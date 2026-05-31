/**
 * Time-Traveling Stream Rules (TTSR)
 * 
 * Your rules sit dormant until the model goes off-script. A regex match
 * aborts the stream mid-token, injects the rule as a system reminder,
 * and retries from the same point. You get course-correction without
 * paying context tax on every turn. Injections survive compaction,
 * so the fix sticks.
 * 
 * Features:
 * - Trigger: regex on text, thinking, or tool streams
 * - Cost: 0 tokens until match
 * - Modes: interrupt, repeat, context
 * - Persistence: survives compaction
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreamType = 'text' | 'thinking' | 'tool';
export type InjectionMode = 'interrupt' | 'repeat' | 'context';

export interface StreamRule {
  id: string;
  name: string;
  description: string;
  pattern: RegExp;
  streamType: StreamType;
  mode: InjectionMode;
  injection: string; // System reminder to inject
  enabled: boolean;
  priority: number; // Higher = checked first
  maxMatches?: number; // Limit matches per session
  cooldownMs?: number; // Minimum time between matches
  tags: string[];
}

export interface StreamRuleMatch {
  ruleId: string;
  position: number;
  matchedText: string;
  timestamp: number;
  injected: boolean;
}

export interface StreamRuleState {
  ruleId: string;
  matchCount: number;
  lastMatchTime: number;
  totalInjections: number;
}

export interface StreamInterceptResult {
  intercepted: boolean;
  rule?: StreamRule;
  match?: StreamRuleMatch;
  injection?: string;
}

// ---------------------------------------------------------------------------
// Rule Manager
// ---------------------------------------------------------------------------

export class StreamRuleManager {
  private rules: Map<string, StreamRule> = new Map();
  private state: Map<string, StreamRuleState> = new Map();
  private sessionMatches: StreamRuleMatch[] = [];

  /**
   * Register a stream rule
   */
  registerRule(rule: StreamRule): void {
    this.rules.set(rule.id, rule);
    this.state.set(rule.id, {
      ruleId: rule.id,
      matchCount: 0,
      lastMatchTime: 0,
      totalInjections: 0,
    });
  }

  /**
   * Unregister a stream rule
   */
  unregisterRule(id: string): void {
    this.rules.delete(id);
    this.state.delete(id);
  }

  /**
   * Get all registered rules
   */
  getRules(): StreamRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get rule by ID
   */
  getRule(id: string): StreamRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Check stream content against all rules
   */
  checkStream(
    content: string,
    streamType: StreamType,
    position: number
  ): StreamInterceptResult {
    // Get applicable rules sorted by priority
    const applicableRules = Array.from(this.rules.values())
      .filter(r => r.enabled && r.streamType === streamType)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of applicableRules) {
      // Check cooldown
      const ruleState = this.state.get(rule.id);
      if (ruleState) {
        if (rule.cooldownMs && Date.now() - ruleState.lastMatchTime < rule.cooldownMs) {
          continue; // Skip if in cooldown
        }
        if (rule.maxMatches && ruleState.matchCount >= rule.maxMatches) {
          continue; // Skip if max matches reached
        }
      }

      // Check pattern
      const match = rule.pattern.exec(content);
      if (match) {
        const matchResult: StreamRuleMatch = {
          ruleId: rule.id,
          position: position + match.index,
          matchedText: match[0],
          timestamp: Date.now(),
          injected: false,
        };

        // Update state
        if (ruleState) {
          ruleState.matchCount++;
          ruleState.lastMatchTime = Date.now();
        }

        this.sessionMatches.push(matchResult);

        return {
          intercepted: true,
          rule,
          match: matchResult,
          injection: rule.injection,
        };
      }
    }

    return { intercepted: false };
  }

  /**
   * Mark a match as injected
   */
  markInjected(matchId: string): void {
    const match = this.sessionMatches.find(m => m.ruleId === matchId);
    if (match) {
      match.injected = true;
      const state = this.state.get(matchId);
      if (state) {
        state.totalInjections++;
      }
    }
  }

  /**
   * Get session matches
   */
  getSessionMatches(): StreamRuleMatch[] {
    return [...this.sessionMatches];
  }

  /**
   * Get rule state
   */
  getRuleState(ruleId: string): StreamRuleState | undefined {
    return this.state.get(ruleId);
  }

  /**
   * Clear session matches
   */
  clearSessionMatches(): void {
    this.sessionMatches = [];
  }

  /**
   * Enable/disable a rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /**
   * Update rule pattern
   */
  updateRulePattern(ruleId: string, pattern: RegExp): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.pattern = pattern;
    }
  }
}

// ---------------------------------------------------------------------------
// Stream Interceptor
// ---------------------------------------------------------------------------

export class StreamInterceptor {
  private manager: StreamRuleManager;
  private buffer: string = '';
  private bufferSize: number = 1000; // Characters to keep in buffer

  constructor(manager?: StreamRuleManager) {
    this.manager = manager || new StreamRuleManager();
  }

