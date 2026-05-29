/**
 * Pakalon Hook Manager
 *
 * Core engine for executing hooks on tool events.
 * Port from ECC hooks system.
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  Hook,
  HookConfig,
  HookEvent,
  HookExecutionContext,
  HookEventPayload,
  HookResult,
  HookProfile,
  HookMatcher,
  ToolName,
} from './types.js';
import { HOME_DIR, PACKALON_CONFIG_DIR } from '../config/paths.js';

export class HookManager {
  private config: HookConfig;
  private context: HookExecutionContext;
  private sessionState: Map<string, unknown> = new Map();

  constructor(config?: HookConfig) {
    this.config = config || this.loadConfig();
    this.context = this.buildContext();
  }

  private loadConfig(): HookConfig {
    const configPath = join(PACKALON_CONFIG_DIR, 'hooks.json');
    if (existsSync(configPath)) {
      try {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        return this.getDefaultConfig();
      }
    }
    return this.getDefaultConfig();
  }

  private getDefaultConfig(): HookConfig {
    return {
      profile: process.env.PAKALON_HOOK_PROFILE as HookProfile || 'standard',
      disabled_hooks: process.env.PAKALON_DISABLED_HOOKS?.split(',') || [],
      hooks: {
        PreToolUse: [],
        PostToolUse: [],
        PostToolUseFailure: [],
        PreCompact: [],
        SessionStart: [],
        SessionEnd: [],
        Stop: [],
      },
    };
  }

  private buildContext(): HookExecutionContext {
    return {
      sessionId: process.env.PAKALON_SESSION_ID,
      workingDirectory: process.cwd(),
      environment: { ...process.env },
      hookProfile: this.config.profile || 'standard',
      disabledHooks: new Set(this.config.disabled_hooks || []),
    };
  }

  /**
   * Execute PreToolUse hooks before a tool runs
   */
  async executePreToolUse(
    toolName: ToolName,
    toolInput: Record<string, unknown>,
    extraContext?: Partial<HookExecutionContext>
  ): Promise<HookResult> {
    const payload: HookEventPayload = {
      event: 'PreToolUse',
      input: {
        tool_name: toolName,
        tool_input: toolInput as import('./types.js').ToolInputArgs,
      },
      context: { ...this.context, ...extraContext },
      startTime: Date.now(),
    };

    const matchers = this.config.hooks.PreToolUse || [];
    const result = await this.executeHooks(matchers, payload, true);

    if (!result.allowed) {
      return {
        allowed: false,
        blocked: true,
        error: result.error || 'Blocked by hook',
        warnings: result.warnings,
      };
    }

    return result;
  }

  /**
   * Execute PostToolUse hooks after a tool runs
   */
  async executePostToolUse(
    toolName: ToolName,
    toolInput: Record<string, unknown>,
    toolOutput: { output?: string; error?: string; exit_code?: number },
    extraContext?: Partial<HookExecutionContext>
  ): Promise<HookResult> {
    const payload: HookEventPayload = {
      event: 'PostToolUse',
      input: {
        tool_name: toolName,
        tool_input: toolInput as import('./types.js').ToolInputArgs,
        tool_output: toolOutput,
      },
      context: { ...this.context, ...extraContext },
      startTime: Date.now(),
    };

    const matchers = this.config.hooks.PostToolUse || [];
    return this.executeHooks(matchers, payload, false);
  }

  /**
   * Execute PostToolUseFailure hooks when a tool fails
   */
  async executePostToolUseFailure(
    toolName: ToolName,
    toolInput: Record<string, unknown>,
    error: string,
    extraContext?: Partial<HookExecutionContext>
  ): Promise<HookResult> {
    const payload: HookEventPayload = {
      event: 'PostToolUseFailure',
      input: {
        tool_name: toolName,
        tool_input: toolInput as import('./types.js').ToolInputArgs,
        tool_output: { error },
      },
      context: { ...this.context, ...extraContext },
      startTime: Date.now(),
    };

    const matchers = this.config.hooks.PostToolUseFailure || [];
    return this.executeHooks(matchers, payload, false);
  }

  /**
   * Execute PreCompact hooks before context compaction
   */
  async executePreCompact(
    extraContext?: Partial<HookExecutionContext>
  ): Promise<HookResult> {
    const payload: HookEventPayload = {
      event: 'PreCompact',
      input: {
        tool_name: 'Bash',
        tool_input: { command: 'compact' },
      },
      context: { ...this.context, ...extraContext },
      startTime: Date.now(),
    };

    const matchers = this.config.hooks.PreCompact || [];
    return this.executeHooks(matchers, payload, false);
  }

  /**
   * Execute SessionStart hooks when a session begins
   */
  async executeSessionStart(
    extraContext?: Partial<HookExecutionContext>
  ): Promise<HookResult> {
    const payload: HookEventPayload = {
      event: 'SessionStart',
      input: {
        tool_name: 'Bash',
        tool_input: { command: 'session:start' },
      },
      context: { ...this.context, ...extraContext },
      startTime: Date.now(),
    };

    const matchers = this.config.hooks.SessionStart || [];
    return this.executeHooks(matchers, payload, false);
  }

  /**
   * Execute SessionEnd hooks when a session ends
   */
  async executeSessionEnd(
    extraContext?: Partial<HookExecutionContext>
  ): Promise<HookResult> {
    const payload: HookEventPayload = {
      event: 'SessionEnd',
      input: {
        tool_name: 'Bash',
        tool_input: { command: 'session:end' },
      },
      context: { ...this.context, ...extraContext },
      startTime: Date.now(),
    };

    const matchers = this.config.hooks.SessionEnd || [];
    return this.executeHooks(matchers, payload, false);
  }

  /**
   * Execute Stop hooks after each response
   */
  async executeStop(
    extraContext?: Partial<HookExecutionContext>
  ): Promise<HookResult> {
    const payload: HookEventPayload = {
      event: 'Stop',
      input: {
        tool_name: 'Bash',
        tool_input: { command: 'stop' },
      },
      context: { ...this.context, ...extraContext },
      startTime: Date.now(),
    };

    const matchers = this.config.hooks.Stop || [];
    return this.executeHooks(matchers, payload, false);
  }

  /**
   * Execute all matching hooks for an event
   */
  private async executeHooks(
    matchers: HookMatcher[],
    payload: HookEventPayload,
    canBlock: boolean
  ): Promise<HookResult> {
    const allWarnings: string[] = [];
    let blocked = false;
    let error: string | undefined;

    for (const matcher of matchers) {
      if (!this.shouldRunMatcher(matcher, payload)) {
        continue;
      }

      for (const hook of matcher.hooks) {
        if (this.context.disabledHooks.has(hook.id)) {
          continue;
        }

        const hookResult = await this.executeHook(hook, payload);

        if (hookResult.warnings) {
          allWarnings.push(...hookResult.warnings);
        }

        if (hookResult.blocked && canBlock) {
          blocked = true;
          error = hookResult.error;
        }
      }
    }

    return {
      allowed: !blocked,
      blocked,
      error,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    };
  }

  /**
   * Check if a matcher should run for this payload
   */
  private shouldRunMatcher(matcher: HookMatcher, payload: HookEventPayload): boolean {
    if (matcher.matchers.length === 0) {
      return true;
    }

    for (const rule of matcher.matchers) {
      if (typeof rule === 'string') {
        if (this.matchRuleString(rule, payload)) {
          return true;
        }
      } else if (typeof rule === 'object') {
        if (this.matchRuleObject(rule, payload)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Match a string rule against the payload
   */
  private matchRuleString(rule: string, payload: HookEventPayload): boolean {
    // Handle wildcard
    if (rule === '*') {
      return true;
    }

    // Handle tool name matching
    if (rule === payload.input.tool_name) {
      return true;
    }

    // Handle OR patterns like "Edit|Write"
    if (rule.includes('|')) {
      const tools = rule.split('|');
      return tools.includes(payload.input.tool_name);
    }

    // Handle matcher expressions (simplified)
    if (rule.includes('==')) {
      const [key, value] = rule.split('==').map(s => s.trim());
      if (key === 'tool' && value === payload.input.tool_name) {
        return true;
      }
    }

    return false;
  }

  /**
   * Match an object rule against the payload
   */
  private matchRuleObject(
    rule: { tool?: ToolName | ToolName[]; tool_input?: Record<string, unknown> },
    payload: HookEventPayload
  ): boolean {
    if (rule.tool) {
      const tools = Array.isArray(rule.tool) ? rule.tool : [rule.tool];
      if (!tools.includes(payload.input.tool_name)) {
        return false;
      }
    }

    if (rule.tool_input) {
      for (const [key, value] of Object.entries(rule.tool_input)) {
        const inputValue = (payload.input.tool_input as Record<string, unknown>)?.[key];
        if (inputValue !== value) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Execute a single hook
   */
  private async executeHook(hook: Hook, payload: HookEventPayload): Promise<HookResult> {
    return new Promise((resolve) => {
      if (hook.type === 'function' && hook.function) {
        this.executeFunctionHook(hook.function, payload).then(resolve);
        return;
      }

      if (!hook.command) {
        resolve({ allowed: true });
        return;
      }

      const timeout = (hook.timeout || 30) * 1000;
      const child = spawn('node', ['-e', hook.command], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.context.environment },
        timeout,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutHandle);

        if (timedOut) {
          resolve({
            allowed: true,
            warnings: [`Hook ${hook.id} timed out after ${timeout}ms`],
          });
          return;
        }

        // Exit code 2 = block (PreToolUse only)
        // Exit code 0 = success/warning only
        // Other non-zero = error (logged but doesn't block)
        if (code === 2) {
          resolve({
            allowed: false,
            blocked: true,
            error: stderr || `Hook ${hook.id} blocked execution`,
          });
          return;
        }

        if (stderr && code !== 0) {
          resolve({
            allowed: true,
            warnings: stderr.split('\n').filter(Boolean),
          });
          return;
        }

        resolve({ allowed: true });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        resolve({
          allowed: true,
          warnings: [`Hook ${hook.id} error: ${err.message}`],
        });
      });

      // Send input as JSON to stdin
      child.stdin.write(JSON.stringify(payload.input));
      child.stdin.end();
    });
  }

  /**
   * Execute a function-based hook
   */
  private async executeFunctionHook(
    functionRef: string,
    payload: HookEventPayload
  ): Promise<HookResult> {
    try {
      // Function hooks are not implemented yet - placeholder for future
      return { allowed: true };
    } catch (error) {
      return {
        allowed: true,
        warnings: [`Function hook error: ${error}`],
      };
    }
  }

  /**
   * Set session state
   */
  setSessionState(key: string, value: unknown): void {
    this.sessionState.set(key, value);
  }

  /**
   * Get session state
   */
  getSessionState<T>(key: string): T | undefined {
    return this.sessionState.get(key) as T | undefined;
  }

  /**
   * Update config at runtime
   */
  updateConfig(updates: Partial<HookConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.profile) {
      this.context.hookProfile = updates.profile;
    }
    if (updates.disabled_hooks) {
      this.context.disabledHooks = new Set(updates.disabled_hooks);
    }
  }
}

// Singleton instance
let hookManagerInstance: HookManager | undefined;

export function getHookManager(config?: HookConfig): HookManager {
  if (!hookManagerInstance) {
    hookManagerInstance = new HookManager(config);
  }
  return hookManagerInstance;
}

export function resetHookManager(): void {
  hookManagerInstance = undefined;
}