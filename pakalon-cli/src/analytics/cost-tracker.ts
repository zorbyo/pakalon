export interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: Date;
}

const costs: CostEntry[] = [];

export function trackCost(entry: CostEntry): void {
  costs.push({ ...entry, timestamp: new Date(entry.timestamp) });
}

export function getTotalCost(since?: Date): number {
  return costs
    .filter((entry) => !since || entry.timestamp >= since)
    .reduce((sum, entry) => sum + entry.cost, 0);
}

export function getCostByModel(since?: Date): Record<string, number> {
  return costs
    .filter((entry) => !since || entry.timestamp >= since)
    .reduce<Record<string, number>>((acc, entry) => {
      acc[entry.model] = (acc[entry.model] ?? 0) + entry.cost;
      return acc;
    }, {});
}
