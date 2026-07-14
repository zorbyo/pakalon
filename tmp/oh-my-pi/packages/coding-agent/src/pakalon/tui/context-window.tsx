/**
 * Context window TUI component with phase budget awareness.
 *
 * Extends the basic context-meter with phase allocation info,
 * budget level indicator, and compression warnings.
 */
import * as React from "react";

export type BudgetLevel = "conservative" | "standard" | "aggressive";

export interface ContextWindowProps {
	usedTokens: number;
	maxTokens: number;
	phaseBudget?: number;
	phaseName?: string;
	budgetLevel?: BudgetLevel;
}

const BAR_WIDTH = 16;
const BUDGET_LEVEL_LABELS: Record<BudgetLevel, string> = {
	conservative: "CON",
	standard: "STD",
	aggressive: "AGG",
};

function formatTokens(n: number): string {
	if (n < 1_000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

function colorFor(pct: number): "green" | "yellow" | "red" {
	if (pct >= 0.95) return "red";
	if (pct >= 0.8) return "yellow";
	return "green";
}

export function renderContextWindow(
	usedTokens: number,
	maxTokens: number,
	phaseBudget?: number,
	phaseName?: string,
	budgetLevel?: BudgetLevel,
): string {
	if (maxTokens <= 0) return "ctx [░░░░░░░░░░░░░░░░] 0/0";

	const reference = phaseBudget || maxTokens;
	const pct = Math.min(1, usedTokens / reference);
	const filled = Math.round(BAR_WIDTH * pct);
	const empty = BAR_WIDTH - filled;
	const bar = "█".repeat(filled) + "░".repeat(empty);
	const color = colorFor(pct);

	const colorCodes: Record<string, string> = { green: "32", yellow: "33", red: "31" };
	let text = `\x1b[${colorCodes[color]}mctx [${bar}] ${formatTokens(usedTokens)}/${formatTokens(reference)}\x1b[0m`;

	if (phaseName) {
		text += ` (${phaseName})`;
	}

	if (budgetLevel) {
		text += ` [${BUDGET_LEVEL_LABELS[budgetLevel]}]`;
	}

	if (pct >= 0.8) {
		const warnColor = pct >= 0.95 ? "31" : "33";
		text += ` \x1b[${warnColor}m\u26a0\x1b[0m`;
	}

	return text;
}

export function ContextWindow({
	usedTokens,
	maxTokens,
	phaseBudget,
	phaseName,
	budgetLevel,
}: ContextWindowProps): React.ReactElement {
	if (maxTokens <= 0) {
		return React.createElement("text", { color: "gray" }, "ctx [░░░░░░░░░░░░░░░░] 0/0");
	}

	const reference = phaseBudget || maxTokens;
	const pct = Math.min(1, usedTokens / reference);
	const filled = Math.round(BAR_WIDTH * pct);
	const empty = BAR_WIDTH - filled;
	const bar = "█".repeat(filled) + "░".repeat(empty);
	const color = colorFor(pct);

	const segments: (React.ReactElement | string)[] = [
		React.createElement(
			"text",
			{ key: "bar", color },
			`ctx [${bar}] ${formatTokens(usedTokens)}/${formatTokens(reference)}`,
		),
	];

	if (phaseName) {
		segments.push(React.createElement("text", { key: "phase", color: "white" }, ` (${phaseName})`));
	}

	if (budgetLevel) {
		segments.push(
			React.createElement("text", { key: "budget", color: "magenta" }, ` [${BUDGET_LEVEL_LABELS[budgetLevel]}]`),
		);
	}

	if (pct >= 0.8) {
		const warnColor = pct >= 0.95 ? "red" : "yellow";
		segments.push(React.createElement("text", { key: "warn", color: warnColor }, " \u26a0"));
	}

	return React.createElement("box", { flexDirection: "row" }, ...segments);
}
