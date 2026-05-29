/**
 * Tool Confirmation & Auto-Approve System
 *
 * Manages when tools need user confirmation before execution, and
 * provides auto-approve capability for trusted tools and patterns.
 *
 * Rules are checked in order:
 *   1. Always deny → block immediately
 *   2. Always allow → skip confirmation
 *   3. Session permission → use cached decision
 *   4. Pattern match → check against pattern rules
 *   5. Ask user → require confirmation
 */

import type { ToolPermissionRulesBySource, PermissionMode } from "./tool-types.js";

// ============================================================================
// Types
// ============================================================================

export interface ConfirmationState {
  /** Pending confirmations waiting for user response */
  pendingConfirmations: Map<string, PendingConfirmation>;
  /** Tool-level allow counts (toolName → count of remaining auto-allows) */
  autoAllowCounts: Map<string, number>;
  /** Session-level remember decisions */
  sessionDecisions: Map<string, boolean>;
}

export interface PendingConfirmation {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  startedAt: number;
  mode: PermissionMode;
  safetyCheckId?: string;
}

export interface ConfirmationConfig {
  /** Max pending confirmations before rejecting new ones */
  maxPending: number;
  /** Timeout for pending confirmations (ms) */
  confirmationTimeout: number;
  /** Auto-allow count for newly trusted tools */
  defaultAutoAllowCount: number;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: ConfirmationConfig = {
  maxPending: 5,
  confirmationTimeout: 120_000, // 2 minutes
  defaultAutoAllowCount: 3,
};

// ============================================================================
// Confirmation Manager
// ============================================================================

export class ConfirmationManager {
  private state: ConfirmationState;
  private config: ConfirmationConfig;
  private alwaysDenyRules: ToolPermissionRulesBySource;
  private alwaysAllowRules: ToolPermissionRulesBySource;

  constructor(config?: Partial<ConfirmationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      pendingConfirmations: new Map(),
      autoAllowCounts: new Map(),
      sessionDecisions: new Map(),
    };
    this.alwaysDenyRules = {};
    this.alwaysAllowRules = {};
  }

  /** Update the permission rules. */
  setRules(allow: ToolPermissionRulesBySource, deny: ToolPermissionRulesBySource): void {
    this.alwaysAllowRules = allow;
    this.alwaysDenyRules = deny;
  }

  /**
   * Determine the confirmation level for a tool call.
   *
   * Returns:
   *   - 'blocked' — tool cannot run (always deny rule matched)
   *   - 'allowed' — tool can run without confirmation
   *   - 'confirm' — tool needs user confirmation first
   */
  resolveConfirmationLevel(
    toolName: string,
    args: Record<string, unknown>,
    mode: PermissionMode,
  ): 'blocked' | 'allowed' | 'confirm' {
    // In YOLO/bypass mode, everything is allowed
    if (mode === 'bypassPermissions' || mode === 'auto') {
      return 'allowed';
    }

    // Check deny rules
    if (this.matchesAnyRule(toolName, args, this.alwaysDenyRules)) {
      return 'blocked';
    }

    // Check allow rules
    if (this.matchesAnyRule(toolName, args, this.alwaysAllowRules)) {
      return 'allowed';
    }

    // Check session cache
    const sessionKey = this.buildSessionKey(toolName, args);
    const cached = this.state.sessionDecisions.get(sessionKey);
    if (cached !== undefined) {
      return cached ? 'allowed' : 'blocked';
    }

    // Check auto-allow counts
    const remainingAllows = this.state.autoAllowCounts.get(toolName);
    if (remainingAllows !== undefined && remainingAllows > 0) {
      this.state.autoAllowCounts.set(toolName, remainingAllows - 1);
      return 'allowed';
    }

    // Otherwise, require confirmation
    return 'confirm';
  }

