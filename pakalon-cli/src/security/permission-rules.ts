/**
 * Enhanced Tool Permission Rules Engine — Rule-based permission system with denial tracking.
 *
 * Provides a comprehensive permission system:
 * - Rules by source (user, plugin, skill, system)
 * - Denial tracking with statistics
 * - Rate limiting per tool
 * - Budget enforcement
 * - Audit logging
 *
 * Port from Claude Code's permission patterns.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PermissionAction = "allow" | "deny" | "ask" | "rate-limit";

export type PermissionSource = "user" | "plugin" | "skill" | "system" | "default";

export type PermissionScope = "once" | "session" | "always" | "never";

export interface PermissionRule {
  /** Unique rule identifier */
  id: string;
  /** Rule name for display */
  name: string;
  /** Tool name pattern (supports wildcards) */
  toolPattern: string;
  /** Action to take */
  action: PermissionAction;
  /** Source that created this rule */
  source: PermissionSource;
  /** Scope of the rule */
  scope: PermissionScope;
  /** Rate limit (actions per minute) */
  rateLimit?: number;
  /** Budget limit (tokens per hour) */
  budgetLimit?: number;
  /** Conditions for the rule */
  conditions?: PermissionCondition[];
  /** Rule priority (higher = checked first) */
  priority: number;
  /** Whether the rule is enabled */
  enabled: boolean;
  /** When the rule was created */
  createdAt: Date;
  /** When the rule was last modified */
  modifiedAt: Date;
  /** Rule description */
  description?: string;
}

export interface PermissionCondition {
  /** Condition type */
  type: "time" | "directory" | "file-pattern" | "argument-pattern" | "user-input";
  /** Condition value */
  value: string;
  /** Negate the condition */
  negate?: boolean;
}

export interface PermissionRequest {
  /** Tool name */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Source of the request */
  source: PermissionSource;
  /** Session ID */
  sessionId?: string;
  /** Working directory */
  cwd?: string;
  /** Timestamp */
  timestamp: Date;
}

export interface PermissionDecision {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Action taken */
  action: PermissionAction;
  /** Rule that matched (if any) */
  matchedRule?: PermissionRule;
  /** Reason for the decision */
  reason: string;
  /** Rate limit info if rate-limited */
  rateLimitInfo?: {
    remaining: number;
    resetAt: Date;
    limit: number;
  };
  /** Budget info if budget-limited */
  budgetInfo?: {
    remaining: number;
    resetAt: Date;
    limit: number;
  };
}

export interface DenialRecord {
  /** Unique denial identifier */
  id: string;
  /** Tool name that was denied */
  toolName: string;
  /** Tool arguments at denial */
  args: Record<string, unknown>;
  /** Rule that caused the denial */
  ruleId: string;
  /** Reason for denial */
  reason: string;
  /** When the denial occurred */
  timestamp: Date;
  /** Session ID */
  sessionId?: string;
  /** User ID */
  userId?: string;
  /** Whether the denial was overridden */
  overridden: boolean;
  /** Override reason if overridden */
  overrideReason?: string;
}

export interface DenialStats {
  /** Total denials */
  totalDenials: number;
  /** Denials by tool */
  byTool: Map<string, number>;
  /** Denials by rule */
  byRule: Map<string, number>;
  /** Denials by source */
  bySource: Map<PermissionSource, number>;
  /** Recent denials (last 24h) */
  recentDenials: DenialRecord[];
  /** Top denied tools */
  topDeniedTools: Array<{ tool: string; count: number }>;
}

export interface RateLimitEntry {
  /** Tool name */
  toolName: string;
  /** Request timestamps */
  timestamps: Date[];
  /** Current count */
  count: number;
  /** Window start */
  windowStart: Date;
}

export interface BudgetEntry {
  /** Token usage */
  tokens: number;
  /** Window start */
  windowStart: Date;
  /** Last update */
  lastUpdate: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Permission Rules Engine
// ─────────────────────────────────────────────────────────────────────────────

export class PermissionRulesEngine {
  private rules: Map<string, PermissionRule> = new Map();
  private denials: DenialRecord[] = [];
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private budgets: Map<string, BudgetEntry> = new Map();
  private maxDenialHistory = 1000;

