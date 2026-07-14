import { cmd } from "./cmd"
import { UI } from "../ui"

export const HelpCommand = cmd({
  command: "help [command]",
  describe: "Show help for commands",
  builder: (yargs) =>
    yargs.positional("command", {
      type: "string",
      describe: "Command to get help for",
    }),
  async handler(args: { command?: string }) {
    if (args.command) {
      // Show help for specific command
      UI.println(UI.Style.TEXT_INFO + `Help for /${args.command}:`)
      UI.empty()
      
      const commandHelp: Record<string, string> = {
        init: "Initialize a new .pakalon folder structure in the current directory",
        session: "Manage conversation sessions - list, select, delete, or export",
        mcp: "Manage MCP (Model Context Protocol) server connections",
        agent: "Manage and interact with AI agents",
        plugins: "List and manage installed plugins",
        skills: "View and manage available skills",
        stats: "Show usage statistics and metrics",
        clear: "Clear the terminal screen",
        exit: "Exit the CLI",
        help: "Show this help message",
        version: "Show version information",
        config: "View or modify configuration settings",
        commit: "Create a git commit with AI-generated message",
        diff: "Show git diff with AI analysis",
        doctor: "Diagnose and fix common issues",
        compact: "Compact session history to save tokens",
        models: "Switch the AI model",
        memory: "Manage conversation memory",
        status: "Show current session status",
        plan: "View or create implementation plans",
        review: "Review code changes",
        resume: "Resume a paused session",
      }

      const help = commandHelp[args.command]
      if (help) {
        UI.println(help)
      } else {
        UI.println(UI.Style.TEXT_WARN + `Unknown command: ${args.command}`)
        UI.println("Use /help to see all available commands")
      }
    } else {
      // Show general help
      UI.println(UI.Style.TEXT_HIGHLIGHT + "Pakalon CLI - Available Commands")
      UI.empty()
      
      const categories = {
        "Session Management": [
          { cmd: "/session", desc: "Manage sessions" },
          { cmd: "/clear", desc: "Clear terminal" },
          { cmd: "/exit", desc: "Exit CLI" },
          { cmd: "/compact", desc: "Compact session" },
          { cmd: "/resume", desc: "Resume session" },
        ],
        "Git & Code": [
          { cmd: "/commit", desc: "AI commit message" },
          { cmd: "/diff", desc: "Show diff" },
          { cmd: "/review", desc: "Code review" },
          { cmd: "/plan", desc: "Implementation plan" },
        ],
        "Configuration": [
          { cmd: "/config", desc: "Settings" },
          { cmd: "/models", desc: "Switch model" },
          { cmd: "/plugins", desc: "Manage plugins" },
          { cmd: "/skills", desc: "View skills" },
        ],
        "System": [
          { cmd: "/init", desc: "Initialize project" },
          { cmd: "/doctor", desc: "Diagnose issues" },
          { cmd: "/stats", desc: "Show statistics" },
          { cmd: "/version", desc: "Show version" },
          { cmd: "/memory", desc: "Manage memory" },
          { cmd: "/status", desc: "Session status" },
        ],
        "MCP & Agents": [
          { cmd: "/mcp", desc: "MCP servers" },
          { cmd: "/agent", desc: "Manage agents" },
        ],
      }

      for (const [category, commands] of Object.entries(categories)) {
        UI.println(UI.Style.TEXT_INFO + category + ":")
        for (const { cmd, desc } of commands) {
          UI.println(`  ${UI.Style.TEXT_HIGHLIGHT}${cmd.padEnd(15)}${UI.Style.RESET}${desc}`)
        }
        UI.empty()
      }

      UI.println(UI.Style.TEXT_DIM + "Use /help <command> for detailed help")
    }
  },
})
