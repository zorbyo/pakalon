import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "./util/log"
import { ConsoleCommand } from "./cli/cmd/account"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { NamedError } from "@pakalon-ai/util/error"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { WorkspaceServeCommand } from "./cli/cmd/workspace-serve"
import { Filesystem } from "./util/filesystem"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { CostCommand } from "./cli/cmd/cost"
import { UsageCommand } from "./cli/cmd/usage"
import { MemoryCommand } from "./cli/cmd/memory"
import { EffortCommand } from "./cli/cmd/effort"
import { LoginCommand } from "./cli/cmd/login"
import { McpCommand } from "./cli/cmd/mcp"
import { SkillsCommand } from "./cli/cmd/skills"
import { PluginsCommand } from "./cli/cmd/plugins"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/tui/attach"
import { TuiThreadCommand } from "./cli/cmd/tui/thread"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import { TrustCommand } from "./cli/cmd/trust"
import { DelegateCommand } from "./cli/cmd/delegate"
import { PhaseCommand } from "./cli/cmd/phase"
import { PakalonAgentsCommand } from "./cli/cmd/pakalon-agents"
import { InitCommand } from "./cli/cmd/init"
import { ConnectCommand, ConnectEndCommand } from "./cli/cmd/connect"
import { BranchCommand } from "./cli/cmd/branch"
import { TeleportCommand } from "./cli/cmd/teleport"
import { BridgeCommand } from "./cli/cmd/bridge"
import { BridgeKickCommand } from "./cli/cmd/bridge-kick"
import { RemoteEnvCommand } from "./cli/cmd/remote-env"
import { RemoteSetupCommand } from "./cli/cmd/remote-setup"
import { OauthRefreshCommand } from "./cli/cmd/oauth-refresh"
import { InsightsCommand } from "./cli/cmd/insights"
import { InstallGithubAppCommand } from "./cli/cmd/install-github-app"
import { InstallSlackAppCommand } from "./cli/cmd/install-slack-app"
import { MobileCommand } from "./cli/cmd/mobile"
import { ChromeCommand } from "./cli/cmd/chrome"
import { TerminalSetupCommand } from "./cli/cmd/terminal-setup"
import { PrivacySettingsCommand } from "./cli/cmd/privacy-settings"
import { DebugToolCallCommand } from "./cli/cmd/debug-tool-call"
import { ResetLimitsCommand } from "./cli/cmd/reset-limits"
import { MockLimitsCommand } from "./cli/cmd/mock-limits"
import { ExtraUsageCommand } from "./cli/cmd/extra-usage"
import { RateLimitOptionsCommand } from "./cli/cmd/rate-limit-options"
import { BreakCacheCommand } from "./cli/cmd/break-cache"
import { GoodClaudeCommand } from "./cli/cmd/good-claude"
import { SandboxToggleCommand } from "./cli/cmd/sandbox-toggle"
import { HeapdumpCommand } from "./cli/cmd/heapdump"
import { PerfIssueCommand } from "./cli/cmd/perf-issue"
import path from "path"
import { Global } from "./global"
import { JsonMigration } from "./storage/json-migration"
import { Database } from "./storage/db"

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

let cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("pakalon")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .middleware(async (opts) => {
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    process.env.AGENT = "1"
    process.env.PAKALON = "1"
    process.env.PAKALON = "1"
    process.env.PAKALON_MODE = "1"
    process.env.PAKALON_PID = String(process.pid)

    Log.Default.info("pakalon", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })

    const marker = path.join(Global.Path.data, "pakalon.db")
    if (!(await Filesystem.exists(marker))) {
      const tty = process.stderr.isTTY
      process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
      const width = 36
      const orange = "\x1b[38;5;214m"
      const muted = "\x1b[0;2m"
      const reset = "\x1b[0m"
      let last = -1
      if (tty) process.stderr.write("\x1b[?25l")
      try {
        await JsonMigration.run(Database.Client().$client, {
          progress: (event) => {
            const percent = Math.floor((event.current / event.total) * 100)
            if (percent === last && event.current !== event.total) return
            last = percent
            if (tty) {
              const fill = Math.round((percent / 100) * width)
              const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
              process.stderr.write(
                `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
              )
              if (event.current === event.total) process.stderr.write("\n")
            } else {
              process.stderr.write(`sqlite-migration:${percent}${EOL}`)
            }
          },
        })
      } finally {
        if (tty) process.stderr.write("\x1b[?25h")
        else {
          process.stderr.write(`sqlite-migration:done${EOL}`)
        }
      }
      process.stderr.write("Database migration complete." + EOL)
    }
  })
  .usage("\n" + UI.logo())
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(SkillsCommand)
  .command(PluginsCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(ConsoleCommand)
  .command(ProvidersCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(CostCommand)
  .command(UsageCommand)
  .command(MemoryCommand)
  .command(EffortCommand)
  .command(LoginCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(DbCommand)
  .command(TrustCommand)
  .command(DelegateCommand)
  .command(PhaseCommand)
  .command(BranchCommand)
  .command(TeleportCommand)
  .command(BridgeCommand)
  .command(BridgeKickCommand)
  .command(RemoteEnvCommand)
  .command(RemoteSetupCommand)
  .command(OauthRefreshCommand)
  .command(InsightsCommand)
  .command(InstallGithubAppCommand)
  .command(InstallSlackAppCommand)
  .command(MobileCommand)
  .command(ChromeCommand)
  .command(TerminalSetupCommand)
  .command(PrivacySettingsCommand)
  .command(DebugToolCallCommand)
  .command(ResetLimitsCommand)
  .command(MockLimitsCommand)
  .command(ExtraUsageCommand)
  .command(RateLimitOptionsCommand)
  .command(BreakCacheCommand)
  .command(GoodClaudeCommand)
  .command(SandboxToggleCommand)
  .command(HeapdumpCommand)
  .command(PerfIssueCommand)
  .command(PakalonAgentsCommand)
  .command(InitCommand)
  .command(ConnectCommand)
  .command(ConnectEndCommand)

if (Installation.isLocal()) {
  cli = cli.command(WorkspaceServeCommand)
}

cli = cli
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    process.stderr.write((e instanceof Error ? e.message : String(e)) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