  /**
   * Add a permission rule.
   */
  addRule(rule: Omit<PermissionRule, "createdAt" | "modifiedAt">): PermissionRule {
    const fullRule: PermissionRule = {
      ...rule,
      createdAt: new Date(),
      modifiedAt: new Date(),
    };
    this.rules.set(fullRule.id, fullRule);
    logger.debug("[PermissionRules] Added rule", { id: fullRule.id, name: fullRule.name });
    return fullRule;
  }

  /**
   * Update an existing permission rule.
   */
  updateRule(id: string, updates: Partial<PermissionRule>): PermissionRule | null {
    const existing = this.rules.get(id);
    if (!existing) return null;

    const updated: PermissionRule = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      createdAt: existing.createdAt, // Prevent creation date change
      modifiedAt: new Date(),
    };
    this.rules.set(id, updated);
    logger.debug("[PermissionRules] Updated rule", { id });
    return updated;
  }

  /**
   * Remove a permission rule.
   */
  removeRule(id: string): boolean {
    const removed = this.rules.delete(id);
    if (removed) {
      logger.debug("[PermissionRules] Removed rule", { id });
    }
    return removed;
  }

  /**
   * Get all rules sorted by priority.
   */
  getRules(): PermissionRule[] {
    return Array.from(this.rules.values())
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get rules for a specific tool.
   */
  getRulesForTool(toolName: string): PermissionRule[] {
    return this.getRules().filter((rule) => 
      rule.enabled && this.matchToolPattern(toolName, rule.toolPattern)
    );
  }

  /**
   * Check permission for a tool request.
   */
  checkPermission(request: PermissionRequest): PermissionDecision {
    const matchingRules = this.getRulesForTool(request.toolName);

    for (const rule of matchingRules) {
      if (this.evaluateConditions(rule, request)) {
        // Check rate limiting
        if (rule.action === "rate-limit" && rule.rateLimit) {
          const rateLimitInfo = this.checkRateLimit(request.toolName, rule.rateLimit);
          if (rateLimitInfo.remaining <= 0) {
            return {
              allowed: false,
              action: "rate-limit",
              matchedRule: rule,
              reason: `Rate limit exceeded for ${request.toolName}`,
              rateLimitInfo,
            };
          }
        }

        // Check budget
        if (rule.budgetLimit) {
          const budgetInfo = this.checkBudget(request.toolName, rule.budgetLimit);
          if (budgetInfo.remaining <= 0) {
            return {
              allowed: false,
              action: "deny",
              matchedRule: rule,
              reason: `Budget limit exceeded for ${request.toolName}`,
              budgetInfo,
            };
          }
        }

        return {
          allowed: rule.action === "allow",
          action: rule.action,
          matchedRule: rule,
          reason: `Rule "${rule.name}" matched`,
        };
      }
    }

    // No rule matched - default to ask
    return {
      allowed: false,
      action: "ask",
      reason: "No matching permission rule",
    };
  }

  /**
   * Record a denial.
   */
  recordDenial(
    request: PermissionRequest,
    ruleId: string,
    reason: string
  ): DenialRecord {
    const denial: DenialRecord = {
      id: crypto.randomUUID(),
      toolName: request.toolName,
      args: request.args,
      ruleId,
      reason,
      timestamp: request.timestamp,
      sessionId: request.sessionId,
      overridden: false,
    };

    this.denials.push(denial);

    // Trim history if needed
    if (this.denials.length > this.maxDenialHistory) {
      this.denials = this.denials.slice(-this.maxDenialHistory);
    }

    logger.warn("[PermissionRules] Denial recorded", {
      tool: request.toolName,
      rule: ruleId,
      reason,
    });

    return denial;
  }

  /**
   * Override a denial.
   */
  overrideDenial(denialId: string, reason: string): boolean {
    const denial = this.denials.find((d) => d.id === denialId);
    if (!denial) return false;

    denial.overridden = true;
    denial.overrideReason = reason;
    logger.info("[PermissionRules] Denial overridden", {
      id: denialId,
      tool: denial.toolName,
      reason,
    });
    return true;
  }

  /**
   * Get denial statistics.
   */
  getDenialStats(): DenialStats {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const byTool = new Map<string, number>();
    const byRule = new Map<string, number>();
    const bySource = new Map<PermissionSource, number>();
    const recentDenials = this.denials.filter((d) => d.timestamp > oneDayAgo);

    for (const denial of this.denials) {
      byTool.set(denial.toolName, (byTool.get(denial.toolName) ?? 0) + 1);
      byRule.set(denial.ruleId, (byRule.get(denial.ruleId) ?? 0) + 1);
    }

    // Sort by count for top denied tools
    const topDeniedTools = Array.from(byTool.entries())
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalDenials: this.denials.length,
      byTool,
      byRule,
      bySource,
      recentDenials,
      topDeniedTools,
    };
  }

