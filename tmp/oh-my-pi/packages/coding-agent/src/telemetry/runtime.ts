/**
 * Telemetry event integration with the agent runtime.
 *
 * Wires `recordEvent` into the lifecycle hooks the agent runtime
 * already calls (session start, session end, prompt submit, tool
 * call, model usage). The CLI runtime already invokes these; this
 * module is the bridge that records them.
 *
 * Designed to be a no-op when telemetry is disabled in
 * `~/.pakalon/storage.json` (privacy mode). All payloads are
 * redacted through `redact()` in `telemetry/index.ts`.
 */
import { logger } from "@oh-my-pi/pi-utils";
import * as telemetry from "./index";
import { hashProjectDir } from "./index";

export interface SessionEventContext {
	sessionId: string;
	projectDir: string;
	model?: string;
}

/**
 * Start-of-session hook. Loads storage (creating the machine IDs
 * on first run), returns the context the rest of the hooks will use.
 */
export function beginSession(sessionId: string, projectDir: string, model?: string): SessionEventContext {
	telemetry.loadOrCreateStorage();
	const ctx: SessionEventContext = { sessionId, projectDir: hashProjectDir(projectDir), model };
	telemetry.recordEvent(telemetry.sessionStartEvent(ctx.sessionId, ctx.projectDir, ctx.model));
	logger.debug("telemetry: session.start", { sessionId });
	return ctx;
}

/**
 * End-of-session hook. Flushes buffered events to the daily JSONL
 * log and writes the session.end event with the final tallies.
 */
export function endSession(
	ctx: SessionEventContext,
	totalInputTokens: number,
	totalOutputTokens: number,
	durationMs: number,
): void {
	telemetry.recordEvent(telemetry.sessionEndEvent(ctx.sessionId, durationMs, totalInputTokens, totalOutputTokens));
	telemetry.flushEvents();
	logger.debug("telemetry: session.end", { sessionId: ctx.sessionId, totalInputTokens, totalOutputTokens });
}

/**
 * Wrap a prompt submission so the prompt preview is captured and
 * redacted.
 */
export function recordPrompt(ctx: SessionEventContext, prompt: string): void {
	telemetry.recordEvent(telemetry.promptSubmitEvent(ctx.sessionId, prompt));
}

/**
 * Wrap a tool call. Only the name and status are recorded (never
 * the args — that's a privacy boundary).
 */
export function recordToolCall(ctx: SessionEventContext, toolName: string, status: "ok" | "error"): void {
	telemetry.recordEvent(telemetry.toolCallEvent(ctx.sessionId, toolName, status));
}

/**
 * Wrap a model usage. Recorded per-call, not aggregated, so the
 * back-end can compute per-period totals accurately.
 */
export function recordModelUsage(
	ctx: SessionEventContext,
	model: string,
	inputTokens: number,
	outputTokens: number,
): void {
	telemetry.recordEvent(telemetry.modelUsageEvent(ctx.sessionId, model, inputTokens, outputTokens));
}

/**
 * Compute and record the per-session line-add/line-del deltas.
 * Only call this on file-write tool completions.
 */
export function recordLineDelta(ctx: SessionEventContext, adds: number, dels: number): void {
	if (adds === 0 && dels === 0) return;
	telemetry.recordEvent({
		type: "tool.call",
		timestamp: new Date().toISOString(),
		sessionId: ctx.sessionId,
		toolName: "write",
		toolStatus: "ok",
		lineAdds: adds,
		lineDels: dels,
	});
}
