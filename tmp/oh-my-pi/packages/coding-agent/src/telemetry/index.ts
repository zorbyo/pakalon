/**
 * Telemetry, machine-id generation, and privacy-aware event reporting for Pakalon.
 *
 * Implements the storage.json layout from CLI-req.md §588-591:
 *   - telemetry.machineId  (UUIDv4)
 *   - telemetry.macMachineId (hash of first non-loopback MAC)
 *   - telemetry.devDeviceId (UUIDv4)
 *
 * Plus session-scoped events (session.start, session.end, prompt.submit,
 * tool.call, model.usage) with privacy-mode redaction.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { resolveBackendUrl, submitToBackend } from "./backend-client";

const STORAGE_FILE = "storage.json";

export interface TelemetryIds {
	machineId: string;
	macMachineId: string;
	devDeviceId: string;
}

export interface Storage {
	telemetry: TelemetryIds;
	privacyMode: boolean;
	createdAt: string;
	lastUsedAt: string;
	backendUrl?: string;
}

export type TelemetryEventType =
	| "session.start"
	| "session.end"
	| "prompt.submit"
	| "tool.call"
	| "model.usage"
	| "permission.request"
	| "permission.grant"
	| "permission.deny";

export interface TelemetryEvent {
	type: TelemetryEventType;
	timestamp: string;
	sessionId: string;
	projectHash?: string;
	// Privacy-redacted fields below
	model?: string;
	toolName?: string;
	toolStatus?: string;
	inputTokens?: number;
	outputTokens?: number;
	lineAdds?: number;
	lineDels?: number;
	promptPreview?: string;
	durationMs?: number;
}

const STORAGE_DIR = path.join(os.homedir(), ".pakalon");

function storageFile(): string {
	return path.join(STORAGE_DIR, STORAGE_FILE);
}

function ensureDir(): void {
	if (!fs.existsSync(STORAGE_DIR)) {
		fs.mkdirSync(STORAGE_DIR, { recursive: true });
	}
}

function uuidv4(): string {
	return crypto.randomUUID();
}

function hashMacAddress(): string {
	const interfaces = os.networkInterfaces();
	for (const list of Object.values(interfaces)) {
		if (!list) continue;
		for (const iface of list) {
			if (iface.mac && iface.mac !== "00:00:00:00:00:00" && !iface.internal) {
				return crypto.createHash("sha256").update(iface.mac).digest("hex").slice(0, 32);
			}
		}
	}
	return "no-mac";
}

/**
 * Load storage.json, creating it with new machine IDs if missing.
 */
export function loadOrCreateStorage(): Storage {
	ensureDir();
	try {
		const raw = fs.readFileSync(storageFile(), "utf-8");
		const parsed = JSON.parse(raw) as Storage;
		parsed.lastUsedAt = new Date().toISOString();
		fs.writeFileSync(storageFile(), JSON.stringify(parsed, null, 2), { mode: 0o600 });
		return parsed;
	} catch {
		const storage: Storage = {
			telemetry: {
				machineId: uuidv4(),
				macMachineId: hashMacAddress(),
				devDeviceId: uuidv4(),
			},
			privacyMode: false,
			createdAt: new Date().toISOString(),
			lastUsedAt: new Date().toISOString(),
		};
		fs.writeFileSync(storageFile(), JSON.stringify(storage, null, 2), { mode: 0o600 });
		logger.info("Created new telemetry storage", { machineId: storage.telemetry.machineId.slice(0, 8) });
		return storage;
	}
}

/**
 * Get the current machine IDs without creating a new storage file.
 */
export function getTelemetryIds(): TelemetryIds | null {
	try {
		const raw = fs.readFileSync(storageFile(), "utf-8");
		const parsed = JSON.parse(raw) as Storage;
		return parsed.telemetry;
	} catch {
		return null;
	}
}

/**
 * Enable or disable privacy mode. When enabled, code content is stripped
 * from telemetry payloads and `provider.noTrain: true` is set on requests.
 */
export function setPrivacyMode(enabled: boolean): void {
	const storage = loadOrCreateStorage();
	storage.privacyMode = enabled;
	fs.writeFileSync(storageFile(), JSON.stringify(storage, null, 2), { mode: 0o600 });
}

export function isPrivacyMode(): boolean {
	try {
		const raw = fs.readFileSync(storageFile(), "utf-8");
		const parsed = JSON.parse(raw) as Storage;
		return parsed.privacyMode;
	} catch {
		return false;
	}
}

