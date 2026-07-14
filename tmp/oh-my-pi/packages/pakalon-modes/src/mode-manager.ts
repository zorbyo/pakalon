import { logger } from "@oh-my-pi/pi-utils";
import { loadModePreference, saveModePreference } from "./persistence";
import type { ModeName, ModeState, PermissionLevel } from "./types";
import { MODE_CONFIGS, MODE_ORDER } from "./types";

export class ModeManager {
	private state: ModeState;
	private listeners: Array<(mode: ModeName, previous: ModeName | null) => void> = [];

	constructor(initialMode: ModeName = "edit") {
		const persisted = loadModePreference();
		this.state = {
			currentMode: persisted ?? initialMode,
			previousMode: null,
			changedAt: new Date().toISOString(),
			autoAcceptEnabled: (persisted ?? initialMode) === "auto-accept",
			persisted: true,
		};
	}

	getCurrentMode(): ModeName {
		return this.state.currentMode;
	}

	getPreviousMode(): ModeName | null {
		return this.state.previousMode;
	}

	getPermissionLevel(): PermissionLevel {
		return MODE_CONFIGS[this.state.currentMode].permissionLevel;
	}

	getModeConfig() {
		return MODE_CONFIGS[this.state.currentMode];
	}

	isHumanInLoop(): boolean {
		return this.state.currentMode === "plan" || this.state.currentMode === "edit";
	}

	isYolo(): boolean {
		return this.state.currentMode === "bypass";
	}

	isAutoAccept(): boolean {
		return this.state.currentMode === "auto-accept" || this.state.autoAcceptEnabled;
	}

	setMode(mode: ModeName): void {
		if (mode === this.state.currentMode) return;
		const previous = this.state.currentMode;
		this.state.previousMode = previous;
		this.state.currentMode = mode;
		this.state.changedAt = new Date().toISOString();
		this.state.autoAcceptEnabled = mode === "auto-accept";
		saveModePreference(mode);
		this.notifyListeners(mode, previous);
		logger.info("Mode changed", { from: previous, to: mode });
	}

	toggleMode(): void {
		const currentIndex = MODE_ORDER.indexOf(this.state.currentMode);
		const nextIndex = (currentIndex + 1) % MODE_ORDER.length;
		this.setMode(MODE_ORDER[nextIndex]);
	}

	cycleForward(): void {
		const currentIndex = MODE_ORDER.indexOf(this.state.currentMode);
		const nextIndex = (currentIndex + 1) % MODE_ORDER.length;
		this.setMode(MODE_ORDER[nextIndex]);
	}

	cycleBackward(): void {
		const currentIndex = MODE_ORDER.indexOf(this.state.currentMode);
		const prevIndex = (currentIndex - 1 + MODE_ORDER.length) % MODE_ORDER.length;
		this.setMode(MODE_ORDER[prevIndex]);
	}

	goBackToPreviousMode(): void {
		if (this.state.previousMode) {
			this.setMode(this.state.previousMode);
		}
	}

	setAutoAccept(enabled: boolean): void {
		this.state.autoAcceptEnabled = enabled;
		if (enabled) {
			this.setMode("auto-accept");
		}
	}

	getState(): ModeState {
		return { ...this.state };
	}

	reset(): void {
		this.setMode("edit");
		this.state.previousMode = null;
	}

	onModeChange(listener: (mode: ModeName, previous: ModeName | null) => void): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter(l => l !== listener);
		};
	}

	private notifyListeners(mode: ModeName, previous: ModeName | null): void {
		for (const listener of this.listeners) {
			try {
				listener(mode, previous);
			} catch (error) {
				logger.warn("Mode change listener failed", { error });
			}
		}
	}
}
