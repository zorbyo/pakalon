import * as fs from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { type Component, padding, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { formatNumber, getProjectDir, logger } from "@oh-my-pi/pi-utils";
import { theme } from "../../modes/theme/theme";
import { renderAuthStatus } from "../../pakalon/tui/auth-status";
import { renderContextMeter } from "../../pakalon/tui/context-meter";
import type { AgentSession } from "../../session/agent-session";
import { shortenPath } from "../../tools/render-utils";
import * as git from "../../utils/git";
import { sanitizeStatusText } from "../shared";
import { formatContextUsage, getContextUsageLevel, getContextUsageThemeColor } from "./status-line/context-thresholds";

/**
 * Footer component that shows pwd, token stats, and context usage
 */
export class FooterComponent implements Component {
	#cachedBranch: string | null | undefined = undefined; // undefined = not checked yet, null = not in git repo, string = branch name
	#gitWatcher: fs.FSWatcher | null = null;
	#onBranchChange: (() => void) | null = null;
	#autoCompactEnabled: boolean = true;
	#extensionStatuses: Map<string, string> = new Map();
	#indicatorsSubscribed: boolean = false;

	constructor(private readonly session: AgentSession) {}

	setAutoCompactEnabled(enabled: boolean): void {
		this.#autoCompactEnabled = enabled;
	}

	/**
	 * Set extension status text to display in the footer.
	 * Text is sanitized (newlines/tabs replaced with spaces) and truncated to terminal width.
	 * ANSI escape codes for styling are preserved.
	 * @param key - Unique key to identify this status
	 * @param text - Status text, or undefined to clear
	 */
	setExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.#extensionStatuses.delete(key);
		} else {
			this.#extensionStatuses.set(key, text);
		}
	}

	/**
	 * Set up a file watcher on .git/HEAD to detect branch changes.
	 * Call the provided callback when branch changes.
	 */
	watchBranch(onBranchChange: () => void): void {
		this.#onBranchChange = onBranchChange;
		this.#setupGitWatcher();
	}

	#setupGitWatcher(): void {
		// Clean up existing watcher
		if (this.#gitWatcher) {
			this.#gitWatcher.close();
			this.#gitWatcher = null;
		}

		void git.head
			.resolve(getProjectDir())
			.then(head => {
				if (!head) {
					return;
				}

				try {
					this.#gitWatcher = fs.watch(head.headPath, () => {
						this.#cachedBranch = undefined; // Invalidate cache
						if (this.#onBranchChange) {
							this.#onBranchChange();
						}
					});
				} catch {
					// Silently fail if we can't watch
				}
			})
			.catch(() => {
				this.#cachedBranch = null;
			});
	}

	/**
	 * Clean up the file watcher
	 */
	dispose(): void {
		if (this.#gitWatcher) {
			this.#gitWatcher.close();
			this.#gitWatcher = null;
		}
	}

	invalidate(): void {
		// Invalidate cached branch so it gets re-read on next render
		this.#cachedBranch = undefined;
	}

	/**
	 * Get current git branch by reading .git/HEAD directly.
	 * Returns null if not in a git repo, branch name otherwise.
	 */
	#getCurrentBranch(): string | null {
		if (this.#cachedBranch !== undefined) {
			return this.#cachedBranch;
		}

		const headState = git.head.resolveSync(getProjectDir());
		this.#cachedBranch =
			headState === null ? null : headState.kind === "ref" ? (headState.branchName ?? headState.ref) : "detached";
		return this.#cachedBranch;
	}

	render(width: number): string[] {
		const state = this.session.state;

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;
		let totalPremiumRequests = 0;

		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;
				totalPremiumRequests += entry.message.usage.premiumRequests ?? 0;
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;

		// Replace home directory with ~
		let pwd = shortenPath(getProjectDir());

		// Add git branch if available
		const branch = this.#getCurrentBranch();
		if (branch) {
			pwd = `${pwd} (${branch})`;
		}

		// Truncate path if too long to fit width
		if (pwd.length > width) {
			const half = Math.floor(width / 2) - 1;
			if (half > 1) {
				const start = pwd.slice(0, half);
				const end = pwd.slice(-(half - 1));
				pwd = `${start}…${end}`;
			} else {
				pwd = pwd.slice(0, Math.max(1, width));
			}
		}

		// Build stats line
		const statsParts = [];
		if (totalInput) statsParts.push(`↑${formatNumber(totalInput)}`);
		if (totalOutput) statsParts.push(`↓${formatNumber(totalOutput)}`);
		if (totalCacheRead) statsParts.push(`R${formatNumber(totalCacheRead)}`);
		if (totalCacheWrite) statsParts.push(`W${formatNumber(totalCacheWrite)}`);

		// Show billing summary with subscription and premium-request indicators
		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		const normalizedPremiumRequests = Math.round((totalPremiumRequests + Number.EPSILON) * 100) / 100;
		if (totalCost || usingSubscription || normalizedPremiumRequests) {
			const billingParts: string[] = [];
			if (totalCost) billingParts.push(`$${totalCost.toFixed(3)}`);
			if (normalizedPremiumRequests) billingParts.push(`★ ${formatNumber(normalizedPremiumRequests)}`);
			if (usingSubscription) billingParts.push("(sub)");
			if (billingParts.length > 0) statsParts.push(billingParts.join(" "));
		}

		// Colorize context percentage based on usage
		let contextPercentStr: string;
		const autoIndicator = this.#autoCompactEnabled ? " (auto)" : "";
		const contextPercentDisplay = `${formatContextUsage(
			contextUsage?.percent === null ? null : contextPercentValue,
			contextWindow,
		)}${autoIndicator}`;
		if (contextUsage?.percent !== null && contextUsage?.percent !== undefined) {
			const color = getContextUsageThemeColor(getContextUsageLevel(contextPercentValue, contextWindow));
			contextPercentStr =
				color === "statusLineContext" ? contextPercentDisplay : theme.fg(color, contextPercentDisplay);
		} else {
			contextPercentStr = contextPercentDisplay;
		}
		// Pakalon: also render the bar meter. The bar is a visual
		// supplement to the percentage; together they tell the user
		// the current budget and the visual headroom remaining.
		// We estimate `used` from the percentage when the field is
		// absent (the pre-existing ContextUsage shape only exposes
		// `contextWindow` + `percent`).
		const usedTokens = Math.round(((contextUsage?.percent ?? 0) * (contextWindow ?? 0)) / 100);
		const maxTokens = contextWindow ?? 0;
		const meter = renderContextMeter(usedTokens, maxTokens);
		const authStatus = renderAuthStatus();
		// Pakalon: also render the new `PakalonStatusPanel` text
		// (tier pill + model + meter + permission-mode pill) — this
		// gives the user a single, glanceable status bar that the
		// audit flagged as missing. We keep the legacy
		// contextPercentStr / authStatus fragments as a fallback so
		// the footer is still readable when the new panel rendering
		// fails. Imported lazily once at module-load to keep the
		// footer's hot path synchronous.
		let panel: string | undefined;
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const panelModule =
				require("../../pakalon/tui/status-panel-text") as typeof import("../../pakalon/tui/status-panel-text");
			const { getActivePermissionMode } =
				require("../../pakalon/modes/permission-mode") as typeof import("../../pakalon/modes/permission-mode");
			const { getUserTier } = require("../../auth/openrouter-auth") as typeof import("../../auth/openrouter-auth");
			const { isSelfHostedMode } =
				require("../../pakalon/local-models/registry") as typeof import("../../pakalon/local-models/registry");
			const { getState, getTokenUsage } =
				require("../../pakalon/orchestrator") as typeof import("../../pakalon/orchestrator");
			const tier: "free" | "pro" | "selfhost" | "anonymous" = (() => {
				try {
					const t = getUserTier();
					if (t === "free" || t === "pro") return t;
					if (isSelfHostedMode()) return "selfhost";
					return "anonymous";
				} catch {
					return "anonymous";
				}
			})();
			const modelId = state.model?.id || "no-model";

			const projectDir = getProjectDir();
			const projectState = getState(projectDir);
			let tokenUsage: { used: number; allocated: number; percentage: number } | undefined;
			if (projectState && projectState.phase !== "idle" && projectState.phase !== "completed") {
				tokenUsage = getTokenUsage(projectDir, projectState.phase);
			}

			panel = panelModule.renderStatusPanelText({
				authTier: tier,
				modelName: modelId,
				contextWindow: maxTokens,
				usedTokens,
				permissionMode: getActivePermissionMode(
					this.session as unknown as Parameters<typeof getActivePermissionMode>[0],
				),
				currentPhase:
					projectState?.phase !== "idle" && projectState?.phase !== "completed" ? projectState?.phase : null,
				hilYoloMode: projectState?.mode,
				tokenUsage,
			});
		} catch (err) {
			logger.warn("footer: status-panel render failed; using legacy", { err });
		}
		statsParts.push(panel ?? `${contextPercentStr}  ${meter}  ${authStatus}`);

		let statsLeft = statsParts.join(" ");

		// Add model name on the right side, plus thinking level if model supports it
		const modelName = state.model?.id || "no-model";

		// Add thinking level hint when the current model advertises supported efforts
		let rightSide = modelName;
		if (state.model?.thinking) {
			if (this.session.isAutoThinking) {
				// Pending (no turn classified yet / classifying) shows a symbol-theme
				// question-box marker; once resolved it shows `<level>`.
				const resolved = this.session.autoResolvedThinkingLevel();
				rightSide = `${modelName} • ${resolved ? resolved : `${theme.thinking.autoPending} auto`}`;
			} else {
				const thinkingLevel = state.thinkingLevel ?? ThinkingLevel.Off;
				if (thinkingLevel !== ThinkingLevel.Off) {
					rightSide = `${modelName} • ${thinkingLevel}`;
				}
			}
		}

		let statsLeftWidth = visibleWidth(statsLeft);
		const rightSideWidth = visibleWidth(rightSide);

		// If statsLeft is too wide, truncate it
		if (statsLeftWidth > width) {
			// Drop styling and truncate by terminal cells (not code points) so wide
			// glyphs and non-SGR escapes can't overflow the line.
			statsLeft = truncateToWidth(stripVTControlCharacters(statsLeft), width);
			statsLeftWidth = visibleWidth(statsLeft);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
		const minPadding = 2;
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let statsLine: string;
		if (totalNeeded <= width) {
			// Both fit - add padding to right-align model
			const pad = padding(width - statsLeftWidth - rightSideWidth);
			statsLine = statsLeft + pad + rightSide;
		} else {
			// Need to truncate right side
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 3) {
				// Drop styling and truncate by terminal cells so the right side fits.
				const truncatedRight = truncateToWidth(stripVTControlCharacters(rightSide), availableForRight);
				const pad = padding(width - statsLeftWidth - visibleWidth(truncatedRight));
				statsLine = statsLeft + pad + truncatedRight;
			} else {
				// Not enough space for right side at all
				statsLine = statsLeft;
			}
		}

		// Apply dim to each part separately. statsLeft may contain color codes (for context %)
		// that end with a reset, which would clear an outer dim wrapper. So we dim the parts
		// before and after the colored section independently.
		const dimStatsLeft = theme.fg("dim", statsLeft);
		const remainder = statsLine.slice(statsLeft.length); // padding + rightSide
		const dimRemainder = theme.fg("dim", remainder);

		const lines = [theme.fg("dim", pwd), dimStatsLeft + dimRemainder];

		// Pakalon: render live tool indicators (blinking dots for
		// in-flight tool calls). The audit flagged this as never
		// rendered. The indicator text is computed fresh on every
		// frame so the spinner animates. We also subscribe to the
		// indicator change feed so the status line re-renders on
		// every frame (TICK_MS = 80ms = ~12.5fps).
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const blinkModule = require("../../tui/blink") as typeof import("../../tui/blink");
			const { renderLiveIndicators, ensureTicker, onIndicatorsChange } = blinkModule;
			if (!this.#indicatorsSubscribed) {
				this.#indicatorsSubscribed = true;
				onIndicatorsChange(() => this.invalidate());
			}
			ensureTicker();
			const indicators = renderLiveIndicators();
			if (indicators.length > 0) {
				lines.push(theme.fg("muted" as never, indicators));
			}
		} catch (err) {
			logger.debug("footer: live-indicator render failed", { err });
		}

		// Add extension statuses on a single line, sorted by key alphabetically
		if (this.#extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(this.#extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width));
		}

		return lines;
	}
}
