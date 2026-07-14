import { logger } from "@oh-my-pi/pi-utils";
import type { ModeManager } from "./mode-manager";
import type { ModeName } from "./types";

export interface YoloConfig {
	maxStepsWithoutConfirmation: number;
	allowedTools: string[];
	blockedTools: string[];
	autoCommit: boolean;
	requireConfirmationForDestructive: boolean;
	maxConsecutiveFailures: number;
}

export class YoloMode {
	private modeManager: ModeManager;
	private config: YoloConfig;
	private stepCount = 0;
	private consecutiveFailures = 0;
	private isActive = false;

	private static readonly DEFAULT_CONFIG: YoloConfig = {
		maxStepsWithoutConfirmation: 10,
		allowedTools: [],
		blockedTools: [],
		autoCommit: false,
		requireConfirmationForDestructive: true,
		maxConsecutiveFailures: 3,
	};

	constructor(modeManager: ModeManager, config?: Partial<YoloConfig>) {
		this.modeManager = modeManager;
		this.config = { ...YoloMode.DEFAULT_CONFIG, ...config };
	}

	activate(): void {
		this.isActive = true;
		this.stepCount = 0;
		this.consecutiveFailures = 0;
		this.modeManager.setMode("bypass");
		logger.warn("YOLO mode activated - full autonomy enabled");
	}

	deactivate(): void {
		this.isActive = false;
		this.stepCount = 0;
		this.consecutiveFailures = 0;
		this.modeManager.setMode("edit");
		logger.info("YOLO mode deactivated");
	}

	recordStep(): void {
		this.stepCount++;
	}

	recordFailure(): void {
		this.consecutiveFailures++;
		if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
			logger.warn("Max consecutive failures reached, deactivating YOLO mode");
			this.deactivate();
		}
	}

	recordSuccess(): void {
		this.consecutiveFailures = 0;
	}

	needsCheckpoint(): boolean {
		return this.stepCount >= this.config.maxStepsWithoutConfirmation;
	}

	resetStepCount(): void {
		this.stepCount = 0;
	}

	isCurrentlyActive(): boolean {
		return this.isActive;
	}

	getStepCount(): number {
		return this.stepCount;
	}

	getConsecutiveFailures(): number {
		return this.consecutiveFailures;
	}

	updateConfig(config: Partial<YoloConfig>): void {
		this.config = { ...this.config, ...config };
		logger.info("YOLO config updated", { config: this.config });
	}

	getConfig(): YoloConfig {
		return { ...this.config };
	}

	getStatus(): { active: boolean; mode: ModeName; steps: number; failures: number } {
		return {
			active: this.isActive,
			mode: this.modeManager.getCurrentMode(),
			steps: this.stepCount,
			failures: this.consecutiveFailures,
		};
	}
}
