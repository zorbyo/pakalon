/**
 * Multi-session TUI dashboard.
 *
 * Renders a card grid of all live sessions in the TUI. Each card shows:
 *   - session id
 *   - project directory (shortened)
 *   - current model
 *   - status indicator (working / awaiting-input / idle)
 *
 * Pressing `+` creates a new session (`/new`); pressing `Enter` on a
 * card swaps the active session; pressing `Ctrl+M` (or `/multi-session`)
 * returns to the dashboard.
 */
import { logger, shortenPath } from "@oh-my-pi/pi-utils";
import {
	createSession,
	getActiveSessionId,
	listSessions,
	type SessionSummary,
	setActiveSession,
} from "./multi-session";

export interface DashboardCard {
	id: string;
	project: string;
	model: string;
	status: "working" | "awaiting-input" | "idle";
	elapsed: string;
}

const ANIM_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Build the dashboard card list from active sessions. The TUI calls
 * this on every render so it can rotate the working indicator frame.
 */
export function buildDashboardCards(): DashboardCard[] {
	return listSessions().map(s => toCard(s, (Date.now() >> 6) % ANIM_FRAMES.length));
}

function toCard(s: SessionSummary, frame: number): DashboardCard {
	const elapsed = formatElapsed(s.startedAt);
	const status: DashboardCard["status"] = s.working ? "working" : s.awaitingInput ? "awaiting-input" : "idle";
	const indicator = status === "working" ? (ANIM_FRAMES[frame] ?? "⠋") : status === "awaiting-input" ? "❯" : "·";
	return {
		id: s.id,
		project: shortenPath(s.projectDir),
		model: s.model,
		status,
		elapsed: `${indicator} ${elapsed}`,
	};
}

function formatElapsed(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	return `${h}h${m % 60}m`;
}

/**
 * Render the dashboard to a string. Width is the terminal width in cells.
 * The TUI pipes this into its diff renderer.
 */
export function renderDashboard(width: number, cards: DashboardCard[]): string {
	const lines: string[] = [];
	lines.push("╭─ Pakalon Sessions ───────────────────────────────────────╮");
	if (cards.length === 0) {
		lines.push("│  No active sessions. Press `+` to start a new one.    │");
	} else {
		const colWidth = Math.max(20, Math.floor((width - 4) / 2) - 2);
		const isActive = (id: string) => id === getActiveSessionId();
		for (let i = 0; i < cards.length; i += 2) {
			const left = cards[i]!;
			const right = cards[i + 1];
			const leftStr = formatCard(left, colWidth, isActive(left.id));
			const rightStr = right ? formatCard(right, colWidth, isActive(right.id)) : " ".repeat(colWidth);
			lines.push(`│ ${leftStr} │ ${rightStr} │`);
		}
	}
	lines.push("╰───────────────────────────────────────────────────────────╯");
	lines.push("  [+ new]  [⏎ switch]  [⌃M back]  [q quit]");
	return lines.join("\n");
}

function formatCard(c: DashboardCard, w: number, active: boolean): string {
	const marker = active ? "▶" : " ";
	const title = `${marker} ${c.id}`;
	const sub = `${c.elapsed}  ${c.model}`;
	const proj = c.project.length > w - 2 ? `${c.project.slice(0, w - 5)}…` : c.project;
	return [title, sub, proj].map(s => s.padEnd(w, " ")).join("\n");
}

/**
 * Dispatch a keypress from the dashboard.
 * Returns `true` if the dashboard consumed the event.
 */
export function handleDashboardKey(key: string): boolean {
	if (key === "+" || key === "n") {
		const session = createSession();
		setActiveSession(session.id);
		logger.info("Dashboard: created new session", { id: session.id });
		return true;
	}
	if (key === "\r" || key === "enter") {
		// Cycle to the next session
		const sessions = listSessions();
		if (sessions.length === 0) return true;
		const idx = sessions.findIndex(s => s.id === getActiveSessionId());
		const next = sessions[(idx + 1) % sessions.length]!;
		setActiveSession(next.id);
		return true;
	}
	return false;
}
