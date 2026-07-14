import { Log } from "../util/log"

export namespace GitHub {
  const log = Log.create({ service: "deploy:github" })
  const txt = new TextDecoder()

  export interface RunResult {
    ok: boolean
    code: number
    out: string
    err: string
    cmd: string[]
  }

  export interface RepoOpts {
    source?: string
    remote?: string
    visibility?: "public" | "private"
    cwd?: string
  }

  function run(cmd: string[], cwd = process.cwd()): RunResult {
    log.info("run", { cmd, cwd })
    const out = Bun.spawnSync({
      cmd,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const result = {
      ok: out.success,
      code: out.exitCode,
      out: txt.decode(out.stdout).trim(),
      err: txt.decode(out.stderr).trim(),
      cmd,
    }
    if (!result.ok) log.warn("command failed", { cmd, code: result.code, err: result.err })
    return result
  }

  function ensure(result: RunResult): RunResult {
    if (result.ok) return result
    throw new Error(result.err || `command failed (${result.code}): ${result.cmd.join(" ")}`)
  }

  export function isAuthenticated(cwd = process.cwd()): boolean {
    return run(["gh", "auth", "status"], cwd).ok
  }

  export function createRepo(name: string, opts: RepoOpts = {}): RunResult {
    return ensure(
      run(
        [
          "gh",
          "repo",
          "create",
          name,
          opts.visibility === "private" ? "--private" : "--public",
          `--source=${opts.source ?? "."}`,
          `--remote=${opts.remote ?? "origin"}`,
        ],
        opts.cwd,
      ),
    )
  }

  export function createBranch(name: string, cwd = process.cwd()): RunResult {
    ensure(run(["git", "checkout", "-b", name], cwd))
    return ensure(run(["git", "push", "-u", "origin", name], cwd))
  }

  export function createPR(title: string, body: string, base: string, head: string, cwd = process.cwd()): RunResult {
    return ensure(run(["gh", "pr", "create", "--title", title, "--body", body, "--base", base, "--head", head], cwd))
  }

  export function createIssue(title: string, body: string, cwd = process.cwd()): RunResult {
    return ensure(run(["gh", "issue", "create", "--title", title, "--body", body], cwd))
  }

  export function pushToRemote(branch?: string, cwd = process.cwd()): RunResult {
    const status = ensure(run(["git", "status", "--porcelain"], cwd))
    if (status.out.length > 0) {
      ensure(run(["git", "add", "-A"], cwd))
      ensure(run(["git", "commit", "-m", "chore: update generated deploy artifacts"], cwd))
    }
    if (branch) return ensure(run(["git", "push", "-u", "origin", branch], cwd))
    return ensure(run(["git", "push"], cwd))
  }

  export function setupBranchProtection(owner: string, repo: string, cwd = process.cwd()): RunResult {
    return ensure(
      run(
        [
          "gh",
          "api",
          "--method",
          "PUT",
          `repos/${owner}/${repo}/branches/main/protection`,
          "-H",
          "Accept: application/vnd.github+json",
          "-f",
          "required_status_checks[strict]=true",
          "-f",
          "required_status_checks[contexts][]=lint",
          "-f",
          "required_status_checks[contexts][]=test",
          "-f",
          "required_status_checks[contexts][]=build",
          "-f",
          "enforce_admins=true",
          "-f",
          "required_pull_request_reviews[required_approving_review_count]=1",
        ],
        cwd,
      ),
    )
  }

  export function formatPRSummary(title: string, changes: string[]): string {
    const rows = changes.map((x) => `- ${x}`).join("\n")
    return [`## ${title}`, "", "### Summary", rows || "- No changes listed", "", "### Validation", "- [ ] CI passes", "- [ ] Manual checks done"].join("\n")
  }
}
