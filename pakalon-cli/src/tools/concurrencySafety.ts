/**
 * Concurrency Safety Flag
 *
 * Marks tools as safe or unsafe for parallel execution. This prevents
 * race conditions when multiple tool calls are executed concurrently.
 *
 * Strategy:
 * 1. Define concurrency safety flags for tools
 * 2. Check flags before parallel execution
 * 3. Serialize unsafe tools automatically
 * 4. Support custom concurrency rules
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConcurrencySafetyOptions {
  /** Default concurrency safety (default: true) */
  defaultSafe?: boolean;
  /** Custom safety checker */
  customChecker?: (toolName: string, args?: Record<string, unknown>) => boolean;
  /** Whether to log safety checks (default: false) */
  logChecks?: boolean;
}

export interface ConcurrencySafetyRule {
  /** Tool name pattern (glob supported) */
  toolPattern: string;
  /** Whether tool is safe for concurrency */
  safe: boolean;
  /** Reason for safety/unsafety */
  reason?: string;
  /** Custom args checker */
  argsChecker?: (args: Record<string, unknown>) => boolean;
}

export interface ConcurrencySafetyResult {
  /** Whether tool is safe for concurrency */
  safe: boolean;
  /** Reason for safety/unsafety */
  reason: string;
  /** Rule that matched */
  rule?: ConcurrencySafetyRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a tool name matches a glob pattern.
 */
function matchesGlob(pattern: string, value: string): boolean {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\[([^\]]+)\]/g, '[$1]');

  return new RegExp(`^${regex}$`, 'i').test(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency Safety Manager
// ─────────────────────────────────────────────────────────────────────────────

export class ConcurrencySafetyManager {
  private rules: ConcurrencySafetyRule[] = [];
  private options: Required<ConcurrencySafetyOptions>;

  constructor(options: ConcurrencySafetyOptions = {}) {
    this.options = {
      defaultSafe: true,
      customChecker: () => true,
      logChecks: false,
      ...options,
    };

    // Register default rules
    this.registerDefaultRules();
  }

  /**
   * Register a concurrency safety rule.
   */
  register(rule: ConcurrencySafetyRule): void {
    this.rules.push(rule);
    logger.debug('[ConcurrencySafety] Registered rule', {
      pattern: rule.toolPattern,
      safe: rule.safe,
      reason: rule.reason,
    });
  }

  /**
   * Check if a tool is safe for concurrency.
   */
  check(toolName: string, args?: Record<string, unknown>): ConcurrencySafetyResult {
    // Find matching rule
    for (const rule of this.rules) {
      if (matchesGlob(rule.toolPattern, toolName)) {
        // Check args if checker exists
        if (rule.argsChecker && args) {
          const argsSafe = rule.argsChecker(args);
          if (!argsSafe) {
            return {
              safe: false,
              reason: rule.reason || `Tool ${toolName} is not safe with these arguments`,
              rule,
            };
          }
        }

        return {
          safe: rule.safe,
          reason: rule.reason || `Rule matched: ${rule.toolPattern}`,
          rule,
        };
      }
    }

    // No rule matched - use default
    const customSafe = this.options.customChecker(toolName, args);
    return {
      safe: customSafe && this.options.defaultSafe,
      reason: customSafe
        ? 'No rules matched, default safe'
        : 'Custom checker returned false',
    };
  }

  /**
   * Check multiple tools for concurrency safety.
   */
  checkMultiple(
    tools: Array<{ name: string; args?: Record<string, unknown> }>
  ): {
    safe: boolean;
    unsafeTools: string[];
    results: Map<string, ConcurrencySafetyResult>;
  } {
    const results = new Map<string, ConcurrencySafetyResult>();
    const unsafeTools: string[] = [];

    for (const tool of tools) {
      const result = this.check(tool.name, tool.args);
      results.set(tool.name, result);

      if (!result.safe) {
        unsafeTools.push(tool.name);
      }
    }

    return {
      safe: unsafeTools.length === 0,
      unsafeTools,
      results,
    };
  }

  /**
   * Partition tools into safe and unsafe groups.
   */
  partition(
    tools: Array<{ name: string; args?: Record<string, unknown> }>
  ): {
    safe: Array<{ name: string; args?: Record<string, unknown> }>;
    unsafe: Array<{ name: string; args?: Record<string, unknown> }>;
  } {
    const safe: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const unsafe: Array<{ name: string; args?: Record<string, unknown> }> = [];

    for (const tool of tools) {
      const result = this.check(tool.name, tool.args);
      if (result.safe) {
        safe.push(tool);
      } else {
        unsafe.push(tool);
      }
    }

    return { safe, unsafe };
  }

  /**
   * Register default concurrency safety rules.
   */
  private registerDefaultRules(): void {
    // Read-only tools are safe
    this.register({
      toolPattern: 'Read',
      safe: true,
      reason: 'Read-only tool',
    });

    this.register({
      toolPattern: 'Glob',
      safe: true,
      reason: 'Read-only tool',
    });

    this.register({
      toolPattern: 'Grep',
      safe: true,
      reason: 'Read-only tool',
    });

    this.register({
      toolPattern: 'WebSearch',
      safe: true,
      reason: 'Read-only tool',
    });

    this.register({
      toolPattern: 'WebFetch',
      safe: true,
      reason: 'Read-only tool',
    });

    this.register({
      toolPattern: 'LSP',
      safe: true,
      reason: 'Read-only tool',
    });

    this.register({
      toolPattern: 'lsp_*',
      safe: true,
      reason: 'Read-only tool',
    });

    // Write tools are unsafe
    this.register({
      toolPattern: 'Write',
      safe: false,
      reason: 'Write tool - file system mutation',
    });

    this.register({
      toolPattern: 'Edit',
      safe: false,
      reason: 'Edit tool - file system mutation',
    });

    // Bash is unsafe
    this.register({
      toolPattern: 'Bash',
      safe: false,
      reason: 'Bash tool - system mutation',
    });

    // TodoWrite is unsafe
    this.register({
      toolPattern: 'TodoWrite',
      safe: false,
      reason: 'TodoWrite tool - state mutation',
    });

    logger.debug('[ConcurrencySafety] Registered default rules');
  }

  /**
   * Clear all rules.
   */
  clear(): void {
    this.rules = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a concurrency safety manager.
 */
export function createConcurrencySafetyManager(
  options: ConcurrencySafetyOptions = {}
): ConcurrencySafetyManager {
  return new ConcurrencySafetyManager(options);
}

/**
 * Check if tools are safe for parallel execution.
 */
export function areToolsSafeForParallel(
  tools: Array<{ name: string; args?: Record<string, unknown> }>,
  options: ConcurrencySafetyOptions = {}
): boolean {
  const manager = createConcurrencySafetyManager(options);
  const { safe } = manager.checkMultiple(tools);
  return safe;
}

export default ConcurrencySafetyManager;