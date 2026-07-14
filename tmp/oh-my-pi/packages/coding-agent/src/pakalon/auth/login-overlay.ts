/**
 * Lightweight, TTY-aware 6-digit login overlay.
 *
 * Renders a centered card to `process.stdout` (using ANSI escape
 * codes) that displays the 6-digit code, the verify URL, and a live
 * countdown. Updates on the same card as the device-code flow
 * progresses. Closes when `close()` is called, restoring the
 * terminal to its previous state.
 *
 * This is a plain-text version (not the React-based `LoginOverlay`
 * in `login-overlay.tsx`, which is the in-TUI panel). The plain-text
 * version is invoked by the pre-launch auth gate, before the TUI
 * mounts.
 */
import * as readline from "node:readline";
import { logger } from "@oh-my-pi/pi-utils";

export interface LoginOverlayState {
	code: string;
	url: string;
	expiresAt: number;
	/** Update message (e.g. "waiting…", "signed in as u@x"). */
	message?: string;
	/** True when the auth was confirmed. */
	confirmed?: boolean;
	/** True when the auth failed. */
	failed?: boolean;
	/** Email of the confirmed user. */
	email?: string;
}

export interface LoginOverlayHandle {
	update(state: Partial<LoginOverlayState>): void;
	markSuccess(email: string): void;
	markFailed(reason: string): void;
	close(): void;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BG_BLUE = "\x1b[44m";
const WHITE = "\x1b[37m";

/** Move cursor to top-left of the overlay. */
function clearArea(_width: number, height: number): void {
	for (let i = 0; i < height; i++) {
		process.stdout.write(`\x1b[${i + 1};1H\x1b[2K`);
	}
	process.stdout.write(`\x1b[${height + 1};1H`);
	// Re-position cursor to a known origin.
	process.stdout.write(`\x1b[1;1H`);
}

function fmtCountdown(expiresAt: number): string {
	const seconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatCode(code: string): string {
	return code.split("").join(" ");
}

const HEIGHT = 8;

function render(state: LoginOverlayState): void {
	const width = Math.max(40, Math.min(process.stdout.columns ?? 80, 80));
	const inner = width - 4;
	const pad = (s: string): string => ` ${s.padEnd(inner, " ")} `;

	const title = `${CYAN}${BOLD}Pakalon — Sign in${RESET}`;
	const sep = "─".repeat(inner);
	const url = `${WHITE}${state.url}${RESET}`;
	const code = `${YELLOW}${BOLD}  ${formatCode(state.code)}  ${RESET}`;
	const countdown = `${DIM}Code expires in ${fmtCountdown(state.expiresAt)} — press Ctrl+C to cancel${RESET}`;
	const status = state.message
		? state.confirmed
			? `${GREEN}${BOLD}✓ ${state.message}${RESET}`
			: state.failed
				? `${RED}${BOLD}✗ ${state.message}${RESET}`
				: `${YELLOW}${state.message}${RESET}`
		: `${DIM}waiting for confirmation…${RESET}`;

	const frame = [
		`╔${"═".repeat(width - 2)}╗`,
		`║${pad(title).padEnd(width - 2, " ")}║`.slice(0, width),
		`║${pad(sep).padEnd(width - 2, " ")}║`.slice(0, width),
		`║${pad("Open this URL in your browser:").padEnd(width - 2, " ")}║`.slice(0, width),
		`║${pad(url).padEnd(width - 2, " ")}║`.slice(0, width),
		`║${pad("Then enter this 6-digit code:").padEnd(width - 2, " ")}║`.slice(0, width),
		`║${pad(`  ${formatCode(state.code)}  `).padEnd(width - 2, " ")}║`.slice(0, width),
		`║${pad(countdown).padEnd(width - 2, " ")}║`.slice(0, width),
		`║${pad(status).padEnd(width - 2, " ")}║`.slice(0, width),
		`╚${"═".repeat(width - 2)}╝`,
	].join("\n");

	process.stdout.write("\x1b[1;1H\x1b[2J");
	process.stdout.write(`${frame}\n`);
}

export interface ShowLoginOverlayOptions {
	/** Optional initial code + url. If omitted the overlay renders an idle state. */
	code?: string;
	url?: string;
	expiresAt?: number;
}

/**
 * Open a centered 6-digit login overlay in the current TTY. Returns
 * a `LoginOverlayHandle` to update the state and close.
 */
export function showLoginOverlay(opts: ShowLoginOverlayOptions = {}): LoginOverlayHandle | undefined {
	if (!process.stdout.isTTY || process.env.PAKALON_OVERLAY === "off") {
		return undefined;
	}
	const state: LoginOverlayState = {
		code: opts.code ?? "------",
		url: opts.url ?? "https://pakalon.dev/auth/verify",
		expiresAt: opts.expiresAt ?? Date.now() + 4 * 60_000,
	};
	render(state);

	// Tick the countdown every 1s.
	const timer = setInterval(() => render(state), 1_000);
	// Best-effort: readline for clean Ctrl+C handling.
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	rl.on("SIGINT", () => {
		clearInterval(timer);
		rl.close();
		process.stdout.write("\x1b[1;1H\x1b[2J");
		process.exit(130);
	});

	return {
		update(next) {
			Object.assign(state, next);
			render(state);
		},
		markSuccess(email) {
			state.confirmed = true;
			state.email = email;
			state.message = `Signed in as ${email}`;
			render(state);
		},
		markFailed(reason) {
			state.failed = true;
			state.message = reason;
			render(state);
		},
		close() {
			clearInterval(timer);
			rl.close();
			clearArea(0, 0); // re-position cursor
			logger.debug("login-overlay: closed");
		},
	};
}
