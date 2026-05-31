/**
 * Hook Schemas
 * 
 * Defines hook-related schema definitions for the plugin system.
 * Supports command, prompt, HTTP, and agent hook types.
 * 
 * This module breaks circular dependencies between settings/types.ts
 * and plugins/schemas.ts by providing shared schema definitions.
 */

import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Hook Event Types
// ---------------------------------------------------------------------------

export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Error',
  'Notification',
] as const;

export type HookEvent = typeof HOOK_EVENTS[number];

// ---------------------------------------------------------------------------
// Shell Types
// ---------------------------------------------------------------------------

export const SHELL_TYPES = ['bash', 'powershell', 'zsh', 'sh'] as const;
export type ShellType = typeof SHELL_TYPES[number];

// ---------------------------------------------------------------------------
// Hook Schemas
// ---------------------------------------------------------------------------

/**
 * Base schema for all hook types
 */
const BaseHookSchema = z.object({
  if: z
    .string()
    .optional()
    .describe(
      'Permission rule syntax to filter when this hook runs (e.g., "Bash(git *)"). ' +
      'Only runs if the tool call matches the pattern.'
    ),
  timeout: z
    .number()
    .positive()
    .optional()
    .describe('Timeout in seconds for this specific hook'),
  statusMessage: z
    .string()
    .optional()
    .describe('Custom status message to display while hook runs'),
  once: z
    .boolean()
    .optional()
    .describe('If true, hook runs once and is removed after execution'),
});

/**
 * Command hook schema (shell commands)
 */
export const BashCommandHookSchema = BaseHookSchema.extend({
  type: z.literal('command').describe('Shell command hook type'),
  command: z.string().describe('Shell command to execute'),
  shell: z
    .enum(SHELL_TYPES)
    .optional()
    .describe(
      "Shell interpreter. 'bash' uses your $SHELL; 'powershell' uses pwsh. Defaults to bash."
    ),
  async: z
    .boolean()
    .optional()
    .describe('If true, hook runs in background without blocking'),
  asyncRewake: z
    .boolean()
    .optional()
    .describe(
      'If true, hook runs in background and wakes the model on exit code 2.'
    ),
});

export type BashCommandHook = z.infer<typeof BashCommandHookSchema>;

/**
 * Prompt hook schema (LLM prompts)
 */
export const PromptHookSchema = BaseHookSchema.extend({
  type: z.literal('prompt').describe('LLM prompt hook type'),
  prompt: z
    .string()
    .describe(
      'Prompt to evaluate with LLM. Use $ARGUMENTS placeholder for hook input JSON.'
    ),
  model: z
    .string()
    .optional()
    .describe(
      'Model to use for this prompt hook (e.g., "claude-sonnet-4-6").'
    ),
});

export type PromptHook = z.infer<typeof PromptHookSchema>;

/**
 * HTTP hook schema (webhooks)
 */
export const HttpHookSchema = BaseHookSchema.extend({
  type: z.literal('http').describe('HTTP hook type'),
  url: z.string().url().describe('URL to POST the hook input JSON to'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Additional headers to include in the request. Values may reference environment variables.'
    ),
  allowedEnvVars: z
    .array(z.string())
    .optional()
    .describe(
      'Explicit list of environment variable names that may be interpolated in header values.'
    ),
});

export type HttpHook = z.infer<typeof HttpHookSchema>;

/**
 * Agent hook schema (agentic verifiers)
 */
export const AgentHookSchema = BaseHookSchema.extend({
  type: z.literal('agent').describe('Agentic verifier hook type'),
  prompt: z
    .string()
    .describe(
      'Prompt describing what to verify (e.g. "Verify that unit tests ran and passed.").'
    ),
  model: z
    .string()
    .optional()
    .describe('Model to use for this agent hook.'),
});

export type AgentHook = z.infer<typeof AgentHookSchema>;

/**
 * Combined hook command schema
 */
export const HookCommandSchema = z.discriminatedUnion('type', [
  BashCommandHookSchema,
  PromptHookSchema,
  AgentHookSchema,
  HttpHookSchema,
]);

export type HookCommand = z.infer<typeof HookCommandSchema>;

/**
 * Hook matcher schema (pattern + hooks)
 */
export const HookMatcherSchema = z.object({
  matcher: z
    .string()
    .optional()
    .describe('String pattern to match (e.g. tool names like "Write")'),
  hooks: z
    .array(HookCommandSchema)
    .describe('List of hooks to execute when the matcher matches'),
});

export type HookMatcher = z.infer<typeof HookMatcherSchema>;

/**
 * Full hooks configuration schema
 * Key = hook event, Value = array of matcher configurations
 */
export const HooksSchema = z.partialRecord(
  z.enum(HOOK_EVENTS),
  z.array(HookMatcherSchema)
);

export type HooksSettings = Partial<Record<HookEvent, HookMatcher[]>>;

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a hook command
 */
export function validateHookCommand(command: unknown): { valid: boolean; error?: string } {
  const result = HookCommandSchema.safeParse(command);
  if (result.success) {
    return { valid: true };
  }
  return {
    valid: false,
    error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '),
  };
}

/**
 * Validate hooks configuration
 */
export function validateHooksConfig(config: unknown): { valid: boolean; error?: string } {
  const result = HooksSchema.safeParse(config);
  if (result.success) {
    return { valid: true };
  }
  return {
    valid: false,
    error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '),
  };
}

/**
 * Check if a hook should run based on the if condition
 */
export function shouldRunHook(
  hook: HookCommand,
  toolName: string,
  toolInput: Record<string, unknown>
): boolean {
  if (!hook.if) return true;

  // Simple pattern matching: "Bash(git *)" matches "Bash" tool with "git" prefix
  const match = hook.if.match(/^(\w+)\((.+)\)$/);
  if (!match) return true;

  const [, patternTool, patternArg] = match;
  if (patternTool !== toolName) return false;

  // Simple wildcard matching
  const argStr = JSON.stringify(toolInput);
  const regex = new RegExp(
    '^' + patternArg.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );
  return regex.test(argStr);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a hook command for display
 */
export function formatHookCommand(hook: HookCommand): string {
  switch (hook.type) {
    case 'command':
      return `Command: ${hook.command}`;
    case 'prompt':
      return `Prompt: ${hook.prompt.slice(0, 50)}...`;
    case 'http':
      return `HTTP: ${hook.url}`;
    case 'agent':
      return `Agent: ${hook.prompt.slice(0, 50)}...`;
    default:
      return 'Unknown hook type';
  }
}

/**
 * Format hooks configuration for display
 */
export function formatHooksConfig(config: HooksSettings): string {
  const lines: string[] = ['Hooks Configuration:', ''];
  for (const [event, matchers] of Object.entries(config)) {
    if (matchers && matchers.length > 0) {
      lines.push(`${event}:`);
      for (const matcher of matchers) {
        if (matcher.matcher) {
          lines.push(`  Matcher: ${matcher.matcher}`);
        }
        for (const hook of matcher.hooks) {
          lines.push(`    - ${formatHookCommand(hook)}`);
        }
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  HOOK_EVENTS,
  SHELL_TYPES,
  BashCommandHookSchema,
  PromptHookSchema,
  HttpHookSchema,
  AgentHookSchema,
  HookCommandSchema,
  HookMatcherSchema,
  HooksSchema,
  validateHookCommand,
  validateHooksConfig,
  shouldRunHook,
  formatHookCommand,
  formatHooksConfig,
};
