/**
 * Permission Rules Engine — Allow/deny/ask rules for tool permissions.
 *
 * Implements Claude Code-style permission rules:
 * - Rules can be defined by source: CLI flags, session config, frontmatter, plugins
 * - Rules support pattern matching on tool names and arguments
 * - Rules cascade: more specific rules override general ones
 * - Denial tracking for observability
 *
 * Usage:
 *   const engine = new PermissionRulesEngine();
 *   engine.addRule({ source: "cli", tool: "bash", action: "allow", pattern: "git" });
 *   engine.addRule({ source: "session", tool: "bash", action: "deny", pattern: "rm" });
 *
 *   const result = await engine.evaluate("bash", { command: "git status" });
 *   // → { decision: "allow", rule: {...}, source: "cli" }
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RuleAction = "allow" | "deny" | "ask";
export type RuleSource = "cli" | "session" | "frontmatter" | "plugin" | "builtin";

export interface PermissionRule {
  /** Unique rule ID */
  id: string;
  /** Where the rule came from */
  source: RuleSource;
  /** Tool name to match (e.g., "bash", "writeFile", "*" for all) */
  tool: string;
  /** Action to take */
  action: RuleAction;
  /** Optional command/arg pattern (regex string) */
  pattern?: string;
  /** Compiled regex from pattern */
  patternRegex?: RegExp;
  /** Human-readable reason for the rule */
  reason?: string;
  /** Priority (higher = overrides lower). Default: 100 */
  priority?: number;
  /** Whether this rule was stripped due to dangerous patterns */
  stripped?: boolean;
}

export interface RuleEvaluationResult {
  /** Final decision */
  decision: RuleAction;
  /** The rule that matched (if any) */
  matchedRule?: PermissionRule;
  /** All rules that were considered */
  considered: PermissionRule[];
  /** Whether the result was a fallback (no rule matched) */
  fallback: boolean;
}

export interface DenialTrackingState {
  /** Tool name */
  toolName: string;
  /** When the denial happened */
  timestamp: Date;
  /** The rule/context that caused the denial */
  reason: string;
  /** The args that were being evaluated */
  args?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source Priority (higher source priority = overrides lower)
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_PRIORITY: Record<RuleSource, number> = {
  cli: 100,
  session: 80,
  frontmatter: 60,
  plugin: 40,
  builtin: 20,
};

// ─────────────────────────────────────────────────────────────────────────────
// Danger Patterns (rules matching these should be flagged)
// ─────────────────────────────────────────────────────────────────────────────

const DANGER_PATTERNS = [
  /^\s*rm\s+-rf\s+\/\s*$/,
  /^\s*rm\s+-rf\s+\/\s*\*\s*/,
  /^\s*chmod\s+777\s+/,
  /^\s*chown\s+.*:.*\s+\/\s*/,
  /^\s*dd\s+if=\/dev\/zero/,
  /^\s*>(\s|\/dev)/,
  /^\s*:\s*>\s*/,
  /^\s*eval\s+/,
  /^\s*curl.*\||^\s*wget.*\||powershell.*-Command\s+.*Invoke-Expression/,
];

// ─────────────────────────────────────────────────────────────────────────────
// Rules Engine
// ─────────────────────────────────────────────────────────────────────────────

export class PermissionRulesEngine {
  private rules: PermissionRule[] = [];
  private denialLog: DenialTrackingState[] = [];
  private maxDenialLog = 100;
  private defaultAction: RuleAction = "ask";

  constructor(defaultAction?: RuleAction) {
    if (defaultAction) this.defaultAction = defaultAction;
  }

  /**
   * Add a permission rule.
   */
  addRule(rule: Omit<PermissionRule, "id">): PermissionRule {
    const fullRule: PermissionRule = {
      ...rule,
      id: crypto.randomUUID(),
      patternRegex: rule.pattern ? new RegExp(rule.pattern, "i") : undefined,
      priority: rule.priority ?? SOURCE_PRIORITY[rule.source],
    };

    // Check if this rule matches a known danger pattern
    const stripped = this.checkDangerPattern(fullRule);
    if (stripped) {
      fullRule.stripped = true;
      logger.warn("[PermRules] Rule stripped due to danger pattern", {
        id: fullRule.id,
        tool: fullRule.tool,
        pattern: fullRule.pattern,
      });
      return fullRule; // Still return it so caller knows it was stripped
    }

    this.rules.push(fullRule);
    this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    logger.debug("[PermRules] Rule added", {
      id: fullRule.id,
      source: fullRule.source,
      tool: fullRule.tool,
      action: fullRule.action,
    });

    return fullRule;
  }

  /**
   * Remove a rule by ID.
   */
  removeRule(ruleId: string): boolean {
    const index = this.rules.findIndex((r) => r.id === ruleId);
    if (index === -1) return false;
    this.rules.splice(index, 1);
    return true;
  }

  /**
   * Remove all rules from a source.
   */
  removeRulesBySource(source: RuleSource): number {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.source !== source);
    return before - this.rules.length;
  }

