import type { Component } from "../tui";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const RENDER_INTERVAL_MS = 16;
const SPINNER_ADVANCE_MS = 80;

export interface BlinkingIndicatorOptions {
	/** Label shown next to the spinner */
	label: string;
	/** Color function for the spinner character */
	spinnerColor?: (text: string) => string;
	/** Color function for the label text */
	labelColor?: (text: string) => string;
	/** Custom spinner frames */
	frames?: string[];
}

/**
 * A small inline blinking indicator that shows a spinner next to a label.
 * Used next to tool calls to indicate that a command is still running.
 */
export class BlinkingIndicator implements Component {
	#currentFrame = 0;
	#intervalId?: NodeJS.Timeout;
	#active = true;
	#lastTick = 0;

	private readonly frames: string[];
	private readonly spinnerColor: (text: string) => string;
	private readonly labelColor: (text: string) => string;

	constructor(private readonly options: BlinkingIndicatorOptions) {
		this.frames = options.frames ?? FRAMES;
		this.spinnerColor = options.spinnerColor ?? ((s: string) => s);
		this.labelColor = options.labelColor ?? ((s: string) => s);
		this.start();
	}

	render(_width: number): string[] {
		if (!this.#active) return [];
		const frame = this.frames[this.#currentFrame];
		const line = `${this.spinnerColor(frame)} ${this.labelColor(this.options.label)}`;
		return [line];
	}

	invalidate(): void {}

	start(): void {
		this.#active = true;
		this.#lastTick = performance.now();
		this.#intervalId = setInterval(() => {
			const now = performance.now();
			if (now - this.#lastTick >= SPINNER_ADVANCE_MS) {
				this.#currentFrame = (this.#currentFrame + 1) % this.frames.length;
				this.#lastTick = now;
			}
		}, RENDER_INTERVAL_MS);
	}

	stop(): void {
		this.#active = false;
		if (this.#intervalId) {
			clearInterval(this.#intervalId);
			this.#intervalId = undefined;
		}
	}

	setLabel(label: string): void {
		this.options.label = label;
	}

	isActive(): boolean {
		return this.#active;
	}
}

/**
 * Manage a set of blinking indicators, one per active tool/command.
 * Call `start(label)` when a tool begins and `stop(label)` when it completes.
 */
export class IndicatorManager {
	#indicators = new Map<string, BlinkingIndicator>();
	#theme: {
		spinnerColor: (text: string) => string;
		labelColor: (text: string) => string;
		dimColor: (text: string) => string;
	};

	constructor(theme: {
		spinnerColor: (text: string) => string;
		labelColor: (text: string) => string;
		dimColor: (text: string) => string;
	}) {
		this.#theme = theme;
	}

	start(label: string): BlinkingIndicator {
		this.stop(label);
		const indicator = new BlinkingIndicator({
			label,
			spinnerColor: this.#theme.spinnerColor,
			labelColor: this.#theme.labelColor,
		});
		this.#indicators.set(label, indicator);
		return indicator;
	}

	stop(label: string): void {
		const indicator = this.#indicators.get(label);
		if (indicator) {
			indicator.stop();
			this.#indicators.delete(label);
		}
	}

	stopAll(): void {
		for (const indicator of this.#indicators.values()) {
			indicator.stop();
		}
		this.#indicators.clear();
	}

	getActiveIndicators(): BlinkingIndicator[] {
		return [...this.#indicators.values()];
	}

	renderAll(width: number): string[] {
		const lines: string[] = [];
		for (const indicator of this.#indicators.values()) {
			lines.push(...indicator.render(width));
		}
		return lines;
	}
}