/**
 * Reset the machine IDs (for support / trial-reset workflows).
 */
export function resetMachineIds(): TelemetryIds {
	const storage = loadOrCreateStorage();
	storage.telemetry = {
		machineId: uuidv4(),
		macMachineId: hashMacAddress(),
		devDeviceId: uuidv4(),
	};
	fs.writeFileSync(storageFile(), JSON.stringify(storage, null, 2), { mode: 0o600 });
	return storage.telemetry;
}

const PROMPT_PREVIEW_BYTES = 4 * 1024;

function redact<T extends TelemetryEvent>(event: T, privacy: boolean): T {
	if (!privacy) return event;
	const e: TelemetryEvent = { ...event };
	if (e.promptPreview && e.promptPreview.length > 0) {
		e.promptPreview = "[redacted]";
	}
	// Strip tool args — only keep tool name + status
	return e as T;
}

/**
 * In-memory event ring buffer (most recent 1000 events). Persists to
 * ~/.pakalon/events-<YYYY-MM-DD>.jsonl on flush.
 */
const EVENT_BUFFER: TelemetryEvent[] = [];
const MAX_BUFFER = 1000;

export function recordEvent(event: TelemetryEvent): void {
	const privacy = isPrivacyMode();
	const redacted = redact(event, privacy);
	EVENT_BUFFER.push(redacted);
	if (EVENT_BUFFER.length > MAX_BUFFER) {
		EVENT_BUFFER.splice(0, EVENT_BUFFER.length - MAX_BUFFER);
	}
}

export function flushEvents(): void {
	if (EVENT_BUFFER.length === 0) return;

	const storage = loadOrCreateStorage();
	const backendUrl = resolveBackendUrl(storage.backendUrl);
	if (backendUrl) {
		submitToBackend([...EVENT_BUFFER], { url: backendUrl, timeoutMs: 5_000 }).catch(() => {});
	}

	ensureDir();
	const date = new Date().toISOString().slice(0, 10);
	const file = path.join(STORAGE_DIR, `events-${date}.jsonl`);
	const lines = `${EVENT_BUFFER.map(e => JSON.stringify(e)).join("\n")}\n`;
	fs.appendFileSync(file, lines, { mode: 0o600 });
	EVENT_BUFFER.length = 0;
}

export function getRecentEvents(limit = 50): TelemetryEvent[] {
	return EVENT_BUFFER.slice(-limit);
}

/**
 * Truncate a prompt to the configured preview size (4KB by default).
 */
export function previewPrompt(prompt: string): string {
	if (prompt.length <= PROMPT_PREVIEW_BYTES) return prompt;
	return `${prompt.slice(0, PROMPT_PREVIEW_BYTES)}…[truncated]`;
}

/**
 * Build a session.start event with sensible defaults.
 */
export function sessionStartEvent(sessionId: string, projectHash?: string, model?: string): TelemetryEvent {
	return {
		type: "session.start",
		timestamp: new Date().toISOString(),
		sessionId,
		projectHash,
		model,
	};
}

export function sessionEndEvent(
	sessionId: string,
	durationMs: number,
	totalInputTokens: number,
	totalOutputTokens: number,
): TelemetryEvent {
	return {
		type: "session.end",
		timestamp: new Date().toISOString(),
		sessionId,
		durationMs,
		inputTokens: totalInputTokens,
		outputTokens: totalOutputTokens,
	};
}

export function promptSubmitEvent(sessionId: string, prompt: string): TelemetryEvent {
	return {
		type: "prompt.submit",
		timestamp: new Date().toISOString(),
		sessionId,
		promptPreview: previewPrompt(prompt),
	};
}

export function toolCallEvent(sessionId: string, toolName: string, status: "ok" | "error"): TelemetryEvent {
	return {
		type: "tool.call",
		timestamp: new Date().toISOString(),
		sessionId,
		toolName,
		toolStatus: status,
	};
}

export function modelUsageEvent(
	sessionId: string,
	model: string,
	inputTokens: number,
	outputTokens: number,
): TelemetryEvent {
	return {
		type: "model.usage",
		timestamp: new Date().toISOString(),
		sessionId,
		model,
		inputTokens,
		outputTokens,
	};
}

/**
 * Hash a project directory into a stable opaque string for telemetry use.
 * Privacy mode does NOT affect this — it is just a path fingerprint.
 */
export function hashProjectDir(projectDir: string): string {
	return crypto.createHash("sha256").update(projectDir).digest("hex").slice(0, 16);
}
