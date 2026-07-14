import { logger } from "@oh-my-pi/pi-utils";
import type { ModeManager } from "./mode-manager";

export class HILMode {
	private modeManager: ModeManager;
	private confirmationCallbacks: Map<string, (approved: boolean) => void> = new Map();
	private pendingConfirmations: Array<{
		id: string;
		toolName: string;
		args: Record<string, unknown>;
		prompt: string;
		timestamp: string;
	}> = [];

	constructor(modeManager: ModeManager) {
		this.modeManager = modeManager;
	}

	requestConfirmation(toolName: string, args: Record<string, unknown>): Promise<boolean> {
		const id = crypto.randomUUID();
		const prompt = this.buildPrompt(toolName, args);
		this.pendingConfirmations.push({ id, toolName, args, prompt, timestamp: new Date().toISOString() });
		logger.info("Confirmation requested", { id, toolName });
		return new Promise(resolve => {
			this.confirmationCallbacks.set(id, resolve);
			this.emitConfirmationRequest(id, toolName, prompt);
		});
	}

	approveConfirmation(id: string): void {
		const callback = this.confirmationCallbacks.get(id);
		if (callback) {
			callback(true);
			this.confirmationCallbacks.delete(id);
			this.pendingConfirmations = this.pendingConfirmations.filter(p => p.id !== id);
			logger.info("Confirmation approved", { id });
		}
	}

	rejectConfirmation(id: string): void {
		const callback = this.confirmationCallbacks.get(id);
		if (callback) {
			callback(false);
			this.confirmationCallbacks.delete(id);
			this.pendingConfirmations = this.pendingConfirmations.filter(p => p.id !== id);
			logger.info("Confirmation rejected", { id });
		}
	}

	rejectAllPending(): void {
		for (const [id, callback] of this.confirmationCallbacks) {
			callback(false);
		}
		this.confirmationCallbacks.clear();
		this.pendingConfirmations = [];
		logger.info("All pending confirmations rejected");
	}

	getPendingConfirmations() {
		return [...this.pendingConfirmations];
	}

	getPendingCount(): number {
		return this.pendingConfirmations.length;
	}

	hasPendingConfirmations(): boolean {
		return this.pendingConfirmations.length > 0;
	}

	autoConfirmEnabled(): boolean {
		return this.modeManager.isAutoAccept() || this.modeManager.isYolo();
	}

	enterPlanMode(): void {
		this.modeManager.setMode("plan");
		logger.info("Entered plan mode (HIL active)");
	}

	enterEditMode(): void {
		this.modeManager.setMode("edit");
		logger.info("Entered edit mode (HIL active)");
	}

	private buildPrompt(toolName: string, args: Record<string, unknown>): string {
		const config = this.modeManager.getModeConfig();
		const lines: string[] = [];
		lines.push(`[${config.name}] Confirmation required for: ${toolName}`);
		lines.push(`Args: ${JSON.stringify(args, null, 2)}`);
		lines.push("");
		lines.push("Approve? (y/N):");
		return lines.join("\n");
	}

	private emitConfirmationRequest(_id: string, _toolName: string, prompt: string): void {
		if (process.stdout.isTTY) {
			process.stdout.write(`\n${prompt}\n`);
		}
	}
}
