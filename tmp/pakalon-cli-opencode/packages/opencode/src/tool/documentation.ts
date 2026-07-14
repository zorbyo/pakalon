import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./documentation.txt"
import { Installation } from "../installation"
import path from "path"
import { Instance } from "../project/instance"
import { Config } from "../config/config"

const CLI_COMMANDS: Record<string, string> = {
  tui: "Start the interactive TUI. Usage: pakalon [project]",
  run: "Run a prompt non-interactively. Usage: pakalon run --prompt <prompt>",
  generate: "Generate code using AI. Usage: pakalon generate <description>",
  serve: "Start the HTTP/WebSocket server. Usage: pakalon serve",
  web: "Open the web dashboard. Usage: pakalon web",
  models: "List available AI models. Usage: pakalon models",
  providers: "Manage AI providers. Usage: pakalon providers",
  agent: "Manage agents. Usage: pakalon agent",
  mcp: "Manage MCP servers. Usage: pakalon mcp [list|add|auth|logout]",
  trust: "Manage trusted directories. Usage: pakalon trust [list|add|remove]",
  delegate: "Delegate a task to a remote repo. Usage: pakalon delegate <task> --repo owner/repo",
  session: "Manage sessions. Usage: pakalon session [list|delete|rename|export]",
  upgrade: "Upgrade pakalon to the latest version. Usage: pakalon upgrade",
  uninstall: "Uninstall pakalon. Usage: pakalon uninstall",
  debug: "Debug utilities. Usage: pakalon debug [config|lsp|file|skill]",
  stats: "Show usage statistics. Usage: pakalon stats",
  export: "Export a session. Usage: pakalon export <session-id>",
  import: "Import a session. Usage: pakalon import <url>",
  pr: "Checkout a GitHub PR. Usage: pakalon pr <number>",
  github: "GitHub integration. Usage: pakalon github",
  db: "Database management. Usage: pakalon db [migrate|status]",
  acp: "Agent Client Protocol. Usage: pakalon acp",
  completion: "Generate shell completion script. Usage: pakalon completion",
}

const CONFIG_OPTIONS: Record<string, string> = {
  model: "Model to use in the format provider/model (e.g., anthropic/claude-sonnet-4-20250514)",
  small_model: "Small model for tasks like title generation",
  username: "Custom username displayed in conversations",
  logLevel: "Log level: DEBUG, INFO, WARN, ERROR",
  share: "Session sharing: manual, auto, or disabled",
  autoupdate: "Auto-update behavior: true, false, or notify",
  mcp: "MCP server configurations (object with server configs)",
  permission: "Permission rules for tools (allow/deny/ask)",
  provider: "Custom provider configurations and model overrides",
  agent: "Agent configuration with model, temperature, prompt, etc.",
  plugin: "Array of plugin packages or paths to load",
  instructions: "Additional instruction files or patterns",
  lsp: "LSP server configuration (false to disable, or object with server configs)",
  formatter: "Code formatter configuration",
  server: "Server config: port, hostname, mdns, cors",
  compaction: "Context compaction: auto, prune, reserved tokens",
  command: "Custom slash command definitions",
  skills: "Additional skill folder paths and URLs",
  enterprise: "Enterprise config: url",
}

const TOOLS_INFO: Record<string, string> = {
  bash: "Execute shell commands in the project directory",
  read: "Read file contents with line numbers",
  write: "Write content to a file (creates or overwrites)",
  edit: "Apply targeted edits to files using 9 replacement strategies",
  glob: "Find files matching glob patterns",
  grep: "Search file contents using ripgrep",
  task: "Spawn a subagent to perform a task",
  fleet: "Dispatch multiple subagent tasks in parallel",
  webfetch: "Fetch and extract content from a URL",
  websearch: "Search the web using Exa AI",
  codesearch: "Search code using Exa Code API",
  question: "Ask the user clarifying questions",
  store_memory: "Store a fact or preference across sessions",
  retrieve_memory: "Search previously stored memories",
  list_memories: "List all stored memories",
  read_agent: "Check progress of a background agent",
  report_intent: "Report planned actions before execution",
  show_file: "Display a file prominently for user review",
  todowrite: "Update the task checklist",
  skill: "Execute a skill from the skill directory",
  apply_patch: "Apply a patch using Codex-style format",
  lsp: "Query LSP for diagnostics, hover, definitions",
  batch: "Execute multiple tool calls in a single batch",
}

