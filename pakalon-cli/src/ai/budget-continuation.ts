export function getBudgetContinuationMessage(
  pct: number,
  turnTokens: number,
  budget: number,
): string {
  const fmt = (n: number): string => new Intl.NumberFormat("en-US").format(n);
  return `Stopped at ${pct}% of token target (${fmt(turnTokens)} / ${fmt(budget)}). Keep working — do not summarize.`;
}

export function buildBudgetContinuationNotice(params: {
  continuationCount: number;
  pct: number;
  turnTokens: number;
  budget: number;
}): string {
  return `Token budget continuation ${params.continuationCount}: ${getBudgetContinuationMessage(params.pct, params.turnTokens, params.budget)}`;
}
