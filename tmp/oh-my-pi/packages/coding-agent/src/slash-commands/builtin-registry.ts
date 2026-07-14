import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/utils/oauth";
import { logger, Snowflake, setProjectDir } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { logout } from "../auth/openrouter-auth";
import type { SettingPath, SettingValue } from "../config/settings";
import { settings } from "../config/settings";
import {
	clearPluginRootsAndCaches,
	resolveActiveProjectRegistryPath,
	resolveOrDefaultProjectRegistryPath,
} from "../discovery/helpers.js";
import { PluginManager } from "../extensibility/plugins";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
	MarketplaceManager,
} from "../extensibility/plugins/marketplace";
import { resolveMemoryBackend } from "../memory-backend";
import type { InteractiveModeContext } from "../modes/types";
import { formatHistory } from "../normal-mode/history";
import {
	addMessage as addNormalMessage,
	formatSessionList,
	getActiveSession,
	getMessages as getNormalMessages,
	getSession as getNormalSession,
	listSessions,
	resumeSession as resumeNormalSession,
} from "../normal-mode/sessions";
import {
	deriveId as deriveAgentId,
	listAgents as listAgentTeams,
	saveAgent as saveAgentTeam,
} from "../pakalon/agent-teams/registry";
import { applyFollowupChoice, type FollowupChoice, readFollowup } from "../pakalon/auditor/followup";
import { runLoginFlow } from "../pakalon/auth/login-flow";
import { deleteAutomation, deriveAutomationId, listAutomations, saveAutomation } from "../pakalon/automations/cron";
import {
	HIL_CHOICES_EXISTING,
	HIL_CHOICES_NEW,
	type ProjectState,
	resolveBudget,
} from "../pakalon/billing/budget-prompt";
// Pakalon imports
import { initAgentsMode, initNormalMode, parseInitArgs } from "../pakalon/init";
import { pickAuto } from "../pakalon/local-models/auto-picker";
import { getUnifiedModels, isSelfHostedMode } from "../pakalon/local-models/registry";
import { advancePhase, generateSummaryReport, getCurrentPhase, jumpToPhase } from "../pakalon/orchestrator";
import { isSyncBridgeRunning, startSyncBridge, stopSyncBridge } from "../pakalon/penpot/sync-bridge";
import {
	clearTelegramConfig,
	setBotToken as setTelegramToken,
	startTelegramServer,
	stopTelegramServer,
} from "../pakalon/telegram/server";
import { applyUndo as applyPakalonUndo, latestSnapshot } from "../pakalon/undo/menu";
import { runPhase1 } from "../phases/phase1";
import { runPhase2 } from "../phases/phase2";
import { runPhase3 } from "../phases/phase3";
import { runPhase4 } from "../phases/phase4";
import { runPhase5 } from "../phases/phase5";
import { runPhase6 } from "../phases/phase6";
import { formatShakeSummary, type ShakeMode } from "../session/shake-types";
import { getChangelogPath, parseChangelog } from "../utils/changelog";
import { buildContextReportText } from "./helpers/context-report";
import { formatDuration } from "./helpers/format";
import { createMarketplaceManager, resolveDefaultMarketplaceUrl } from "./helpers/marketplace-manager";
import { handleMcpAcp } from "./helpers/mcp";
import { commandConsumed, errorMessage, parseSlashCommand, parseSubcommand, usage } from "./helpers/parse";
import { handleSshAcp } from "./helpers/ssh";
import { handleTodoAcp } from "./helpers/todo";
import { buildUsageReportText } from "./helpers/usage-report";
import { parseMarketplaceInstallArgs, parsePluginScopeArgs } from "./marketplace-install-parser";
import type {
	BuiltinSlashCommand,
	ParsedSlashCommand,
	SlashCommandResult,
	SlashCommandRuntime,
	SlashCommandSpec,
	TuiSlashCommandRuntime,
} from "./types";

export type { BuiltinSlashCommand, SubcommandDef } from "./types";

/** TUI-specific runtime accepted by `executeBuiltinSlashCommand`. */
export type BuiltinSlashCommandRuntime = TuiSlashCommandRuntime;

function refreshStatusLine(ctx: InteractiveModeContext): void {
	ctx.statusLine.invalidate();
	ctx.updateEditorTopBorder();
	ctx.ui.requestRender();
}

const shutdownHandlerTui = (_command: ParsedSlashCommand, runtime: TuiSlashCommandRuntime): SlashCommandResult => {
	runtime.ctx.editor.setText("");
	void runtime.ctx.shutdown();
	return commandConsumed();
};

/** Parse the `/shake` subcommand into a {@link ShakeMode}; empty defaults to elide. */
function parseShakeMode(args: string): ShakeMode | { error: string } {
	const verb = args.trim().toLowerCase();
	if (verb === "" || verb === "elide") return "elide";
	if (verb === "summary") return "summary";
	if (verb === "images") return "images";
	return { error: `Unknown /shake mode "${verb}". Use elide, summary, or images.` };
}

