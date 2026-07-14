import { logger } from "@oh-my-pi/pi-utils";
import type { ModeName } from "./types";
import { MODE_ORDER } from "./types";

export interface TabCycleState {
	currentIndex: number;
	order: ModeName[];
	isCycling: boolean;
	loopEnabled: boolean;
}

export class TabCycle {
	private currentIndex = 0;
	private readonly order: ModeName[] = MODE_ORDER;
	private isCycling = false;
	private loopEnabled = true;
	private cycleIntervalMs = 2000;
	private intervalHandle: ReturnType<typeof setInterval> | null = null;
	private listeners: Array<(mode: ModeName) => void> = [];

	constructor(initialMode?: ModeName) {
		if (initialMode) {
			this.currentIndex = this.order.indexOf(initialMode);
			if (this.currentIndex === -1) this.currentIndex = 0;
		}
	}

	getCurrentMode(): ModeName {
		return this.order[this.currentIndex];
	}

	getNextMode(): ModeName {
		return this.order[(this.currentIndex + 1) % this.order.length];
	}

	getPreviousMode(): ModeName {
		return this.order[(this.currentIndex - 1 + this.order.length) % this.order.length];
	}

	next(): ModeName {
		this.currentIndex = (this.currentIndex + 1) % this.order.length;
		const mode = this.getCurrentMode();
		this.notifyListeners(mode);
		return mode;
	}

	previous(): ModeName {
		this.currentIndex = (this.currentIndex - 1 + this.order.length) % this.order.length;
		const mode = this.getCurrentMode();
		this.notifyListeners(mode);
		return mode;
	}

	goTo(mode: ModeName): void {
		const index = this.order.indexOf(mode);
		if (index === -1) return;
		this.currentIndex = index;
		this.notifyListeners(mode);
	}

	startCycling(intervalMs?: number): void {
		if (this.isCycling) return;
		if (intervalMs) this.cycleIntervalMs = intervalMs;
		this.isCycling = true;
		this.intervalHandle = setInterval(() => {
			this.next();
		}, this.cycleIntervalMs);
		logger.info("Tab cycling started", { interval: this.cycleIntervalMs });
	}

	stopCycling(): void {
		if (!this.isCycling) return;
		this.isCycling = false;
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
		logger.info("Tab cycling stopped");
	}

	toggleCycling(): void {
		if (this.isCycling) this.stopCycling();
		else this.startCycling();
	}

	setLoopEnabled(enabled: boolean): void {
		this.loopEnabled = enabled;
	}

	getState(): TabCycleState {
		return {
			currentIndex: this.currentIndex,
			order: [...this.order],
			isCycling: this.isCycling,
			loopEnabled: this.loopEnabled,
		};
	}

	onModeChange(listener: (mode: ModeName) => void): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter(l => l !== listener);
		};
	}

	destroy(): void {
		this.stopCycling();
		this.listeners = [];
	}

	private notifyListeners(mode: ModeName): void {
		for (const listener of this.listeners) {
			try {
				listener(mode);
			} catch (error) {
				logger.warn("Tab cycle listener failed", { error });
			}
		}
	}
}
