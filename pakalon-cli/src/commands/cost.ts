/**
 * Cost & Usage Commands for Pakalon CLI
 * 
 * Track token usage, costs, and API consumption.
 */

import type { CommandContext, CommandResult } from "./types.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface CostEntry {
  timestamp: number;
  model: string;
  usage: TokenUsage;
  cost: number;
  operation?: string;
}

export interface UsageStats {
  total: TokenUsage;
  totalCost: number;
  byModel: Record<string, { usage: TokenUsage; cost: number; count: number }>;
  entries: CostEntry[];
  sessionStart: number;
}

// ---------------------------------------------------------------------------
// Pricing (per 1M tokens, in USD)
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }> = {
  // Claude models
  "claude-3-opus": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-3.5-sonnet": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-3-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
  "claude-3.5-haiku": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  
  // GPT models
  "gpt-4": { input: 30.0, output: 60.0 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "gpt-4o": { input: 5.0, output: 15.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  
  // Default fallback
  "default": { input: 3.0, output: 15.0 },
};

// ---------------------------------------------------------------------------
// Usage Tracking
// ---------------------------------------------------------------------------

const usageStats: UsageStats = {
  total: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  totalCost: 0,
  byModel: {},
  entries: [],
  sessionStart: Date.now(),
};

/**
 * Calculate cost for token usage
 */
export function calculateCost(model: string, usage: TokenUsage): number {
  // Normalize model name
  const normalizedModel = model.toLowerCase().replace(/[^a-z0-9.-]/g, "");
  const pricing = MODEL_PRICING[normalizedModel] ?? MODEL_PRICING["default"]!;
  
  let cost = 0;
  
  // Input tokens
  cost += (usage.inputTokens / 1_000_000) * pricing.input;
  
  // Output tokens
  cost += (usage.outputTokens / 1_000_000) * pricing.output;
  
  // Cache tokens (if applicable)
  if (usage.cacheReadTokens && pricing.cacheRead) {
    cost += (usage.cacheReadTokens / 1_000_000) * pricing.cacheRead;
  }
  if (usage.cacheWriteTokens && pricing.cacheWrite) {
    cost += (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWrite;
  }
  
  return cost;
}

/**
 * Record usage for a request
 */
export function recordUsage(model: string, usage: TokenUsage, operation?: string): CostEntry {
  const cost = calculateCost(model, usage);
  
  const entry: CostEntry = {
    timestamp: Date.now(),
    model,
    usage,
    cost,
    operation,
  };
  
  // Update totals
  usageStats.total.inputTokens += usage.inputTokens;
  usageStats.total.outputTokens += usage.outputTokens;
  usageStats.total.totalTokens += usage.totalTokens;
  usageStats.total.cacheReadTokens! += usage.cacheReadTokens ?? 0;
  usageStats.total.cacheWriteTokens! += usage.cacheWriteTokens ?? 0;
  usageStats.totalCost += cost;
  
  // Update by-model stats
  if (!usageStats.byModel[model]) {
    usageStats.byModel[model] = {
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: 0,
      count: 0,
    };
  }
  
  const modelStats = usageStats.byModel[model]!;
  modelStats.usage.inputTokens += usage.inputTokens;
  modelStats.usage.outputTokens += usage.outputTokens;
  modelStats.usage.totalTokens += usage.totalTokens;
  modelStats.cost += cost;
  modelStats.count++;
  
  // Store entry (keep last 1000)
  usageStats.entries.push(entry);
  if (usageStats.entries.length > 1000) {
    usageStats.entries = usageStats.entries.slice(-1000);
  }
  
  logger.debug(`[usage] Recorded: ${model} - ${usage.totalTokens} tokens - $${cost.toFixed(4)}`);
  
  return entry;
}

/**
 * Get current usage stats
 */
export function getUsageStats(): UsageStats {
  return { ...usageStats };
}

/**
 * Reset usage tracking
 */
export function resetUsage(): void {
  usageStats.total = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  usageStats.totalCost = 0;
  usageStats.byModel = {};
  usageStats.entries = [];
  usageStats.sessionStart = Date.now();
  
  logger.info("[usage] Stats reset");
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(2)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Command Implementations
// ---------------------------------------------------------------------------

export const costCommand = {
  name: "cost",
  aliases: ["price", "$"],
  description: "Show token costs for current session",
  usage: "/cost [--detail] [--reset]",
  category: "info" as const,
  
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const showDetail = args.includes("--detail") || args.includes("-d");
    const reset = args.includes("--reset") || args.includes("-r");
    
    if (reset) {
      resetUsage();
      return {
        success: true,
        message: "Usage stats reset",
      };
    }
    
    const stats = getUsageStats();
    const duration = Date.now() - stats.sessionStart;
    
    const lines: string[] = [];
    
    lines.push("╔══════════════════════════════════════╗");
    lines.push("║            Session Cost              ║");
    lines.push("╠══════════════════════════════════════╣");
    lines.push(`║  Total Cost:     ${formatCost(stats.totalCost).padStart(16)} ║`);
    lines.push(`║  Input Tokens:   ${formatTokens(stats.total.inputTokens).padStart(16)} ║`);
    lines.push(`║  Output Tokens:  ${formatTokens(stats.total.outputTokens).padStart(16)} ║`);
    lines.push(`║  Total Tokens:   ${formatTokens(stats.total.totalTokens).padStart(16)} ║`);
    lines.push(`║  Session Time:   ${formatDuration(duration).padStart(16)} ║`);
    lines.push("╚══════════════════════════════════════╝");
    
    if (showDetail && Object.keys(stats.byModel).length > 0) {
      lines.push("\nBreakdown by Model:");
      lines.push("─".repeat(40));
      
      for (const [model, modelStats] of Object.entries(stats.byModel)) {
        lines.push(`\n  ${model}:`);
        lines.push(`    Requests: ${modelStats.count}`);
        lines.push(`    Tokens: ${formatTokens(modelStats.usage.totalTokens)}`);
        lines.push(`    Cost: ${formatCost(modelStats.cost)}`);
      }
    }
    
    if (stats.total.cacheReadTokens! > 0 || stats.total.cacheWriteTokens! > 0) {
      lines.push("\nCache Usage:");
      lines.push(`  Read: ${formatTokens(stats.total.cacheReadTokens!)}`);
      lines.push(`  Write: ${formatTokens(stats.total.cacheWriteTokens!)}`);
    }
    
    return {
      success: true,
      message: lines.join("\n"),
      data: {
        totalCost: stats.totalCost,
        totalTokens: stats.total.totalTokens,
        sessionDuration: duration,
      },
    };
  },
};

export const usageCommand = {
  name: "usage",
  aliases: ["tokens"],
  description: "Show API usage statistics",
  usage: "/usage [--history] [--export]",
  category: "info" as const,
  
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const showHistory = args.includes("--history") || args.includes("-h");
    const exportData = args.includes("--export") || args.includes("-e");
    
    const stats = getUsageStats();
    
    if (exportData) {
      // Return as JSON for export
      return {
        success: true,
        message: JSON.stringify(stats, null, 2),
        data: stats,
      };
    }
    
    const lines: string[] = [];
    
    lines.push("[Chart] API Usage Statistics");
    lines.push("═".repeat(40));
    lines.push("");
    lines.push(`Input Tokens:  ${formatTokens(stats.total.inputTokens).padStart(10)}`);
    lines.push(`Output Tokens: ${formatTokens(stats.total.outputTokens).padStart(10)}`);
    lines.push(`Total Tokens:  ${formatTokens(stats.total.totalTokens).padStart(10)}`);
    lines.push("");
    lines.push(`API Calls: ${stats.entries.length}`);
    lines.push(`Est. Cost: ${formatCost(stats.totalCost)}`);
    
    if (showHistory && stats.entries.length > 0) {
      lines.push("\nRecent Requests:");
      lines.push("─".repeat(40));
      
      const recent = stats.entries.slice(-10).reverse();
      for (const entry of recent) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        lines.push(`  ${time} | ${entry.model} | ${formatTokens(entry.usage.totalTokens)} | ${formatCost(entry.cost)}`);
      }
    }
    
    return {
      success: true,
      message: lines.join("\n"),
    };
  },
};

export const statsCommand = {
  name: "stats",
  aliases: ["statistics"],
  description: "Show session statistics",
  usage: "/stats [--full]",
  category: "info" as const,
  
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const showFull = args.includes("--full") || args.includes("-f");
    
    const usage = getUsageStats();
    const messageCount = context.messages?.length ?? 0;
    const duration = Date.now() - usage.sessionStart;
    
    const lines: string[] = [];
    
    lines.push("[ChartUp] Session Statistics");
    lines.push("═".repeat(40));
    lines.push("");
    lines.push(`Messages: ${messageCount}`);
    lines.push(`Duration: ${formatDuration(duration)}`);
    lines.push(`API Calls: ${usage.entries.length}`);
    lines.push(`Total Tokens: ${formatTokens(usage.total.totalTokens)}`);
    lines.push(`Est. Cost: ${formatCost(usage.totalCost)}`);
    
    if (showFull) {
      lines.push("");
      lines.push("Model Usage:");
      lines.push("─".repeat(40));
      
      for (const [model, stats] of Object.entries(usage.byModel)) {
        const pct = usage.entries.length > 0
          ? ((stats.count / usage.entries.length) * 100).toFixed(1)
          : "0";
        lines.push(`  ${model}: ${stats.count} calls (${pct}%)`);
      }
      
      if (usage.total.cacheReadTokens! > 0) {
        lines.push("");
        lines.push("Cache Efficiency:");
        const cacheHitRate = usage.total.cacheReadTokens! / (usage.total.inputTokens || 1) * 100;
        lines.push(`  Cache Hit Rate: ${cacheHitRate.toFixed(1)}%`);
      }
    }
    
    return {
      success: true,
      message: lines.join("\n"),
      data: {
        messageCount,
        duration,
        apiCalls: usage.entries.length,
        totalTokens: usage.total.totalTokens,
        totalCost: usage.totalCost,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  costCommand,
  usageCommand,
  statsCommand,
  calculateCost,
  recordUsage,
  getUsageStats,
  resetUsage,
  MODEL_PRICING,
};
