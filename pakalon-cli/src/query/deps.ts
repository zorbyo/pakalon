/**
 * Query Dependencies
 * Manages dependencies and tool result tracking for query execution
 */
import type { Tools } from '@/ai/tool-registry';
import logger from '@/utils/logger.js';

export interface ToolResultEntry {
  toolName: string;
  args: any;
  result: any;
  timestamp: number;
  duration: number;
  cached: boolean;
}

export interface QueryDependencies {
  toolResults: Map<string, ToolResultEntry>;
  cachedResults: Map<string, any>;
  maxCachedResults: number;
}

const DEFAULT_MAX_CACHED = 100;

let dependencies: QueryDependencies = {
  toolResults: new Map(),
  cachedResults: new Map(),
  maxCachedResults: DEFAULT_MAX_CACHED,
};

export function initDependencies(): void {
  dependencies = {
    toolResults: new Map(),
    cachedResults: new Map(),
    maxCachedResults: DEFAULT_MAX_CACHED,
  };
  logger.debug('[QueryDeps] Initialized dependencies');
}

export function addToolResult(
  toolUseId: string,
  entry: Omit<ToolResultEntry, 'cached'>,
): void {
  dependencies.toolResults.set(toolUseId, {
    ...entry,
    cached: false,
  });
}

export function getToolResult(toolUseId: string): ToolResultEntry | undefined {
  return dependencies.toolResults.get(toolUseId);
}

export function getAllToolResults(): ToolResultEntry[] {
  return Array.from(dependencies.toolResults.values());
}

export function cacheResult(key: string, value: any): void {
  if (dependencies.cachedResults.size >= dependencies.maxCachedResults) {
    const firstKey = dependencies.cachedResults.keys().next().value;
    if (firstKey) {
      dependencies.cachedResults.delete(firstKey);
    }
  }
  dependencies.cachedResults.set(key, value);
}

export function getCachedResult(key: string): any | undefined {
  return dependencies.cachedResults.get(key);
}

export function hasCachedResult(key: string): boolean {
  return dependencies.cachedResults.has(key);
}

export function clearCache(): void {
  dependencies.cachedResults.clear();
  logger.debug('[QueryDeps] Cleared cache');
}

export function clearToolResults(): void {
  dependencies.toolResults.clear();
  logger.debug('[QueryDeps] Cleared tool results');
}

export function clearAll(): void {
  initDependencies();
}

export function getCacheSize(): number {
  return dependencies.cachedResults.size;
}

export function getToolResultCount(): number {
  return dependencies.toolResults.size;
}

export function setMaxCachedResults(max: number): void {
  dependencies.maxCachedResults = max;
}

export function getDependencies(): QueryDependencies {
  return {
    toolResults: new Map(dependencies.toolResults),
    cachedResults: new Map(dependencies.cachedResults),
    maxCachedResults: dependencies.maxCachedResults,
  };
}

export { QueryDependencies, ToolResultEntry };