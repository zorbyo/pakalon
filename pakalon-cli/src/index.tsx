#!/usr/bin/env bun
/**
 * Pakalon CLI entry point — yargs command parser + Ink renderer.
 */
import React from "react";
import { render } from "ink";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import App from "@/app.js";
import BuildScreen from "@/components/screens/BuildScreen.js";
import SplashLoginScreen from "@/frontend/screens/SplashLoginScreen.js";
import { ErrorBoundary } from "@/components/ErrorBoundary.js";
import { logout } from "@/auth/device-flow.js";
import { isAuthenticated } from "@/auth/storage.js";
import { cmdListModels, cmdSetModel } from "@/commands/models.js";
import { cmdGeneratePrint } from "@/commands/generate.js";
import { cmdEnterprisePrint } from "@/commands/enterprise.js";
import type { EnterpriseService, EnterpriseAction } from "@/commands/enterprise.js";
import { cmdListSessions, cmdCreateSession, cmdResumeSession } from "@/commands/session.js";
import { cmdStatus, formatStatus } from "@/commands/status.js";
import { cmdUpgrade } from "@/commands/upgrade.js";
import { cmdDoctor } from "@/commands/doctor.js";
import { cmdInstall } from "@/commands/install.js";
import { cmdSetupToken } from "@/commands/setup-token.js";
import { cmdUpdateCli } from "@/commands/update-cli.js";
import {
  addMcpServer,
  removeMcpServer,
  listMcpServers,
  installMcpServer,
  discoverMcpServers,
  uninstallMcpServer,
  listVendoredMcpServerPresets,
  importVendoredMcpServers,
} from "@/mcp/manager.js";
import { searchRegistry } from "@/mcp/registry.js";
import { summarizeVendoredEverythingAssets } from "@/utils/claude-imports.js";
import { initHooksConfig } from "@/ai/hooks.js";
import {
  getHooksConfigPath,
  importVendoredHooks,
  listConfiguredHooks,
  listVendoredHookPresets,
  removeConfiguredHookEntry,
} from "@/hooks/manager.js";
import {
  discoverCommandCatalog,
  findCommandCatalogEntry,
  getCommandImportTargetDir,
  importCatalogCommands,
  searchCommandCatalog,
} from "@/commands/catalog.js";
import {
  importVendoredSkills,
  listImportableVendoredSkills,
} from "@/skills/importer.js";
import {
  importVendoredManifestModules,
  importVendoredManifestProfile,
  loadVendoredManifestCatalog,
} from "@/manifests/manager.js";
import { cmdHistory } from "@/commands/history.js";
import { getAllAgents } from "@/commands/agents.js";
import { cmdDirectory } from "@/commands/directory.js";
import { cmdListWorkflows, cmdSaveWorkflow, cmdDeleteWorkflow } from "@/commands/workflows.js";
import { cmdListPlugins, cmdInstallPlugin, cmdRemovePlugin, cmdCheckUpdates, cmdAutoUpdate, cmdListMarketplace } from "@/commands/plugins.js";
import { cmdSecurity } from "@/commands/security.js";
import { cmdTrace } from "@/commands/trace.js";
import { cachePrContext, formatPrContextForPrompt } from "@/utils/github-pr.js";
import { runPrintMode, readStdin, buildSystemPrompt } from "@/utils/print-mode.js";
import type { OutputFormat } from "@/utils/print-mode.js";
import logger from "@/utils/logger.js";
import { EXIT_SUCCESS, EXIT_AUTH_ERROR, EXIT_API_ERROR } from "@/utils/exit-codes.js";
import { initTelemetry, shutdownTelemetry } from "@/utils/telemetry.js";
import { setAllowAllTools, addAllowTool, addDenyTool } from "@/ai/tool-permissions.js";
import { isSelfHosted, loadModeConfig } from "@/config/mode.js";
import { discoverAllLocalModels } from "@/ai/local/discovery.js";
import { initLocalDatabase, loadLocalModelRegistry } from "@/db/local.js";
import { initDiagnostics, logForDiagnosticsNoPII } from "@/utils/diagnostics.js";
import { feature, enableFeature, disableFeature } from "@/utils/features.js";

async function initializeSelfHostedRuntime(): Promise<void> {
  initLocalDatabase();
  try {
    await discoverAllLocalModels();
  } catch {
    // Local providers are optional at startup; /models will show setup guidance.
  }
}

function normalizeCliPermissionMode(args: Record<string, unknown>) {
  if (args["plan"]) return "plan";
  if (args["edit"] || args["HIL"] || args["hil"]) return "normal";
  if (args["yolo"] || args["auto-accept"] || args["bypass-permissions"]) {
    return "auto-accept";
  }

  const raw = typeof args["permission-mode"] === "string"
    ? args["permission-mode"].toLowerCase()
    : undefined;

  if (raw === "edit" || raw === "hil" || raw === "human-in-loop") return "normal";
  if (raw === "bypass" || raw === "yolo" || raw === "auto") return "auto-accept";
  if (raw === "plan" || raw === "normal" || raw === "auto-accept" || raw === "orchestration") {
    return raw;
  }
  return undefined;
}

