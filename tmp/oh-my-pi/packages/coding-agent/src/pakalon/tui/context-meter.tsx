/**
 * Context meter TUI component.
 *
 * Renders a one-line bar `ctx [████░░░░] 12.4k/128k` below the chat
 * input. Color: green < 60%, yellow 60-85%, red > 85%.
 */
import * as React from "react";

export interface ContextMeterProps {
	usedTokens: number;
	maxTokens: number;
}

const BAR_WIDTH = 16;

function colorFor(pct: number): "green" | "yellow" | "red" {
	if (pct >= 0.85) return "red";
	if (pct >= 0.6) return "yellow";
	return "green";
}

function formatTokens(n: number): string {
	if (n < 1_000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Pure-string render path. Used by the pre-existing footer in
 * `modes/components/footer.ts` which has a string[] render contract.
 */
export function renderContextMeter(usedTokens: number, maxTokens: number): string {
	if (maxTokens <= 0) return "ctx [░░░░░░░░░░░░░░░░] 0/0";
	const pct = Math.min(1, usedTokens / maxTokens);
	const filled = Math.round(BAR_WIDTH * pct);
	const empty = BAR_WIDTH - filled;
	const bar = "█".repeat(filled) + "░".repeat(empty);
	const color = colorFor(pct);
	return colorize(color, `ctx [${bar}] ${formatTokens(usedTokens)}/${formatTokens(maxTokens)}`);
}

function colorize(color: "green" | "yellow" | "red", text: string): string {
	// ANSI color codes — the existing TUI uses chalk; here we use raw
	// codes so this function has zero deps and can be called from
	// the footer's `string[]` render.
	const codes: Record<string, string> = { green: "32", yellow: "33", red: "31" };
	return `\x1b[${codes[color]}m${text}\x1b[0m`;
}

export function ContextMeter({ usedTokens, maxTokens }: ContextMeterProps): React.ReactElement {
	const pct = maxTokens > 0 ? Math.min(1, usedTokens / maxTokens) : 0;
	const filled = Math.round(BAR_WIDTH * pct);
	const empty = BAR_WIDTH - filled;
	const bar = "█".repeat(filled) + "░".repeat(empty);
	const color = colorFor(pct);
	const text = `ctx [${bar}] ${formatTokens(usedTokens)}/${formatTokens(maxTokens)}`;
	return React.createElement("text", { color }, text);
}