  /**
   * Process stream chunk
   */
  processChunk(
    chunk: string,
    streamType: StreamType,
    currentPosition: number
  ): {
    approved: string;
    intercepted: boolean;
    injection?: string;
  } {
    // Add to buffer
    this.buffer += chunk;

    // Keep buffer size manageable
    if (this.buffer.length > this.bufferSize * 2) {
      this.buffer = this.buffer.slice(-this.bufferSize);
    }

    // Check for rule matches
    const result = this.manager.checkStream(this.buffer, streamType, currentPosition);

    if (result.intercepted && result.match && result.injection) {
      // Find where the match occurred in the buffer
      const matchIndex = this.buffer.indexOf(result.match.matchedText);
      
      if (matchIndex >= 0) {
        // Split content at match point
        const beforeMatch = this.buffer.slice(0, matchIndex);
        const afterMatch = this.buffer.slice(matchIndex + result.match.matchedText.length);

        // Mark as injected
        this.manager.markInjected(result.rule!.id);

        // Clear buffer
        this.buffer = afterMatch;

        return {
          approved: beforeMatch,
          intercepted: true,
          injection: result.injection,
        };
      }
    }

    // No interception - approve the chunk
    const approved = this.buffer;
    this.buffer = '';
    return { approved, intercepted: false };
  }

  /**
   * Flush remaining buffer
   */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    return remaining;
  }

  /**
   * Get rule manager
   */
  getManager(): StreamRuleManager {
    return this.manager;
  }
}

// ---------------------------------------------------------------------------
// Built-in Rules
// ---------------------------------------------------------------------------

export const DEFAULT_RULES: StreamRule[] = [
  {
    id: 'no-secrets',
    name: 'No Secrets',
    description: 'Prevent accidental secret exposure',
    pattern: /(?:password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]+['"]/gi,
    streamType: 'text',
    mode: 'interrupt',
    injection: 'SECURITY REMINDER: Never output hardcoded secrets, passwords, or API keys. Use environment variables or secure vaults instead.',
    enabled: true,
    priority: 100,
    tags: ['security', 'critical'],
  },
  {
    id: 'no-eval',
    name: 'No Eval',
    description: 'Prevent use of eval()',
    pattern: /eval\s*\(/g,
    streamType: 'text',
    mode: 'interrupt',
    injection: 'SECURITY REMINDER: Do not use eval(). Use safer alternatives like Function constructor, JSON.parse, or specific parsers.',
    enabled: true,
    priority: 90,
    tags: ['security'],
  },
  {
    id: 'no-console-log',
    name: 'No Console.log',
    description: 'Warn about console.log in production',
    pattern: /console\.log\(/g,
    streamType: 'text',
    mode: 'context',
    injection: 'STYLE REMINDER: Remove console.log statements before committing. Use proper logging libraries for production code.',
    enabled: true,
    priority: 50,
    tags: ['style'],
  },
  {
    id: 'prefer-const',
    name: 'Prefer Const',
    description: 'Encourage const over let/var',
    pattern: /\blet\s+\w+\s*=/g,
    streamType: 'text',
    mode: 'context',
    injection: 'STYLE REMINDER: Prefer const for variables that are not reassigned. Use let only when reassignment is needed.',
    enabled: false, // Disabled by default
    priority: 30,
    tags: ['style'],
  },
];

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const streamRuleToolDefinition = {
  name: 'stream_rules',
  description: 'Manage stream rules for time-traveling course correction',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'remove', 'enable', 'disable', 'test'],
        description: 'Action to perform',
      },
      rule: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          pattern: { type: 'string', description: 'Regex pattern as string' },
          streamType: { type: 'string', enum: ['text', 'thinking', 'tool'] },
          mode: { type: 'string', enum: ['interrupt', 'repeat', 'context'] },
          injection: { type: 'string', description: 'System reminder to inject' },
          priority: { type: 'number' },
        },
      },
      testContent: { type: 'string', description: 'Content to test against rules' },
    },
    required: ['action'],
  },
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input: { action: string; rule?: any; testContent?: string }) {
    const manager = new StreamRuleManager();
    
    // Load default rules
    for (const rule of DEFAULT_RULES) {
      manager.registerRule(rule);
    }

    switch (input.action) {
      case 'list': {
        const rules = manager.getRules();
        return {
          count: rules.length,
          rules: rules.map(r => ({
            id: r.id,
            name: r.name,
            enabled: r.enabled,
            pattern: r.pattern.source,
            streamType: r.streamType,
            mode: r.mode,
            priority: r.priority,
          })),
        };
      }

      case 'add': {
        if (!input.rule) {
          return { error: 'Rule definition required' };
        }
        const newRule: StreamRule = {
          id: input.rule.id || `rule-${Date.now()}`,
          name: input.rule.name || 'Custom Rule',
          description: input.rule.description || '',
          pattern: new RegExp(input.rule.pattern),
          streamType: input.rule.streamType || 'text',
          mode: input.rule.mode || 'interrupt',
          injection: input.rule.injection || '',
          enabled: true,
          priority: input.rule.priority || 50,
          tags: [],
        };
        manager.registerRule(newRule);
        return { success: true, ruleId: newRule.id };
      }

      case 'test': {
        if (!input.testContent) {
          return { error: 'Test content required' };
        }
        const interceptor = new StreamInterceptor(manager);
        const result = interceptor.processChunk(input.testContent, 'text', 0);
        return {
          intercepted: result.intercepted,
          injection: result.injection,
          approved: result.approved,
        };
      }

      default:
        return { error: `Unknown action: ${input.action}` };
    }
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  StreamRuleManager,
  StreamInterceptor,
  DEFAULT_RULES,
  streamRuleToolDefinition,
};