  /** Create a pending confirmation entry. */
  createPendingConfirmation(
    toolName: string,
    args: Record<string, unknown>,
    mode: PermissionMode,
    safetyCheckId?: string,
  ): PendingConfirmation | null {
    if (this.state.pendingConfirmations.size >= this.config.maxPending) {
      return null; // Too many pending
    }

    // Clean up stale confirmations
    this.cleanStaleConfirmations();

    const id = `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry: PendingConfirmation = {
      id,
      toolName,
      args,
      startedAt: Date.now(),
      mode,
      safetyCheckId,
    };

    this.state.pendingConfirmations.set(id, entry);
    return entry;
  }

  /** Resolve a pending confirmation (user responded). */
  resolveConfirmation(id: string, allowed: boolean): PendingConfirmation | undefined {
    const entry = this.state.pendingConfirmations.get(id);
    if (!entry) return undefined;

    this.state.pendingConfirmations.delete(id);
    this.state.sessionDecisions.set(
      this.buildSessionKey(entry.toolName, entry.args),
      allowed,
    );

    return entry;
  }

  /** Mark a tool as auto-approved for N more uses. */
  setAutoAllowCount(toolName: string, count: number): void {
    this.state.autoAllowCounts.set(toolName, count);
  }

  /** Get auto-allow count for a tool (remaining). */
  getAutoAllowCount(toolName: string): number {
    return this.state.autoAllowCounts.get(toolName) ?? 0;
  }

  /** Clear all session decisions. */
  clearSessionDecisions(): void {
    this.state.sessionDecisions.clear();
  }

  /** Get pending confirmation count. */
  get pendingCount(): number {
    return this.state.pendingConfirmations.size;
  }

  /** Get all pending confirmations. */
  get pendingConfirmations(): PendingConfirmation[] {
    return Array.from(this.state.pendingConfirmations.values());
  }

  // -- Private helpers --

  private cleanStaleConfirmations(): void {
    const now = Date.now();
    for (const [id, entry] of this.state.pendingConfirmations) {
      if (now - entry.startedAt > this.config.confirmationTimeout) {
        // Auto-reject stale confirmations
        this.state.sessionDecisions.set(
          this.buildSessionKey(entry.toolName, entry.args),
          false,
        );
        this.state.pendingConfirmations.delete(id);
      }
    }
  }

  private matchesAnyRule(
    toolName: string,
    args: Record<string, unknown>,
    rules: ToolPermissionRulesBySource,
  ): boolean {
    if (!rules) return false;

    for (const source of Object.keys(rules)) {
      const sourceRules = rules[source as keyof ToolPermissionRulesBySource];
      if (!sourceRules || !Array.isArray(sourceRules)) continue;

      for (const rule of sourceRules) {
        if (this.matchesRule(toolName, args, rule)) return true;
      }
    }

    return false;
  }

  private matchesRule(
    toolName: string,
    args: Record<string, unknown>,
    rule: string,
  ): boolean {
    // Exact tool name match
    if (rule === toolName) return true;

    // Wildcard: "tool.*" matches "tool.read", "tool.write", etc.
    if (rule.endsWith(".*")) {
      const prefix = rule.slice(0, -2);
      if (toolName.startsWith(prefix)) return true;
    }

    // Argument-sensitive: "tool.args.key=value"
    if (rule.includes(".")) {
      const dotIndex = rule.indexOf(".");
      const ruleTool = rule.slice(0, dotIndex);
      const rest = rule.slice(dotIndex + 1);

      if (ruleTool !== toolName) return false;

      if (rest.startsWith("args.")) {
        const argPath = rest.slice(5);
        const eqIndex = argPath.indexOf("=");
        if (eqIndex === -1) return false;

        const argKey = argPath.slice(0, eqIndex);
        const argValue = argPath.slice(eqIndex + 1);

        const actualValue = this.getNestedArg(args, argKey);
        return String(actualValue) === argValue;
      }
    }

    return false;
  }

  private getNestedArg(
    args: Record<string, unknown>,
    path: string,
  ): unknown {
    const parts = path.split(".");
    let current: unknown = args;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private buildSessionKey(toolName: string, args: Record<string, unknown>): string {
    // Create a simplified key for caching decisions
    const simplifiedKeys = ["command", "file", "path", "url", "package"];
    const relevantArgs = simplifiedKeys
      .filter((k) => k in args)
      .map((k) => `${k}=${args[k]}`)
      .join(",");

    return `${toolName}:${relevantArgs}`;
  }
}
