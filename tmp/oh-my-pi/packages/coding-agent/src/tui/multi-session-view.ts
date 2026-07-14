/**
 * Multi-session TUI view.
 *
 * Renders a card grid of all live sessions using the existing TUI
 * diffing engine. Each card has:
 *   - session id
 *   - project directory (shortened)
 *   - current model
 *   - blinking status indicator (working / awaiting-input / idle)
 *
 * Press `+` to create a new session, `Enter` to switch, `Esc` to
 * return to the active session. Integrates with the existing
 * `multi-session.ts` registry.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { createSession, getActiveSessionId, listSessions, setActiveSession } from "../normal-mode/multi-session";
import type { Session } from "../normal-mode/sessions";
import { buildDashboardCards, handleDashboardKey, renderDashboard } from "./multi-session-dashboard";

export interface MultiSessionView {
	id: string;
	render(width: number, height: number): string;
	onKey(key: string): "handled" | "passthrough";
}

/**
 * Factory. Caller is the TUI controller; on `Esc` from a session
 * the controller constructs one of these and switches the view.
 */
export function createMultiSessionView(): MultiSessionView {
	return {
		id: "multi-session",
		render(width: number, _height: number): string {
			const cards = buildDashboardCards();
			const body = renderDashboard(width, cards);
			return body;
		},
		onKey(key: string): "handled" | "passthrough" {
			// Esc / Ctrl+M → back to active session
			if (key === "\x1b" || key === "\x0f") {
				const active = getActiveSessionId();
				if (active !== null) return "handled";
				return "passthrough";
			}
			// `q` → quit (back to chat)
			if (key === "q") {
				logger.info("multi-session: quit");
				return "handled";
			}
			// `+` or `n` → new session; Enter → cycle
			if (handleDashboardKey(key)) return "handled";
			return "passthrough";
		},
	};
}

export type { Session };
export { createSession, listSessions, setActiveSession };