  /**
   * Clear all rules.
   */
  clearRules(): void {
    this.rules = [];
  }

  /**
   * Get all rules.
   */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  /**
   * Get rules by source.
   */
  getRulesBySource(source: RuleSource): PermissionRule[] {
    return this.rules.filter((r) => r.source === source);
  }

  /**
   * Evaluate a tool call against all rules.
   * Returns the first matching rule (sorted by priority).
   * Falls back to defaultAction if no rule matches.
   */
  evaluate(
    toolName: string,
    args?: Record<string, unknown>,
  ): RuleEvaluationResult {
    const considered: PermissionRule[] = [];

    for (const rule of this.rules) {
      if (rule.stripped) continue;

      // Check tool match
      if (rule.tool !== "*" && rule.tool.toLowerCase() !== toolName.toLowerCase()) {
        continue;
      }

      considered.push(rule);

      // Check pattern match if rule has a pattern
      if (rule.pattern && rule.patternRegex) {
        const command = this.extractCommand(toolName, args);
        if (!command || !rule.patternRegex.test(command)) {
          continue;
        }
      }

      // Rule matched
      logger.debug("[PermRules] Rule matched", {
        ruleId: rule.id,
        tool: toolName,
        action: rule.action,
        source: rule.source,
      });

      return {
        decision: rule.action,
        matchedRule: rule,
        considered,
        fallback: false,
      };
    }

    // No rule matched — use default
    return {
      decision: this.defaultAction,
      considered,
      fallback: true,
    };
  }

  /**
   * Quick check if a tool is allowed (all rules considered).
   */
  isAllowed(toolName: string, args?: Record<string, unknown>): boolean {
    const result = this.evaluate(toolName, args);
    return result.decision === "allow";
  }

  /**
   * Quick check if a tool is denied (all rules considered).
   */
  isDenied(toolName: string, args?: Record<string, unknown>): boolean {
    const result = this.evaluate(toolName, args);
    return result.decision === "deny";
  }

  /**
   * Log a denial for tracking/auditing.
   */
  logDenial(toolName: string, reason: string, args?: Record<string, unknown>): void {
    const entry: DenialTrackingState = {
      toolName,
      timestamp: new Date(),
      reason,
      args,
    };

    this.denialLog.push(entry);
    if (this.denialLog.length > this.maxDenialLog) {
      this.denialLog.shift();
    }
  }

  /**
   * Get denial history.
   */
  getDenialLog(): DenialTrackingState[] {
    return [...this.denialLog];
  }

  /**
   * Get denial count for a specific tool.
   */
  getDenialCount(toolName: string): number {
    return this.denialLog.filter((d) => d.toolName === toolName).length;
  }

  /**
   * Parse CLI --allow-tool and --deny-tool flags into rules.
   */
  parseCliFlags(
    allowTools?: string[],
    denyTools?: string[],
  ): PermissionRule[] {
    const parsed: PermissionRule[] = [];

    for (const spec of allowTools ?? []) {
      const parsedRule = this.parseToolSpec(spec, "allow");
      if (parsedRule) {
        const rule = this.addRule({ ...parsedRule, source: "cli" });
        parsed.push(rule);
      }
    }

    for (const spec of denyTools ?? []) {
      const parsedRule = this.parseToolSpec(spec, "deny");
      if (parsedRule) {
        const rule = this.addRule({ ...parsedRule, source: "cli" });
        parsed.push(rule);
      }
    }

    return parsed;
  }

  /**
   * Parse a tool spec string like "bash(git)" or "writeFile".
   */
  private parseToolSpec(
    spec: string,
    action: RuleAction,
  ): Omit<PermissionRule, "id" | "source"> | null {
    // Check for pattern: tool(pattern)
    const match = spec.match(/^(\w+)\((.+)\)$/);
    if (match) {
      return {
        tool: match[1]!,
        action,
        pattern: match[2],
        reason: `${action}ed by CLI flag: ${spec}`,
      };
    }

    // Simple: tool name only
    return {
      tool: spec,
      action,
      reason: `${action}ed by CLI flag: ${spec}`,
    };
  }

  /**
   * Check if a rule matches a known danger pattern and should be flagged.
   */
  private checkDangerPattern(rule: PermissionRule): boolean {
    if (rule.action !== "allow" || !rule.pattern) return false;

    for (const danger of DANGER_PATTERNS) {
      if (danger.test(rule.pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract the command string from tool arguments.
   */
  private extractCommand(
    toolName: string,
    args?: Record<string, unknown>,
  ): string | undefined {
    if (!args) return undefined;

    const lower = toolName.toLowerCase();

    if (lower === "bash" || lower === "powershell") {
      if (typeof args.command === "string") return args.command;
    }

    if (lower === "writefile" || lower === "editfile" || lower === "readfile") {
      if (typeof args.filePath === "string") return args.filePath;
      if (typeof args.path === "string") return args.path;
    }

    return undefined;
  }
}
