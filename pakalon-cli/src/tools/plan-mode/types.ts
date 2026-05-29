/**
 * Plan Mode Types
 *
 * Type definitions for plan mode tools and state management.
 */

import type { z } from 'zod';

/**
 * Allowed prompt schema for semantic permission requests in plan mode.
 * These describe categories of actions rather than specific commands.
 */
export const allowedPromptSchema = z.object({
  tool: z.enum(['Bash']).describe('The tool this prompt applies to'),
  prompt: z
    .string()
    .describe(
      'Semantic description of the action, e.g. "run tests", "install dependencies"',
    ),
});

export type AllowedPrompt = z.infer<typeof allowedPromptSchema>;

/**
 * Input schema for EnterPlanModeTool - no parameters needed
 */
export const enterPlanModeInputSchema = z.strictObject({});

export type EnterPlanModeInput = z.infer<typeof enterPlanModeInputSchema>;

/**
 * Output schema for EnterPlanModeTool
 */
export const enterPlanModeOutputSchema = z.object({
  message: z.string().describe('Confirmation that plan mode was entered'),
});

export type EnterPlanModeOutput = z.infer<typeof enterPlanModeOutputSchema>;

/**
 * Input schema for ExitPlanModeTool
 */
export const exitPlanModeInputSchema = z
  .strictObject({
    allowedPrompts: z
      .array(allowedPromptSchema)
      .optional()
      .describe(
        'Prompt-based permissions needed to implement the plan. These describe categories of actions rather than specific commands.',
      ),
  })
  .passthrough();

export type ExitPlanModeInput = z.infer<typeof exitPlanModeInputSchema>;

/**
 * SDK-facing input schema for ExitPlanModeTool - includes fields injected by normalizeToolInput
 */
export const exitPlanModeSdkInputSchema = exitPlanModeInputSchema.extend({
  plan: z
    .string()
    .optional()
    .describe('The plan content (injected by normalizeToolInput from disk)'),
  planFilePath: z
    .string()
    .optional()
    .describe('The plan file path (injected by normalizeToolInput)'),
});

export type ExitPlanModeSdkInput = z.infer<typeof exitPlanModeSdkInputSchema>;

/**
 * Output schema for ExitPlanModeTool
 */
export const exitPlanModeOutputSchema = z.object({
  plan: z
    .string()
    .nullable()
    .describe('The plan that was presented to the user'),
  isAgent: z.boolean(),
  filePath: z
    .string()
    .optional()
    .describe('The file path where the plan was saved'),
  hasTaskTool: z
    .boolean()
    .optional()
    .describe('Whether the Agent tool is available in the current context'),
  planWasEdited: z
    .boolean()
    .optional()
    .describe(
      'True when the user edited the plan (CCR web UI or Ctrl+G); determines whether the plan is echoed back in tool_result',
    ),
  awaitingLeaderApproval: z
    .boolean()
    .optional()
    .describe(
      'When true, the teammate has sent a plan approval request to the team leader',
    ),
  requestId: z
    .string()
    .optional()
    .describe('Unique identifier for the plan approval request'),
});

export type ExitPlanModeOutput = z.infer<typeof exitPlanModeOutputSchema>;