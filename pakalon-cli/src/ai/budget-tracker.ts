export interface BudgetUsageEntry {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turn?: number;
  mode?: "chat" | "agent";
}

export interface SessionBudgetTracker {
  startedAt: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  turnCount: number;
  continuationCount: number;
  history: BudgetUsageEntry[];
  mode: "chat" | "agent";
}

export function createBudgetTracker(mode: "chat" | "agent" = "chat"): SessionBudgetTracker {
  return {
    startedAt: Date.now(),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    turnCount: 0,
    continuationCount: 0,
    history: [],
    mode,
  };
}

export function recordBudgetUsage(
  tracker: SessionBudgetTracker,
  usage: { inputTokens?: number; outputTokens?: number },
): SessionBudgetTracker {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = inputTokens + outputTokens;

  tracker.totalInputTokens += inputTokens;
  tracker.totalOutputTokens += outputTokens;
  tracker.totalTokens += totalTokens;
  tracker.turnCount += 1;
  tracker.history.push({
    timestamp: Date.now(),
    inputTokens,
    outputTokens,
    totalTokens,
    turn: tracker.turnCount,
    mode: tracker.mode,
  });

  if (tracker.history.length > 1000) tracker.history = tracker.history.slice(-1000);
  return tracker;
}

export function getBudgetUsagePct(tracker: SessionBudgetTracker, budget: number): number {
  if (budget <= 0) return 0;
  return Math.min(100, Math.round((tracker.totalTokens / budget) * 100));
}

export function hasReachedContinuationThreshold(
  tracker: SessionBudgetTracker,
  budget: number,
  threshold = 0.9,
): boolean {
  if (budget <= 0) return false;
  return tracker.totalTokens >= budget * threshold;
}