const BUILTIN_SLASH_COMMAND_REGISTRY: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "settings",
		description: "Open settings menu",
		handleTui: (_command, runtime) => {
			runtime.ctx.showSettingsSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "plan",
		description: "Toggle plan mode (agent plans before executing)",
		inlineHint: "[prompt]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const hadArgs = !!command.args;
			// Capture state BEFORE the call: when plan mode is already active,
			// handlePlanModeCommand may exit it (on confirmed exit) or leave it on (on cancel
			// or warning). In every "already active" case the typed args are NOT consumed,
			// so preserve them in history regardless of the user's confirm/cancel choice.
			const wasPlanModeEnabled = runtime.ctx.planModeEnabled;
			await runtime.ctx.handlePlanModeCommand(command.args || undefined);
			if (hadArgs && wasPlanModeEnabled) {
				runtime.ctx.editor.addToHistory(command.text);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "goal",
		description: "Toggle goal mode (persistent autonomous objective for this session)",
		subcommands: [
			{ name: "set", description: "Set or replace the goal", usage: "<objective>" },
			{ name: "show", description: "Show current goal details" },
			{ name: "pause", description: "Pause the current goal" },
			{ name: "resume", description: "Resume a paused goal" },
			{ name: "drop", description: "Drop the current goal" },
			{ name: "budget", description: "Adjust the token budget", usage: "<N|off>" },
		],
		inlineHint: "[objective]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const hadArgs = !!command.args;
			// Capture state BEFORE the call (see /plan above for rationale).
			const wasGoalModeEnabled = runtime.ctx.goalModeEnabled;
			await runtime.ctx.handleGoalModeCommand(command.args || undefined);
			if (hadArgs && wasGoalModeEnabled) {
				runtime.ctx.editor.addToHistory(command.text);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "loop",
		description:
			"Toggle loop mode. While enabled, the next prompt you send re-submits after every yield. Esc cancels the current iteration; /loop again to disable.",
		inlineHint: "[count|duration]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			await runtime.ctx.handleLoopCommand(command.args);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "model",
		aliases: ["models"],
		description: "Select model (opens selector UI)",
		acpDescription: "Show current model selection",
		handle: async (command, runtime) => {
			if (command.args) {
				const modelId = command.args.trim();
				const availableModels = runtime.session.getAvailableModels?.() ?? [];
				const match = availableModels.find(
					model => model.id === modelId || `${model.provider}/${model.id}` === modelId,
				);
				if (!match) {
					return usage(
						`Unknown model: ${modelId}. Use ACP \`session/setModel\` for picker-driven selection or list available models with /model.`,
						runtime,
					);
				}
				try {
					await runtime.session.setModel(match);
					await runtime.output(`Model set to ${match.provider}/${match.id}.`);
					await runtime.notifyTitleChanged?.();
					await runtime.notifyConfigChanged?.();
					return commandConsumed();
				} catch (err) {
					return usage(`Failed to set model: ${errorMessage(err)}`, runtime);
				}
			}

			const model = runtime.session.model;
			await runtime.output(
				model ? `Current model: ${model.provider}/${model.id}` : "No model is currently selected.",
			);
			return commandConsumed();
		},
		handleTui: (_command, runtime) => {
			runtime.ctx.showModelSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "switch",
		description: "Switch model for this session (same as alt+p)",
		handleTui: (_command, runtime) => {
			runtime.ctx.showModelSelector({ temporaryOnly: true });
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "fast",
		description: "Toggle priority service tier (OpenAI service_tier=priority, Anthropic speed=fast)",
		acpDescription: "Toggle fast mode",
		acpInputHint: "[on|off|status]",
		subcommands: [
			{ name: "on", description: "Enable fast mode" },
			{ name: "off", description: "Disable fast mode" },
			{ name: "status", description: "Show fast mode status" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const arg = command.args.toLowerCase();
			if (!arg || arg === "toggle") {
				const enabled = runtime.session.toggleFastMode();
				await runtime.output(`Fast mode ${enabled ? "enabled" : "disabled"}.`);
				return commandConsumed();
			}
			if (arg === "on") {
				runtime.session.setFastMode(true);
				await runtime.output("Fast mode enabled.");
				return commandConsumed();
			}
			if (arg === "off") {
				runtime.session.setFastMode(false);
				await runtime.output("Fast mode disabled.");
				return commandConsumed();
			}
			if (arg === "status") {
				await runtime.output(`Fast mode is ${runtime.session.isFastModeEnabled() ? "on" : "off"}.`);
				return commandConsumed();
			}
			return usage("Usage: /fast [on|off|status]", runtime);
		},
		handleTui: (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (!arg || arg === "toggle") {
				const enabled = runtime.ctx.session.toggleFastMode();
				refreshStatusLine(runtime.ctx);
				runtime.ctx.showStatus(`Fast mode ${enabled ? "enabled" : "disabled"}.`);
				runtime.ctx.editor.setText("");
				return;
			}
			if (arg === "on") {
				runtime.ctx.session.setFastMode(true);
				refreshStatusLine(runtime.ctx);
				runtime.ctx.showStatus("Fast mode enabled.");
				runtime.ctx.editor.setText("");
				return;
			}
			if (arg === "off") {
				runtime.ctx.session.setFastMode(false);
				refreshStatusLine(runtime.ctx);
				runtime.ctx.showStatus("Fast mode disabled.");
				runtime.ctx.editor.setText("");
				return;
			}
			if (arg === "status") {
				const enabled = runtime.ctx.session.isFastModeEnabled();
				runtime.ctx.showStatus(`Fast mode is ${enabled ? "on" : "off"}.`);
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.showStatus("Usage: /fast [on|off|status]");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "export",
		description: "Export session to HTML file",
		inlineHint: "[path]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const arg = command.args.trim();
			// Match the interactive `/export` behavior: clipboard aliases are not a
			// valid export target. Without this, the literal value (`copy`,
			// `--copy`, `clipboard`) is passed to `exportToHtml` and becomes the
			// output filename.
			if (arg === "--copy" || arg === "clipboard" || arg === "copy") {
				return usage("Use /dump to copy the session to clipboard.", runtime);
			}
			try {
				const filePath = await runtime.session.exportToHtml(arg || undefined);
				await runtime.output(`Session exported to: ${filePath}`);
				return commandConsumed();
			} catch (err) {
				return usage(`Failed to export session: ${errorMessage(err)}`, runtime);
			}
		},
		handleTui: async (command, runtime) => {
			await runtime.ctx.handleExportCommand(command.text);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "dump",
		description: "Copy session transcript to clipboard",
		acpDescription: "Return full transcript as plain text",
		handle: async (_command, runtime) => {
			const text = runtime.session.formatSessionAsText();
			await runtime.output(text || "No messages to dump yet.");
			return commandConsumed();
		},
		handleTui: async (_command, runtime) => {
			await runtime.ctx.handleDumpCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "share",
		description: "Share session as a secret GitHub gist",
		handle: async (_command, runtime) => {
			const tmpFile = path.join(os.tmpdir(), `${Snowflake.next()}.html`);
			try {
				try {
					await runtime.session.exportToHtml(tmpFile);
				} catch (err) {
					return usage(`Failed to export session: ${errorMessage(err)}`, runtime);
				}
				const result = await $`gh gist create --public=false ${tmpFile}`.quiet().nothrow();
				if (result.exitCode !== 0) {
					return usage(
						`Failed to create gist: ${result.stderr.toString("utf-8").trim() || "unknown error"}`,
						runtime,
					);
				}
				const gistUrl = result.stdout.toString("utf-8").trim();
				const gistId = gistUrl.split("/").pop();
				if (!gistId) return usage("Failed to parse gist ID from gh output", runtime);
				await runtime.output(`Share URL: https://gistpreview.github.io/?${gistId}\nGist: ${gistUrl}`);
				return commandConsumed();
			} catch {
				return usage("GitHub CLI (gh) is required for /share. Install it from https://cli.github.com/.", runtime);
			} finally {
				await fs.rm(tmpFile, { force: true }).catch(() => {});
			}
		},
		handleTui: async (_command, runtime) => {
			await runtime.ctx.handleShareCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "browser",
		description: "Toggle browser headless vs visible mode",
		acpInputHint: "[headless|visible]",
		subcommands: [
			{ name: "headless", description: "Switch to headless mode" },
			{ name: "visible", description: "Switch to visible mode" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const arg = command.args.toLowerCase();
			const enabled = runtime.settings.get("browser.enabled" as SettingPath) as boolean;
			if (!enabled) return usage("Browser tool is disabled (enable in settings).", runtime);
			const current = runtime.settings.get("browser.headless" as SettingPath) as boolean;
			let next = current;
			if (!arg) next = !current;
			else if (arg === "headless" || arg === "hidden") next = true;
			else if (arg === "visible" || arg === "show" || arg === "headful") next = false;
			else return usage("Usage: /browser [headless|visible]", runtime);
			runtime.settings.set("browser.headless" as SettingPath, next as SettingValue<SettingPath>);
			const tool = runtime.session.getToolByName("browser");
			if (tool && "restartForModeChange" in tool) {
				try {
					await (tool as { restartForModeChange: () => Promise<void> }).restartForModeChange();
				} catch (err) {
					// Setting was already mutated; surface the restart failure so the
					// user knows the browser is in an inconsistent state.
					await runtime.output(
						`Browser mode set to ${next ? "headless" : "visible"}, but restart failed: ${errorMessage(err)}`,
					);
					return commandConsumed();
				}
			}
			await runtime.output(`Browser mode: ${next ? "headless" : "visible"}`);
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			const arg = command.args.toLowerCase();
			const current = settings.get("browser.headless" as SettingPath) as boolean;
			let next = current;
			if (!(settings.get("browser.enabled" as SettingPath) as boolean)) {
				runtime.ctx.showWarning("Browser tool is disabled (enable in settings)");
				runtime.ctx.editor.setText("");
				return;
			}
			if (!arg) {
				next = !current;
			} else if (arg === "headless" || arg === "hidden") {
				next = true;
			} else if (arg === "visible" || arg === "show" || arg === "headful") {
				next = false;
			} else {
				runtime.ctx.showStatus("Usage: /browser [headless|visible]");
				runtime.ctx.editor.setText("");
				return;
			}
			settings.set("browser.headless" as SettingPath, next as SettingValue<SettingPath>);
			const tool = runtime.ctx.session.getToolByName("browser");
			if (tool && "restartForModeChange" in tool) {
				try {
					await (tool as { restartForModeChange: () => Promise<void> }).restartForModeChange();
				} catch (error) {
					runtime.ctx.showWarning(`Failed to restart browser: ${errorMessage(error)}`);
					runtime.ctx.editor.setText("");
					return;
				}
			}
			runtime.ctx.showStatus(`Browser mode: ${next ? "headless" : "visible"}`);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "copy",
		description: "Copy last agent message to clipboard",
		subcommands: [
			{ name: "last", description: "Copy full last agent message" },
			{ name: "code", description: "Copy last code block" },
			{ name: "all", description: "Copy all code blocks from last message" },
			{ name: "cmd", description: "Copy last bash/python command" },
		],
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const sub = command.args.trim().toLowerCase() || undefined;
			await runtime.ctx.handleCopyCommand(sub);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "todo",
		description: "View or modify the agent's todo list",
		acpDescription: "Manage todos",
		acpInputHint: "<subcommand>",
		subcommands: [
			{ name: "edit", description: "Open todos in $EDITOR (Markdown round-trip)" },
			{ name: "copy", description: "Copy todos as Markdown to clipboard" },
			{ name: "export", description: "Write todos as Markdown to a file (default: TODO.md)", usage: "[<path>]" },
			{ name: "import", description: "Replace todos from a Markdown file (default: TODO.md)", usage: "[<path>]" },
			{
				name: "append",
				description: "Append a task; phase fuzzy-matched or auto-created",
				usage: "[<phase>] <task...>",
			},
			{ name: "start", description: "Mark task in_progress (fuzzy-matched)", usage: "<task>" },
			{ name: "done", description: "Mark task/phase/all completed (fuzzy-matched)", usage: "[<task|phase>]" },
			{ name: "drop", description: "Mark task/phase/all abandoned (fuzzy-matched)", usage: "[<task|phase>]" },
			{ name: "rm", description: "Remove task/phase/all (fuzzy-matched)", usage: "[<task|phase>]" },
		],
		allowArgs: true,
		handle: handleTodoAcp,
		handleTui: async (command, runtime) => {
			await runtime.ctx.handleTodoCommand(command.args);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "session",
		description: "Session management commands",
		acpDescription: "Show session information",
		acpInputHint: "info|delete",
		subcommands: [
			{ name: "info", description: "Show session info and stats" },
			{ name: "delete", description: "Delete current session and return to selector" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			if (!command.args || command.args === "info") {
				await runtime.output(
					[
						`Session: ${runtime.session.sessionId}`,
						`Title: ${runtime.session.sessionName}`,
						`CWD: ${runtime.cwd}`,
					].join("\n"),
				);
				return commandConsumed();
			}
			if (command.args === "delete") {
				if (runtime.session.isStreaming) return usage("Cannot delete the session while streaming.", runtime);
				const sessionFile = runtime.sessionManager.getSessionFile();
				if (!sessionFile) return usage("No session file to delete (in-memory session).", runtime);
				// Route through the active SessionManager so the persist writer is
				// closed before the file is deleted. Constructing a fresh
				// FileSessionStorage and calling deleteSessionWithArtifacts leaves
				// the active writer attached to the now-deleted path, so the next
				// prompt would silently resurrect or corrupt the "deleted" file.
				try {
					await runtime.sessionManager.dropSession(sessionFile);
				} catch (err) {
					return usage(`Failed to delete session: ${errorMessage(err)}`, runtime);
				}
				await runtime.output(
					`Session deleted: ${sessionFile}. Use ACP \`session/load\` to switch to another session.`,
				);
				return commandConsumed();
			}
			return usage("Usage: /session [info|delete]", runtime);
		},
		handleTui: async (command, runtime) => {
			const sub = command.args.trim().toLowerCase() || "info";
			if (sub === "delete") {
				runtime.ctx.editor.setText("");
				await runtime.ctx.handleSessionDeleteCommand();
				return;
			}
			// Default: show session info
			await runtime.ctx.handleSessionCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "jobs",
		description: "Show async background jobs status",
		acpDescription: "Show background jobs",
		handle: async (_command, runtime) => {
			const snapshot = runtime.session.getAsyncJobSnapshot({ recentLimit: 5 });
			if (!snapshot || (snapshot.running.length === 0 && snapshot.recent.length === 0)) {
				await runtime.output(
					"No background jobs running. (Background jobs run async tools — e.g. long-running bash, debug, or task subagents that would otherwise tie up a turn. They appear here while alive and for ~5 minutes after.)",
				);
				return commandConsumed();
			}
			const now = Date.now();
			const lines: string[] = ["Background Jobs", `Running: ${snapshot.running.length}`];
			if (snapshot.running.length > 0) {
				lines.push("", "Running Jobs");
				for (const job of snapshot.running) {
					lines.push(`  [${job.id}] ${job.type} (${job.status}) — ${formatDuration(now - job.startTime)}`);
					lines.push(`    ${job.label}`);
				}
			}
			if (snapshot.recent.length > 0) {
				lines.push("", "Recent Jobs");
				for (const job of snapshot.recent) {
					lines.push(`  [${job.id}] ${job.type} (${job.status}) — ${formatDuration(now - job.startTime)}`);
					lines.push(`    ${job.label}`);
				}
			}
			await runtime.output(lines.join("\n"));
			return commandConsumed();
		},
		handleTui: async (_command, runtime) => {
			await runtime.ctx.handleJobsCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "usage",
		description: "Show provider usage and limits",
		acpDescription: "Show token usage",
		handle: async (_command, runtime) => {
			await runtime.output(await buildUsageReportText(runtime));
			return commandConsumed();
		},
		handleTui: async (_command, runtime) => {
			await runtime.ctx.handleUsageCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "changelog",
		description: "Show changelog entries",
		acpDescription: "Show changelog",
		acpInputHint: "[full]",
		subcommands: [{ name: "full", description: "Show complete changelog" }],
		allowArgs: true,
		handle: async (command, runtime) => {
			const changelogPath = getChangelogPath();
			const allEntries = await parseChangelog(changelogPath);
			const showFull = command.args.trim().toLowerCase() === "full";
			const entriesToShow = showFull ? allEntries : allEntries.slice(0, 3);
			if (entriesToShow.length === 0) {
				await runtime.output("No changelog entries found.");
				return commandConsumed();
			}
			await runtime.output(
				[...entriesToShow]
					.reverse()
					.map(entry => entry.content)
					.join("\n\n"),
			);
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			const showFull = command.args.split(/\s+/).filter(Boolean).includes("full");
			await runtime.ctx.handleChangelogCommand(showFull);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "hotkeys",
		description: "Show all keyboard shortcuts",
		handleTui: (_command, runtime) => {
			runtime.ctx.handleHotkeysCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "tools",
		description: "Show tools currently visible to the agent",
		acpDescription: "Show available tools",
		handle: async (_command, runtime) => {
			const active = runtime.session.getActiveToolNames();
			const all = runtime.session.getAllToolNames();
			if (all.length === 0) {
				await runtime.output("No tools are available.");
				return commandConsumed();
			}
			await runtime.output(all.map(name => `${active.includes(name) ? "*" : "-"} ${name}`).join("\n"));
			return commandConsumed();
		},
		handleTui: (_command, runtime) => {
			runtime.ctx.handleToolsCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "context",
		description: "Show estimated context usage breakdown",
		acpDescription: "Show context usage",
		handle: async (_command, runtime) => {
			await runtime.output(buildContextReportText(runtime));
			return commandConsumed();
		},
		handleTui: (_command, runtime) => {
			runtime.ctx.handleContextCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "extensions",
		aliases: ["status"],
		description: "Open Extension Control Center dashboard",
		handleTui: (_command, runtime) => {
			runtime.ctx.showExtensionsDashboard();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "agents",
		description: "Open Agent Control Center dashboard",
		handleTui: (_command, runtime) => {
			runtime.ctx.showAgentsDashboard();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "branch",
		description: "Create a new branch from a previous message",
		handleTui: (_command, runtime) => {
			if (settings.get("doubleEscapeAction") === "tree") {
				runtime.ctx.showTreeSelector();
			} else {
				runtime.ctx.showUserMessageSelector();
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "fork",
		description: "Create a new fork from a previous message",
		handleTui: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleForkCommand();
		},
	},
	{
		name: "tree",
		description: "Navigate session tree (switch branches)",
		handleTui: (_command, runtime) => {
			runtime.ctx.showTreeSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "login",
		description: "Login with OAuth provider",
		inlineHint: "[provider|redirect URL]",
		allowArgs: true,
		handleTui: (command, runtime) => {
			const manualInput = runtime.ctx.oauthManualInput;
			const args = command.args.trim();
			if (args.length > 0) {
				const matchedProvider = getOAuthProviders().find(provider => provider.id === args);
				if (matchedProvider) {
					if (manualInput.hasPending()) {
						const pendingProvider = manualInput.pendingProviderId;
						const message = pendingProvider
							? `OAuth login already in progress for ${pendingProvider}. Paste the redirect URL with /login <url>.`
							: "OAuth login already in progress. Paste the redirect URL with /login <url>.";
						runtime.ctx.showWarning(message);
						runtime.ctx.editor.setText("");
						return;
					}
					void runtime.ctx.showOAuthSelector("login", matchedProvider.id);
					runtime.ctx.editor.setText("");
					return;
				}
				const submitted = manualInput.submit(args);
				if (submitted) {
					runtime.ctx.showStatus("OAuth callback received; completing login…");
				} else {
					runtime.ctx.showWarning("No OAuth login is waiting for a manual callback.");
				}
				runtime.ctx.editor.setText("");
				return;
			}

			if (manualInput.hasPending()) {
				const provider = manualInput.pendingProviderId;
				const message = provider
					? `OAuth login already in progress for ${provider}. Paste the redirect URL with /login <url>.`
					: "OAuth login already in progress. Paste the redirect URL with /login <url>.";
				runtime.ctx.showWarning(message);
				runtime.ctx.editor.setText("");
				return;
			}

			void runtime.ctx.showOAuthSelector("login");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "logout",
		description: "Logout from OAuth provider",
		handleTui: (_command, runtime) => {
			void runtime.ctx.showOAuthSelector("logout");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "mcp",
		description: "Manage MCP servers (add, list, remove, test)",
		acpDescription: "Manage MCP servers",
		inlineHint: "<subcommand>",
		subcommands: [
			{
				name: "add",
				description: "Add a new MCP server",
				usage: "<name> [--scope project|user] [--url <url>] [-- <command...>]",
			},
			{ name: "list", description: "List all configured MCP servers" },
			{ name: "remove", description: "Remove an MCP server", usage: "<name> [--scope project|user]" },
			{ name: "test", description: "Test connection to a server", usage: "<name>" },
			{ name: "reauth", description: "Reauthorize OAuth for a server", usage: "<name>" },
			{ name: "unauth", description: "Remove OAuth auth from a server", usage: "<name>" },
			{ name: "enable", description: "Enable an MCP server", usage: "<name>" },
			{ name: "disable", description: "Disable an MCP server", usage: "<name>" },
			{
				name: "smithery-search",
				description: "Search Smithery registry and deploy an MCP server",
				usage: "<keyword> [--scope project|user] [--limit <1-100>] [--semantic]",
			},
			{ name: "smithery-login", description: "Login to Smithery and cache API key" },
			{ name: "smithery-logout", description: "Remove cached Smithery API key" },
			{ name: "reconnect", description: "Reconnect to a specific MCP server", usage: "<name>" },
			{ name: "reload", description: "Force reload MCP runtime tools" },
			{ name: "resources", description: "List available resources from connected servers" },
			{ name: "prompts", description: "List available prompts from connected servers" },
			{ name: "notifications", description: "Show notification capabilities and subscriptions" },
			{ name: "help", description: "Show help message" },
		],
		allowArgs: true,
		handle: handleMcpAcp,
		handleTui: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMCPCommand(command.text);
		},
	},
	{
		name: "ssh",
		description: "Manage SSH hosts (add, list, remove)",
		acpDescription: "Manage SSH connections",
		inlineHint: "<subcommand>",
		subcommands: [
			{
				name: "add",
				description: "Add an SSH host",
				usage: "<name> --host <host> [--user <user>] [--port <port>] [--key <keyPath>]",
			},
			{ name: "list", description: "List all configured SSH hosts" },
			{ name: "remove", description: "Remove an SSH host", usage: "<name> [--scope project|user]" },
			{ name: "help", description: "Show help message" },
		],
		allowArgs: true,
		handle: handleSshAcp,
		handleTui: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleSSHCommand(command.text);
		},
	},
	{
		name: "new",
		description: "Start a new session",
		handleTui: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleClearCommand();
		},
	},
	{
		name: "drop",
		description: "Delete the current session and start a new one",
		handleTui: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleDropCommand();
		},
	},
	{
		name: "compact",
		description: "Manually compact the session context",
		acpDescription: "Compact the conversation",
		inlineHint: "[focus instructions]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const before = runtime.session.getContextUsage?.();
			const beforeTokens = before?.tokens;
			try {
				await runtime.session.compact(command.args || undefined);
			} catch (err) {
				// Compaction precondition failures (no model, already compacted, too
				// small) and provider errors propagate as plain Errors; surface them
				// via runtime.output so they don't fail the ACP prompt turn.
				return usage(`Compaction failed: ${errorMessage(err)}`, runtime);
			}
			const after = runtime.session.getContextUsage?.();
			const afterTokens = after?.tokens;
			if (beforeTokens != null && afterTokens != null) {
				const saved = beforeTokens - afterTokens;
				await runtime.output(`Compaction complete. Tokens: ${beforeTokens} -> ${afterTokens} (saved ${saved}).`);
			} else {
				await runtime.output("Compaction complete.");
			}
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			const customInstructions = command.args || undefined;
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleCompactCommand(customInstructions);
		},
	},
	{
		name: "shake",
		description: "Drop heavy content from context (tool results, large blocks)",
		acpDescription: "Shake heavy content out of the conversation context",
		subcommands: [
			{ name: "elide", description: "Strip tool results + large blocks (default)" },
			{ name: "summary", description: "Compress heavy regions with a local on-device model" },
			{ name: "images", description: "Strip image blocks" },
		],
		acpInputHint: "[elide|summary|images]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const mode = parseShakeMode(command.args);
			if (typeof mode !== "string") return usage(mode.error, runtime);
			const result = await runtime.session.shake(mode);
			await runtime.output(formatShakeSummary(result));
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			const mode = parseShakeMode(command.args);
			if (typeof mode !== "string") {
				runtime.ctx.showWarning(mode.error);
				return;
			}
			await runtime.ctx.handleShakeCommand(mode);
		},
	},
	{
		name: "handoff",
		description: "Hand off session context to a new session",
		inlineHint: "[focus instructions]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const customInstructions = command.args || undefined;
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleHandoffCommand(customInstructions);
		},
	},
	{
		name: "resume",
		description: "Resume a different session",
		handleTui: (_command, runtime) => {
			runtime.ctx.showSessionSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "btw",
		description: "Ask an ephemeral side question using the current session context",
		inlineHint: "<question>",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const question = command.text.slice(`/${command.name}`.length).trim();
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleBtwCommand(question);
		},
	},
	{
		name: "omfg",
		description: "Forge a TTSR rule from a complaint to stop a recurring behavior",
		inlineHint: "<complaint>",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const complaint = command.text.slice(`/${command.name}`.length).trim();
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleOmfgCommand(complaint);
		},
	},
	{
		name: "retry",
		description: "Retry the last failed agent turn",
		handleTui: async (_command, runtime) => {
			const didRetry = await runtime.ctx.session.retry();
			if (!didRetry) {
				runtime.ctx.showStatus("Nothing to retry");
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "background",
		aliases: ["bg"],
		description: "Detach UI and continue running in background",
		handleTui: (_command, runtime) => {
			runtime.ctx.editor.setText("");
			runtime.handleBackgroundCommand();
		},
	},
	{
		name: "debug",
		description: "Open debug tools selector",
		handleTui: (_command, runtime) => {
			runtime.ctx.showDebugSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "memory",
		description: "Inspect and operate memory maintenance",
		acpDescription: "Manage memory",
		acpInputHint: "<subcommand>",
		subcommands: [
			{ name: "view", description: "Show current memory injection payload" },
			{ name: "stats", description: "Show memory backend statistics" },
			{ name: "diagnose", description: "Run memory backend diagnostics" },
			{ name: "clear", description: "Clear persisted memory data and artifacts" },
			{ name: "reset", description: "Alias for clear" },
			{ name: "enqueue", description: "Enqueue memory consolidation maintenance" },
			{ name: "rebuild", description: "Alias for enqueue" },
			{ name: "mm list", description: "List mental models on the active bank" },
			{ name: "mm show", description: "Show one mental model (id required)" },
			{
				name: "mm refresh",
				description: "Refresh auto-refresh models bank-wide, or one model by id",
			},
			{ name: "mm history", description: "Diff the change history of a mental model" },
			{ name: "mm seed", description: "Create any built-in mental models that are missing" },
			{ name: "mm delete", description: "Delete a mental model from the bank (id required)" },
			{ name: "mm reload", description: "Re-pull the cached <mental_models> block" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const verb = (command.args.trim().split(/\s+/)[0] ?? "").toLowerCase() || "view";
			const backend = resolveMemoryBackend(runtime.settings);
			switch (verb) {
				case "view": {
					const payload = await backend.buildDeveloperInstructions(
						runtime.settings.getAgentDir(),
						runtime.settings,
						runtime.session,
					);
					await runtime.output(payload || "Memory payload is empty.");
					return commandConsumed();
				}
				case "clear":
				case "reset": {
					await backend.clear(runtime.settings.getAgentDir(), runtime.cwd, runtime.session);
					await runtime.session.refreshBaseSystemPrompt();
					await runtime.output("Memory cleared.");
					return commandConsumed();
				}
				case "enqueue":
				case "rebuild": {
					await backend.enqueue(runtime.settings.getAgentDir(), runtime.cwd, runtime.session);
					await runtime.output("Memory consolidation enqueued.");
					return commandConsumed();
				}
				case "stats":
				case "diagnose": {
					const hook = verb === "stats" ? backend.stats : backend.diagnose;
					const payload = await hook?.(runtime.settings.getAgentDir(), runtime.cwd, runtime.session);
					await runtime.output(payload ?? `Memory ${verb} is not available for the ${backend.id} backend.`);
					return commandConsumed();
				}
				case "mm":
					return usage(
						"Mental-model maintenance via /memory mm is unsupported in ACP mode; use the hindsight HTTP API directly.",
						runtime,
					);
				default:
					return usage("Usage: /memory <view|stats|diagnose|clear|reset|enqueue|rebuild>", runtime);
			}
		},
		handleTui: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMemoryCommand(command.text);
		},
	},
	{
		name: "rename",
		description: "Rename the current session",
		inlineHint: "<title>",
		allowArgs: true,
		handle: async (command, runtime) => {
			if (!command.args) return usage("Usage: /rename <title>", runtime);
			const ok = await runtime.sessionManager.setSessionName(command.args, "user");
			if (!ok) {
				await runtime.output("Session name not changed (a user-set name takes precedence).");
				return commandConsumed();
			}
			await runtime.notifyTitleChanged?.();
			await runtime.output(`Session renamed to ${command.args}.`);
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			const title = command.args.trim();
			if (!title) {
				runtime.ctx.showError("Usage: /rename <title>");
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleRenameCommand(title);
		},
	},
	{
		name: "move",
		description: "Move session to a different working directory",
		acpDescription: "Move the current session file",
		inlineHint: "<path>",
		allowArgs: true,
		handle: async (command, runtime) => {
			if (runtime.session.isStreaming) return usage("Cannot move while streaming.", runtime);
			if (!command.args) return usage("Usage: /move <path>", runtime);
			const resolvedPath = path.resolve(runtime.cwd, command.args);
			let isDirectory: boolean;
			try {
				isDirectory = (await fs.stat(resolvedPath)).isDirectory();
			} catch {
				return usage(`Directory does not exist or is not a directory: ${resolvedPath}`, runtime);
			}
			if (!isDirectory) return usage(`Directory does not exist or is not a directory: ${resolvedPath}`, runtime);
			try {
				await runtime.sessionManager.flush();
				await runtime.sessionManager.moveTo(resolvedPath);
			} catch (err) {
				return usage(`Move failed: ${errorMessage(err)}`, runtime);
			}
			setProjectDir(resolvedPath);
			// Reload plugin/capability caches so the next prompt sees commands and
			// capabilities scoped to the new cwd.
			await runtime.reloadPlugins();
			await runtime.notifyTitleChanged?.();
			await runtime.output(`Session moved to ${runtime.sessionManager.getCwd()}.`);
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			const targetPath = command.args;
			if (!targetPath) {
				runtime.ctx.showError("Usage: /move <path>");
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMoveCommand(targetPath);
		},
	},
	{
		name: "exit",
		description: "Exit the application",
		handleTui: shutdownHandlerTui,
	},
	{
		name: "marketplace",
		description: "Manage marketplace plugin sources and installed plugins",
		acpDescription: "Manage plugins from marketplaces",
		acpInputHint: "<subcommand>",
		subcommands: [
			{ name: "add", description: "Add a marketplace source", usage: "<source>" },
			{ name: "remove", description: "Remove a marketplace source", usage: "<name>" },
			{ name: "update", description: "Update marketplace catalog(s)", usage: "[name]" },
			{ name: "list", description: "List configured marketplaces" },
			{ name: "discover", description: "Browse available plugins", usage: "[marketplace]" },
			{
				name: "install",
				description: "Install a plugin (interactive browser if no args)",
				usage: "[--force] [name@marketplace]",
			},
			{ name: "uninstall", description: "Uninstall a plugin (selector if no args)", usage: "[name@marketplace]" },
			{ name: "installed", description: "List installed marketplace plugins" },
			{ name: "upgrade", description: "Upgrade outdated plugins", usage: "[name@marketplace]" },
			{ name: "help", description: "Show usage guide" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const { verb, rest } = parseSubcommand(command.args);
			if (!verb) {
				try {
					const manager = await createMarketplaceManager(runtime);
					const marketplaces = await manager.listMarketplaces();
					if (marketplaces.length === 0) {
						await runtime.output(
							`No marketplaces configured.\n\nGet started:\n  /marketplace add ${resolveDefaultMarketplaceUrl()}\n\nThen browse with /marketplace discover`,
						);
					} else {
						const lines = marketplaces.map(m => `  ${m.name}  ${m.sourceUri}`);
						await runtime.output(
							`Marketplaces:\n${lines.join("\n")}\n\nUse /marketplace discover to browse plugins, or /marketplace help for all commands`,
						);
					}
					return commandConsumed();
				} catch (err) {
					return usage(`Marketplace error: ${errorMessage(err)}`, runtime);
				}
			}
			if (verb === "help") {
				await runtime.output(
					[
						"Marketplace commands:",
						"  /marketplace                              List configured marketplaces",
						"  /marketplace add <source>                  Add a marketplace (e.g. owner/repo)",
						"  /marketplace remove <name>                 Remove a marketplace",
						"  /marketplace update [name]                 Re-fetch catalog(s)",
						"  /marketplace list                          List configured marketplaces",
						"  /marketplace discover [marketplace]        Browse available plugins",
						"  /marketplace install <name@marketplace>    Install a plugin",
						"  /marketplace uninstall <name@marketplace>  Uninstall a plugin",
						"  /marketplace installed                     List installed plugins",
						"  /marketplace upgrade [name@marketplace]    Upgrade plugin(s)",
						"",
						"Quick start:",
						"  /marketplace add anthropics/claude-plugins-official",
					].join("\n"),
				);
				return commandConsumed();
			}
			if ((verb === "install" || verb === "uninstall") && !rest) {
				return usage(
					"Interactive plugin pickers are TUI-only. Pass an explicit name@marketplace argument.",
					runtime,
				);
			}
			try {
				const manager = await createMarketplaceManager(runtime);
				switch (verb) {
					case "add": {
						if (!rest) return usage("Usage: /marketplace add <source>", runtime);
						const entry = await manager.addMarketplace(rest);
						await runtime.output(`Added marketplace: ${entry.name}`);
						return commandConsumed();
					}
					case "remove":
					case "rm": {
						if (!rest) return usage("Usage: /marketplace remove <name>", runtime);
						await manager.removeMarketplace(rest);
						await runtime.output(`Removed marketplace: ${rest}`);
						return commandConsumed();
					}
					case "update": {
						if (rest) {
							await manager.updateMarketplace(rest);
							await runtime.output(`Updated marketplace: ${rest}`);
						} else {
							const results = await manager.updateAllMarketplaces();
							await runtime.output(`Updated ${results.length} marketplace(s)`);
						}
						return commandConsumed();
					}
					case "list": {
						const marketplaces = await manager.listMarketplaces();
						if (marketplaces.length === 0) {
							await runtime.output("No marketplaces configured.");
						} else {
							const lines = marketplaces.map(m => `  ${m.name}  ${m.sourceUri}`);
							await runtime.output(`Marketplaces:\n${lines.join("\n")}`);
						}
						return commandConsumed();
					}
					case "discover": {
						const plugins = await manager.listAvailablePlugins(rest || undefined);
						if (plugins.length === 0) {
							const marketplaces = await manager.listMarketplaces();
							await runtime.output(
								marketplaces.length === 0
									? `No marketplaces configured. Try:\n  /marketplace add ${resolveDefaultMarketplaceUrl()}`
									: "No plugins available in configured marketplaces",
							);
							return commandConsumed();
						}
						const lines = ["Available plugins:"];
						for (const plugin of plugins) {
							lines.push(`  - ${plugin.name}${plugin.version ? `@${plugin.version}` : ""}`);
							if (plugin.description) lines.push(`      ${plugin.description}`);
						}
						await runtime.output(lines.join("\n"));
						return commandConsumed();
					}
					case "install": {
						const parsed = parseMarketplaceInstallArgs(rest);
						if ("error" in parsed) return usage(parsed.error, runtime);
						const atIndex = parsed.installSpec.lastIndexOf("@");
						const pluginName = parsed.installSpec.slice(0, atIndex);
						const marketplace = parsed.installSpec.slice(atIndex + 1);
						await manager.installPlugin(pluginName, marketplace, { force: parsed.force, scope: parsed.scope });
						await runtime.reloadPlugins();
						await runtime.output(`Installed ${pluginName} from ${marketplace}`);
						return commandConsumed();
					}
					case "uninstall": {
						const parsed = parsePluginScopeArgs(
							rest,
							"Usage: /marketplace uninstall [--scope user|project] <name@marketplace>",
						);
						if ("error" in parsed) return usage(parsed.error, runtime);
						await manager.uninstallPlugin(parsed.pluginId, parsed.scope);
						await runtime.reloadPlugins();
						await runtime.output(`Uninstalled ${parsed.pluginId}`);
						return commandConsumed();
					}
					case "installed": {
						const installed = await manager.listInstalledPlugins();
						if (installed.length === 0) {
							await runtime.output("No marketplace plugins installed");
						} else {
							const lines = installed.map(
								p => `  ${p.id} [${p.scope}]${p.shadowedBy ? " [shadowed]" : ""} (${p.entries.length} entry)`,
							);
							await runtime.output(`Installed plugins:\n${lines.join("\n")}`);
						}
						return commandConsumed();
					}
					case "upgrade": {
						if (rest) {
							const parsed = parsePluginScopeArgs(
								rest,
								"Usage: /marketplace upgrade [--scope user|project] <name@marketplace>",
							);
							if ("error" in parsed) return usage(parsed.error, runtime);
							const result = await manager.upgradePlugin(parsed.pluginId, parsed.scope);
							await runtime.reloadPlugins();
							await runtime.output(`Upgraded ${parsed.pluginId} to ${result.version}`);
							return commandConsumed();
						}
						const results = await manager.upgradeAllPlugins();
						if (results.length === 0) {
							await runtime.output("All marketplace plugins are up to date");
						} else {
							await runtime.reloadPlugins();
							const lines = results.map(r => `  ${r.pluginId}: ${r.from} -> ${r.to}`);
							await runtime.output(`Upgraded ${results.length} plugin(s):\n${lines.join("\n")}`);
						}
						return commandConsumed();
					}
					default:
						return usage(
							`Unknown /marketplace subcommand: ${verb}. Use /marketplace help for available commands.`,
							runtime,
						);
				}
			} catch (err) {
				return usage(`Marketplace error: ${errorMessage(err)}`, runtime);
			}
		},
		handleTui: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			const args = command.args.trim().split(/\s+/);
			const sub = args[0] || "install";
			const rest = args.slice(1).join(" ").trim();

			// /marketplace (no args) or /marketplace install (no args) → interactive browser
			if ((sub === "install" && !rest) || (!args[0] && !command.args.trim())) {
				try {
					runtime.ctx.showPluginSelector("install");
				} catch (err) {
					runtime.ctx.showStatus(`Marketplace error: ${err}`);
				}
				return;
			}

			const mgr = new MarketplaceManager({
				marketplacesRegistryPath: getMarketplacesRegistryPath(),
				installedRegistryPath: getInstalledPluginsRegistryPath(),
				projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(
					runtime.ctx.sessionManager.getCwd(),
				),
				marketplacesCacheDir: getMarketplacesCacheDir(),
				pluginsCacheDir: getPluginsCacheDir(),
				clearPluginRootsCache: clearPluginRootsAndCaches,
			});

			try {
				switch (sub) {
					case "add": {
						if (!rest) {
							runtime.ctx.showStatus("Usage: /marketplace add <source>");
							return;
						}
						const entry = await mgr.addMarketplace(rest);
						runtime.ctx.showStatus(`Added marketplace: ${entry.name}`);
						break;
					}
					case "remove":
					case "rm": {
						if (!rest) {
							runtime.ctx.showStatus("Usage: /marketplace remove <name>");
							return;
						}
						await mgr.removeMarketplace(rest);
						runtime.ctx.showStatus(`Removed marketplace: ${rest}`);
						break;
					}
					case "update": {
						if (rest) {
							await mgr.updateMarketplace(rest);
							runtime.ctx.showStatus(`Updated marketplace: ${rest}`);
						} else {
							const results = await mgr.updateAllMarketplaces();
							runtime.ctx.showStatus(`Updated ${results.length} marketplace(s)`);
						}
						break;
					}
					case "discover": {
						const plugins = await mgr.listAvailablePlugins(rest || undefined);
						if (plugins.length === 0) {
							const marketplaces = await mgr.listMarketplaces();
							if (marketplaces.length === 0) {
								runtime.ctx.showStatus(
									`No marketplaces configured. Try:\n  /marketplace add ${resolveDefaultMarketplaceUrl()}`,
								);
							} else {
								runtime.ctx.showStatus("No plugins available in configured marketplaces");
							}
						} else {
							const lines = plugins.map(
								p =>
									`  ${p.name}${p.version ? `@${p.version}` : ""}${p.description ? ` - ${p.description}` : ""}`,
							);
							runtime.ctx.showStatus(`Available plugins:\n${lines.join("\n")}`);
						}
						break;
					}
					case "install": {
						// Parse: /marketplace install [--force] [--scope user|project] name@marketplace
						const parsed = parseMarketplaceInstallArgs(rest);
						if ("error" in parsed) {
							runtime.ctx.showStatus(parsed.error);
							return;
						}
						const atIdx = parsed.installSpec.lastIndexOf("@");
						const name = parsed.installSpec.slice(0, atIdx);
						const marketplace = parsed.installSpec.slice(atIdx + 1);
						await mgr.installPlugin(name, marketplace, { force: parsed.force, scope: parsed.scope });
						runtime.ctx.showStatus(`Installed ${name} from ${marketplace}`);
						break;
					}
					case "uninstall": {
						if (!rest) {
							// No args → open interactive uninstall selector
							runtime.ctx.showPluginSelector("uninstall");
							return;
						}
						const uninstArgs = parsePluginScopeArgs(
							rest,
							"Usage: /marketplace uninstall [--scope user|project] <name@marketplace>",
						);
						if ("error" in uninstArgs) {
							runtime.ctx.showStatus(uninstArgs.error);
							return;
						}
						await mgr.uninstallPlugin(uninstArgs.pluginId, uninstArgs.scope);
						runtime.ctx.showStatus(`Uninstalled ${uninstArgs.pluginId}`);
						break;
					}
					case "installed": {
						const installed = await mgr.listInstalledPlugins();
						if (installed.length === 0) {
							runtime.ctx.showStatus("No marketplace plugins installed");
						} else {
							const lines = installed.map(
								p => `  ${p.id} [${p.scope}]${p.shadowedBy ? " [shadowed]" : ""} (${p.entries.length} entry)`,
							);
							runtime.ctx.showStatus(`Installed plugins:\n${lines.join("\n")}`);
						}
						break;
					}
					case "upgrade": {
						if (rest) {
							const upArgs = parsePluginScopeArgs(
								rest,
								"Usage: /marketplace upgrade [--scope user|project] <name@marketplace>",
							);
							if ("error" in upArgs) {
								runtime.ctx.showStatus(upArgs.error);
								return;
							}
							const result = await mgr.upgradePlugin(upArgs.pluginId, upArgs.scope);
							runtime.ctx.showStatus(`Upgraded ${upArgs.pluginId} to ${result.version}`);
						} else {
							const results = await mgr.upgradeAllPlugins();
							if (results.length === 0) {
								runtime.ctx.showStatus("All marketplace plugins are up to date");
							} else {
								const lines = results.map(r => `  ${r.pluginId}: ${r.from} -> ${r.to}`);
								runtime.ctx.showStatus(`Upgraded ${results.length} plugin(s):\n${lines.join("\n")}`);
							}
						}
						break;
					}
					case "help": {
						runtime.ctx.showStatus(
							[
								"Marketplace commands:",
								"  /marketplace                              Browse and install plugins",
								"  /marketplace add <source>                  Add a marketplace (e.g. owner/repo)",
								"  /marketplace remove <name>                 Remove a marketplace",
								"  /marketplace update [name]                 Re-fetch catalog(s)",
								"  /marketplace list                          List configured marketplaces",
								"  /marketplace discover [marketplace]        Browse available plugins",
								"  /marketplace install <name@marketplace>    Install a plugin",
								"  /marketplace uninstall <name@marketplace>  Uninstall a plugin",
								"  /marketplace installed                     List installed plugins",
								"  /marketplace upgrade [name@marketplace]    Upgrade plugin(s)",
								"",
								"Quick start:",
								"  /marketplace add anthropics/claude-plugins-official",
								"  /marketplace                               (opens interactive browser)",
							].join("\n"),
						);
						break;
					}
					default: {
						const marketplaces = await mgr.listMarketplaces();
						if (marketplaces.length === 0) {
							runtime.ctx.showStatus(
								`No marketplaces configured.\n\nGet started:\n  /marketplace add ${resolveDefaultMarketplaceUrl()}\n\nThen browse plugins with /marketplace or /marketplace discover`,
							);
						} else {
							const lines = marketplaces.map(m => `  ${m.name}  ${m.sourceUri}`);
							runtime.ctx.showStatus(
								`Marketplaces:\n${lines.join("\n")}\n\nUse /marketplace discover to browse plugins, or /marketplace help for all commands`,
							);
						}
						break;
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				runtime.ctx.showStatus(`Marketplace error: ${msg}`);
			}
		},
	},
	{
		name: "plugins",
		description: "View and manage installed plugins",
		acpDescription: "Manage plugins",
		acpInputHint: "[list|enable|disable]",
		subcommands: [
			{ name: "list", description: "List all installed plugins (npm + marketplace)" },
			{ name: "enable", description: "Enable a marketplace plugin", usage: "<name@marketplace>" },
			{ name: "disable", description: "Disable a marketplace plugin", usage: "<name@marketplace>" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const { verb, rest } = parseSubcommand(command.args);
			try {
				if (verb === "enable" || verb === "disable") {
					const parsed = parsePluginScopeArgs(
						rest,
						`Usage: /plugins ${verb} [--scope user|project] <name@marketplace>`,
					);
					if ("error" in parsed) return usage(parsed.error, runtime);
					const manager = await createMarketplaceManager(runtime);
					const isEnable = verb === "enable";
					await manager.setPluginEnabled(parsed.pluginId, isEnable, parsed.scope);
					await runtime.reloadPlugins();
					await runtime.output(`${isEnable ? "Enabled" : "Disabled"} ${parsed.pluginId}`);
					return commandConsumed();
				}
				// Default: list
				const lines: string[] = [];
				const npmManager = new PluginManager();
				const npmPlugins = await npmManager.list();
				if (npmPlugins.length > 0) {
					lines.push("npm plugins:");
					for (const plugin of npmPlugins) {
						const status = plugin.enabled === false ? " (disabled)" : "";
						lines.push(`  ${plugin.name}@${plugin.version}${status}`);
					}
				}

				const marketplaceManager = await createMarketplaceManager(runtime);
				const marketplacePlugins = await marketplaceManager.listInstalledPlugins();
				if (marketplacePlugins.length > 0) {
					if (lines.length > 0) lines.push("");
					lines.push("marketplace plugins:");
					for (const plugin of marketplacePlugins) {
						const entry = plugin.entries[0];
						const status = entry?.enabled === false ? " (disabled)" : "";
						const shadowed = plugin.shadowedBy ? " [shadowed]" : "";
						lines.push(`  ${plugin.id} v${entry?.version ?? "?"}${status} [${plugin.scope}]${shadowed}`);
					}
				}

				await runtime.output(lines.length === 0 ? "No plugins installed" : lines.join("\n"));
				return commandConsumed();
			} catch (err) {
				return usage(`Plugin error: ${errorMessage(err)}`, runtime);
			}
		},
		handleTui: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			const args = command.args.trim().split(/\s+/);
			const sub = args[0] || "list";
			const rest = args.slice(1).join(" ").trim();

			try {
				const mgr = new MarketplaceManager({
					marketplacesRegistryPath: getMarketplacesRegistryPath(),
					installedRegistryPath: getInstalledPluginsRegistryPath(),
					projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(
						runtime.ctx.sessionManager.getCwd(),
					),
					marketplacesCacheDir: getMarketplacesCacheDir(),
					pluginsCacheDir: getPluginsCacheDir(),
					clearPluginRootsCache: clearPluginRootsAndCaches,
				});

				switch (sub) {
					case "enable":
					case "disable": {
						const parsed = parsePluginScopeArgs(
							rest ?? "",
							`Usage: /plugins ${sub} [--scope user|project] <name@marketplace>`,
						);
						if ("error" in parsed) {
							runtime.ctx.showStatus(parsed.error);
							return;
						}
						const isEnable = sub === "enable";
						await mgr.setPluginEnabled(parsed.pluginId, isEnable, parsed.scope);
						runtime.ctx.showStatus(`${isEnable ? "Enabled" : "Disabled"} ${parsed.pluginId}`);
						break;
					}
					default: {
						const lines: string[] = [];

						const npm = new PluginManager();
						const npmPlugins = await npm.list();
						if (npmPlugins.length > 0) {
							lines.push("npm plugins:");
							for (const p of npmPlugins) {
								const status = p.enabled === false ? " (disabled)" : "";
								lines.push(`  ${p.name}@${p.version}${status}`);
							}
						}

						const mktPlugins = await mgr.listInstalledPlugins();
						if (mktPlugins.length > 0) {
							if (lines.length > 0) lines.push("");
							lines.push("marketplace plugins:");
							for (const p of mktPlugins) {
								const entry = p.entries[0];
								const status = entry?.enabled === false ? " (disabled)" : "";
								const shadowed = p.shadowedBy ? " [shadowed]" : "";
								lines.push(`  ${p.id} v${entry?.version ?? "?"}${status} [${p.scope}]${shadowed}`);
							}
						}

						if (lines.length === 0) {
							runtime.ctx.showStatus("No plugins installed");
						} else {
							runtime.ctx.showStatus(lines.join("\n"));
						}
						break;
					}
				}
			} catch (err) {
				runtime.ctx.showStatus(`Plugin error: ${err}`);
			}
		},
	},
	{
		name: "reload-plugins",
		description: "Reload all plugins (skills, commands, hooks, tools, agents, MCP)",
		acpDescription: "Reload all plugins",
		handle: async (_command, runtime) => {
			await runtime.reloadPlugins();
			await runtime.output("Plugins reloaded.");
			return commandConsumed();
		},
		handleTui: async (_command, runtime) => {
			// Invalidate registry fs caches and the plugin roots cache so
			// listClaudePluginRoots re-reads from disk on next access.
			const projectPath = await resolveActiveProjectRegistryPath(runtime.ctx.sessionManager.getCwd());
			clearPluginRootsAndCaches(projectPath ? [projectPath] : undefined);
			await runtime.ctx.refreshSlashCommandState();
			await runtime.ctx.session.refreshSshTool({ activateIfAvailable: true });
			runtime.ctx.showStatus("Plugins reloaded.");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "force",
		description: "Force next turn to use a specific tool",
		aliases: ["force:"],
		inlineHint: "<tool-name> [prompt]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const spaceIdx = command.args.indexOf(" ");
			const toolName = spaceIdx === -1 ? command.args : command.args.slice(0, spaceIdx);
			const prompt = spaceIdx === -1 ? "" : command.args.slice(spaceIdx + 1).trim();
			if (!toolName) return usage("Usage: /force:<tool-name> [prompt]", runtime);
			try {
				runtime.session.setForcedToolChoice(toolName);
			} catch (err) {
				return usage(errorMessage(err), runtime);
			}
			await runtime.output(`Next turn forced to use ${toolName}.`);
			return prompt ? { prompt } : commandConsumed();
		},
		handleTui: (command, runtime) => {
			const spaceIdx = command.args.indexOf(" ");
			const toolName = spaceIdx === -1 ? command.args : command.args.slice(0, spaceIdx);
			const prompt = spaceIdx === -1 ? "" : command.args.slice(spaceIdx + 1).trim();

			if (!toolName) {
				runtime.ctx.showError("Usage: /force:<tool-name> [prompt]");
				runtime.ctx.editor.setText("");
				return;
			}

			try {
				runtime.ctx.session.setForcedToolChoice(toolName);
				runtime.ctx.showStatus(`Next turn forced to use ${toolName}.`);
			} catch (error) {
				runtime.ctx.showError(errorMessage(error));
				runtime.ctx.editor.setText("");
				return;
			}

			runtime.ctx.editor.setText("");

			// If a prompt was provided, pass it through as input
			if (prompt) return { prompt };
		},
	},
	// ──────────────────────────────────────────────────────────────────────
	// Pakalon slash commands (added by code.md implementation)
	// ──────────────────────────────────────────────────────────────────────
	{
		name: "init",
		description: "Initialize .pakalon normal mode folder",
		inlineHint: "[--force] [--yolo]",
		allowArgs: true,
		handleTui: (command, runtime) => {
			const args = parseInitArgs(command.args || "");
			const cwd = runtime.ctx.sessionManager.getCwd();
			const result = initNormalMode(cwd, { force: args.force, mode: "normal" });
			runtime.ctx.showStatus(result);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "pakalon",
		description: "Initialize .pakalon-agents full SDLC mode",
		inlineHint: "[--force] [--yolo] [HIL|YOLO]",
		allowArgs: true,
		handleTui: (command, runtime) => {
			const args = parseInitArgs(command.args || "");
			const mode: "HIL" | "YOLO" = args.yolo ? "YOLO" : "HIL";
			const cwd = runtime.ctx.sessionManager.getCwd();
			const result = initAgentsMode(cwd, { force: args.force, mode: "agents" }, mode);
			runtime.ctx.showStatus(result);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "logout",
		description: "Logout from Pakalon and clear session tokens",
		handleTui: (_command, runtime) => {
			logout();
			runtime.ctx.showStatus("Logged out successfully.");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "undo",
		description: "Undo last code change or conversation",
		inlineHint: "[code|conversation|both|nothing]",
		allowArgs: true,
		handleTui: (command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const arg = (command.args || "").trim().toLowerCase();
			if (!arg) {
				const snap = latestSnapshot(cwd);
				runtime.ctx.showStatus(
					snap
						? `Last change: ${snap.id} (${snap.files.length} files, ${snap.conversationTail} messages). Use /undo code | /undo conversation | /undo both | /undo nothing.`
						: "Nothing to undo.",
				);
			} else if (arg === "code") {
				const r = applyPakalonUndo(cwd, "code");
				runtime.ctx.showStatus(r.restored.length ? `Restored ${r.restored.length} files.` : "Nothing to restore.");
			} else if (arg === "conversation") {
				const r = applyPakalonUndo(cwd, "conversation");
				runtime.ctx.showStatus(`Popped ${r.popped} message(s).`);
			} else if (arg === "both") {
				const r = applyPakalonUndo(cwd, "both");
				runtime.ctx.showStatus(`Restored ${r.restored.length} files; popped ${r.popped} message(s).`);
			} else if (arg === "nothing") {
				applyPakalonUndo(cwd, "nothing");
				runtime.ctx.showStatus("No changes.");
			} else {
				runtime.ctx.showStatus("Usage: /undo code | /undo conversation | /undo both | /undo nothing");
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "penpot",
		description: "Open Penpot for wireframe editing (starts the sync bridge + browser)",
		handleTui: async (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const state = await startSyncBridge({
				projectDir: cwd,
				penpotUrl: process.env.PENPOT_URL ?? "http://localhost:9100",
				onChange: file => {
					runtime.ctx.showStatus(`[sync-bridge] ${file}`);
				},
			});
			// Best-effort: open Penpot in the user's default browser so they
			// land on the running container without copy-pasting the URL.
			if (state.penpot?.url) {
				try {
					const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
					Bun.spawn([cmd, state.penpot.url], { stdout: "ignore", stderr: "ignore" });
				} catch {
					// Browser-open is best-effort; log silently.
				}
			}
			runtime.ctx.showStatus(
				state.penpot
					? `Penpot sync bridge started. ${state.penpot.url} (opened in browser). Watching ${state.watching}.`
					: `Penpot sync bridge started in local-watcher mode (Docker not available). Watching ${state.watching}.`,
			);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "penpot-stop",
		description: "Stop the Penpot sync bridge",
		handleTui: async (_command, runtime) => {
			await stopSyncBridge();
			runtime.ctx.showStatus(isSyncBridgeRunning() ? "Bridge still running" : "Bridge stopped.");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "automations",
		aliases: ["automation"],
		description: "List or create automation workflows",
		inlineHint: "[list|create <name>|delete <id>]",
		allowArgs: true,
		handleTui: (command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const args = (command.args || "").trim();
			if (!args || args === "list") {
				const items = listAutomations(cwd);
				runtime.ctx.showStatus(
					items.length
						? items.map(a => `${a.id}  ${a.name}  (${a.cron})`).join("\n")
						: "No automations yet. Use /automations create <name>.",
				);
			} else if (args.startsWith("create ")) {
				const name = args.slice(7).trim();
				const id = deriveAutomationId(name);
				saveAutomation(cwd, {
					id,
					name,
					description: "",
					prompt: "",
					integrations: [],
					cron: "*/15 * * * *",
					createdAt: new Date().toISOString(),
				});
				runtime.ctx.showStatus(
					`Created automation '${id}'. Edit ${cwd}/.pakalon/automations/${id}.json to add prompt + cron.`,
				);
			} else if (args.startsWith("delete ")) {
				const id = args.slice(7).trim();
				const ok = deleteAutomation(cwd, id);
				runtime.ctx.showStatus(ok ? `Deleted ${id}.` : `${id} not found.`);
			} else {
				runtime.ctx.showStatus("Usage: /automations [list|create <name>|delete <id>]");
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "agents",
		description: "Create or list agent teams (with color + tool allow-list)",
		aliases: ["agent"],
		inlineHint: "[create|list|delete|color|tools|show] [name] [...]",
		allowArgs: true,
		handleTui: (command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const sub = (command.args || "list").trim();
			const spaceIdx = sub.indexOf(" ");
			const verb = (spaceIdx < 0 ? sub : sub.slice(0, spaceIdx)).toLowerCase();
			const rest = spaceIdx < 0 ? "" : sub.slice(spaceIdx + 1).trim();
			const fsMod = require("node:fs") as typeof import("node:fs");
			const pathMod = require("node:path") as typeof import("node:path");

			const readAgent = (idOrName: string) => {
				const items = listAgentTeams(cwd);
				return items.find(a => a.id === idOrName || a.name === idOrName) ?? null;
			};
			const writeAgent = (agent: {
				id: string;
				name: string;
				description: string;
				color: string;
				tools: string[];
				systemPrompt: string;
				createdAt: string;
				updatedAt: string;
			}) => {
				const file = pathMod.join(cwd, ".pakalon", "agents", `${agent.id}.json`);
				const next = { ...agent, updatedAt: new Date().toISOString() };
				fsMod.writeFileSync(file, JSON.stringify(next, null, 2));
			};

			if (verb === "list" || !verb) {
				const items = listAgentTeams(cwd);
				runtime.ctx.showStatus(
					items.length
						? items
								.map(a => `${a.id}  ${a.name}  (color=${a.color}, tools=${a.tools.length || "all"})`)
								.join("\n")
						: "No agent teams yet. Use /agents create <name>.",
				);
			} else if (verb === "create" && rest) {
				const id = deriveAgentId(rest);
				saveAgentTeam(cwd, {
					id,
					name: rest,
					description: "",
					color: "#3B82F6",
					tools: [],
					systemPrompt: "",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				});
				runtime.ctx.showStatus(
					`Created agent team '${rest}' (id=${id}). Next: /agents color ${rest} <#hex>, /agents tools ${rest} read,write,edit,bash, /agents edit ${rest} "system prompt…" (edit the JSON directly).`,
				);
			} else if (verb === "color" && rest) {
				// /agents color <name|id> <#hex>
				const sp = rest.indexOf(" ");
				const who = sp < 0 ? rest : rest.slice(0, sp);
				const hex = sp < 0 ? "" : rest.slice(sp + 1).trim();
				if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
					runtime.ctx.showStatus("Color must be a 6-digit hex like #3B82F6.");
				} else {
					const a = readAgent(who);
					if (!a) {
						runtime.ctx.showStatus(`Agent '${who}' not found.`);
					} else {
						writeAgent({ ...a, color: hex });
						runtime.ctx.showStatus(`Set ${a.name} color to ${hex}.`);
					}
				}
			} else if (verb === "tools" && rest) {
				// /agents tools <name|id> <tool1,tool2,...|all|none>
				const sp = rest.indexOf(" ");
				const who = sp < 0 ? rest : rest.slice(0, sp);
				const list = sp < 0 ? "" : rest.slice(sp + 1).trim();
				const a = readAgent(who);
				if (!a) {
					runtime.ctx.showStatus(`Agent '${who}' not found.`);
				} else if (!list) {
					runtime.ctx.showStatus(`Current tools for ${a.name}: ${a.tools.length ? a.tools.join(", ") : "(all)"}`);
				} else if (list === "all") {
					writeAgent({ ...a, tools: [] });
					runtime.ctx.showStatus(`${a.name} now has access to all tools.`);
				} else if (list === "none") {
					writeAgent({ ...a, tools: [] });
					runtime.ctx.showStatus(`${a.name} now has no tools (repl mode).`);
				} else {
					const tools = list
						.split(/[,\s]+/)
						.map(t => t.trim())
						.filter(Boolean);
					writeAgent({ ...a, tools });
					runtime.ctx.showStatus(`Set ${a.name} tools: ${tools.join(", ")}`);
				}
			} else if (verb === "show" && rest) {
				const a = readAgent(rest);
				runtime.ctx.showStatus(
					a
						? [
								`# ${a.name} (id=${a.id})`,
								`color: ${a.color}`,
								`tools: ${a.tools.length ? a.tools.join(", ") : "(all)"}`,
								`description: ${a.description || "(none)"}`,
								`createdAt: ${a.createdAt}`,
								`updatedAt: ${a.updatedAt}`,
							].join("\n")
						: `${rest} not found.`,
				);
			} else if (verb === "delete" && rest) {
				const removed = listAgentTeams(cwd).find(a => a.id === rest || a.name === rest);
				if (removed) {
					try {
						fsMod.unlinkSync(pathMod.join(cwd, ".pakalon", "agents", `${removed.id}.json`));
						runtime.ctx.showStatus(`Deleted ${removed.id}.`);
					} catch (err) {
						runtime.ctx.showStatus(`Failed to delete: ${err}`);
					}
				} else {
					runtime.ctx.showStatus(`${rest} not found.`);
				}
			} else {
				runtime.ctx.showStatus(
					"Usage: /agents [list|create <name>|color <name> <#hex>|tools <name> <list|all|none>|show <name>|delete <name>]",
				);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "history",
		description: "Show session history for this directory",
		handleTui: (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			runtime.ctx.showStatus(formatHistory(cwd));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "session",
		aliases: ["sessions"],
		description: "List per-directory sessions",
		handleTui: (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			runtime.ctx.showStatus(formatSessionList(cwd));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "resume",
		description: "Resume a previous session",
		inlineHint: "[session-id]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const id = (command.args || "").trim();
			try {
				let sessionId = id;
				if (!sessionId) {
					// No id: pick the most recent paused/active session.
					const active = getActiveSession(cwd);
					if (active) {
						sessionId = active.id;
					} else {
						const recent = listSessions(cwd).filter(s => s.status === "paused" || s.status === "active");
						if (recent.length === 0) {
							runtime.ctx.showStatus("No previous sessions found. Use /session to list.");
							runtime.ctx.editor.setText("");
							return;
						}
						recent.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
						sessionId = recent[0].id;
					}
				}
				const session = getNormalSession(cwd, sessionId);
				if (!session) {
					runtime.ctx.showStatus(`Session ${sessionId} not found.`);
					runtime.ctx.editor.setText("");
					return;
				}
				const resumed = resumeNormalSession(cwd, sessionId);
				if (!resumed) {
					runtime.ctx.showStatus(`Failed to resume session ${sessionId}.`);
					runtime.ctx.editor.setText("");
					return;
				}
				// Replay prior conversation tail into the live session.
				const msgs = getNormalMessages(cwd, sessionId);
				const tail = msgs.slice(-20);
				const transcript = tail.map(m => `[${m.role}] ${m.content}`).join("\n");
				const replayPrompt = `[RESUMED-SESSION ${sessionId}] ${resumed.name}\n\nPrevious conversation tail:\n${transcript}\n\nContinue from where we left off.`;
				void runtime.ctx.session
					.sendUserMessage(replayPrompt)
					.catch((err: unknown) => runtime.ctx.showStatus(`Resume replay failed: ${errorMessage(err)}`));
				// Log the resume event in the active session for history.
				addNormalMessage(
					cwd,
					runtime.ctx.sessionManager.getSessionId?.() ?? sessionId,
					"system",
					`Resumed session ${sessionId}: ${resumed.name}`,
				);
				runtime.ctx.showStatus(
					`Resumed session ${sessionId} (${resumed.name}) — replaying ${tail.length} message(s)…`,
				);
			} catch (err) {
				runtime.ctx.showStatus(`Resume failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "ans",
		aliases: ["ask"],
		description: "Ask a side question without interrupting the agent (spawns a side sub-agent)",
		inlineHint: "<question>",
		allowArgs: true,
		handleTui: (command, runtime) => {
			if (!command.args) {
				runtime.ctx.showStatus("Usage: /ans <question>");
				runtime.ctx.editor.setText("");
				return;
			}
			// Preferred path: use the BtwController (`runEphemeralTurn`) so the
			// main agent loop is NOT interrupted — per requirments/CLI-req.md
			// "the AI agent will keep on working but when this command is
			// typed and asked for any questions it ans them without
			// interupting the AI agent that is working".
			const btw = (
				runtime.ctx as unknown as {
					btwController?: { start: (q: string) => void | Promise<void> };
				}
			).btwController;
			if (btw && typeof btw.start === "function") {
				void btw.start(command.args);
				runtime.ctx.showStatus(`Side Q&A: ${command.args}`);
				runtime.ctx.editor.setText("");
				return;
			}
			// Fallback: best-effort non-interrupting prompt via `[SIDE-QA]`
			// tag. The main agent is expected to honour this prefix and
			// answer inline without taking tools that mutate state.
			void runtime.ctx.session
				.sendUserMessage(
					`[SIDE-QA] Answer concisely using only the project files. Do not modify anything.\n\n${command.args}`,
				)
				.catch((err: unknown) => runtime.ctx.showStatus(`Side Q&A failed: ${errorMessage(err)}`));
			runtime.ctx.showStatus(`Side Q&A submitted: ${command.args}`);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "connect",
		description: "Connect to Telegram bot",
		inlineHint: "<bot-token>",
		allowArgs: true,
		handleTui: (command, runtime) => {
			if (!command.args) {
				runtime.ctx.showStatus("Usage: /connect <bot-token>");
			} else {
				setTelegramToken(command.args.trim());
				const { url } = startTelegramServer(0);
				// Wire the live AgentSession to the Telegram router so that
				// incoming messages actually reach the agent. Without this,
				// messages received on the webhook are silently dropped.
				import("../pakalon/telegram/router")
					.then(({ bindTelegramSession }) => {
						const session = runtime.ctx.session as unknown as {
							sendUserMessage?: (text: string) => Promise<string>;
							prompt?: (text: string) => Promise<string>;
						};
						const submit = async (text: string): Promise<string> => {
							if (typeof session.sendUserMessage === "function") {
								const result = await session.sendUserMessage(text);
								return typeof result === "string" ? result : "";
							}
							if (typeof session.prompt === "function") {
								const result = await session.prompt(text);
								return typeof result === "string" ? result : "";
							}
							return "";
						};
						bindTelegramSession(submit);
					})
					.catch((err: unknown) => {
						runtime.ctx.showStatus(`Telegram: failed to bind session: ${errorMessage(err)}`);
					});
				runtime.ctx.showStatus(
					`Telegram bot connected. Webhook: ${url}. Set this URL on your bot via @BotFather → /setwebhook, then send a message to start.`,
				);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "connect-end",
		description: "Disconnect Telegram bot",
		handleTui: (_command, runtime) => {
			stopTelegramServer();
			clearTelegramConfig();
			runtime.ctx.showStatus("Telegram bot disconnected and credentials cleared.");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "update",
		description: "Apply a surgical update (snapshot taken so /undo can revert any excess changes)",
		inlineHint: "<description>",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			if (!command.args) {
				runtime.ctx.showStatus("Usage: /update <change-description>");
				runtime.ctx.editor.setText("");
				return;
			}
			const cwd = runtime.ctx.sessionManager.getCwd();
			// Take a snapshot of every file we suspect the agent might
			// touch. The audit's requirement is "the main purpose of
			// this tool is that when this tool is called then whatever
			// the changes that are mentioned alone should be made,
			// other than what is mentioned nothing should be made" —
			// we enforce this by snapshotting the working tree so the
			// user can /undo if the agent's diff exceeds the scope.
			try {
				const { recordSnapshot } = await import("../pakalon/undo/menu");
				const { execSync } = await import("node:child_process");
				let tracked: string[] = [];
				try {
					const out = execSync("git ls-files --others --exclude-standard --modified", { cwd, encoding: "utf-8" });
					tracked = out
						.split("\n")
						.map(s => s.trim())
						.filter(Boolean);
				} catch {
					// not a git repo: snapshot the whole tree
					tracked = [];
				}
				recordSnapshot(cwd, tracked, 0);
				runtime.ctx.showStatus(
					`Snapshot taken (${tracked.length} files). Applying targeted update: ${command.args}. Use /undo if scope exceeded.`,
				);
			} catch (err) {
				logger.warn("update: snapshot failed", { err });
			}
			void runtime.ctx.session
				.sendUserMessage(
					`[CONSTRAINED-UPDATE] Apply ONLY this change. Do not modify anything else.\n\n` +
						`REQUESTED CHANGE:\n${command.args}\n\n` +
						`RULES:\n- Touch only the files required for the change above.\n- If you need to touch more, STOP and ask for confirmation.\n- Do not refactor adjacent code.\n- Do not reformat files.\n- Do not change unrelated tests, comments, or imports.`,
				)
				.catch((err: unknown) => runtime.ctx.showStatus(`Update failed: ${errorMessage(err)}`));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "multi-session",
		aliases: ["ms"],
		description: "Show multi-session manager with card layout",
		handleTui: (_command, runtime) => {
			const { loadSessions, renderSessionCards } =
				require("../normal-mode/multi-session") as typeof import("../normal-mode/multi-session");
			const cwd = runtime.ctx.sessionManager.getCwd();
			const sessions = loadSessions(cwd);
			// Render the React multi-session dashboard if a renderer is available;
			// otherwise fall back to the chalk text view.
			type DashboardSessions = Array<{
				id: string;
				name: string;
				status: "running" | "idle" | "needsInput" | "done" | "error" | "archived";
				createdAt: number;
				messageCount: number;
				model: string;
				phase?: string;
			}>;
			const dashboardSessions: DashboardSessions = sessions.map(s => ({
				id: s.id,
				name: s.name,
				// map OMP status → dashboard status
				status:
					s.status === "active"
						? "running"
						: s.status === "paused"
							? "idle"
							: s.status === "completed"
								? "done"
								: s.status === "archived"
									? "archived"
									: "needsInput",
				createdAt: s.lastActiveAt || s.createdAt,
				messageCount: s.messageCount,
				model: s.model ?? "",
				phase: s.phase,
			}));
			const renderReactDashboard = (
				runtime.ctx as unknown as {
					renderMultiSessionDashboard?: (sessions: DashboardSessions) => Promise<string> | string;
				}
			).renderMultiSessionDashboard;
			if (typeof renderReactDashboard === "function") {
				void Promise.resolve(renderReactDashboard(dashboardSessions)).then(out => runtime.ctx.showStatus(out));
			} else {
				runtime.ctx.showStatus(renderSessionCards(sessions));
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "phase-1",
		description: "Start Phase 1: Planning & Requirements",
		handleTui: async (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const { hasPhaseOutputs, shouldRerunPhase, writePhaseSummary } = await import("../pakalon/phases/helpers");
			const exists = hasPhaseOutputs(cwd, "phase-1");
			if (exists) {
				const proceed = await shouldRerunPhase(cwd, "phase-1", "HIL", () => {
					runtime.ctx.showStatus(
						"Phase 1 has prior outputs. Re-running will overwrite. Type /phase-1 again to confirm.",
					);
					return false; // HIL: require a second invocation to actually re-run.
				});
				if (!proceed) {
					runtime.ctx.editor.setText("");
					return;
				}
			}
			jumpToPhase(cwd, "phase-1");
			try {
				await runPhase1(cwd, { prompt: runtime.ctx.editor.getText() || "", mode: "HIL" });
				writePhaseSummary(
					cwd,
					"phase-1",
					"Phase 1: Planning & Requirements completed (HIL).\nSee plan.md, tasks.md, user-stories.md, and the 14 supporting artifacts.",
				);
				runtime.ctx.showStatus("Phase 1 completed. See .pakalon-agents/ai-agents/phase-1/ for outputs.");
			} catch (err) {
				runtime.ctx.showStatus(`Phase 1 failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "phase-2",
		description:
			"Start Phase 2: Wireframe Generation. Use /phase-2 accept|modify <desc>|redesign after wireframes are generated.",
		handleTui: async (command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const { hasPhaseOutputs, shouldRerunPhase, writePhaseSummary } = await import("../pakalon/phases/helpers");

			// ── Accept/Modify/Redesign decision handling ────────────────
			const verb = command.args.trim().toLowerCase();
			if (verb === "accept") {
				const phase = getCurrentPhase(cwd);
				if (phase === "phase-2") {
					advancePhase(cwd);
					runtime.ctx.showStatus("Phase 2 accepted. Proceeding to Phase 3. Use /phase-3 to start development.");
				} else {
					runtime.ctx.showStatus("Phase 2 is not the active phase. Start with /phase-2 first.");
				}
				runtime.ctx.editor.setText("");
				return;
			}

			if (verb === "redesign") {
				runtime.ctx.showStatus("Redesigning wireframes from scratch...");
				jumpToPhase(cwd, "phase-2");
				try {
					await runPhase2(cwd);
					writePhaseSummary(cwd, "phase-2", "Phase 2: Wireframe Regeneration (redesign) completed.");
					runtime.ctx.showStatus(
						"Wireframes regenerated. Choose: /phase-2 accept | /phase-2 modify <desc> | /phase-2 redesign",
					);
				} catch (err) {
					runtime.ctx.showStatus(`Phase 2 redesign failed: ${errorMessage(err)}`);
				}
				runtime.ctx.editor.setText("");
				return;
			}

			if (verb.startsWith("modify")) {
				const desc = verb.slice(6).trim();
				if (!desc) {
					runtime.ctx.showStatus("Usage: /phase-2 modify <description of changes>");
					runtime.ctx.editor.setText("");
					return;
				}
				runtime.ctx.showStatus(`Modifying wireframes: ${desc}...`);
				jumpToPhase(cwd, "phase-2");
				try {
					await runPhase2(cwd, {
						projectDir: cwd,
						designSystem: { description: desc },
					});
					writePhaseSummary(cwd, "phase-2", `Phase 2: Wireframe Modification applied.\nChanges: ${desc}`);
					runtime.ctx.showStatus(
						"Wireframes regenerated. Choose: /phase-2 accept | /phase-2 modify <desc> | /phase-2 redesign",
					);
				} catch (err) {
					runtime.ctx.showStatus(`Phase 2 modify failed: ${errorMessage(err)}`);
				}
				runtime.ctx.editor.setText("");
				return;
			}

			// ── Normal Phase 2 run ─────────────────────────────────────
			if (hasPhaseOutputs(cwd, "phase-2")) {
				const proceed = await shouldRerunPhase(cwd, "phase-2", "HIL", () => {
					runtime.ctx.showStatus(
						"Phase 2 has prior outputs. Re-running will overwrite. Type /phase-2 again to confirm.",
					);
					return false;
				});
				if (!proceed) {
					if (hasPhaseOutputs(cwd, "phase-2")) {
						runtime.ctx.showStatus(
							"Prior wireframes exist. Choose: /phase-2 accept | /phase-2 modify <desc> | /phase-2 redesign",
						);
					}
					runtime.ctx.editor.setText("");
					return;
				}
			}
			jumpToPhase(cwd, "phase-2");
			try {
				await runPhase2(cwd);
				writePhaseSummary(
					cwd,
					"phase-2",
					"Phase 2: Wireframe Generation completed.\nOutputs: Wireframe_generated.svg / .json / .penpot.",
				);
				runtime.ctx.showStatus(
					"Phase 2 completed. Choose: /phase-2 accept | /phase-2 modify <description> | /phase-2 redesign",
				);
			} catch (err) {
				runtime.ctx.showStatus(`Phase 2 failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "phase-3",
		description: "Start Phase 3: Development & Implementation",
		handleTui: async (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const { hasPhaseOutputs, shouldRerunPhase, writePhaseSummary } = await import("../pakalon/phases/helpers");
			if (hasPhaseOutputs(cwd, "phase-3")) {
				const proceed = await shouldRerunPhase(cwd, "phase-3", "HIL", () => {
					runtime.ctx.showStatus(
						"Phase 3 has prior outputs. Re-running will overwrite. Type /phase-3 again to confirm.",
					);
					return false;
				});
				if (!proceed) {
					runtime.ctx.editor.setText("");
					return;
				}
			}
			jumpToPhase(cwd, "phase-3");
			// Pakalon: auto-trigger the Docker sandbox for large
			// projects before phase-3 starts. The audit flagged that
			// `ensureSandboxForProject` was never invoked from
			// production code.
			try {
				const { ensureSandboxForProject } = await import("../pakalon/sandbox/policy");
				const policy = await ensureSandboxForProject(cwd);
				if (policy.enabled) {
					runtime.ctx.showStatus(`Sandbox auto-started: ${policy.reason}`);
				}
			} catch (err) {
				// Sandbox is best-effort; never block phase-3.
			}
			try {
				await runPhase3(cwd);
				writePhaseSummary(
					cwd,
					"phase-3",
					"Phase 3: Development & Implementation completed.\n5 sub-agents dispatched in parallel waves (SA1+SA2 → SA3 → SA4 → SA5).",
				);
				runtime.ctx.showStatus("Phase 3 completed. See .pakalon-agents/ai-agents/phase-3/ for outputs.");
			} catch (err) {
				runtime.ctx.showStatus(`Phase 3 failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "phase-4",
		description: "Start Phase 4: Testing & Security",
		handleTui: async (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const { hasPhaseOutputs, shouldRerunPhase, writePhaseSummary, renderPhase4OverrideMessage } = await import(
				"../pakalon/phases/helpers"
			);
			if (hasPhaseOutputs(cwd, "phase-4")) {
				const proceed = await shouldRerunPhase(cwd, "phase-4", "HIL", () => {
					runtime.ctx.showStatus(
						"Phase 4 has prior outputs. Re-running will overwrite. Type /phase-4 again to confirm.",
					);
					return false;
				});
				if (!proceed) {
					runtime.ctx.editor.setText("");
					return;
				}
			}
			jumpToPhase(cwd, "phase-4");
			try {
				await runPhase4(cwd, {
					projectDir: cwd,
					enableSast: true,
					enableDast: true,
					enableCodeReview: true,
					mode: "HIL",
				});
				const overrideMsg = renderPhase4OverrideMessage(cwd);
				if (overrideMsg) {
					runtime.ctx.showStatus(overrideMsg);
				} else {
					writePhaseSummary(
						cwd,
						"phase-4",
						"Phase 4: Testing & Security completed.\nSAST, DAST, code review, CI/CD, pentest sub-agents dispatched.",
					);
					runtime.ctx.showStatus("Phase 4 completed. See .pakalon-agents/ai-agents/phase-4/ for reports.");
				}
			} catch (err) {
				runtime.ctx.showStatus(`Phase 4 failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "phase-5",
		description: "Start Phase 5: Deployment",
		handleTui: async (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const { hasPhaseOutputs, shouldRerunPhase, writePhaseSummary, renderPhase4OverrideMessage } = await import(
				"../pakalon/phases/helpers"
			);
			// If Phase 4 override is pending, notify the user and clear it
			// (the act of running Phase 5 is the "proceed despite warnings" choice).
			const phase4OverrideMsg = renderPhase4OverrideMessage(cwd);
			if (phase4OverrideMsg) {
				runtime.ctx.showStatus(phase4OverrideMsg);
				// Clear the override file — user has chosen to proceed.
				try {
					const { clearPhase4Override } = await import("../phases/phase4/index");
					clearPhase4Override(cwd);
				} catch {
					/* best-effort */
				}
			}
			if (hasPhaseOutputs(cwd, "phase-5")) {
				const proceed = await shouldRerunPhase(cwd, "phase-5", "HIL", () => {
					runtime.ctx.showStatus(
						"Phase 5 has prior outputs. Re-running will overwrite. Type /phase-5 again to confirm.",
					);
					return false;
				});
				if (!proceed) {
					runtime.ctx.editor.setText("");
					return;
				}
			}
			jumpToPhase(cwd, "phase-5");
			try {
				await runPhase5(cwd);
				writePhaseSummary(
					cwd,
					"phase-5",
					"Phase 5: Deployment completed.\nCI/CD configs, platform IaC, and GitHub push (when gh CLI is available) generated.",
				);
				runtime.ctx.showStatus("Phase 5 completed. See .pakalon-agents/ai-agents/phase-5/ for outputs.");
			} catch (err) {
				runtime.ctx.showStatus(`Phase 5 failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "phase-6",
		description: "Start Phase 6: Maintenance & Documentation",
		handleTui: async (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const { hasPhaseOutputs, shouldRerunPhase, writePhaseSummary } = await import("../pakalon/phases/helpers");
			if (hasPhaseOutputs(cwd, "phase-6")) {
				const proceed = await shouldRerunPhase(cwd, "phase-6", "HIL", () => {
					runtime.ctx.showStatus(
						"Phase 6 has prior outputs. Re-running will overwrite. Type /phase-6 again to confirm.",
					);
					return false;
				});
				if (!proceed) {
					runtime.ctx.editor.setText("");
					return;
				}
			}
			jumpToPhase(cwd, "phase-6");
			try {
				await runPhase6(cwd, {
					projectDir: cwd,
					projectName: "Pakalon Project",
					description: "",
					version: "1.0.0",
				});
				writePhaseSummary(
					cwd,
					"phase-6",
					"Phase 6: Maintenance & Documentation completed.\nDoc.md, README.md, CHANGELOG.md, and the AST-derived symbols table generated.",
				);
				runtime.ctx.showStatus("Phase 6 completed. See .pakalon-agents/ai-agents/phase-6/ for docs.");
			} catch (err) {
				runtime.ctx.showStatus(`Phase 6 failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "help",
		description: "List all registered Pakalon slash commands",
		inlineHint: "[<filter-text>]",
		allowArgs: true,
		handleTui: (command, runtime) => {
			// Walk the registry we are *in*. We can read the module's
			// `BUILTIN_SLASH_COMMAND_LOOKUP` map via the same
			// dynamic require the file uses internally. If the
			// map is not exposed, fall back to scanning for a
			// "description" property on each entry.
			let entries: ReadonlyArray<{ name: string; description?: string; aliases?: string[] }> = [];
			try {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const reg = require("./acp-builtins") as { BUILTIN_SLASH_COMMAND_LOOKUP?: Map<string, unknown> };
				const lookup = reg.BUILTIN_SLASH_COMMAND_LOOKUP;
				if (lookup instanceof Map) {
					entries = [...lookup.values()].filter(
						(v): v is { name: string; description?: string; aliases?: string[] } => {
							return typeof v === "object" && v !== null && "name" in v;
						},
					);
				}
			} catch {
				/* fall through */
			}
			if (entries.length === 0) {
				// Fall back to a curated list. This is the canonical
				// Pakalon command surface per the requirements doc.
				entries = [
					{ name: "init", description: "Initialize .pakalon/" },
					{ name: "pakalon", description: "Initialize .pakalon-agents/ (HIL/YOLO)" },
					{ name: "login", description: "Sign in via 6-digit device code" },
					{ name: "logout", description: "Wipe auth record" },
					{ name: "models", description: "Switch model" },
					{ name: "model-auto", description: "Auto-pick model" },
					{ name: "models-list", description: "List OpenRouter models" },
					{ name: "workflows", description: "Open workflow runner" },
					{ name: "directory", description: "Switch working directory" },
					{ name: "agents", description: "Create/list/manage agent teams" },
					{ name: "web", description: "Web search / fetch" },
					{ name: "history", description: "Show prompt history" },
					{ name: "session", description: "List sessions" },
					{ name: "new", description: "Start new session" },
					{ name: "resume", description: "Resume a session" },
					{ name: "update", description: "Surgical update" },
					{ name: "penpot", description: "Start Penpot sync" },
					{ name: "automations", description: "List automations" },
					{ name: "ans", description: "Side Q&A" },
					{ name: "phase-1..6", description: "Run a phase" },
					{ name: "connect", description: "Connect Telegram bot" },
					{ name: "connect-end", description: "Disconnect Telegram" },
					{ name: "mode", description: "Cycle permission mode" },
					{ name: "figma", description: "Import a Figma .fig / URL" },
					{ name: "undo", description: "Undo menu" },
					{ name: "budget", description: "Set token budget" },
					{ name: "status", description: "Project status" },
					{ name: "doctor", description: "Diagnostics" },
					{ name: "auditor", description: "Run auditor loop" },
					{ name: "followup", description: "Auditor follow-up" },
					{ name: "ask", description: "Ask the side agent" },
					{ name: "ms", description: "Multi-session dashboard" },
					{ name: "help", description: "This message" },
				];
			}
			const filter = (command.args || "").trim().toLowerCase();
			const filteredList = filter
				? entries.filter(
						e => e.name.toLowerCase().includes(filter) || (e.description ?? "").toLowerCase().includes(filter),
					)
				: entries;
			// Stable sort by name. Copy first to avoid `readonly`.
			const filtered = [...filteredList].sort((a, b) => a.name.localeCompare(b.name));
			const lines: string[] = [`Pakalon slash commands${filter ? ` (filter: ${filter})` : ""}:`];
			for (const e of filtered) {
				const desc = e.description ? `  — ${e.description}` : "";
				const aliases = e.aliases && e.aliases.length > 0 ? ` (${e.aliases.join(", ")})` : "";
				lines.push(`  /${e.name}${aliases}${desc}`);
			}
			lines.push("");
			lines.push(`Total: ${filtered.length} command(s).`);
			runtime.ctx.showStatus(lines.join("\n"));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "status",
		description: "Show current Pakalon project status",
		handleTui: (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			runtime.ctx.showStatus(generateSummaryReport(cwd));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "login",
		description: "Sign in via 6-digit device code (web companion)",
		handleTui: async (_command, runtime) => {
			if (isSelfHostedMode()) {
				runtime.ctx.showStatus("Self-hosted mode: login not required. Using local models only.");
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.showStatus("Initiating 6-digit device-code login…");
			const rec = await runLoginFlow({}).catch((err: unknown) => {
				runtime.ctx.showStatus(`Login failed: ${errorMessage(err)}`);
				return null;
			});
			runtime.ctx.editor.setText("");
			if (!rec) return;
			runtime.ctx.showStatus(
				`Signed in as ${rec.email} (${rec.tier}). You can now use ${rec.tier === "pro" ? "all models" : "free models"}.`,
			);
		},
	},
	{
		name: "budget",
		description: "Resolve the phase-1 token-budget percentage (HIL/YOLO)",
		inlineHint: "[new|existing] [HIL|YOLO]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const args = (command.args || "").trim().toLowerCase();
			const state: ProjectState = args.includes("existing") ? "existing" : "new";
			const mode = args.includes("yolo") ? "YOLO" : "HIL";
			const choices = state === "new" ? HIL_CHOICES_NEW : HIL_CHOICES_EXISTING;
			const budget = await resolveBudget({ mode, state, choices });
			runtime.ctx.showStatus(
				`Budget: ${budget.pct}% (${budget.chosen}, state=${budget.state}).\n` +
					choices.map(c => `  - ${c.label}`).join("\n"),
			);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "mode",
		description: "Cycle the 4-state permission mode (plan | edit | auto-accept | bypass)",
		inlineHint: "[plan|edit|auto-accept|bypass|next|prev]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const permModule = await import("../pakalon/modes/permission-mode");
			const {
				applyPermissionMode,
				cyclePermissionMode,
				getActivePermissionMode,
				PERMISSION_MODE_DESCRIPTIONS,
				previousPermissionMode,
			} = permModule;
			const session = runtime.ctx.session as unknown as Parameters<typeof applyPermissionMode>[1];
			const arg = (command.args || "").trim().toLowerCase();
			// PermissionMode is a 4-state string union; declared inline to avoid
			// pulling permission-mode's type into a separate top-level import.
			type PermMode = "plan" | "edit" | "auto-accept" | "bypass";
			let next: PermMode | null = null;
			if (arg === "" || arg === "next") {
				next = cyclePermissionMode(session) as PermMode;
			} else if (arg === "prev" || arg === "previous") {
				const cur = getActivePermissionMode(session);
				const prev = previousPermissionMode(cur);
				applyPermissionMode(prev, session);
				next = prev;
			} else if (arg === "plan" || arg === "edit" || arg === "auto-accept" || arg === "bypass") {
				const mode: PermMode = arg;
				applyPermissionMode(mode, session);
				next = mode;
			} else {
				runtime.ctx.showStatus(`Usage: /mode [plan|edit|auto-accept|bypass|next|prev]`);
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.showStatus(`Mode: ${next} — ${PERMISSION_MODE_DESCRIPTIONS[next]}`);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "web",
		description: "Web search (or fetch a URL)",
		inlineHint: "<query|url>",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const input = (command.args || "").trim();
			if (!input) {
				runtime.ctx.showStatus("Usage: /web <query or url>");
				runtime.ctx.editor.setText("");
				return;
			}
			// Pakalon: programmatic web search/fetch. If `input`
			// is a URL we call Firecrawl (or the local web-scrape
			// fallback) directly and print the result. Otherwise
			// we forward to the agent with a [WEB-SEARCH] tag so
			// the LLM can decide which tool to invoke.
			const isUrl = /^https?:\/\//i.test(input);
			if (isUrl) {
				try {
					const { fetchUrl } = await import("../pakalon/web-scrape/scraper");
					const { fetchUrl: firecrawl } = await import("../pakalon/firecrawl/client");
					const result = (await firecrawl(input).catch(() => null)) ?? (await fetchUrl(input));
					runtime.ctx.showStatus(
						`[web] ${input}\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}`,
					);
				} catch (err) {
					runtime.ctx.showStatus(`[web] fetch failed for ${input}: ${errorMessage(err)}`);
				}
				runtime.ctx.editor.setText("");
				return;
			}
			// Query path: still forwarded to the agent. The
			// agent can use the bundled `rag-scraper` / `web-scrape`
			// tools to actually run the search.
			void runtime.ctx.session
				.sendUserMessage(`[WEB-SEARCH] ${input}`)
				.catch((err: unknown) => runtime.ctx.showStatus(`Web search failed: ${errorMessage(err)}`));
			runtime.ctx.showStatus(`Web search submitted: ${input}`);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "workflows",
		description: "Open the workflow runner (YAML pipelines from swarm-extension)",
		inlineHint: "[run <yaml> | status | help]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const args = (command.args || "").trim();
			const cwd = runtime.ctx.sessionManager.getCwd();
			try {
				// Lazy import to avoid top-level cycle with swarm-extension.
				const swarm = (await import("@pakalon/swarm-extension" as string).catch(() => null)) as {
					swarmExtension?: (api: unknown) => unknown;
					runSwarmYaml?: (yaml: string, cwd: string) => Promise<string>;
				} | null;
				if (!swarm) {
					runtime.ctx.showStatus(
						"Workflows: @pakalon/swarm-extension not installed. Run `bun add @pakalon/swarm-extension`.",
					);
					runtime.ctx.editor.setText("");
					return;
				}
				if (args.startsWith("run ")) {
					const yamlPath = args.slice(4).trim();
					if (!yamlPath) {
						runtime.ctx.showStatus("Usage: /workflows run <yaml-path>");
					} else {
						if (swarm.runSwarmYaml) {
							const out = await swarm.runSwarmYaml(yamlPath, cwd);
							runtime.ctx.showStatus(`Workflow ${yamlPath}:\n${out}`);
						} else {
							runtime.ctx.showStatus(
								`Workflow ${yamlPath}: runner available but not auto-registered. Pass the extension to your session.`,
							);
						}
					}
				} else if (args === "status" || args === "") {
					runtime.ctx.showStatus(
						"Workflows: pass a YAML path to /workflows run <yaml>.\nExample: /workflows run .swarm/phase-3.yaml",
					);
				} else {
					runtime.ctx.showStatus("Usage: /workflows [run <yaml> | status | help]");
				}
			} catch (err) {
				runtime.ctx.showStatus(`Workflows error: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "directory",
		description: "Switch the working directory (project tree selector or path arg)",
		inlineHint: "[<absolute-path>]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			// Programmatic path: `/directory /abs/path` switches
			// immediately. No argument opens the TUI tree
			// selector (legacy behaviour).
			const arg = (command.args || "").trim();
			if (arg) {
				try {
					const target =
						arg.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(arg)
							? arg
							: path.join(runtime.ctx.sessionManager.getCwd(), arg);
					const { existsSync, statSync } = await import("node:fs");
					if (!existsSync(target) || !statSync(target).isDirectory()) {
						runtime.ctx.showStatus(`Not a directory: ${target}`);
					} else {
						process.chdir(target);
						runtime.ctx.showStatus(`Working directory: ${target}`);
					}
				} catch (err) {
					runtime.ctx.showStatus(`Directory error: ${errorMessage(err)}`);
				}
				runtime.ctx.editor.setText("");
				return;
			}
			try {
				const showTree = (
					runtime.ctx as unknown as {
						showTreeSelector?: (opts: { title: string; onSelect: (p: string) => void }) => void;
					}
				).showTreeSelector;
				if (typeof showTree !== "function") {
					runtime.ctx.showStatus("Directory: tree selector is not available in this mode.");
					runtime.ctx.editor.setText("");
					return;
				}
				showTree.call(runtime.ctx, {
					title: "Select working directory",
					onSelect: (p: string) => {
						runtime.ctx.showStatus(`Switching to ${p}…`);
						try {
							process.chdir(p);
						} catch {
							/* ignored */
						}
						void runtime.ctx.session.sendUserMessage(`Switch the working directory to: ${p}`);
					},
				});
			} catch (err) {
				runtime.ctx.showStatus(`Directory error: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "figma",
		description: "Import a Figma `.fig` file (or URL) and re-run phase-2 with auto-fill",
		inlineHint: "<path-to.fig | https://www.figma.com/file/...>",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const src = (command.args || "").trim();
			if (!src) {
				runtime.ctx.showStatus("Usage: /figma <path-to.fig | https://www.figma.com/file/...>");
				runtime.ctx.editor.setText("");
				return;
			}
			// Tier-gate: Figma URL import (via the REST API) is
			// Pro-tier only. Local `.fig` file import is free.
			const isUrl = /^https?:\/\//i.test(src);
			if (isUrl) {
				try {
					// eslint-disable-next-line @typescript-eslint/no-require-imports
					const { getUserTier } = require("../auth/openrouter-auth") as typeof import("../auth/openrouter-auth");
					const tier = getUserTier();
					if (tier !== "pro" && tier !== "free") {
						// unknown tier — treat as free; if the URL
						// import actually requires an API token,
						// it will fail with a clear error.
					} else if (tier !== "pro") {
						runtime.ctx.showStatus(
							`Figma URL import requires a Pro subscription. Local .fig file import is free.\nLocal: /figma ./path/to/file.fig`,
						);
						runtime.ctx.editor.setText("");
						return;
					}
				} catch (err) {
					// Tier check is best-effort; fall through.
				}
			}
			const cwd = runtime.ctx.sessionManager.getCwd();
			try {
				const { runPhase2 } = await import("../phases/phase2");
				runtime.ctx.showStatus(`Importing from Figma: ${src}…`);
				const out = await runPhase2(cwd, { projectDir: cwd, figmaSource: src });
				if (out.figmaImported) {
					runtime.ctx.showStatus(
						`Figma imported. Wireframe pre-filled with ${out.wireframeJson.length}b of JSON. Use /phase-2 to refine, or /phase-3 to build.`,
					);
				} else {
					runtime.ctx.showStatus(`Figma import did not match a known source. Falling back to LLM wireframe.`);
				}
			} catch (err) {
				runtime.ctx.showStatus(`Figma import failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "build",
		description: "Build the application from the current /plan output.md",
		handleTui: async (_command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const fs = require("node:fs") as typeof import("node:fs");
			const planFile = `${cwd}/output.md`;
			if (!fs.existsSync(planFile)) {
				runtime.ctx.showStatus("No output.md found. Run /plan first.");
				runtime.ctx.editor.setText("");
				return;
			}
			jumpToPhase(cwd, "phase-3");
			try {
				await runPhase3(cwd);
				runtime.ctx.showStatus("Phase 3 build completed from output.md.");
			} catch (err) {
				runtime.ctx.showStatus(`Build failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "model-auto",
		description: "Resolve and apply the auto-picked model",
		handleTui: async (_command, runtime) => {
			const pick = await pickAuto();
			if (!pick) {
				runtime.ctx.showStatus("No model available. Run /login or start Ollama/LM Studio.");
				runtime.ctx.editor.setText("");
				return;
			}
			// Apply to both the env var (so subprocesses + future launches
			// see it) and the live session (so the current conversation
			// uses it immediately).
			process.env.PAKALON_MODEL = pick.model.id;
			const session = runtime.ctx.session as unknown as {
				model?: { id?: string; name?: string };
				setModel?: (m: { provider: string; id: string }) => Promise<void> | void;
			};
			let applied = false;
			if (session.setModel) {
				const slash = pick.model.id.includes("/") ? pick.model.id.split("/", 2) : ["auto", pick.model.id];
				const [provider = "auto", id = pick.model.id] = slash;
				try {
					await session.setModel({ provider, id });
					applied = true;
				} catch (err) {
					runtime.ctx.showStatus(
						`Auto-picked ${pick.model.id} (env only — session.setModel failed: ${err instanceof Error ? err.message : String(err)})`,
					);
				}
			}
			runtime.ctx.showStatus(
				`Auto-picked ${pick.model.id} (${pick.reason}). ${applied ? "Applied to current session." : "Env var set; restart session to apply."}`,
			);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "models-list",
		description: "List available models (free-only when free tier, all when pro)",
		inlineHint: "[search-text | all | pro | free | limit N]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const { loadAuth } = require("../auth/openrouter-auth") as typeof import("../auth/openrouter-auth");
			const auth = loadAuth() as { tier?: "free" | "pro" } | null;
			const isPro = auth?.tier === "pro";
			const registry = await getUnifiedModels();
			const args = (command.args || "").trim();
			let visible = isPro ? registry.models : registry.models.filter(m => m.isFree);
			let limit = 50;
			// Args: "free" / "pro" / "all" / "<search>" / "limit N"
			if (args === "free") visible = registry.models.filter(m => m.isFree);
			else if (args === "pro" || args === "all") {
				if (!isPro) {
					runtime.ctx.showStatus(`'${args}' requires Pro tier. Showing free models instead.`);
				}
				visible = registry.models;
			} else if (args.startsWith("limit ")) {
				const n = Number(args.slice(6));
				if (Number.isFinite(n) && n > 0) limit = Math.min(200, Math.floor(n));
			} else if (args) {
				const q = args.toLowerCase();
				visible = visible.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
			}
			const lines: string[] = [
				`Source: ${registry.mode} | Tier: ${isPro ? "pro" : "free"} | ${visible.length} models (showing up to ${limit})`,
				"",
			];
			// Sort: free models first, then by lowest output price.
			const sorted = [...visible].sort((a, b) => {
				if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
				return (a.pricing.completion ?? 0) - (b.pricing.completion ?? 0);
			});
			for (const m of sorted.slice(0, limit)) {
				lines.push(`  ${m.id}  (ctx=${m.contextLength}, $/M-out=${m.pricing.completion}, free=${m.isFree})`);
			}
			runtime.ctx.showStatus(lines.join("\n"));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "doctor",
		description: "Run Pakalon doctor: auth, models, MCP, plugins",
		handleTui: async (_command, runtime) => {
			const lines: string[] = ["Pakalon Doctor", "================"];
			try {
				const { loadAuth } = require("../auth/openrouter-auth") as typeof import("../auth/openrouter-auth");
				const auth = loadAuth() as { tier?: string; email?: string } | null;
				lines.push(`Auth: ${auth ? `${auth.tier ?? "unknown"} (${auth.email ?? "no email"})` : "not logged in"}`);
			} catch (err) {
				lines.push(`Auth: error (${err})`);
			}
			try {
				const reg = await getUnifiedModels();
				lines.push(`Models: ${reg.models.length} available (${reg.mode})`);
			} catch (err) {
				lines.push(`Models: error (${err})`);
			}
			lines.push("MCP: see /mcp list");
			lines.push("Plugins: see /plugins");
			runtime.ctx.showStatus(lines.join("\n"));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "auditor",
		description: "Run the auditor agent loop",
		inlineHint: "[max-iterations]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const max = Number((command.args || "3").trim()) || 3;
			const { runAuditorLoop } = require("../pakalon/auditor/loop") as typeof import("../pakalon/auditor/loop");
			try {
				const result = await runAuditorLoop(cwd, "HIL", max);
				runtime.ctx.showStatus(
					`Auditor: ${result.iterations} iteration(s); complete=${result.finalReport.complete} partial=${result.finalReport.partial} missing=${result.finalReport.missing}.`,
				);
			} catch (err) {
				runtime.ctx.showStatus(`Auditor failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "followup",
		aliases: ["fu"],
		description: "Read the auditor's HIL follow-up prompt and apply a choice",
		inlineHint: "[implement-all|implement-core|do-nothing]",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			const prompt = readFollowup(cwd);
			if (!prompt) {
				runtime.ctx.showStatus("No auditor follow-up pending. Run /auditor first.");
				runtime.ctx.editor.setText("");
				return;
			}
			const arg = (command.args || "").trim().toLowerCase();
			if (arg) {
				const valid: FollowupChoice[] = ["implement-all", "implement-core", "do-nothing"];
				if (!(valid as string[]).includes(arg)) {
					runtime.ctx.showStatus(`Invalid choice. Use: ${valid.join(" | ")}`);
					runtime.ctx.editor.setText("");
					return;
				}
				const result = await applyFollowupChoice(cwd, arg as FollowupChoice, prompt.report);
				runtime.ctx.showStatus(result.dispatched ? `Followup: ${result.reason}` : `Followup: ${result.reason}`);
				runtime.ctx.editor.setText("");
				return;
			}
			// No arg → render the prompt and let the user pick
			const { renderFollowupPrompt } =
				require("../pakalon/auditor/followup") as typeof import("../pakalon/auditor/followup");
			runtime.ctx.showStatus(renderFollowupPrompt(prompt));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "ask",
		aliases: ["q"],
		description: "Ask a Q&A question in the phase-1 multi-choice format",
		inlineHint: "<question>",
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const cwd = runtime.ctx.sessionManager.getCwd();
			if (!command.args) {
				runtime.ctx.showStatus("Usage: /ask <question>");
				runtime.ctx.editor.setText("");
				return;
			}
			const { generateQuestions } = require("../pakalon/qa/qa-runner") as typeof import("../pakalon/qa/qa-runner");
			try {
				const questions = await generateQuestions(command.args, "HIL", cwd);
				const lines: string[] = [`Q: ${command.args}`, ""];
				for (const q of questions) {
					lines.push(`**${q.question}**`);
					for (const opt of q.options) {
						lines.push(`  - ${opt.label}: ${opt.description}`);
					}
					lines.push("");
				}
				runtime.ctx.showStatus(lines.join("\n"));
			} catch (err) {
				runtime.ctx.showStatus(`/ask failed: ${errorMessage(err)}`);
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "quit",
		description: "Quit the application",
		handleTui: shutdownHandlerTui,
	},
];

const BUILTIN_SLASH_COMMAND_LOOKUP = new Map<string, SlashCommandSpec>();
for (const command of BUILTIN_SLASH_COMMAND_REGISTRY) {
	BUILTIN_SLASH_COMMAND_LOOKUP.set(command.name, command);
	for (const alias of command.aliases ?? []) {
		BUILTIN_SLASH_COMMAND_LOOKUP.set(alias, command);
	}
}

/** Builtin command metadata used for slash-command autocomplete and help text. */
export const BUILTIN_SLASH_COMMAND_DEFS: ReadonlyArray<BuiltinSlashCommand> = BUILTIN_SLASH_COMMAND_REGISTRY.map(
	command => ({
		name: command.name,
		description: command.description,
		subcommands: command.subcommands,
		inlineHint: command.inlineHint,
	}),
);

/**
 * Unified registry exposed for cross-mode tooling. Each spec carries at least
 * one of `handle` / `handleTui`. The TUI dispatcher prefers `handleTui`; the
 * ACP dispatcher requires `handle` and skips TUI-only entries.
 */
export const BUILTIN_SLASH_COMMANDS_INTERNAL: ReadonlyArray<SlashCommandSpec> = BUILTIN_SLASH_COMMAND_REGISTRY;

/**
 * Execute a builtin slash command in the interactive TUI.
 *
 * Returns `false` when no builtin matched. Returns `true` when a command
 * consumed the input entirely. Returns a `string` when the command was handled
 * but remaining text should be sent as a prompt.
 */
export async function executeBuiltinSlashCommand(
	text: string,
	runtime: BuiltinSlashCommandRuntime,
): Promise<string | boolean> {
	const parsed = parseSlashCommand(text);
	if (!parsed) return false;

	const command = BUILTIN_SLASH_COMMAND_LOOKUP.get(parsed.name);
	if (!command) return false;
	if (parsed.args.length > 0 && !command.allowArgs) {
		return false;
	}
	if (command.handleTui) {
		const result = await command.handleTui(parsed, runtime);
		if (result && typeof result === "object" && "prompt" in result) return result.prompt;
		return true;
	}
	if (command.handle) {
		// No TUI-specific override → adapt the ACP/text-mode `handle` to the
		// TUI by routing `runtime.output` through `ctx.showStatus`, clearing
		// the editor after the call, and reusing the active session's plugin
		// reload pipeline. Spec authors get a single body usable from either
		// dispatcher without forcing every TUI test to construct the full
		// `SlashCommandRuntime` shape.
		const ctx = runtime.ctx;
		const adapted: SlashCommandRuntime = {
			session: ctx.session,
			sessionManager: ctx.sessionManager,
			settings: ctx.settings,
			cwd: ctx.sessionManager.getCwd(),
			output: (text: string) => {
				ctx.showStatus(text);
			},
			refreshCommands: () => ctx.refreshSlashCommandState(),
			reloadPlugins: async () => {
				const projectPath = await resolveActiveProjectRegistryPath(ctx.sessionManager.getCwd());
				clearPluginRootsAndCaches(projectPath ? [projectPath] : undefined);
				await ctx.refreshSlashCommandState();
				await ctx.session.refreshSshTool({ activateIfAvailable: true });
			},
		};
		const result = await command.handle(parsed, adapted);
		ctx.editor.setText("");
		if (result && typeof result === "object" && "prompt" in result) return result.prompt;
		return true;
	}
	return false;
}

/** Look up a unified spec by name or alias. Used by the ACP dispatcher. */
export function lookupBuiltinSlashCommand(name: string): SlashCommandSpec | undefined {
	return BUILTIN_SLASH_COMMAND_LOOKUP.get(name);
}

export type { ParsedSlashCommand, SlashCommandResult, SlashCommandRuntime, SlashCommandSpec, TuiSlashCommandRuntime };