export const PakalonDocumentationTool = Tool.define("fetch_pakalon_documentation", {
  description: DESCRIPTION,
  parameters: z.object({
    topic: z
      .enum(["commands", "config", "tools", "version", "agents", "plugins", "all"])
      .describe("The topic to get documentation for"),
  }),
  async execute(params) {
    let output = ""

    switch (params.topic) {
      case "commands": {
        output = "Pakalon CLI Commands:\n\n"
        for (const [cmd, desc] of Object.entries(CLI_COMMANDS)) {
          output += `  pakalon ${cmd}\n    ${desc}\n\n`
        }
        break
      }

      case "config": {
        output = "Pakalon Configuration Options (pakalon.json):\n\n"
        for (const [key, desc] of Object.entries(CONFIG_OPTIONS)) {
          output += `  ${key}: ${desc}\n`
        }
        output += "\nConfig cascade (low → high precedence):\n"
        output += "  1. Remote .well-known/pakalon (org defaults)\n"
        output += "  2. Global (~/.config/pakalon/pakalon.json)\n"
        output += "  3. Custom (PAKALON_CONFIG env var)\n"
        output += "  4. Project (pakalon.json in project root)\n"
        output += "  5. .pakalon directories\n"
        output += "  6. Inline (PAKALON_CONFIG_CONTENT env var)\n"
        output += "  7. Account/org config\n"
        output += "  8. Managed (/etc/pakalon or /Library/Application Support/pakalon)\n"
        break
      }

      case "tools": {
        output = "Pakalon Available Tools:\n\n"
        for (const [tool, desc] of Object.entries(TOOLS_INFO)) {
          output += `  ${tool}: ${desc}\n`
        }
        break
      }

      case "version": {
        output = [
          `Pakalon Version: ${Installation.VERSION}`,
          `Directory: ${Instance.directory}`,
          `Worktree: ${Instance.worktree}`,
          `Project: ${Instance.project.id}`,
          `VCS: ${Instance.project.vcs ?? "none"}`,
        ].join("\n")
        break
      }

      case "agents": {
        const config = await Config.get()
        output = "Agent Configuration:\n\n"
        for (const [name, agent] of Object.entries(config.agent ?? {})) {
          output += `  ${name}:\n`
          if (agent?.model) output += `    model: ${agent.model}\n`
          if (agent?.mode) output += `    mode: ${agent.mode}\n`
          if (agent?.description) output += `    description: ${agent.description}\n`
          output += "\n"
        }
        break
      }

      case "plugins": {
        const config = await Config.get()
        output = "Plugin System:\n\n"
        output += "Plugins are loaded from:\n"
        output += "  1. Built-in: pakalon-anthropic-auth, codex-auth, copilot-auth\n"
        output += "  2. Config: pakalon.json plugin array (npm packages or file:// paths)\n"
        output += "  3. Local: .pakalon/plugins/*.ts or .pakalon/plugin/*.ts\n\n"
        if (config.plugin && config.plugin.length > 0) {
          output += "Configured plugins:\n"
          for (const p of config.plugin) {
            output += `  - ${p}\n`
          }
        } else {
          output += "No additional plugins configured.\n"
        }
        output += "\nPlugin hooks: tool.execute.before, tool.execute.after, shell.env, config, event\n"
        break
      }

      case "all": {
        output = [
          "=== PAKALON CLI REFERENCE ===",
          "",
          `Version: ${Installation.VERSION}`,
          "",
          "--- COMMANDS ---",
          ...Object.entries(CLI_COMMANDS).map(([cmd, desc]) => `  pakalon ${cmd}: ${desc}`),
          "",
          "--- TOOLS ---",
          ...Object.entries(TOOLS_INFO).map(([tool, desc]) => `  ${tool}: ${desc}`),
          "",
          "--- CONFIG KEYS ---",
          ...Object.entries(CONFIG_OPTIONS).map(([key, desc]) => `  ${key}: ${desc}`),
          "",
          "--- CONFIG PRECEDENCE ---",
          "  Remote → Global → Custom → Project → .pakalon → Inline → Account → Managed",
        ].join("\n")
        break
      }
    }

    return {
      title: `Documentation: ${params.topic}`,
      output,
      metadata: { topic: params.topic },
    }
  },
})
