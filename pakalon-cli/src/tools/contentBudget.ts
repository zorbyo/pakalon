/**
 * Content Budget Manager
 *
 * Manages the budget for tool result content in conversations.
 * Prevents unbounded growth of tool results by enforcing limits on:
 *   - Total characters added per tool use
 *   - Total tool results kept in context
 *   - Priority-based eviction of low-value tool results
 *   - Budget carry-over across compaction cycles
 */

import type { ToolResultReplacement } from "./tool-types.js";
import { renderToolResultMessage } from "./toolRenderer.js";

// ============================================================================
// Types
// ============================================================================

export interface ContentBudgetConfig {
  /** Maximum tool use count in a single step */
  maxToolUsesPerStep: number;
  /** Maximum total tool result characters to keep in conversation */
  maxToolResultChars: number;
  /** Maximum number of tool results to track */
  maxToolResults: number;
  /** Default budget for a single tool result */
  defaultToolResultBudget: number;
  /** Additional budget for read-only tools */
  readOnlyToolBudget: number;
  /** Budget carry-over from previous compaction cycle (0-1 fraction) */
  budgetCarryOverFraction: number;
}

export interface ToolResultEntry {
  toolUseId: string;
  toolName: string;
  charCount: number;
  priority: number;
  timestamp: number;
  isError: boolean;
  content: string;
}

export interface ContentBudgetState {
  config: ContentBudgetConfig;
  entries: ToolResultEntry[];
  usedChars: number;
  usedTools: number;
  remainingBudget: number;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: ContentBudgetConfig = {
  maxToolUsesPerStep: 25,
  maxToolResultChars: 100_000,
  maxToolResults: 200,
  defaultToolResultBudget: 5_000,
  readOnlyToolBudget: 10_000,
  budgetCarryOverFraction: 0.5,
};

// ============================================================================
// Budget Manager
// ============================================================================

export class ContentBudgetManager {
  private state: ContentBudgetState;

  constructor(config?: Partial<ContentBudgetConfig>) {
    this.state = {
      config: { ...DEFAULT_CONFIG, ...config },
      entries: [],
      usedChars: 0,
      usedTools: 0,
      remainingBudget: DEFAULT_CONFIG.maxToolResultChars,
    };
  }

  /** Check whether adding a tool result would exceed budget. */
  canAddToolResult(
    toolName: string,
    result: unknown,
    currentStepToolCount: number,
  ): boolean {
    // Hard cap on tool uses per step
    if (currentStepToolCount >= this.state.config.maxToolUsesPerStep) {
      return false;
    }

    // Estimate the character count
    const estimatedChars = this.estimateCharCount(toolName, result);

    // Check total budget
    if (this.state.usedChars + estimatedChars > this.state.config.maxToolResultChars) {
      return false;
    }

    // Check total tool count
    if (this.state.entries.length >= this.state.config.maxToolResults) {
      return false;
    }

    return true;
  }

  /** Track a new tool result in the budget. */
  addToolResult(
    toolUseId: string,
    toolName: string,
    result: unknown,
  ): ToolResultEntry {
    const rendered = renderToolResultMessage(toolName, result);
    const charCount = rendered.length;
    const isReadOnly = this.isReadOnlyTool(toolName);
    const budget = isReadOnly
      ? this.state.config.readOnlyToolBudget
      : this.state.config.defaultToolResultBudget;
    const isError = result instanceof Error || (typeof result === "object" && result !== null && "error" in (result as Record<string, unknown>));

    const entry: ToolResultEntry = {
      toolUseId,
      toolName,
      charCount,
      priority: this.calculatePriority(toolName, isError),
      timestamp: Date.now(),
      isError,
      content: charCount > budget ? rendered.slice(0, budget) + "\n[truncated by budget]" : rendered,
    };

    this.state.entries.push(entry);
    this.state.usedChars += charCount;
    this.state.usedTools += 1;
    this.state.remainingBudget =
      this.state.config.maxToolResultChars - this.state.usedChars;

    return entry;
  }

  /** Compact budget: remove lowest-priority entries. */
  compact(targetFraction: number = 0.5): ToolResultReplacement[] {
    if (this.state.entries.length === 0) return [];

    const replacements: ToolResultReplacement[] = [];

    // Sort by priority (ascending) then by timestamp (oldest first)
    const sorted = [...this.state.entries].sort(
      (a, b) => a.priority - b.priority || a.timestamp - b.timestamp,
    );

    const targetChars = Math.floor(
      this.state.config.maxToolResultChars * (1 - targetFraction),
    );
    let charsToRemove = this.state.usedChars - targetChars;

    const removedIds = new Set<string>();

    for (const entry of sorted) {
      if (charsToRemove <= 0) break;
      if (entry.isError) continue; // Keep errors for debugging
      if (entry.priority >= 5) continue; // Keep high-priority entries

      removedIds.add(entry.toolUseId);
      charsToRemove -= entry.charCount;

      // Create a replacement: tiny placeholder
      replacements.push({
        originalText: entry.content,
        replacementText: `[${entry.toolName}: ${entry.charCount} chars — compacted]`,
        toolUseId: entry.toolUseId,
      });
    }

    // Update state
    this.state.entries = this.state.entries.filter(
      (e) => !removedIds.has(e.toolUseId),
    );
    this.state.usedChars = this.state.entries.reduce(
      (sum, e) => sum + e.charCount,
      0,
    );
    this.state.remainingBudget =
      this.state.config.maxToolResultChars - this.state.usedChars;

    // Carry over remaining budget fraction
    this.state.config.maxToolResultChars = Math.floor(
      this.state.config.maxToolResultChars * this.state.config.budgetCarryOverFraction,
    );

    return replacements;
  }

  /** Get the current state (snapshot). */
  getState(): ContentBudgetState {
    return { ...this.state, entries: [...this.state.entries] };
  }

  /** Reset budget entirely. */
  reset(): void {
    this.state = {
      config: { ...DEFAULT_CONFIG },
      entries: [],
      usedChars: 0,
      usedTools: 0,
      remainingBudget: DEFAULT_CONFIG.maxToolResultChars,
    };
  }

  // -- Private helpers --

  private estimateCharCount(toolName: string, result: unknown): number {
    try {
      return renderToolResultMessage(toolName, result).length;
    } catch {
      return 100; // fallback
    }
  }

  private isReadOnlyTool(toolName: string): boolean {
    const readOnlyPrefixes = [
      "read",
      "grep",
      "glob",
      "search",
      "list",
      "lsp",
      "view",
      "show",
    ];
    return readOnlyPrefixes.some((prefix) =>
      toolName.toLowerCase().startsWith(prefix),
    );
  }

  private calculatePriority(toolName: string, isError: boolean): number {
    if (isError) return 1; // low priority for errors
    if (this.isReadOnlyTool(toolName)) return 3; // medium for reads
    return 5; // high for writes
  }
}