  /**
   * Clear denial history.
   */
  clearDenialHistory(): void {
    this.denials = [];
    logger.debug("[PermissionRules] Denial history cleared");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private matchToolPattern(toolName: string, pattern: string): boolean {
    // Exact match
    if (pattern === toolName) return true;

    // Wildcard match
    if (pattern === "*") return true;

    // Prefix match
    if (pattern.endsWith("*")) {
      return toolName.startsWith(pattern.slice(0, -1));
    }

    // Suffix match
    if (pattern.startsWith("*")) {
      return toolName.endsWith(pattern.slice(1));
    }

    // Contains match
    if (pattern.startsWith("*") && pattern.endsWith("*")) {
      return toolName.includes(pattern.slice(1, -1));
    }

    // OR pattern (pipe-separated)
    if (pattern.includes("|")) {
      return pattern.split("|").some((p) => this.matchToolPattern(toolName, p.trim()));
    }

    return false;
  }

  private evaluateConditions(rule: PermissionRule, request: PermissionRequest): boolean {
    if (!rule.conditions || rule.conditions.length === 0) return true;

    return rule.conditions.every((condition) => {
      let result = false;

      switch (condition.type) {
        case "directory":
          result = request.cwd?.includes(condition.value) ?? false;
          break;
        case "file-pattern":
          const filePath = request.args.file_path as string;
          result = filePath ? new RegExp(condition.value).test(filePath) : false;
          break;
        case "argument-pattern":
          const argStr = JSON.stringify(request.args);
          result = new RegExp(condition.value).test(argStr);
          break;
        case "time":
          const hour = new Date().getHours();
          const timeParts = condition.value.split("-").map(Number);
          const startHour = timeParts[0] ?? 0;
          const endHour = timeParts[1] ?? 24;
          result = hour >= startHour && hour < endHour;
          break;
        default:
          result = false;
      }

      return condition.negate ? !result : result;
    });
  }

  private checkRateLimit(toolName: string, limit: number): { remaining: number; resetAt: Date; limit: number } {
    const now = new Date();
    const windowMs = 60 * 1000; // 1 minute window

    let entry = this.rateLimits.get(toolName);
    if (!entry) {
      entry = {
        toolName,
        timestamps: [],
        count: 0,
        windowStart: now,
      };
      this.rateLimits.set(toolName, entry);
    }

    // Clean old timestamps
    entry.timestamps = entry.timestamps.filter(
      (t) => now.getTime() - t.getTime() < windowMs
    );
    entry.count = entry.timestamps.length;

    const remaining = Math.max(0, limit - entry.count);
    const resetAt = new Date(entry.windowStart.getTime() + windowMs);

    return { remaining, resetAt, limit };
  }

  private recordRateLimitUsage(toolName: string): void {
    const entry = this.rateLimits.get(toolName);
    if (entry) {
      entry.timestamps.push(new Date());
      entry.count = entry.timestamps.length;
    }
  }

  private checkBudget(toolName: string, limit: number): { remaining: number; resetAt: Date; limit: number } {
    const now = new Date();
    const windowMs = 60 * 60 * 1000; // 1 hour window

    let entry = this.budgets.get(toolName);
    if (!entry) {
      entry = {
        tokens: 0,
        windowStart: now,
        lastUpdate: now,
      };
      this.budgets.set(toolName, entry);
    }

    // Reset if window expired
    if (now.getTime() - entry.windowStart.getTime() > windowMs) {
      entry.tokens = 0;
      entry.windowStart = now;
    }

    const remaining = Math.max(0, limit - entry.tokens);
    const resetAt = new Date(entry.windowStart.getTime() + windowMs);

    return { remaining, resetAt, limit };
  }

  /**
   * Record token usage for budget tracking.
   */
  recordTokenUsage(toolName: string, tokens: number): void {
    const entry = this.budgets.get(toolName);
    if (entry) {
      entry.tokens += tokens;
      entry.lastUpdate = new Date();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let engineInstance: PermissionRulesEngine | null = null;

/**
 * Get the singleton permission rules engine.
 */
export function getPermissionRulesEngine(): PermissionRulesEngine {
  if (!engineInstance) {
    engineInstance = new PermissionRulesEngine();
  }
  return engineInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetPermissionRulesEngine(): void {
  engineInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create default permission rules.
 */
export function createDefaultRules(): PermissionRule[] {
  const now = new Date();
  return [
    {
      id: "system-read",
      name: "Allow Read Operations",
      toolPattern: "Read|readFile|read",
      action: "allow",
      source: "system",
      scope: "always",
      priority: 100,
      enabled: true,
      createdAt: now,
      modifiedAt: now,
      description: "Allow all read operations",
    },
    {
      id: "system-glob",
      name: "Allow Glob Operations",
      toolPattern: "Glob|globFind",
      action: "allow",
      source: "system",
      scope: "always",
      priority: 100,
      enabled: true,
      createdAt: now,
      modifiedAt: now,
      description: "Allow all glob operations",
    },
    {
      id: "system-grep",
      name: "Allow Grep Operations",
      toolPattern: "Grep|grepSearch",
      action: "allow",
      source: "system",
      scope: "always",
      priority: 100,
      enabled: true,
      createdAt: now,
      modifiedAt: now,
      description: "Allow all grep operations",
    },
    {
      id: "system-web",
      name: "Allow Web Search",
      toolPattern: "webSearch|WebFetch|websearch_web_search_exa",
      action: "allow",
      source: "system",
      scope: "always",
      priority: 90,
      enabled: true,
      createdAt: now,
      modifiedAt: now,
      description: "Allow web search and fetch",
    },
    {
      id: "system-lsp",
      name: "Allow LSP Operations",
      toolPattern: "lsp*",
      action: "allow",
      source: "system",
      scope: "always",
      priority: 90,
      enabled: true,
      createdAt: now,
      modifiedAt: now,
      description: "Allow all LSP operations",
    },
    {
      id: "system-todo",
      name: "Allow Todo Operations",
      toolPattern: "TodoWrite|TaskList",
      action: "allow",
      source: "system",
      scope: "always",
      priority: 80,
      enabled: true,
      createdAt: now,
      modifiedAt: now,
      description: "Allow todo/task operations",
    },
    {
      id: "dangerous-bash",
      name: "Rate Limit Bash",
      toolPattern: "Bash|bash",
      action: "rate-limit",
      source: "system",
      scope: "session",
      rateLimit: 30, // 30 per minute
      priority: 50,
      enabled: true,
      createdAt: now,
      modifiedAt: now,
      description: "Rate limit bash commands",
    },
    {
      id: "dangerous-write",
      name: "Ask for Write Operations",
      toolPattern: "Write|writeFile|Edit|editFile|MultiEdit",
      action: "ask",
      source: "system",
      scope: "session",
      priority: 40,
      enabled: true,
      createdAt: now,
      modifiedAt: now,
      description: "Ask before write/edit operations",
    },
    {
      id: "dangerous-delete",
      name: "Ask for Delete Operations",
      toolPattern: "deleteFile|rm",
      action: "ask",
      source: "system",
      scope: "session",
      priority: 60,
      enabled: true,
      createdAt: now,
      modifiedAt: now,
      description: "Ask before delete operations",
    },
  ];
}

/**
 * Initialize the permission rules engine with default rules.
 */
export function initializePermissionRules(): PermissionRulesEngine {
  const engine = getPermissionRulesEngine();
  const defaultRules = createDefaultRules();
  
  for (const rule of defaultRules) {
    engine.addRule(rule);
  }

  logger.info("[PermissionRules] Initialized with default rules", {
    ruleCount: defaultRules.length,
  });

  return engine;
}
