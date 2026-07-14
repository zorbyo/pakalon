/**
 * Backend client — submits telemetry events to pakalon-backend-rs.
 *
 * When a backend URL is configured (via PAKALON_API_URL env var or
 * storage.json `backendUrl`), the telemetry flush pipeline sends a
 * batch of events to the backend's `/api/telemetry` endpoint. The
 * backend is responsible for persisting and aggregating the events
 * for the dashboard & admin views.
 *
 * Falls back to the local JSONL file when the URL is unset, the
 * backend is unreachable, or the user is in privacy mode.
 */
import type { TelemetryEvent } from "./index";

const ENV_BACKEND_URL = "PAKALON_API_URL";
const DEFAULT_BACKEND = "http://127.0.0.1:8000";

export interface BackendConfig {
	url: string;
	timeoutMs: number;
}

/**
 * Resolve the backend URL from:
 * 1. PAKALON_API_URL env var
 * 2. storage.json backendUrl
 * 3. Fallback default
 */
export function resolveBackendUrl(storedUrl?: string | null): string {
	return Bun.env[ENV_BACKEND_URL] ?? storedUrl ?? DEFAULT_BACKEND;
}

/**
 * Send a batch of telemetry events to the backend. Returns `true` on
 * success, `false` when the backend is unreachable or returns an error.
 * Never throws — the caller (flushEvents) continues to the local JSONL
 * fallback regardless.
 */
export async function submitToBackend(events: TelemetryEvent[], config: BackendConfig): Promise<boolean> {
	if (events.length === 0) return true;

	try {
		const response = await fetch(`${config.url}/api/telemetry`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ events }),
			signal: AbortSignal.timeout(config.timeoutMs),
		});
		return response.ok;
	} catch {
		return false;
	}
}
