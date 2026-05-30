/**
 * ToolSearch - Deferred tool loading with keyword search.
 *
 * When many tools are available, ToolSearch defers loading tool schemas
 * until the model searches for them by keyword, reducing prompt token usage.
 */

import type { Tool } from '../tool.js';

/**
 * Index entry for a tool in the search index.
 */
interface ToolIndexEntry {
  tool: Tool;
  keywords: string[];
  searchText: string;
}

/**
 * ToolSearch index for efficient keyword-based tool discovery.
 */
export class ToolSearchIndex {
  private entries: ToolIndexEntry[] = [];
  private searchCache = new Map<string, Tool[]>();

  /**
   * Index a set of tools for search.
   */
  indexTools(tools: Tool[]): void {
    this.entries = tools.map((tool) => ({
      tool,
      keywords: this.extractKeywords(tool),
      searchText: this.buildSearchText(tool),
    }));
    this.searchCache.clear();
  }

  /**
   * Search tools by query string.
   * Returns tools matching the query, ranked by relevance.
   */
  searchTools(query: string, limit: number = 10): Tool[] {
    if (!query.trim()) return [];

    const cacheKey = `${query}:${limit}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    const normalizedQuery = query.toLowerCase().trim();
    const queryWords = normalizedQuery.split(/\s+/);

    const scored = this.entries.map((entry) => ({
      tool: entry.tool,
      score: this.scoreMatch(entry, queryWords, normalizedQuery),
    }));

    const results = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.tool);

    this.searchCache.set(cacheKey, results);
    return results;
  }

  /**
   * Determine if a tool should be deferred from the initial prompt.
   */
  shouldDeferTool(tool: Tool, activeToolNames: string[]): boolean {
    // Never defer tools that are explicitly marked as alwaysLoad
    if (tool.alwaysLoad) return false;

    // If the tool has shouldDefer=true, defer it
    if (tool.shouldDefer) return true;

    // If the tool is in the active set, don't defer
    if (activeToolNames.includes(tool.name)) return false;

    // Defer tools with searchHint (they're designed for deferred loading)
    return !!tool.searchHint;
  }

  /**
   * Get compact schema descriptions for deferred tools.
   * These are injected into the prompt so the model knows they exist.
   */
  getDeferredToolSchemas(tools: Tool[], maxTokens: number = 2000): string[] {
    const schemas: string[] = [];
    let tokenEstimate = 0;

    for (const tool of tools) {
      // Estimate tokens: ~4 chars per token
      const schemaText = this.compactSchema(tool);
      const estimatedTokens = Math.ceil(schemaText.length / 4);

      if (tokenEstimate + estimatedTokens > maxTokens) break;

      schemas.push(schemaText);
      tokenEstimate += estimatedTokens;
    }

    return schemas;
  }

  /**
   * Generate a compact schema string for a tool.
   */
  private compactSchema(tool: Tool): string {
    const hint = tool.searchHint ?? tool.description;
    const aliases = tool.aliases.length > 0 ? ` (aliases: ${tool.aliases.join(', ')})` : '';
    return `${tool.name}${aliases}: ${hint}`;
  }

  /**
   * Extract searchable keywords from a tool.
   */
  private extractKeywords(tool: Tool): string[] {
    const keywords = new Set<string>();

    // Add tool name words
    for (const word of tool.name.toLowerCase().split(/[\s_-]+/)) {
      if (word.length > 1) keywords.add(word);
    }

    // Add alias words
    for (const alias of tool.aliases) {
      for (const word of alias.toLowerCase().split(/[\s_-]+/)) {
        if (word.length > 1) keywords.add(word);
      }
    }

    // Add searchHint words
    if (tool.searchHint) {
      for (const word of tool.searchHint.toLowerCase().split(/\s+/)) {
        if (word.length > 1) keywords.add(word);
      }
    }

    return Array.from(keywords);
  }

  /**
   * Build full searchable text for a tool.
   */
  private buildSearchText(tool: Tool): string {
    const parts = [
      tool.name,
      tool.description,
      tool.searchHint ?? '',
      ...tool.aliases,
    ];
    return parts.join(' ').toLowerCase();
  }

  /**
   * Score how well a tool matches a query.
   */
  private scoreMatch(entry: ToolIndexEntry, queryWords: string[], fullQuery: string): number {
    let score = 0;
    const searchText = entry.searchText;

    // Exact name match (highest score)
    if (entry.tool.name.toLowerCase() === fullQuery) {
      score += 100;
    }

    // Name starts with query
    if (entry.tool.name.toLowerCase().startsWith(fullQuery)) {
      score += 80;
    }

    // Name contains query
    if (entry.tool.name.toLowerCase().includes(fullQuery)) {
      score += 60;
    }

    // SearchHint contains query
    if (entry.tool.searchHint?.toLowerCase().includes(fullQuery)) {
      score += 50;
    }

    // Keyword matching
    for (const queryWord of queryWords) {
      if (entry.keywords.includes(queryWord)) {
        score += 20;
      }
      if (searchText.includes(queryWord)) {
        score += 10;
      }
    }

    return score;
  }

  /**
   * Clear the search cache.
   */
  clearCache(): void {
    this.searchCache.clear();
  }
}

// Singleton instance
let _instance: ToolSearchIndex | null = null;

/**
 * Get the global ToolSearch index.
 */
export function getToolSearchIndex(): ToolSearchIndex {
  if (!_instance) {
    _instance = new ToolSearchIndex();
  }
  return _instance;
}

/**
 * Search tools using the global index.
 */
export function searchTools(query: string, tools?: Tool[], limit?: number): Tool[] {
  const index = getToolSearchIndex();
  if (tools) {
    index.indexTools(tools);
  }
  return index.searchTools(query, limit);
}

/**
 * Check if a tool should be deferred.
 */
export function shouldDeferTool(tool: Tool, activeToolNames: string[]): boolean {
  return getToolSearchIndex().shouldDeferTool(tool, activeToolNames);
}

/**
 * Get deferred tool schemas for prompt injection.
 */
export function getDeferredToolSchemas(tools: Tool[], maxTokens?: number): string[] {
  return getToolSearchIndex().getDeferredToolSchemas(tools, maxTokens);
}
