/**
 * Time-traveling Stream Rules
 * 
 * Allows rules to be injected mid-stream when patterns are detected.
 * Based on OMP's time-traveling stream rules feature.
 */

import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface StreamRule {
  id: string;
  name: string;
  pattern: RegExp;
  injection: string;
  priority: number;
  enabled: boolean;
  cooldownMs?: number;
  lastTriggered?: number;
}

export interface StreamRuleMatch {
  rule: StreamRule;
  match: RegExpMatchArray;
  position: number;
  timestamp: number;
}

export interface StreamRuleInjection {
  ruleId: string;
  ruleName: string;
  injection: string;
  matchPosition: number;
  timestamp: number;
}

// ============================================================================
// Stream Rules Manager
// ============================================================================

export class StreamRulesManager {
  private rules: Map<string, StreamRule> = new Map();
  private injections: StreamRuleInjection[] = [];
  private cooldowns: Map<string, number> = new Map();

  /**
   * Register a new stream rule
   */
  register(rule: Omit<StreamRule, 'id'>): string {
    const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullRule: StreamRule = { ...rule, id };
    this.rules.set(id, fullRule);
    
    if (rule.enabled) {
      logger.debug('[stream-rules] Registered rule', { id, name: rule.name });
    }
    
    return id;
  }

  /**
   * Unregister a stream rule
   */
  unregister(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * Enable/disable a rule
   */
  setEnabled(id: string, enabled: boolean): void {
    const rule = this.rules.get(id);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /**
   * Check if a stream chunk matches any rules
   */
  checkChunk(chunk: string, position: number): StreamRuleMatch[] {
    const matches: StreamRuleMatch[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Check cooldown
      if (rule.cooldownMs) {
        const lastTriggered = this.cooldowns.get(rule.id) || 0;
        if (now - lastTriggered < rule.cooldownMs) {
          continue;
        }
      }

      // Check pattern match
      const match = rule.pattern.exec(chunk);
      if (match) {
        matches.push({
          rule,
          match,
          position,
          timestamp: now,
        });

        // Update cooldown
        if (rule.cooldownMs) {
          this.cooldowns.set(rule.id, now);
        }
      }
    }

    return matches;
  }

  /**
   * Process matches and generate injections
   */
  processMatches(matches: StreamRuleMatch[]): StreamRuleInjection[] {
    const injections: StreamRuleInjection[] = [];

    // Sort by priority (higher = more important)
    const sortedMatches = matches.sort((a, b) => b.rule.priority - a.rule.priority);

    for (const match of sortedMatches) {
      const injection: StreamRuleInjection = {
        ruleId: match.rule.id,
        ruleName: match.rule.name,
        injection: match.rule.injection,
        matchPosition: match.position,
        timestamp: match.timestamp,
      };

      injections.push(injection);
      this.injections.push(injection);

      logger.debug('[stream-rules] Rule triggered', {
        ruleId: match.rule.id,
        ruleName: match.rule.name,
        position: match.position,
      });
    }

    return injections;
  }

  /**
   * Get all injections for a session
   */
  getInjections(): StreamRuleInjection[] {
    return [...this.injections];
  }

  /**
   * Clear injection history
   */
  clearInjections(): void {
    this.injections = [];
  }

  /**
   * Get all registered rules
   */
  getRules(): StreamRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get active rules
   */
  getActiveRules(): StreamRule[] {
    return Array.from(this.rules.values()).filter(r => r.enabled);
  }

  /**
   * Clear all rules
   */
  clear(): void {
    this.rules.clear();
    this.injections = [];
    this.cooldowns.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: StreamRulesManager | null = null;

export function getStreamRulesManager(): StreamRulesManager {
  if (!managerInstance) {
    managerInstance = new StreamRulesManager();
  }
  return managerInstance;
}

export function resetStreamRulesManager(): void {
  managerInstance = null;
}

// ============================================================================
// Built-in Rules
// ============================================================================

export function registerBuiltinStreamRules(): void {
  const manager = getStreamRulesManager();

  // Rule: Prevent Box::leak usage
  manager.register({
    name: 'prevent-box-leak',
    pattern: /Box::leak\(/g,
    injection: "Don't use Box::leak in production code paths. Use Arc or Rc for shared ownership instead.",
    priority: 100,
    enabled: true,
    cooldownMs: 60000, // 1 minute cooldown
  });

  // Rule: Prevent eval usage
  manager.register({
    name: 'prevent-eval',
    pattern: /\beval\s*\(/g,
    injection: "Avoid using eval() - it's a security risk. Use safer alternatives like Function constructor or dynamic imports.",
    priority: 90,
    enabled: true,
    cooldownMs: 60000,
  });

  // Rule: Prevent console.log in production
  manager.register({
    name: 'prevent-console-log',
    pattern: /console\.log\(/g,
    injection: "Remove console.log statements before committing. Use a proper logging library instead.",
    priority: 50,
    enabled: false, // Disabled by default
    cooldownMs: 30000,
  });

  // Rule: Prevent TODO/FIXME without issue reference
  manager.register({
    name: 'require-issue-ref',
    pattern: /(?:TODO|FIXME|HACK)(?:\s*\(.*?\))?\s*:/g,
    injection: "Add an issue reference to TODO/FIXME comments (e.g., TODO(#123): description)",
    priority: 30,
    enabled: false, // Disabled by default
    cooldownMs: 60000,
  });

  logger.debug('[stream-rules] Registered builtin rules');
}
