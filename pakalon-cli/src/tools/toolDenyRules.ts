/**
 * Tool Deny Rules
 *
 * Filtering tools by deny patterns. Allows defining rules that
 * prevent certain tools from being used based on patterns.
 *
 * Strategy:
 * 1. Define deny rules with patterns
 * 2. Match tools against patterns
 * 3. Support glob and regex patterns
 * 4. Allow rule priority and specificity
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolDenyRule {
  /** Unique rule ID */
  id: string;
  /** Rule name/description */
  name: string;
  /** Tool name pattern (glob supported) */
  toolPattern: string;
  /** Args pattern (optional, for more specific matching) */
  argsPattern?: Record<string, unknown>;
  /** Rule priority (higher = more important) */
  priority: number;
  /** Rule scope */
  scope: 'global' | 'project' | 'session';
  /** Whether rule is enabled */
  enabled: boolean;
  /** Rule description */
  description?: string;
  /** Rule metadata */
  metadata?: Record<string, unknown>;
}

export interface ToolDenyContext {
  /** Tool name */
  toolName: string;
  /** Tool arguments */
  args?: Record<string, unknown>;
  /** File path (if applicable) */
  filePath?: string;
  /** Session ID */
  sessionId?: string;
  /** Project directory */
  projectDir?: string;
}

export interface ToolDenyResult {
  /** Whether tool is denied */
  denied: boolean;
  /** Rule that caused denial */
  ruleId?: string;
  /** Rule name */
  ruleName?: string;
  /** Reason for denial */
  reason: string;
  /** All matching rules */
  matchingRules: ToolDenyRule[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a tool name matches a glob pattern.
 */
function matchesGlob(pattern: string, value: string): boolean {
  // Convert glob pattern to regex
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\[([^\]]+)\]/g, '[$1]');

  return new RegExp(`^${regex}$`, 'i').test(value);
}

/**
 * Check if args match a pattern.
 */
function matchesArgsPattern(
  pattern: Record<string, unknown>,
  args: Record<string, unknown>
): boolean {
  for (const [key, patternValue] of Object.entries(pattern)) {
    const argsValue = args[key];

    if (argsValue === undefined) {
      return false;
    }

    if (typeof patternValue === 'string') {
      if (typeof argsValue === 'string') {
        if (!matchesGlob(patternValue, argsValue)) {
          return false;
        }
      } else {
        return false;
      }
    } else if (typeof patternValue === 'object' && patternValue !== null) {
      if (typeof argsValue === 'object' && argsValue !== null) {
        if (!matchesArgsPattern(
          patternValue as Record<string, unknown>,
          argsValue as Record<string, unknown>
        )) {
          return false;
        }
      } else {
        return false;
      }
    } else if (patternValue !== argsValue) {
      return false;
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deny Rules Manager
// ─────────────────────────────────────────────────────────────────────────────

export class ToolDenyRulesManager {
  private rules: Map<string, ToolDenyRule> = new Map();

  constructor() {
    // Register default deny rules
    this.registerDefaultRules();
  }

  /**
   * Register a deny rule.
   */
  register(rule: ToolDenyRule): void {
    this.rules.set(rule.id, rule);
    logger.debug('[ToolDenyRules] Registered rule', {
      id: rule.id,
      name: rule.name,
      pattern: rule.toolPattern,
    });
  }

  /**
   * Unregister a deny rule.
   */
  unregister(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Get all rules.
   */
  getAll(): ToolDenyRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get rules by scope.
   */
  getByScope(scope: ToolDenyRule['scope']): ToolDenyRule[] {
    return Array.from(this.rules.values())
      .filter(rule => rule.scope === scope && rule.enabled);
  }

  /**
   * Check if a tool is denied.
   */
  checkDenied(context: ToolDenyContext): ToolDenyResult {
    const { toolName, args } = context;

    // Get applicable rules (sorted by priority)
    const applicableRules = Array.from(this.rules.values())
      .filter(rule => rule.enabled)
      .sort((a, b) => b.priority - a.priority);

    const matchingRules: ToolDenyRule[] = [];

    for (const rule of applicableRules) {
      // Check tool pattern
      if (!matchesGlob(rule.toolPattern, toolName)) {
        continue;
      }

      // Check args pattern if specified
      if (rule.argsPattern && args) {
        if (!matchesArgsPattern(rule.argsPattern, args)) {
          continue;
        }
      }

      matchingRules.push(rule);
    }

    if (matchingRules.length === 0) {
      return {
        denied: false,
        reason: 'No matching deny rules',
        matchingRules: [],
      };
    }

    // Use highest priority rule
    const topRule = matchingRules[0];

    return {
      denied: true,
      ruleId: topRule.id,
      ruleName: topRule.name,
      reason: `Denied by rule "${topRule.name}" (pattern: ${topRule.toolPattern})`,
      matchingRules,
    };
  }

  /**
   * Register default deny rules.
   */
  private registerDefaultRules(): void {
    // Block dangerous bash commands
    this.register({
      id: 'dangerous-bash-rm',
      name: 'Block dangerous rm commands',
      toolPattern: 'Bash',
      argsPattern: {
        command: /rm\s+-rf\s+\//,
      },
      priority: 100,
      scope: 'global',
      enabled: true,
      description: 'Blocks rm -rf / commands',
    });

    this.register({
      id: 'dangerous-bash-mkfs',
      name: 'Block filesystem formatting',
      toolPattern: 'Bash',
      argsPattern: {
        command: /mkfs/,
      },
      priority: 100,
      scope: 'global',
      enabled: true,
      description: 'Blocks mkfs commands',
    });

    this.register({
      id: 'dangerous-bash-dd',
      name: 'Block disk writes',
      toolPattern: 'Bash',
      argsPattern: {
        command: /dd\s+if=/,
      },
      priority: 100,
      scope: 'global',
      enabled: true,
      description: 'Blocks dd if= commands',
    });

    // Block writing to system directories
    this.register({
      id: 'system-dir-write',
      name: 'Block writing to system directories',
      toolPattern: 'Write',
      argsPattern: {
        filePath: /^\/(etc|var|usr|bin|sbin|lib|boot|dev|proc|sys)\//,
      },
      priority: 90,
      scope: 'global',
      enabled: true,
      description: 'Blocks writing to system directories',
    });

    logger.debug('[ToolDenyRules] Registered default rules');
  }

  /**
   * Clear all rules.
   */
  clear(): void {
    this.rules.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a tool deny rules manager.
 */
export function createToolDenyRulesManager(): ToolDenyRulesManager {
  return new ToolDenyRulesManager();
}

/**
 * Create a custom deny rule.
 */
export function createDenyRule(
  id: string,
  name: string,
  toolPattern: string,
  options: {
    argsPattern?: Record<string, unknown>;
    priority?: number;
    scope?: ToolDenyRule['scope'];
    description?: string;
  } = {}
): ToolDenyRule {
  return {
    id,
    name,
    toolPattern,
    ...options,
    priority: options.priority || 50,
    scope: options.scope || 'global',
    enabled: true,
  };
}

export default ToolDenyRulesManager;