async function main() {
  // Global error handling to prevent unhandled rejections/exceptions from exiting the process
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    // Continue running; the error will be handled elsewhere or logged
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    // Continue running; this is a last-resort log
  });

  if (isSelfHosted()) {
    await initializeSelfHostedRuntime();
  }

  // T-CLI-OTEL: initialise OpenTelemetry when PAKALON_ENABLE_TELEMETRY=1
  await initTelemetry();

  // Initialize diagnostics logging (PII-safe)
  initDiagnostics({
    enabled: true,
    level: process.env.PAKALON_DEBUG ? "debug" : "info",
    stripPII: true,
  });
  logForDiagnosticsNoPII("info", "cli_started", { version: process.env.npm_package_version });

  const argv = await yargs(hideBin(process.argv))
    .scriptName("pakalon")
    .usage("$0 [message]  Start a chat session")
    .command(
      "$0 [message]",
      "Start a chat (or send a one-shot message)",
      (y) =>
        y
          .positional("message", { type: "string", describe: "Message to send directly" })
          .option("agent", { alias: "a", type: "boolean", describe: "Start in agent mode" })
          .option("dir", { alias: "d", type: "string", describe: "Project directory" })
          .option("no-banner", { type: "boolean", describe: "Hide the banner" })
          .option("permission-mode", { type: "string", choices: ["plan", "normal", "auto-accept", "orchestration", "edit", "bypass", "yolo", "hil", "human-in-loop"] as const, describe: "Permission mode: plan, normal/HIL (ask first), auto-accept/YOLO, orchestration (Q&A only)" })
          .option("plan", { type: "boolean", describe: "Start in plan (read-only) mode" })
          .option("edit", { type: "boolean", describe: "Start in normal mode (ask before actions)" })
          .option("auto-accept", { type: "boolean", describe: "Start in auto-accept mode" })
          .option("yolo", { type: "boolean", describe: "Start in YOLO mode (auto-accept all permitted actions)" })
          .option("HIL", { type: "boolean", describe: "Start in Human-in-Loop mode (ask before actions)" })
          .option("hil", { type: "boolean", describe: "Start in Human-in-Loop mode (ask before actions)" })
          .option("bypass-permissions", { type: "boolean", describe: "Start in bypass mode (YOLO — no confirmations)" })
          .option("model", { alias: "m", type: "string", describe: "Model to use" })
          .option("defaultModel", { type: "string", describe: "Default model to use" })
          .option("fallbackModel", { type: "string", describe: "Fallback model when default fails" })
          .option("verbose", { type: "boolean", describe: "Verbose output mode" })
          .option("debug", { type: "boolean", describe: "Enable debug logging" })
          .option("session-id", { type: "string", describe: "Resume a specific session" })
          .option("add-dir", { type: "array", string: true, describe: "Additional project directories to include in context" })
           .option("allowedTools", { type: "string", describe: "Comma-separated list of allowed tool names" })
           .option("allow-all-tools", { type: "boolean", default: false, describe: "Bypass all tool permission prompts (dangerous)" })
           .option("allow-tool", { type: "array", string: true, describe: "Allow a specific tool (e.g., 'bash' or 'bash(git)'). Can be repeated." })
           .option("deny-tool", { type: "array", string: true, describe: "Deny a specific tool (e.g., 'bash(rm)'). Can be repeated." })
           .option("jsonl", { type: "boolean", default: false, describe: "Output in JSONL format (one JSON object per line) for scripting" })
           .option("MCP", { type: "array", string: true, describe: "Additional MCP server URLs to connect on startup" })
          .option("fork-session", { type: "boolean", default: false, describe: "Fork the current session into a new one" })
          .option("replay-user-messages", { type: "boolean", default: false, describe: "Replay persisted user messages from the last session" })
          .option("continue", { alias: "c", type: "boolean", default: false, describe: "Resume the most recent session (same as --session-id with last id)" })
          .option("file", { type: "array", string: true, describe: "File(s) to inject as context at startup (paths relative to cwd)" })
          .option("settings", { type: "string", describe: "Path to a JSON settings file (overrides env defaults)" })
          .option("max-budget-usd", { type: "number", describe: "Maximum spend budget in USD; stops generation when exceeded" })
          .option("mcp-config", { type: "string", describe: "Path to an extra MCP server config JSON file to load on startup" })
          // ── Claude Code–parity flags ──────────────────────────────────────
          .option("print", { alias: "p", type: "boolean", default: false, describe: "Non-interactive: stream response to stdout without TUI and exit" })
          .option("output-format", { type: "string", choices: ["text", "json", "stream-json"] as const, default: "text", describe: "Output format for --print mode (text | json | stream-json)" })
          .option("system-prompt", { type: "string", describe: "Override the default system prompt" })
          .option("system-prompt-file", { type: "string", describe: "Read system prompt from a file" })
          .option("append-system-prompt", { type: "string", describe: "Append text after the default system prompt" })
          .option("append-system-prompt-file", { type: "string", describe: "Append file contents after the default system prompt" })
          .option("disable-slash-commands", { type: "boolean", default: false, describe: "Disable slash-command parsing in the TUI" })
          .option("disallowed-tools", { type: "string", describe: "Comma-separated list of tool names to disallow" })
          .option("input-format", { type: "string", choices: ["text", "json"] as const, default: "text", describe: "Format of the message argument (text or JSON messages array)" })
          .option("mcp-debug", { type: "boolean", default: false, describe: "Enable MCP server debugging output" })
          .option("debug-file", { type: "string", describe: "Path to debug log file" })
          .option("penpot-cooldown", { type: "number", describe: "Penpot sync cooldown in milliseconds" })
          .option("screenshot-threshold", { type: "number", describe: "Screenshot comparison threshold (0-1)" })
          .option("setting-sources", { type: "string", choices: ["env", "file", "cli"] as const, describe: "Source for settings: env, file, or cli" })
          .option("alt-screen", { type: "boolean", default: false, describe: "Use alternate screen buffer (full-screen TUI)" })
          .option("screen-reader", { type: "boolean", default: false, describe: "Screen reader mode — static text instead of spinners" })
          .option("streamer-mode", { type: "boolean", default: false, describe: "Hide model names and quota for recordings" })
          .option("secret-env-vars", { type: "string", describe: "Comma-separated env var names to redact from output" }),
      async (args) => {
        if (args.debug) {
          process.env["PAKALON_DEBUG"] = "1";
        }

        // ── --allow-all-tools / --allow-tool / --deny-tool: permission overrides ──
        if ((args as any)["allow-all-tools"]) {
          setAllowAllTools(true);
        }
        const allowTools = (args as any)["allow-tool"] as string[] | undefined;
        if (allowTools && allowTools.length > 0) {
          for (const pattern of allowTools) {
            addAllowTool(pattern);
          }
        }
        const denyTools = (args as any)["deny-tool"] as string[] | undefined;
        if (denyTools && denyTools.length > 0) {
          for (const pattern of denyTools) {
            addDenyTool(pattern);
          }
        }

        // ── --jsonl: set JSONL output format for print mode ──
        if ((args as any)["jsonl"]) {
          (args as any)["output-format"] = "jsonl";
        }

        // ── --alt-screen: enter alternate screen buffer ───────────────────
        if (args["alt-screen"]) {
          const { setupAltScreen } = await import("@/utils/alt-screen.js");
          setupAltScreen();
        }

        // ── --screen-reader: enable accessible mode ───────────────────────
        if (args["screen-reader"]) {
          const { enableScreenReaderMode } = await import("@/utils/screen-reader.js");
          enableScreenReaderMode();
        }

        // ── --streamer-mode: hide model names for recordings ──────────────
        if (args["streamer-mode"]) {
          process.env["PAKALON_STREAMER_MODE"] = "1";
        }

        if (typeof args["penpot-cooldown"] === "number" && Number.isFinite(args["penpot-cooldown"])) {
          process.env["PENPOT_SYNC_COOLDOWN_MS"] = String(args["penpot-cooldown"]);
        }

        if (typeof args["screenshot-threshold"] === "number" && Number.isFinite(args["screenshot-threshold"])) {
          process.env["SCREENSHOT_THRESHOLD"] = String(args["screenshot-threshold"]);
        }

        // ── --secret-env-vars: initialize redaction ───────────────────────
        const secretEnvVars = args["secret-env-vars"] as string | undefined;
        if (secretEnvVars) {
          const { initSecretRedaction } = await import("@/utils/secret-redaction.js");
          initSecretRedaction(secretEnvVars);
        }

        // ── stdin piping: read piped content and prepend to message ──────────
        const stdinContent = await readStdin();
        let finalMessage = args.message ?? "";
        if (stdinContent) {
          finalMessage = stdinContent + (finalMessage ? `\n\n${finalMessage}` : "");
        }

        // ── --print / -p mode: non-interactive one-shot output ───────────────
        if ((args as any).print || (args as any).p) {
          if (!finalMessage) {
            process.stderr.write("Error: a message is required in --print mode.\n");
            process.exit(1);
          }
          await runPrintMode({
            message: finalMessage,
            model: args.model,
            systemPrompt: args["system-prompt"] as string | undefined,
            systemPromptFile: args["system-prompt-file"] as string | undefined,
            appendSystemPrompt: args["append-system-prompt"] as string | undefined,
            appendSystemPromptFile: args["append-system-prompt-file"] as string | undefined,
            outputFormat: ((args as any)["output-format"] as OutputFormat) ?? "text",
          });
          process.exit(EXIT_SUCCESS);
        }

        // ── --betas: enable experimental feature flags via env vars ─────────
        const betaFlags: string[] = ((args as any)["betas"] as string | undefined)
          ?.split(",")
          .map((f: string) => f.trim().toLowerCase())
          .filter(Boolean) ?? [];
        for (const flag of betaFlags) {
          const envKey = `PAKALON_BETA_${flag.toUpperCase().replace(/-/g, "_")}`;
          process.env[envKey] = "1";
        }

        // ── --ide: set IDE integration mode env var ───────────────────────────
        const ideMode = (args as any)["ide"] as string | undefined;
        if (ideMode && ideMode !== "none") {
          process.env["PAKALON_IDE_MODE"] = ideMode;
        }

        // ── --teammate-mode: forces plan (read-only) + teammate indicator ─────
        const isTeammateMode = Boolean((args as any)["teammate-mode"]);

        // ── --worktree: create/reuse a git worktree and use it as projectDir ──
        let resolvedProjectDir = args.dir ?? process.cwd();
        const worktreePath = (args as any)["worktree"] as string | undefined;
        if (worktreePath) {
          const { execSync: _exec } = await import("child_process");
          const { existsSync: _exists } = await import("fs");
          const abs = path.resolve(worktreePath);
          try {
            if (!_exists(abs)) {
              const branch = `pakalon-wt-${Date.now()}`;
              _exec(`git worktree add "${abs}" -b "${branch}"`, {
                cwd: resolvedProjectDir,
                stdio: "pipe",
              });
              process.stderr.write(`[OK] Created git worktree at ${abs}\n`);
              // T-HK-11: Fire WorktreeCreate hook
              try {
                const { runHooks: _runHooks } = await import("@/ai/hooks.js");
                _runHooks("WorktreeCreate", {
                  cwd: resolvedProjectDir,
                  toolInput: { path: abs, branch },
                }, resolvedProjectDir).catch(() => {});
              } catch { /* non-fatal */ }
            } else {
              process.stderr.write(`[OK] Using worktree at ${abs}\n`);
            }
            resolvedProjectDir = abs;
          } catch (wtErr: unknown) {
            const msg = wtErr instanceof Error ? wtErr.message : String(wtErr);
            process.stderr.write(`[!] Worktree setup failed (${msg}), falling back to ${resolvedProjectDir}\n`);
          }
          // T-HK-11: Fire WorktreeRemove hook on process exit
          const _origDir = resolvedProjectDir;
          const _worktreeAbs = path.resolve(worktreePath);
          const _onExit = () => {
            try {
              const { runHooks: _rh } = require("@/ai/hooks.js") as typeof import("@/ai/hooks.js");
              _rh("WorktreeRemove", {
                cwd: _origDir,
                toolInput: { path: _worktreeAbs },
              }, _origDir).catch(() => {});
            } catch { /* non-fatal */ }
          };
          process.once("exit", _onExit);
          process.once("SIGINT", _onExit);
          process.once("SIGTERM", _onExit);
        }

        const projectDir = resolvedProjectDir;
        await render(
          React.createElement(ErrorBoundary, null,
            React.createElement(App, {
              initialMessage: finalMessage || undefined,
              projectDir,
              forceAgent: args.agent ?? false,
              showBanner: args["no-banner"] ? false : true,
              permissionMode: isTeammateMode
                ? "plan"
                : normalizeCliPermissionMode(args as Record<string, unknown>),
              modelOverride: args.model,
              defaultModel: args.defaultModel,
              fallbackModel: args.fallbackModel,
              sessionIdOverride: args["session-id"],
              addDirs: (args["add-dir"] as string[] | undefined) ?? [],
              allowedTools: args.allowedTools ?? undefined,
              mcpServers: (args["MCP"] as string[] | undefined) ?? [],
              forkSession: args["fork-session"] ?? false,
              replayUserMessages: args["replay-user-messages"] ?? false,
              continueSession: args["continue"] ?? false,
              fileContexts: (args["file"] as string[] | undefined) ?? [],
              settingsFile: args["settings"] as string | undefined,
              maxBudgetUsd: args["max-budget-usd"] as number | undefined,
              mcpConfigFile: args["mcp-config"] as string | undefined,
              disableSlashCommands: (args as any)["disable-slash-commands"] ?? false,
              systemPrompt: buildSystemPrompt({
                systemPrompt: args["system-prompt"] as string | undefined,
                systemPromptFile: args["system-prompt-file"] as string | undefined,
                appendSystemPrompt: args["append-system-prompt"] as string | undefined,
                appendSystemPromptFile: args["append-system-prompt-file"] as string | undefined,
              }) || undefined,
              fromPr: args["from-pr"] as string | undefined,
              ideMode: (ideMode ?? undefined) as "none" | "cursor" | "vscode" | "windsurf" | undefined,
              teammateMode: isTeammateMode,
              betas: betaFlags,
            })
          )
        ).waitUntilExit();
      }
    )
    .command("login", "Authenticate with GitHub via device code", {}, async () => {
      if (isSelfHosted()) {
        console.log("Pakalon is running in self-hosted mode. Login is not required.");
        process.exit(EXIT_SUCCESS);
      }

      let unmountFn: (() => void) | undefined;

      await new Promise<void>((resolve, reject) => {
        const { unmount, waitUntilExit } = render(
          React.createElement(SplashLoginScreen, {
            showAnimation: false,
            onAuthenticated: () => {
              unmountFn?.();
              resolve();
            },
          })
        );
        unmountFn = unmount;
        waitUntilExit().catch(reject);
      });
      process.exit(EXIT_SUCCESS);
    })
    .command("logout", "Log out and clear credentials", {}, async () => {
      const result = await logout();
      const backendStatus = result.backendLogoutAttempted
        ? (result.backendLogoutSucceeded ? "backend token revoked" : "backend revocation unavailable")
        : "no backend token to revoke";
      console.log(result.webLogoutAttempted
        ? `[OK] Logged out (${backendStatus}) and opened website sign-out: ${result.webLogoutUrl}`
        : `[OK] Logged out (${backendStatus})`);
      process.exit(EXIT_SUCCESS);
    })
    .command(
      "model [action] [id]",
      "List or set the active model",
      (y) =>
        y
          .positional("action", { type: "string", choices: ["list", "set"] as const, default: "list" })
          .positional("id", { type: "string", describe: "Model ID (for set)" }),
      async (args) => {
        if (!isAuthenticated()) {
          console.error("Not logged in. Run `pakalon login` first.");
          process.exit(EXIT_AUTH_ERROR);
        }
        try {
          if (args.action === "set" && args.id) {
            await cmdSetModel(args.id);
            console.log(`[OK] Model set to ${args.id}`);
          } else {
            // T-CLI-15: Show remaining context % for each model
            await cmdListModels();
          }
        } catch (err) {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(EXIT_API_ERROR);
        }
        process.exit(EXIT_SUCCESS);
      }
    )
    .command("status", "Show account and trial status", {}, async () => {
      if (isSelfHosted()) {
        const config = loadModeConfig();
        const models = loadLocalModelRegistry();
        console.log("\nPakalon Status");
        console.log("  Mode: self-hosted");
        console.log(`  Storage: ${config.storage.path}`);
        console.log(`  Ollama: ${config.localProviders.ollama?.enabled ? config.localProviders.ollama.baseUrl : "disabled"}`);
        console.log(`  LM Studio: ${config.localProviders.lmstudio?.enabled ? config.localProviders.lmstudio.baseUrl : "disabled"}`);
        console.log(`  Local models: ${models.length}\n`);
        process.exit(EXIT_SUCCESS);
      }

      if (!isAuthenticated()) {
        console.error("Not logged in. Run `pakalon login` first.");
        process.exit(EXIT_AUTH_ERROR);
      }
      try {
        const info = await cmdStatus();
        console.log(formatStatus(info));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(EXIT_API_ERROR);
      }
      process.exit(EXIT_SUCCESS);
    })
    .command("upgrade", "Upgrade to Pakalon Pro", {}, async () => {
      if (isSelfHosted()) {
        console.log("Self-hosted mode has no billing tier. All local models are available without upgrade.");
        process.exit(EXIT_SUCCESS);
      }

      if (!isAuthenticated()) {
        console.error("Not logged in. Run `pakalon login` first.");
        process.exit(EXIT_AUTH_ERROR);
      }
      try {
        const url = await cmdUpgrade();
        console.log(`\n→ Open this URL to upgrade:\n  ${url}\n`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(EXIT_API_ERROR);
      }
      process.exit(EXIT_SUCCESS);
    })
    .command(
      "session [action] [id]",
      "Manage chat sessions",
      (y) =>
        y
          .positional("action", {
            type: "string",
            choices: ["list", "new", "clear", "resume"] as const,
            default: "list",
          })
          .positional("id", { type: "string", describe: "Session ID (for resume)" }),
      async (args) => {
        if (!isAuthenticated()) {
          console.error("Not logged in.");
          process.exit(EXIT_AUTH_ERROR);
        }
        try {
          if (args.action === "new") {
            const s = await cmdCreateSession();
            console.log(`[OK] New session: ${s.id}`);
          } else if (args.action === "resume") {
            const id = await cmdResumeSession(args.id);
            console.log(id ? `[OK] Resumed session: ${id}` : "No sessions found to resume.");
          } else if (args.action === "list") {
            const sessions = await cmdListSessions();
            for (const s of sessions) {
              console.log(`  ${s.id}  ${s.title ?? "(untitled)"}  [${s.mode}]  ${s.created_at.slice(0, 10)}`);
            }
          }
        } catch (err) {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(EXIT_API_ERROR);
        }
        process.exit(EXIT_SUCCESS);
      }
    )
    .command("history", "Show session history", (y) =>
      y
        .option("limit", { type: "number", default: 20, describe: "Max sessions to show" })
        .option("dir", { alias: "d", type: "string", describe: "Filter by project directory" })
        .option("json-schema", { type: "boolean", default: false, describe: "Output full JSON array" })
        .option("include-partial-messages", { type: "boolean", default: false, describe: "Include sessions with incomplete messages" }),
      async (args) => {
        if (!isAuthenticated()) { console.error("Not logged in."); process.exit(EXIT_AUTH_ERROR); }
        await cmdHistory(args.limit, {
          projectDir: args.dir,
          jsonSchema: args["json-schema"],
          includePartialMessages: args["include-partial-messages"],
        });
        process.exit(EXIT_SUCCESS);
      }
    )
    .command(
      "agents [action] [name]",
      "List or inspect saved agent configurations",
      (y) =>
        y
          .positional("action", { type: "string", choices: ["list"] as const, default: "list" })
          .positional("name", { type: "string", describe: "Agent name" }),
      async (args) => {
        const agents = getAllAgents();
        if (!agents.length) { console.log("No saved agents."); process.exit(EXIT_SUCCESS); }
        for (const a of agents) {
          console.log(`  ${a.name.padEnd(30)} ${a.description ?? ""}`);
        }
        process.exit(EXIT_SUCCESS);
      }
    )
    .command(
      "directory [path]",
      "Show project directory tree",
      (y) => y.positional("path", { type: "string", describe: "Directory path" }),
      async (args) => {
        cmdDirectory(args.path ?? process.cwd());
        process.exit(EXIT_SUCCESS);
      }
    )
    .command(
      "plugins [action] [package]",
      "Manage Pakalon plugins",
      (y) =>
        y
          .positional("action", { type: "string", choices: ["list", "install", "remove", "check", "update", "marketplace"] as const, default: "list" })
          .positional("package", { type: "string", describe: "Package name or search query" })
          .option("yes", { alias: "y", type: "boolean", describe: "Skip changelog confirmation prompt" }),
      async (args) => {
        const action = args.action ?? "list";
        if (action === "install") {
          if (!args.package) { console.error("Package name required."); process.exit(1); }
          await cmdInstallPlugin(args.package);
        } else if (action === "remove") {
          if (!args.package) { console.error("Package name required."); process.exit(1); }
          cmdRemovePlugin(args.package);
        } else if (action === "check") {
          await cmdCheckUpdates();
        } else if (action === "update") {
          await cmdAutoUpdate(args.package, { yes: args.yes });
        } else if (action === "marketplace") {
          await cmdListMarketplace(args.package);
        } else {
          cmdListPlugins();
        }
        process.exit(EXIT_SUCCESS);
      }
    )
    .command(
      "workflows [action] [name]",
      "Manage saved prompt workflows",
      (y) =>
        y
          .positional("action", { type: "string", choices: ["list", "save", "delete"] as const, default: "list" })
          .positional("name", { type: "string", describe: "Workflow name" })
          .option("description", { alias: "d", type: "string", default: "" })
          .option("prompts", { type: "array", string: true, describe: "Prompts to save", default: [] as string[] }),
      async (args) => {
        const action = args.action ?? "list";
        if (action === "save") {
          if (!args.name) { console.error("Workflow name required."); process.exit(1); }
          cmdSaveWorkflow(args.name, args.description ?? "", args.prompts as string[]);
          console.log(`[OK] Workflow saved: ${args.name}`);
        } else if (action === "delete") {
          if (!args.name) { console.error("Workflow name required."); process.exit(1); }
          cmdDeleteWorkflow(args.name);
          console.log(`[OK] Workflow deleted: ${args.name}`);
        } else {
          cmdListWorkflows();
        }
        process.exit(EXIT_SUCCESS);
      }
    )
    .command("doctor", "Check system requirements and diagnose issues", {}, async () => {
      await cmdDoctor();
    })
    .command("install", "Install Python bridge and dependencies", {}, async () => {
      await cmdInstall();
    })
    .command("setup-token", "Set authentication token manually (CI/CD)", {}, async () => {
      await cmdSetupToken();
    })
    .command(
      "update",
      "Update Pakalon CLI to the latest version",
      (y) => y.option("yes", { alias: "y", type: "boolean", describe: "Skip confirmation prompt" }),
      async (args) => {
        await cmdUpdateCli({ yes: args.yes });
      }
    )
    .command(
      "mcp [action]",
      "Manage Model Context Protocol servers",
      (y) =>
        y
          .positional("action", {
            type: "string",
            choices: ["list", "add", "remove", "search", "install", "discover", "uninstall", "sources", "import-vendored"] as const,
            default: "list",
          })
          .option("name", { type: "string", describe: "Server name" })
          .option("url", { type: "string", describe: "Server URL" })
          .option("scope", {
            type: "string",
            choices: ["global", "project"] as const,
            default: "global",
            describe: "Config scope",
          })
          .option("query", { alias: "q", type: "string", describe: "Search query" }),
      async (args) => {
        const action = args.action ?? "list";

        if (action === "list") {
          const servers = listMcpServers();
          if (servers.length === 0) {
            console.log("\nNo MCP servers configured.");
            console.log('Add one: pakalon mcp add --name github --url <url> --scope global\n');
          } else {
            console.log(`\n── MCP Servers (${servers.length}) ─────────────────────\n`);
            for (const s of servers) {
              console.log(`  [${s.scope}] ${s.name.padEnd(25)} ${s.url}`);
            }
            console.log();
          }
        } else if (action === "add") {
          if (!args.name || !args.url) {
            console.error("--name and --url are required for mcp add");
            process.exit(1);
          }
          const result = await addMcpServer(args.name, args.url, args.scope as "global" | "project");
          console.log(result.message);
          if (!result.ok) process.exit(1);
        } else if (action === "remove") {
          if (!args.name) {
            console.error("--name is required for mcp remove");
            process.exit(1);
          }
          const result = removeMcpServer(args.name, args.scope as "global" | "project");
          console.log(result.message);
          if (!result.ok) process.exit(1);
        } else if (action === "search") {
          const query = args.query ?? args.name ?? "";
          const results = searchRegistry(query);
          if (results.length === 0) {
            console.log(`No MCP servers found for "${query}"`);
          } else {
            console.log(`\n── Registry Results for "${query}" ─────────────\n`);
            for (const r of results.slice(0, 10)) {
              const badge = r.official ? "[official]" : "[community]";
              console.log(`  ${r.name.padEnd(25)} ${badge.padEnd(12)} ${r.description}`);
            }
            console.log("\nInstall with: pakalon mcp install <name>\n");
          }
        } else if (action === "install") {
          const nameOrPkg = args.name ?? args.query;
          if (!nameOrPkg) { console.error("--name or a positional package name is required."); process.exit(1); }
          const result = await installMcpServer(nameOrPkg, args.scope as "global" | "project", { url: args.url });
          console.log(result.message);
          if (!result.ok) process.exit(1);
        } else if (action === "discover") {
          const query = args.query ?? "";
          const entries = await discoverMcpServers(query);
          if (entries.length === 0) {
            console.log(`No MCP servers found${query ? ` for "${query}"` : ""}.`);
          } else {
            console.log(`\n── Available MCP Servers${query ? ` matching "${query}"` : ""} ─────────────\n`);
            for (const e of entries.slice(0, 25)) {
              const inst = e.installedVersion ? ` [installed v${e.installedVersion}]` : "";
              console.log(`  ${e.name.padEnd(25)} ${(e.tags ?? []).join(", ").padEnd(20)}${inst}`);
              console.log(`    ${e.description}`);
              console.log();
            }
            console.log("Install with: pakalon mcp install <name>\n");
          }
        } else if (action === "sources") {
          const summary = summarizeVendoredEverythingAssets();
          const presets = listVendoredMcpServerPresets(args.query ?? args.name ?? "");
          console.log("\n── Vendored MCP Sources ─────────────────────\n");
          for (const file of summary.mcpConfigPaths) {
            console.log(`  config: ${file}`);
          }
          if (summary.hookRoots.length > 0) {
            for (const root of summary.hookRoots) {
              console.log(`  hooks:  ${root}`);
            }
          }
          if (summary.manifestPaths.length > 0) {
            for (const file of summary.manifestPaths) {
              console.log(`  manifest:${file.startsWith("D:") ? " " : ""}${file}`);
            }
          }
          console.log("");
          if (presets.length === 0) {
            console.log("No vendored MCP presets found.");
          } else {
            console.log(`Vendored presets (${presets.length}):\n`);
            for (const preset of presets.slice(0, 50)) {
              const transport = preset.transport ?? "sse";
              console.log(`  ${preset.name.padEnd(25)} ${transport.padEnd(8)} ${preset.description ?? ""}`);
              console.log(`    source: ${preset.sourcePath}`);
            }
            console.log("\nImport with: pakalon mcp import-vendored --name <preset>");
            console.log("Import all:  pakalon mcp import-vendored\n");
          }
        } else if (action === "import-vendored") {
          const names = [args.name, args.query].filter((value): value is string => Boolean(value));
          const result = await importVendoredMcpServers({
            scope: args.scope as "global" | "project",
            cwd: process.cwd(),
            names,
          });
          console.log(`Imported: ${result.imported.length}`);
          if (result.imported.length > 0) {
            for (const name of result.imported) console.log(`  + ${name}`);
          }
          if (result.skipped.length > 0) {
            console.log(`Skipped: ${result.skipped.length}`);
            for (const name of result.skipped) console.log(`  = ${name}`);
          }
          if (result.errors.length > 0) {
            console.log(`Errors: ${result.errors.length}`);
            for (const error of result.errors) console.log(`  ! ${error.name}: ${error.reason}`);
            process.exit(1);
          }
        } else if (action === "uninstall") {
          if (!args.name) { console.error("--name is required for mcp uninstall"); process.exit(1); }
          const result = await uninstallMcpServer(args.name, args.scope as "global" | "project", { removePackage: true });
          console.log(result.message);
          if (!result.ok) process.exit(1);
        }
        process.exit(EXIT_SUCCESS);
      }
    )
    .command(
      "skills [action] [name]",
      "Inspect and import vendored skills into target skill roots",
      (y) =>
        y
          .positional("action", {
            type: "string",
            choices: ["list", "sources", "import-vendored"] as const,
            default: "list",
          })
          .positional("name", { type: "string", describe: "Skill name" })
          .option("query", { alias: "q", type: "string", describe: "Search query" })
          .option("scope", {
            type: "string",
            choices: ["global", "project"] as const,
            default: "project",
            describe: "Import target scope",
          })
          .option("dir", { alias: "d", type: "string", describe: "Project directory for project-scoped imports" }),
      async (args) => {
        const action = args.action ?? "list";
        const query = args.query ?? args.name ?? "";
        const cwd = path.resolve(args.dir ?? process.cwd());

        if (action === "list") {
          const entries = listImportableVendoredSkills(query);
          if (entries.length === 0) {
            console.log(`No vendored skills found${query ? ` for "${query}"` : ""}.`);
            process.exit(EXIT_SUCCESS);
          }

          console.log(`\n── Vendored Skills (${entries.length}) ─────────────────────\n`);
          for (const entry of entries.slice(0, 100)) {
            console.log(`  ${entry.name.padEnd(30)} ${entry.description}`);
          }
          console.log("");
          process.exit(EXIT_SUCCESS);
        }

        if (action === "sources") {
          const summary = summarizeVendoredEverythingAssets();
          const entries = listImportableVendoredSkills(query);
          console.log("\n── Skill Sources ─────────────────────\n");
          for (const root of summary.skillRoots) {
            console.log(`  vendored: ${root}`);
          }
          console.log(`\nMatched skills: ${entries.length}`);
          console.log("Import with: pakalon skills import-vendored --name <skill>");
          console.log("Import all:  pakalon skills import-vendored\n");
          process.exit(EXIT_SUCCESS);
        }

        if (action === "import-vendored") {
          const names = [args.name].filter((value): value is string => Boolean(value));
          const result = await importVendoredSkills({
            names,
            query: args.query,
            scope: args.scope as "global" | "project",
            cwd,
          });

          console.log(`Target dir: ${result.targetDir}`);
          console.log(`Imported: ${result.imported.length}`);
          for (const name of result.imported) {
            console.log(`  + ${name}`);
          }
          if (result.skipped.length > 0) {
            console.log(`Skipped: ${result.skipped.length}`);
            for (const name of result.skipped) {
              console.log(`  = ${name}`);
            }
          }
          if (result.errors.length > 0) {
            console.log(`Errors: ${result.errors.length}`);
            for (const error of result.errors) {
              console.log(`  ! ${error.name}: ${error.reason}`);
            }
            process.exit(1);
          }

          process.exit(EXIT_SUCCESS);
        }
      }
    )
    .command(
      "commands [action] [name]",
      "Inspect and import bundled markdown commands",
      (y) =>
        y
          .positional("action", {
            type: "string",
            choices: ["list", "show", "sources", "import-vendored"] as const,
            default: "list",
          })
          .positional("name", { type: "string", describe: "Command name such as plan or verify" })
          .option("query", { alias: "q", type: "string", describe: "Search query" })
          .option("scope", {
            type: "string",
            choices: ["global", "project"] as const,
            default: "project",
            describe: "Import target scope",
          })
          .option("dir", { alias: "d", type: "string", describe: "Project directory for project-scoped imports" }),
      async (args) => {
        const action = args.action ?? "list";
        const query = args.query ?? args.name ?? "";
        const cwd = path.resolve(args.dir ?? process.cwd());

        if (action === "list") {
          const entries = searchCommandCatalog(query);
          if (entries.length === 0) {
            console.log(`No imported commands found${query ? ` for "${query}"` : ""}.`);
            process.exit(EXIT_SUCCESS);
          }

          console.log(`\n── Imported Markdown Commands (${entries.length}) ─────────────────────\n`);
          for (const entry of entries.slice(0, 100)) {
            const tools = entry.allowedTools.length > 0 ? ` [${entry.allowedTools.join(", ")}]` : "";
            console.log(`  /${entry.name.padEnd(24)} ${entry.source.padEnd(8)} ${entry.description}${tools}`);
          }
          console.log("");
          process.exit(EXIT_SUCCESS);
        }

        if (action === "show") {
          if (!args.name) {
            console.error("A command name is required for commands show");
            process.exit(1);
          }

          const entry = findCommandCatalogEntry(args.name, { includeContent: true });
          if (!entry) {
            console.error(`Command not found: ${args.name}`);
            process.exit(1);
          }

          console.log(`\n/${entry.name}`);
          console.log(`source: ${entry.source}`);
          console.log(`path:   ${entry.path}`);
          if (entry.allowedTools.length > 0) {
            console.log(`tools:  ${entry.allowedTools.join(", ")}`);
          }
          console.log("");
          console.log(entry.content ?? "");
          process.exit(EXIT_SUCCESS);
        }

        if (action === "sources") {
          const summary = summarizeVendoredEverythingAssets();
          const entries = searchCommandCatalog(query);
          const embedded = discoverCommandCatalog().filter((entry) => entry.source === "embedded").length;
          const vendored = discoverCommandCatalog().filter((entry) => entry.source === "vendored").length;

          console.log("\n── Command Sources ─────────────────────\n");
          if (summary.commandRoots.length > 0) {
            for (const root of summary.commandRoots) {
              console.log(`  vendored: ${root}`);
            }
          }
          for (const entry of discoverCommandCatalog().filter((item) => item.source === "embedded").slice(0, 1)) {
            console.log(`  embedded: ${entry.rootDir}`);
          }
          console.log("");
          console.log(`Embedded commands: ${embedded}`);
          console.log(`Vendored commands: ${vendored}`);
          console.log(`Matched commands:  ${entries.length}`);
          console.log(`Import target:     ${getCommandImportTargetDir(args.scope as "global" | "project", cwd)}`);
          console.log("\nImport with: pakalon commands import-vendored --name <command>");
          console.log("Import all:  pakalon commands import-vendored\n");
          process.exit(EXIT_SUCCESS);
        }

        if (action === "import-vendored") {
          const names = [args.name].filter((value): value is string => Boolean(value));
          const result = await importCatalogCommands({
            names,
            query: args.query,
            scope: args.scope as "global" | "project",
            cwd,
          });

          console.log(`Target dir: ${result.targetDir}`);
          console.log(`Imported: ${result.imported.length}`);
          for (const name of result.imported) {
            console.log(`  + ${name}`);
          }
          if (result.skipped.length > 0) {
            console.log(`Skipped: ${result.skipped.length}`);
            for (const name of result.skipped) {
              console.log(`  = ${name}`);
            }
          }
          if (result.errors.length > 0) {
            console.log(`Errors: ${result.errors.length}`);
            for (const error of result.errors) {
              console.log(`  ! ${error.name}: ${error.reason}`);
            }
            process.exit(1);
          }

          process.exit(EXIT_SUCCESS);
        }
      }
    )
    .command(
      "manifests [action] [name]",
      "Inspect and apply vendored manifest profiles/modules",
      (y) =>
        y
          .positional("action", {
            type: "string",
            choices: ["profiles", "modules", "show", "import-profile", "import-module"] as const,
            default: "profiles",
          })
          .positional("name", { type: "string", describe: "Profile id or module id" })
          .option("query", { alias: "q", type: "string", describe: "Search query" })
          .option("scope", {
            type: "string",
            choices: ["global", "project"] as const,
            default: "project",
            describe: "Import target scope",
          })
          .option("dir", { alias: "d", type: "string", describe: "Project directory for project-scoped imports" }),
      async (args) => {
        const action = args.action ?? "profiles";
        const query = (args.query ?? args.name ?? "").toLowerCase();
        const cwd = path.resolve(args.dir ?? process.cwd());
        const catalog = loadVendoredManifestCatalog();

        if (action === "profiles") {
          const profiles = catalog.profiles.filter((profile) =>
            !query ||
            profile.id.toLowerCase().includes(query) ||
            profile.description.toLowerCase().includes(query),
          );

          console.log(`\n── Vendored Profiles (${profiles.length}) ─────────────────────\n`);
          for (const profile of profiles) {
            console.log(`  ${profile.id.padEnd(16)} ${profile.description}`);
          }
          console.log("");
          process.exit(EXIT_SUCCESS);
        }

        if (action === "modules") {
          const modules = catalog.modules.filter((module) =>
            !query ||
            module.id.toLowerCase().includes(query) ||
            module.kind.toLowerCase().includes(query) ||
            module.description.toLowerCase().includes(query),
          );

          console.log(`\n── Vendored Modules (${modules.length}) ─────────────────────\n`);
          for (const module of modules) {
            console.log(`  ${module.id.padEnd(24)} ${module.kind.padEnd(13)} ${module.description}`);
          }
          console.log("");
          process.exit(EXIT_SUCCESS);
        }

        if (action === "show") {
          if (!args.name) {
            console.error("A profile or module id is required for manifests show");
            process.exit(1);
          }

          const profile = catalog.profiles.find((entry) => entry.id === args.name);
          if (profile) {
            console.log(`\nprofile: ${profile.id}`);
            console.log(`description: ${profile.description}`);
            console.log(`modules: ${profile.modules.join(", ")}`);
            process.exit(EXIT_SUCCESS);
          }

          const module = catalog.modules.find((entry) => entry.id === args.name);
          if (module) {
            console.log(`\nmodule: ${module.id}`);
            console.log(`kind: ${module.kind}`);
            console.log(`description: ${module.description}`);
            console.log("paths:");
            for (const modulePath of module.paths) {
              console.log(`  - ${modulePath}`);
            }
            process.exit(EXIT_SUCCESS);
          }

          console.error(`Manifest entry not found: ${args.name}`);
          process.exit(1);
        }

        if (action === "import-profile") {
          if (!args.name) {
            console.error("A profile id is required for manifests import-profile");
            process.exit(1);
          }

          const result = await importVendoredManifestProfile({
            profileId: args.name,
            scope: args.scope as "global" | "project",
            cwd,
          });

          console.log(`Imported modules: ${result.importedModules.length}`);
          for (const id of result.importedModules) console.log(`  + ${id}`);
          if (result.importedCommands.length > 0) console.log(`Commands: ${result.importedCommands.length}`);
          if (result.importedSkills.length > 0) console.log(`Skills: ${result.importedSkills.length}`);
          if (result.importedHooks.length > 0) console.log(`Hooks: ${result.importedHooks.length}`);
          if (result.importedMcpServers.length > 0) console.log(`MCP: ${result.importedMcpServers.length}`);
          if (result.copiedPaths.length > 0) console.log(`Copied paths: ${result.copiedPaths.length}`);
          if (result.skippedModules.length > 0) {
            console.log(`Skipped modules: ${result.skippedModules.length}`);
            for (const id of result.skippedModules) console.log(`  = ${id}`);
          }
          if (result.errors.length > 0) {
            console.log(`Errors: ${result.errors.length}`);
            for (const error of result.errors) console.log(`  ! ${error.id}: ${error.reason}`);
            process.exit(1);
          }

          process.exit(EXIT_SUCCESS);
        }

        if (action === "import-module") {
          if (!args.name) {
            console.error("A module id is required for manifests import-module");
            process.exit(1);
          }

          const result = await importVendoredManifestModules({
            moduleIds: [args.name],
            scope: args.scope as "global" | "project",
            cwd,
          });

          console.log(`Imported modules: ${result.importedModules.length}`);
          for (const id of result.importedModules) console.log(`  + ${id}`);
          if (result.importedCommands.length > 0) console.log(`Commands: ${result.importedCommands.length}`);
          if (result.importedSkills.length > 0) console.log(`Skills: ${result.importedSkills.length}`);
          if (result.importedHooks.length > 0) console.log(`Hooks: ${result.importedHooks.length}`);
          if (result.importedMcpServers.length > 0) console.log(`MCP: ${result.importedMcpServers.length}`);
          if (result.copiedPaths.length > 0) console.log(`Copied paths: ${result.copiedPaths.length}`);
          if (result.errors.length > 0) {
            console.log(`Errors: ${result.errors.length}`);
            for (const error of result.errors) console.log(`  ! ${error.id}: ${error.reason}`);
            process.exit(1);
          }

          process.exit(EXIT_SUCCESS);
        }
      }
    )
    .command(
      "hooks [action]",
      "Manage hook configuration and vendored hook imports",
      (y) =>
        y
          .positional("action", {
            type: "string",
            choices: ["list", "init", "remove", "sources", "import-vendored"] as const,
            default: "list",
          })
          .option("scope", {
            type: "string",
            choices: ["global", "project"] as const,
            describe: "Config scope",
          })
          .option("dir", { alias: "d", type: "string", describe: "Project directory for project-scoped hooks" })
          .option("event", { type: "string", describe: "Hook event name (for remove)" })
          .option("index", { type: "number", describe: "Hook index within the event (for remove)" })
          .option("name", { type: "string", describe: "Vendored preset id such as PreToolUse:0" })
          .option("query", { alias: "q", type: "string", describe: "Filter vendored presets" }),
      async (args) => {
        const action = args.action ?? "list";
        const cwd = path.resolve(args.dir ?? process.cwd());

        if (action === "init") {
          const configPath = initHooksConfig(cwd);
          console.log(`Hooks config ready: ${configPath}`);
          process.exit(EXIT_SUCCESS);
        }

        if (action === "list") {
          const scope = args.scope as "global" | "project" | undefined;
          const hooks = listConfiguredHooks(cwd, scope);
          const scopes = scope ? [scope] : (["global", "project"] as const);

          console.log("\n── Hook Config Sources ─────────────────────\n");
          for (const selectedScope of scopes) {
            console.log(`  [${selectedScope}] ${getHooksConfigPath(selectedScope, cwd)}`);
          }

          if (hooks.length === 0) {
            console.log("\nNo hooks configured.");
            console.log("Initialize with: pakalon hooks init");
            console.log("Import vendored presets with: pakalon hooks import-vendored\n");
            process.exit(EXIT_SUCCESS);
          }

          console.log(`\n── Configured Hooks (${hooks.length}) ─────────────────────\n`);
          for (const entry of hooks) {
            const target = entry.hook.command ?? entry.hook.url ?? entry.hook.type ?? "<unknown>";
            const match = entry.hook.match ? ` match=${entry.hook.match}` : "";
            console.log(`  [${entry.scope}] ${entry.event}[${entry.index}]${match}`);
            console.log(`    ${target}`);
          }
          console.log("");
          process.exit(EXIT_SUCCESS);
        }

        if (action === "remove") {
          if (!args.event || args.index === undefined || !args.scope) {
            console.error("--event, --index, and --scope are required for hooks remove");
            process.exit(1);
          }

          const removed = removeConfiguredHookEntry(
            args.event as Parameters<typeof removeConfiguredHookEntry>[0],
            args.index,
            args.scope as "global" | "project",
            cwd,
          );

          if (!removed) {
            console.error("Hook not found.");
            process.exit(1);
          }

          console.log(`Removed ${args.event}[${args.index}] from ${args.scope} hooks.`);
          process.exit(EXIT_SUCCESS);
        }

        if (action === "sources") {
          const summary = summarizeVendoredEverythingAssets();
          const presets = listVendoredHookPresets(args.query ?? args.name ?? "");

          console.log("\n── Vendored Hook Sources ─────────────────────\n");
          for (const root of summary.hookRoots) {
            console.log(`  hooks:  ${root}`);
          }
          console.log(`  file:   ${path.join(summary.root, "hooks", "hooks.json")}`);
          console.log("");

          if (presets.length === 0) {
            console.log("No vendored hook presets found.");
          } else {
            console.log(`Vendored presets (${presets.length}):\n`);
            for (const preset of presets.slice(0, 50)) {
              const matcher = preset.matcher ? ` matcher=${preset.matcher}` : "";
              console.log(`  ${preset.id.padEnd(18)} ${preset.event}${matcher}`);
              if (preset.description) {
                console.log(`    ${preset.description}`);
              }
            }
            console.log("\nImport with: pakalon hooks import-vendored --name <event:index>");
            console.log("Import all:  pakalon hooks import-vendored\n");
          }

          process.exit(EXIT_SUCCESS);
        }

        if (action === "import-vendored") {
          const ids = [args.name].filter((value): value is string => Boolean(value));
          const result = await importVendoredHooks({
            scope: (args.scope as "global" | "project" | undefined) ?? "project",
            cwd,
            ids,
            query: args.query,
          });

          console.log(`Target config: ${result.configPath}`);
          console.log(`Imported: ${result.imported.length}`);
          for (const id of result.imported) {
            console.log(`  + ${id}`);
          }
          if (result.skipped.length > 0) {
            console.log(`Skipped: ${result.skipped.length}`);
            for (const id of result.skipped) {
              console.log(`  = ${id}`);
            }
          }
          if (result.errors.length > 0) {
            console.log(`Errors: ${result.errors.length}`);
            for (const error of result.errors) {
              console.log(`  ! ${error.id}: ${error.reason}`);
            }
            process.exit(1);
          }

          process.exit(EXIT_SUCCESS);
        }
      }
    )
    .command(
      "build [prompt]",
      "Run the 6-phase agentic build pipeline (T-CLI-03, T-CLI-04, T-CLI-11)",
      (y) =>
        y
          .positional("prompt", { type: "string", describe: "What to build" })
          .option("phase", { alias: "p", type: "number", default: 1, describe: "Start from phase (1-6)" })
          .option("dir", { alias: "d", type: "string", describe: "Project directory" })
          .option("yolo", { type: "boolean", default: false, describe: "YOLO mode — skip confirmations" })
          .option("figma", { type: "string", describe: "Figma URL (Phase 1)" })
          .option("target", { type: "string", default: "http://localhost:3000", describe: "Target URL for Phase 4 DAST" }),
      async (args) => {
        if (!isAuthenticated()) {
          console.error("Not logged in. Run `pakalon login` first.");
          process.exit(EXIT_AUTH_ERROR);
        }
        const projectDir = args.dir ?? process.cwd();
        await render(
          React.createElement(BuildScreen, {
            projectDir,
            userPrompt: args.prompt ?? "",
            phase: args.phase ?? 1,
            isYolo: args.yolo ?? false,
            figmaUrl: args.figma,
            targetUrl: args.target,
            privacyLevel: "off",
          })
        ).waitUntilExit();
      }
    )
    .command(
      "generate <prompt>",
      "Generate an AI image from a text description (Pro feature)",
      (y) =>
        y
          .positional("prompt", { type: "string", describe: "Image description" })
          .option("size", {
            type: "string",
            choices: ["1024x1024", "1792x1024", "1024x1792"] as const,
            default: "1024x1024",
            describe: "Image dimensions",
          })
          .option("quality", {
            type: "string",
            choices: ["standard", "hd"] as const,
            default: "standard",
            describe: "Image quality (hd uses more tokens)",
          })
          .option("style", {
            type: "string",
            choices: ["natural", "vivid"] as const,
            default: "natural",
            describe: "Generation style",
          })
          .option("dir", { alias: "d", type: "string", describe: "Project directory (output path)" }),
      async (args) => {
        if (!args.prompt) {
          console.error('Usage: pakalon generate "<description>"');
          process.exit(1);
        }
        await cmdGeneratePrint(args.prompt, {
          size: args.size as "1024x1024" | "1792x1024" | "1024x1792",
          quality: args.quality as "standard" | "hd",
          style: args.style as "natural" | "vivid",
          projectDir: args.dir ?? process.cwd(),
        });
        process.exit(EXIT_SUCCESS);
      }
    )

    // ── enterprise <service> <action> ───────────────────────────────────────
    .command(
      "enterprise <service> <action>",
      "Manage enterprise integrations (Notion, Jira)",
      (yargs) =>
        yargs
          .positional("service", {
            type: "string",
            choices: ["notion", "jira"] as const,
            describe: "Enterprise service to configure",
          })
          .positional("action", {
            type: "string",
            choices: ["setup", "remove", "status"] as const,
            describe: "Action to perform",
          })
          .option("token", { alias: "t", type: "string", describe: "API token / PAT" })
          .option("workspace", { alias: "w", type: "string", describe: "Workspace name / Atlassian subdomain" })
          .option("email", { alias: "e", type: "string", describe: "User email (Jira Cloud)" })
          .option("server", { type: "string", describe: "Jira Server/DC URL" })
          .option("scope", {
            type: "string",
            choices: ["global", "project"] as const,
            default: "global",
            describe: "MCP server scope",
          }),
      async (args) => {
        await cmdEnterprisePrint(
          args.service as EnterpriseService,
          args.action as EnterpriseAction,
          {
            token: args.token,
            workspace: args.workspace,
            email: args.email,
            server: args.server,
            scope: (args.scope as "global" | "project") ?? "global",
            cwd: process.cwd(),
          }
        );
        process.exit(EXIT_SUCCESS);
      }
    )

    // ── security <subcommand> ──────────────────────────────────────────────
    .command(
      "security [subcommand] [args..]",
      "View and act on Phase 4 security findings (SAST/DAST reports)",
      (y) =>
        y
          .positional("subcommand", {
            type: "string",
            choices: ["findings", "list", "report", "tools", "fix"] as const,
            default: "findings",
            describe: "Sub-command: findings | report | tools | fix",
          })
          .positional("args", { type: "string", array: true, describe: "Extra positional args" })
          .option("severity", { type: "string", describe: "Filter by severity (CRITICAL|HIGH|MEDIUM|LOW|INFO)" })
          .option("owasp", { type: "string", describe: "Filter by OWASP category" })
          .option("source", { type: "string", describe: "Filter by source scanner (zap|nikto|semgrep|…)" })
          .option("project", { type: "string", describe: "Project directory (default: cwd)" })
          .option("yes", { alias: "y", type: "boolean", describe: "Skip interactive prompts" }),
      async (args) => {
        await cmdSecurity(
          args.subcommand ?? "findings",
          (args.args ?? []) as string[],
          {
            ...(args.severity !== undefined && { severity: args.severity }),
            ...(args.owasp !== undefined && { owasp: args.owasp }),
            ...(args.source !== undefined && { source: args.source }),
            ...(args.project !== undefined && { project: args.project }),
          }
        );
        process.exit(EXIT_SUCCESS);
      }
    )

    // ── trace <subcommand> ─────────────────────────────────────────────────
    .command(
      "trace [subcommand] [args..]",
      "View the cross-phase decision registry written by Pakalon agents",
      (y) =>
        y
          .positional("subcommand", {
            type: "string",
            choices: ["list", "show", "links", "summary", "search"] as const,
            default: "list",
            describe: "Sub-command: list | show | links | summary | search",
          })
          .positional("args", { type: "string", array: true, describe: "Extra positional args" })
          .option("type", { type: "string", describe: "Filter by decision type (requirement|security_finding|…)" })
          .option("phase", { type: "number", describe: "Filter by pipeline phase number" })
          .option("project", { type: "string", describe: "Project directory (default: cwd)" }),
      async (args) => {
        await cmdTrace(
          args.subcommand ?? "list",
          (args.args ?? []) as string[],
          {
            ...(args.type !== undefined && { type: args.type }),
            ...(args.phase !== undefined && { phase: String(args.phase) }),
            ...(args.project !== undefined && { project: args.project }),
          }
        );
        process.exit(EXIT_SUCCESS);
      }
    )

    .help()
    .alias("h", "help")
    .version()
    .alias("v", "version")
    .strict()
    .parseAsync();

  logger.debug("Parsed args", argv);
}

main()
  .then(() => shutdownTelemetry())
  .catch(async (err) => {
    await shutdownTelemetry();
    console.error(err);
    process.exit(99);
  });

