/**
 * Blinking TUI indicator primitive.
 *
 * Used to show "command running" / "agent working" with a per-frame
 * animation. The TUI calls `tick(now)` on every render frame and
 * inspects `state(now)` to decide what to draw.
 */
import type { Blinker } from "@oh-my-pi/pi-tui";

const ANIM_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS = 80;

export function createBlinkIndicator(label: string): {
	render: () => string;
	stop: () => void;
} {
	const start = Date.now();
	const id: Blinker = { id: label, startTime: start, isRunning: true };
	let stopped = false;
	return {
		render: () => {
			if (stopped) return `${label} · done`;
			const elapsed = Date.now() - start;
			const frame = ANIM_FRAMES[Math.floor(elapsed / TICK_MS) % ANIM_FRAMES.length] ?? "⠋";
			const seconds = Math.floor(elapsed / 1000);
			return `${frame} ${label} · ${seconds}s`;
		},
		stop: () => {
			stopped = true;
		},
	};
}

/**
 * Bounded registry of all live indicators. TUI renders them at the
 * bottom of every command card.
 */
const LIVE_INDICATORS = new Map<string, { render: () => string; stop: () => void }>();

/** Listeners notified when the indicator set changes (add / remove). */
const INDICATOR_LISTENERS = new Set<() => void>();

/** Subscribe to indicator-set changes (used by the footer to invalidate). */
export function onIndicatorsChange(listener: () => void): () => void {
	INDICATOR_LISTENERS.add(listener);
	return () => INDICATOR_LISTENERS.delete(listener);
}

export function startIndicator(label: string): string {
	const id = `${label}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
	const ind = createBlinkIndicator(label);
	LIVE_INDICATORS.set(id, ind);
	notify();
	return id;
}

export function stopIndicator(id: string): void {
	const ind = LIVE_INDICATORS.get(id);
	if (ind) {
		ind.stop();
		LIVE_INDICATORS.delete(id);
		notify();
	}
}

function notify(): void {
	for (const listener of INDICATOR_LISTENERS) {
		try {
			listener();
		} catch {
			/* ignore listener errors */
		}
	}
}

/**
 * Background ticker that calls every active indicator's `render()`
 * ~12.5 times per second. Combined with a registered listener (via
 * `onIndicatorsChange`), the footer invalidates on every animation
 * frame so the blinking dots stay animated even when no other TUI
 * event fires.
 */
let tickerHandle: ReturnType<typeof setInterval> | null = null;

export function ensureTicker(): void {
	if (tickerHandle !== null) return;
	tickerHandle = setInterval(() => {
		if (LIVE_INDICATORS.size === 0) {
			clearInterval(tickerHandle as ReturnType<typeof setInterval>);
			tickerHandle = null;
			return;
		}
		// Each render() reads Date.now() so the animation frame
		// advances every tick. We just notify listeners that
		// something changed.
		notify();
	}, TICK_MS);
	// Allow the process to exit naturally if only the ticker remains.
	if (typeof tickerHandle === "object" && tickerHandle && "unref" in tickerHandle) {
		(tickerHandle as { unref?: () => void }).unref?.();
	}
}

export function renderLiveIndicators(): string {
	const lines: string[] = [];
	for (const ind of LIVE_INDICATORS.values()) {
		lines.push(ind.render());
	}
	if (lines.length > 0) {
		// Ensure the ticker is running while at least one indicator
		// is alive.
		ensureTicker();
	}
	return lines.join("\n");
}
