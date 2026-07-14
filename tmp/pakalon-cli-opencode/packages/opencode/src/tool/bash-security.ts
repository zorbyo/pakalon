import type { Tree, Node } from "web-tree-sitter"

export namespace BashSecurity {
  const SAFE_COMMANDS = new Set([
    "ls",
    "cat",
    "grep",
    "find",
    "which",
    "pwd",
    "echo",
    "git",
    "head",
    "tail",
    "wc",
    "diff",
    "file",
    "stat",
    "tree",
    "env",
    "printenv",
    "whoami",
    "date",
    "uname",
    "hostname",
    "id",
    "groups",
    "type",
    "realpath",
    "basename",
    "dirname",
    "sort",
    "uniq",
    "cut",
    "tr",
    "tee",
    "hexdump",
    "xxd",
    "od",
    "strings",
    "nl",
    "rev",
    "column",
  ])

  const SAFE_GIT_SUBCOMMANDS = new Set(["status", "log", "diff", "branch", "show", "remote", "tag", "stash list"])

  const SAFE_FIND_FLAGS = new Set(["-name", "-type", "-path", "-iname", "-regex", "-maxdepth", "-mindepth"])

  function tokensFromCommand(node: Node): string[] {
    const tokens: string[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === "command_name" || child.type === "word" || child.type === "string" || child.type === "raw_string") {
        tokens.push(child.text)
      }
    }
    return tokens
  }

  export function isSafeCommand(command: string, tree: Tree): { safe: boolean; reason?: string } {
    for (const node of tree.rootNode.descendantsOfType("command")) {
      if (!node) continue

      const tokens = tokensFromCommand(node)
      if (tokens.length === 0) continue

      const baseCmd = tokens[0]

      if (!SAFE_COMMANDS.has(baseCmd)) {
        return { safe: false, reason: `Command '${baseCmd}' is not in the safe list` }
      }

      if (baseCmd === "git" && tokens.length >= 2) {
        const subcmd = tokens.slice(1).find((t) => !t.startsWith("-")) ?? tokens[1]
        if (!SAFE_GIT_SUBCOMMANDS.has(subcmd)) {
          return { safe: false, reason: `Git subcommand '${subcmd}' is not in the safe list` }
        }
      }

      if (baseCmd === "find") {
        for (const arg of tokens.slice(1)) {
          if (arg.startsWith("-") && !SAFE_FIND_FLAGS.has(arg)) {
            const dangerousFindFlags = new Set(["-exec", "-delete", "-execdir", "-ok", "-okdir"])
            if (dangerousFindFlags.has(arg)) {
              return { safe: false, reason: `find with '${arg}' is not safe` }
            }
          }
        }
      }

      for (const arg of tokens.slice(1)) {
        if (arg.includes(";") || arg.includes("&&") || arg.includes("||") || arg.includes("|")) {
          return { safe: false, reason: "Command chaining detected in arguments" }
        }
      }
    }

    return { safe: true }
  }

  export function detectDangerousPatterns(command: string): { detected: boolean; patterns: string[] } {
    const patterns: string[] = []

    if (/\$\([^)]*\)/.test(command)) {
      patterns.push("Command substitution $(...) detected")
    }

    if (/`[^`]+`/.test(command)) {
      patterns.push("Backtick command substitution `...` detected")
    }

    if (/\$\{[^}]+\}/.test(command)) {
      patterns.push("Variable expansion ${...} detected")
    }

    if (/\\{2}[^\\]+\\/.test(command) || /\\\\[a-zA-Z]/.test(command)) {
      patterns.push("UNC path (\\\\server\\share) detected - may trigger SMB connection and leak credentials")
    }

    return { detected: patterns.length > 0, patterns }
  }

  export function detectUNCPaths(command: string): { detected: boolean; paths: string[] } {
    const paths: string[] = []
    const uncPattern = /\\\\[a-zA-Z0-9._-]+\\[a-zA-Z0-9._$-]+/g
    let match: RegExpExecArray | null
    while ((match = uncPattern.exec(command)) !== null) {
      paths.push(match[0])
    }
    return { detected: paths.length > 0, paths }
  }

  export function detectSelfKill(command: string): { detected: boolean; reason?: string } {
    const cliPid = process.pid
    const killPattern = /\b(kill|killall|pkill)\b.*\b(-9|-15|-TERM|-KILL)?\b.*\b(\d+|[a-zA-Z_][a-zA-Z0-9_]*)\b/

    const killMatch = killPattern.exec(command)
    if (!killMatch) return { detected: false }

    const pidStr = killMatch[3]
    const pid = parseInt(pidStr, 10)

    if (!isNaN(pid) && pid === cliPid) {
      return { detected: true, reason: `Command would kill the pakalon CLI process (PID ${cliPid})` }
    }

    if (pidStr === "pakalon") {
      return { detected: true, reason: `Command would kill the pakalon process` }
    }

    return { detected: false }
  }

  export interface RedirectionInfo {
    hasWriteRedirection: boolean
    targets: string[]
  }

  export function detectOutputRedirection(tree: Tree): RedirectionInfo {
    const targets: string[] = []

    for (const node of tree.rootNode.descendantsOfType("file_redirect")) {
      if (node) {
        targets.push(node.text)
      }
    }

    for (const node of tree.rootNode.descendantsOfType("heredoc_redirect")) {
      if (node) {
        targets.push(node.text)
      }
    }

    for (const node of tree.rootNode.descendantsOfType("redirected_statement")) {
      if (node) {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child && child.type === "file_redirect") {
            targets.push(child.text)
          }
        }
      }
    }

    return { hasWriteRedirection: targets.length > 0, targets }
  }

  export interface SecurityAnalysis {
    safe: boolean
    safeCommand: boolean
    dangerousPatterns: string[]
    uncPaths: string[]
    selfKill: { detected: boolean; reason?: string }
    outputRedirection: RedirectionInfo
    reasons: string[]
  }

  export function analyze(command: string, tree: Tree): SecurityAnalysis {
    const reasons: string[] = []

    const safe = isSafeCommand(command, tree)
    const dangerous = detectDangerousPatterns(command)
    const unc = detectUNCPaths(command)
    const selfKill = detectSelfKill(command)
    const redirection = detectOutputRedirection(tree)

    if (!safe.safe) {
      reasons.push(safe.reason!)
    }

    for (const p of dangerous.patterns) {
      reasons.push(p)
    }

    for (const p of unc.paths) {
      reasons.push(`UNC path detected: ${p}`)
    }

    if (selfKill.detected) {
      reasons.push(selfKill.reason!)
    }

    if (redirection.hasWriteRedirection) {
      reasons.push(`Output redirection detected: ${redirection.targets.join(", ")}`)
    }

    return {
      safe: safe.safe && !dangerous.detected && !unc.detected && !selfKill.detected && !redirection.hasWriteRedirection,
      safeCommand: safe.safe,
      dangerousPatterns: dangerous.patterns,
      uncPaths: unc.paths,
      selfKill,
      outputRedirection: redirection,
      reasons,
    }
  }
}
