/**
 * 6-Digit Device Code Authentication Flow
 *
 * Generates a 6-digit code, displays it, polls backend for validation.
 * Used for cloud mode authentication.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { DeviceFlowSession } from "./types";

const DEVICE_FLOWS_DIR = path.join(os.homedir(), ".config", "pakalon", "device-flows");

export class DeviceFlowAuth {
	private activeSessions = new Map<string, DeviceFlowSession>();
	private pollTimers = new Map<string, ReturnType<typeof setInterval>>();

	/**
	 * Start a new device flow, generating a 6-digit code.
	 */
	startDeviceFlow(verificationUri?: string): DeviceFlowSession {
		const code = Math.floor(100000 + Math.random() * 900000).toString();
		const deviceCode = `dc_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

		const session: DeviceFlowSession = {
			code,
			verificationUri: verificationUri ?? `${process.env.PAKALON_WEB_URL ?? "https://pakalon.dev"}/device`,
			expiresIn: 300,
			interval: 5,
			deviceCode,
			startedAt: new Date().toISOString(),
		};

		this.activeSessions.set(code, session);
		this.persistSession(session);
		logger.info("Device flow started", { code, verificationUri: session.verificationUri });
		return session;
	}

	/**
	 * Poll the backend to check if the 6-digit code was verified.
	 */
	async pollForCompletion(code: string): Promise<{ completed: boolean; token?: string }> {
		const session = this.activeSessions.get(code);
		if (!session) return { completed: false };

		try {
			const apiUrl = process.env.PAKALON_API_URL ?? "https://api.pakalon.dev";
			const response = await fetch(`${apiUrl}/auth/device/check`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deviceCode: session.deviceCode }),
			});

			if (!response.ok) {
				if (response.status === 404) return { completed: false };
				logger.warn("Device flow poll failed", { status: response.status });
				return { completed: false };
			}

			const data = (await response.json()) as { authorized: boolean; token?: string; expired: boolean };
			if (data.authorized && data.token) {
				this.cleanupSession(code);
				return { completed: true, token: data.token };
			}
			if (data.expired) {
				this.cleanupSession(code);
				return { completed: false };
			}
			return { completed: false };
		} catch (error) {
			logger.error("Device flow poll error", { error });
			return { completed: false };
		}
	}

	/**
	 * Start polling with callbacks. Returns a cleanup function.
	 */
	startPolling(code: string, onComplete: (token: string) => void, onExpire: () => void): () => void {
		const session = this.activeSessions.get(code);
		if (!session) return () => {};

		const interval = setInterval(async () => {
			const result = await this.pollForCompletion(code);
			if (result.completed && result.token) {
				clearInterval(interval);
				this.pollTimers.delete(code);
				onComplete(result.token);
			} else if (!result.completed && !this.activeSessions.has(code)) {
				clearInterval(interval);
				this.pollTimers.delete(code);
				onExpire();
			}
		}, session.interval * 1000);

		this.pollTimers.set(code, interval);
		return () => {
			clearInterval(interval);
			this.pollTimers.delete(code);
		};
	}

	/**
	 * Cancel an active device flow.
	 */
	cancelDeviceFlow(code: string): void {
		this.cleanupSession(code);
	}

	/**
	 * Validate the format of a 6-digit code.
	 */
	isValidCodeFormat(code: string): boolean {
		return /^\d{6}$/.test(code);
	}

	/**
	 * Get an active session by code.
	 */
	getSession(code: string): DeviceFlowSession | undefined {
		return this.activeSessions.get(code);
	}

	private cleanupSession(code: string): void {
		const timer = this.pollTimers.get(code);
		if (timer) {
			clearInterval(timer);
			this.pollTimers.delete(code);
		}
		this.activeSessions.delete(code);
		this.removePersistedSession(code);
	}

	private persistSession(session: DeviceFlowSession): void {
		try {
			fs.mkdirSync(DEVICE_FLOWS_DIR, { recursive: true });
			fs.writeFileSync(path.join(DEVICE_FLOWS_DIR, `${session.code}.json`), JSON.stringify(session, null, 2));
		} catch (error) {
			logger.warn("Failed to persist device flow session", { error });
		}
	}

	private removePersistedSession(code: string): void {
		try {
			const filePath = path.join(DEVICE_FLOWS_DIR, `${code}.json`);
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
		} catch (error) {
			logger.warn("Failed to remove persisted device flow session", { error });
		}
	}
}

export const deviceFlow = new DeviceFlowAuth();
