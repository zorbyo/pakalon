/**
 * Token Budget Management
 * Tracks and enforces token budgets during query execution
 */
import logger from '@/utils/logger.js';

export interface TokenBudget {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxTokens: number;
  warningThreshold: number;
  criticalThreshold: number;
}

export interface BudgetState {
  current: TokenBudget;
  history: TokenUsage[];
  isLimited: boolean;
  limitReason?: string;
}

export interface TokenUsage {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  queryId?: string;
}

const DEFAULT_MAX_TOKENS = 100000;
const DEFAULT_WARNING_THRESHOLD = 0.7;
const DEFAULT_CRITICAL_THRESHOLD = 0.9;

let currentBudget: TokenBudget = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  maxTokens: DEFAULT_MAX_TOKENS,
  warningThreshold: DEFAULT_WARNING_THRESHOLD,
  criticalThreshold: DEFAULT_CRITICAL_THRESHOLD,
};

let budgetHistory: TokenUsage[] = [];
let isLimited = false;
let limitReason: string | undefined;

export function getBudget(): TokenBudget {
  return { ...currentBudget };
}

export function updateBudget(usage: Partial<TokenUsage>): void {
  if (usage.inputTokens !== undefined) {
    currentBudget.inputTokens += usage.inputTokens;
  }
  if (usage.outputTokens !== undefined) {
    currentBudget.outputTokens += usage.outputTokens;
  }
  currentBudget.totalTokens = currentBudget.inputTokens + currentBudget.outputTokens;

  checkBudgetLimits();
}

export function setMaxTokens(max: number): void {
  currentBudget.maxTokens = max;
  checkBudgetLimits();
}

export function setWarningThreshold(threshold: number): void {
  currentBudget.warningThreshold = threshold;
}

export function setCriticalThreshold(threshold: number): void {
  currentBudget.criticalThreshold = threshold;
}

export function checkBudgetLimits(): void {
  const ratio = currentBudget.totalTokens / currentBudget.maxTokens;

  if (ratio >= currentBudget.criticalThreshold) {
    isLimited = true;
    limitReason = 'Critical: Token budget exhausted';
    logger.warn(`[TokenBudget] Critical threshold reached: ${(ratio * 100).toFixed(1)}%`);
  } else if (ratio >= currentBudget.warningThreshold) {
    logger.warn(`[TokenBudget] Warning threshold reached: ${(ratio * 100).toFixed(1)}%`);
  }
}

export function getBudgetState(): BudgetState {
  return {
    current: { ...currentBudget },
    history: [...budgetHistory],
    isLimited,
    limitReason,
  };
}

export function recordUsage(usage: TokenUsage): void {
  budgetHistory.push(usage);

  if (budgetHistory.length > 1000) {
    budgetHistory = budgetHistory.slice(-1000);
  }

  currentBudget.inputTokens += usage.inputTokens;
  currentBudget.outputTokens += usage.outputTokens;
  currentBudget.totalTokens += usage.totalTokens;

  checkBudgetLimits();
}

export function canProceed(): boolean {
  return !isLimited;
}

export function getLimitReason(): string | undefined {
  return limitReason;
}

export function resetBudget(): void {
  currentBudget = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    maxTokens: DEFAULT_MAX_TOKENS,
    warningThreshold: DEFAULT_WARNING_THRESHOLD,
    criticalThreshold: DEFAULT_CRITICAL_THRESHOLD,
  };
  budgetHistory = [];
  isLimited = false;
  limitReason = undefined;
}

export function getBudgetUsageRatio(): number {
  return currentBudget.totalTokens / currentBudget.maxTokens;
}

export function getRemainingTokens(): number {
  return Math.max(0, currentBudget.maxTokens - currentBudget.totalTokens);
}

export function getHistory(): TokenUsage[] {
  return [...budgetHistory];
}

export { TokenBudget, BudgetState, TokenUsage };