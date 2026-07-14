/**
 * BlinkingIndicator wrapper — bridges the high-level React component
 * with the low-level blink.ts indicator registry.
 *
 * Usage:
 *   const id = registerIndicator("bash:ls -la", "spinner");
 *   // … the indicator animates in the footer …
 *   unregisterIndicator(id);
 */
import React from "react";
import BlinkingIndicator, { type BlinkingIndicatorStatus, type BlinkingIndicatorVariant } from "./blinking-indicator";

// ─── Registry ──────────────────────────────────────────────────────────

interface IndicatorEntry {
	id: string;
	label: string;
	variant: BlinkingIndicatorVariant;
	status: BlinkingIndicatorStatus;
	createdAt: number;
}

const REGISTRY = new Map<string, IndicatorEntry>();
const LISTENERS = new Set<() => void>();

function notify(): void {
	for (const fn of LISTENERS) {
		try {
			fn();
		} catch {
			/* noop */
		}
	}
}

export function onIndicatorChange(fn: () => void): () => void {
	LISTENERS.add(fn);
	return () => LISTENERS.delete(fn);
}

export function registerIndicator(label: string, variant: BlinkingIndicatorVariant = "spinner"): string {
	const id = `${label}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
	REGISTRY.set(id, {
		id,
		label,
		variant,
		status: "running",
		createdAt: Date.now(),
	});
	notify();
	return id;
}

export function setIndicatorStatus(id: string, status: BlinkingIndicatorStatus): void {
	const entry = REGISTRY.get(id);
	if (entry) {
		entry.status = status;
		notify();
		if (status === "completed" || status === "failed") {
			// Auto-remove after a short delay so the user sees the ✓/✗
			setTimeout(() => {
				REGISTRY.delete(id);
				notify();
			}, 2000);
		}
	}
}

export function unregisterIndicator(id: string): void {
	if (REGISTRY.delete(id)) notify();
}

export function clearAllIndicators(): void {
	if (REGISTRY.size > 0) {
		REGISTRY.clear();
		notify();
	}
}

// ─── Rendering ─────────────────────────────────────────────────────────

export function renderActiveIndicators(): React.ReactElement | null {
	const entries = [...REGISTRY.values()];
	if (entries.length === 0) return null;

	return React.createElement(
		"box",
		{ flexDirection: "column", marginTop: 0 },
		...entries.map(e =>
			React.createElement(BlinkingIndicator, {
				key: e.id,
				label: e.label,
				status: e.status,
				variant: e.variant,
				elapsed: Date.now() - e.createdAt,
			}),
		),
	);
}

export function getActiveIndicatorCount(): number {
	return REGISTRY.size;
}
