/**
 * Query Configuration
 * Feature-gated query configuration
 */
import logger from '@/utils/logger.js';

export interface QueryConfiguration {
  maxTurns: number;
  maxTokens: number;
  temperature: number;
  model: string;
  enableCompaction: boolean;
  enableRecovery: boolean;
  enableTokenBudget: boolean;
  compactThreshold: number;
  recoveryRetries: number;
}

const DEFAULT_CONFIG: QueryConfiguration = {
  maxTurns: 100,
  maxTokens: 4096,
  temperature: 0.7,
  model: 'anthropic/claude-3-5-sonnet',
  enableCompaction: true,
  enableRecovery: true,
  enableTokenBudget: true,
  compactThreshold: 0.8,
  recoveryRetries: 3,
};

let currentConfig: QueryConfiguration = { ...DEFAULT_CONFIG };

export function getQueryConfig(): QueryConfiguration {
  return { ...currentConfig };
}

export function updateQueryConfig(updates: Partial<QueryConfiguration>): void {
  currentConfig = {
    ...currentConfig,
    ...updates,
  };
  logger.debug('[QueryConfig] Updated config', updates);
}

export function resetQueryConfig(): void {
  currentConfig = { ...DEFAULT_CONFIG };
}

export function isFeatureEnabled(feature: keyof QueryConfiguration): boolean {
  const value = currentConfig[feature];
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
}

export function getMaxTurns(): number {
  return currentConfig.maxTurns;
}

export function getMaxTokens(): number {
  return currentConfig.maxTokens;
}

export function getModel(): string {
  return currentConfig.model;
}

export function getTemperature(): number {
  return currentConfig.temperature;
}

export function getCompactThreshold(): number {
  return currentConfig.compactThreshold;
}

export function getRecoveryRetries(): number {
  return currentConfig.recoveryRetries;
}

export { DEFAULT_CONFIG };
export type { QueryConfiguration };