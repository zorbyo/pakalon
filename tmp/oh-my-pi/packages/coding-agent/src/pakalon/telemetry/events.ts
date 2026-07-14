/**
 * Telemetry event types and dispatch for Pakalon.
 * Defines the high-level events the CLI emits (per requirement §8).
 */

import { logger } from "@oh-my-pi/pi-utils";
import { bumpUsage, loadStorage } from "./storage";

export interface TelemetryEvent {
	type:
		| "prompt.submitted"
		| "ai.request"
		| "line.changed"
		| "suggestion.accepted"
		| "suggestion.rejected"
		| "chat.interaction"
		| "active.tick"
		| "error.raised";
	timestamp?: string;
	payload?: Record<string, unknown>;
}

/** Emit a telemetry event. In privacy mode, drop everything that could leak code. */
export function emit(event: TelemetryEvent): void {
	const privacy = loadStorage()["privacy.enabled"] === true;
	if (privacy && (event.type === "prompt.submitted" || event.type === "line.changed")) {
		// Privacy mode: don't track prompt contents or line deltas
		return;
	}
	switch (event.type) {
		case "prompt.submitted":
			bumpUsage("usage.totalPrompts", 1);
			break;
		case "ai.request":
			bumpUsage("usage.totalAIRequests", 1);
			break;
		case "line.changed": {
			const added = (event.payload?.added as number) ?? 0;
			const removed = (event.payload?.removed as number) ?? 0;
			if (added) bumpUsage("usage.linesAdded", added);
			if (removed) bumpUsage("usage.linesRemoved", removed);
			break;
		}
		default:
			break;
	}
	logger.debug("telemetry: emit", { type: event.type });
}
