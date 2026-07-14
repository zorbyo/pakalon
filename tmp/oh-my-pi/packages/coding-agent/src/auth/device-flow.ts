/**
 * 6-Digit Device Flow Authentication
 *
 * Implements the device flow pattern:
 * 1. CLI generates 6-digit code and displays it
 * 2. Backend stores the code temporarily
 * 3. User copies code and pastes in web browser
 * 4. Backend validates and completes authentication
 * 5. CLI polls for completion and proceeds
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface DeviceFlowSession {
	code: string;
	verificationUri: string;
	expiresIn: number;
	interval: number;
	deviceCode: string;
}

export class DeviceFlowAuth {
	private activeSessions: Map<string, DeviceFlowSession> = new Map();
	private pollIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

	/**
	 * Generate a 6-digit device code and start authentication flow
	 */
	startDeviceFlow(): DeviceFlowSession {
		// Generate 6-digit code
		const code = Math.floor(100000 + Math.random() * 900000).toString();

		// Generate device code (backend would use this)
		const deviceCode = `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

		const session: DeviceFlowSession = {
			code,
			verificationUri: `${process.env.PAKALON_WEB_URL || "https://pakalon.dev"}/device`,
			expiresIn: 300, // 5 minutes
			interval: 5, // Poll every 5 seconds
			deviceCode,
		};

		this.activeSessions.set(code, session);

		// Store in local state for persistence
		this.persistSession(session);

		logger.info("Device flow started", { code, verificationUri: session.verificationUri });

		return session;
	}

	/**
	 * Poll backend to check if code was verified
	 */
	async pollForCompletion(code: string): Promise<{ completed: boolean; token?: string }> {
		const session = this.activeSessions.get(code);
		if (!session) {
			return { completed: false };
		}

		try {
			// In real implementation, this would call the backend API
			// const response = await fetch(`${API_BASE}/auth/device/check`, {
			//   method: 'POST',
			//   headers: { 'Content-Type': 'application/json' },
			//   body: JSON.stringify({ deviceCode: session.deviceCode })
			// });
			// const data = await response.json();

			// For now, simulate completion
			const data = await this.checkDeviceCode(session.deviceCode);

			if (data.authorized) {
				// Clean up
				this.cleanupSession(code);
				return { completed: true, token: data.token };
			}

			if (data.expired) {
				this.cleanupSession(code);
				return { completed: false, token: undefined };
			}

			return { completed: false };
		} catch (error) {
			logger.error("Device flow poll failed", { error });
			return { completed: false };
		}
	}

	/**
	 * Start polling in background (returns unsubscribe function)
	 */
	startPolling(code: string, onComplete: (token: string) => void, onExpire: () => void): () => void {
		const session = this.activeSessions.get(code);
		if (!session) {
			return () => {};
		}

		const interval = setInterval(async () => {
			const result = await this.pollForCompletion(code);

			if (result.completed && result.token) {
				clearInterval(interval);
				this.pollIntervals.delete(code);
				onComplete(result.token);
			} else if (!result.completed && !this.activeSessions.has(code)) {
				clearInterval(interval);
				this.pollIntervals.delete(code);
				onExpire();
			}
		}, session.interval * 1000);

		this.pollIntervals.set(code, interval);

		// Return cleanup function
		return () => {
			clearInterval(interval);
			this.pollIntervals.delete(code);
		};
	}

	/**
	 * Cancel device flow
	 */
	cancelDeviceFlow(code: string): void {
		this.cleanupSession(code);
	}

	/**
	 * Validate 6-digit code format
	 */
	isValidCodeFormat(code: string): boolean {
		return /^\d{6}$/.test(code);
	}

	private cleanupSession(code: string): void {
		const interval = this.pollIntervals.get(code);
		if (interval) {
			clearInterval(interval);
			this.pollIntervals.delete(code);
		}
		this.activeSessions.delete(code);
		this.removePersistedSession(code);
	}

	private persistSession(session: DeviceFlowSession): void {
		try {
			const sessionsDir = path.join(os.homedir(), ".config", "pakalon", "device-flows");
			fs.mkdirSync(sessionsDir, { recursive: true });
			fs.writeFileSync(path.join(sessionsDir, `${session.code}.json`), JSON.stringify(session, null, 2));
		} catch (error) {
			logger.warn("Failed to persist device flow session", { error });
		}
	}

	private removePersistedSession(code: string): void {
		try {
			const sessionPath = path.join(os.homedir(), ".config", "pakalon", "device-flows", `${code}.json`);
			if (fs.existsSync(sessionPath)) {
				fs.unlinkSync(sessionPath);
			}
		} catch (error) {
			logger.warn("Failed to remove persisted device flow session", { error });
		}
	}

	private async checkDeviceCode(
		_deviceCode: string,
	): Promise<{ authorized: boolean; expired: boolean; token?: string }> {
		// Placeholder for actual backend check
		// In production, this would make an API call to verify the device code
		return { authorized: false, expired: false };
	}
}

// Singleton instance
export const deviceFlow = new DeviceFlowAuth();
