/**
 * Pure-string render of the context meter.
 *
 * Used by the pre-existing footer in `modes/components/footer.ts`
 * which has a `string[]` render contract. Kept as a separate `.ts`
 * file (not `.tsx`) so the import works without `--jsx` in the
 * project's tsconfig.
 */
const BAR_WIDTH = 16;

type MeterColor = "green" | "yellow" | "red";

function colorFor(pct: number): MeterColor {
	if (pct >= 0.85) return "red";
	if (pct >= 0.6) return "yellow";
	return "green";
}

function formatTokens(n: number): string {
	if (n < 1_000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

const CODES: Record<MeterColor, string> = { green: "32", yellow: "33", red: "31" };

export function renderContextMeter(usedTokens: number, maxTokens: number): string {
	if (maxTokens <= 0) return `[32mctx [${"░".repeat(BAR_WIDTH)}] 0/0[0m`;
	const pct = Math.min(1, usedTokens / maxTokens);
	const filled = Math.round(BAR_WIDTH * pct);
	const empty = BAR_WIDTH - filled;
	const bar = "█".repeat(filled) + "░".repeat(empty);
	const color = colorFor(pct);
	const text = `ctx [${bar}] ${formatTokens(usedTokens)}/${formatTokens(maxTokens)}`;
	return `[${CODES[color]}m${text}[0m`;
}
