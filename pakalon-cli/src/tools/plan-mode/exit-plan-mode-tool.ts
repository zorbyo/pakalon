/**
 * ExitPlanModeTool
 *
 * Tool to exit plan mode and present the plan for user approval.
 * When approved, the user can proceed with implementation.
 */

import { writeFile } from 'fs/promises';
import { z } from 'zod';
import {
  buildTool,
  type Tool,
  type ToolDef,
  toolMatchesName,
} from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { EXIT_PLAN_MODE_TOOL_NAME } from './constants.js';
import { EXIT_PLAN_MODE_TOOL_PROMPT } from './prompt.js';

const allowedPromptSchema = lazySchema(() =>
  z.object({
    tool: z.enum(['Bash']).describe('The tool this prompt applies to'),
    prompt: z
      .string()
      .describe(
        'Semantic description of the action, e.g. "run tests", "install dependencies"',
      ),
  }),
);

export type AllowedPrompt = z.infer<ReturnType<typeof allowedPromptSchema>>;

const inputSchema = lazySchema(() =>
  z
    .strictObject({
      allowedPrompts: z
        .array(allowedPromptSchema())
        .optional()
        .describe(
          'Prompt-based permissions needed to implement the plan. These describe categories of actions rather than specific commands.',
        ),
    })
    .passthrough(),
);

type InputSchema = ReturnType<typeof inputSchema>;

export const _sdkInputSchema = lazySchema(() =>
  inputSchema().extend({
    plan: z
      .string()
      .optional()
      .describe('The plan content (injected by normalizeToolInput from disk)'),
    planFilePath: z
      .string()
      .optional()
      .describe('The plan file path (injected by normalizeToolInput)'),
  }),
);

export const outputSchema = lazySchema(() =>
  z.object({
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
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

const AGENT_TOOL_NAME = 'Agent';

export const ExitPlanModeTool: Tool<InputSchema, Output> = buildTool({
  name: EXIT_PLAN_MODE_TOOL_NAME,
  searchHint: 'present plan for approval and start coding (plan mode only)',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Prompts the user to exit plan mode and start coding';
  },
  async prompt() {
    return EXIT_PLAN_MODE_TOOL_PROMPT;
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return '';
  },
  shouldDefer: true,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return false;
  },
  requiresUserInteraction() {
    return true;
  },
  async validateInput(_input, { getAppState }) {
    const mode = getAppState().toolPermissionContext.mode;
    if (mode !== 'plan') {
      return {
        result: false,
        message:
          'You are not in plan mode. This tool is only for exiting plan mode after writing a plan. If your plan was already approved, continue with implementation.',
        errorCode: 1,
      };
    }
    return { result: true };
  },
  async checkPermissions(input, context) {
    return {
      behavior: 'ask' as const,
      message: 'Exit plan mode?',
      updatedInput: input,
    };
  },
  async call(input, context) {
    const isAgent = !!context.agentId;
    const inputPlan =
      'plan' in input && typeof input.plan === 'string' ? input.plan : undefined;
    const plan = inputPlan ?? null;

    if (inputPlan !== undefined) {
      const filePath = input.planFilePath;
      if (filePath) {
        await writeFile(filePath, inputPlan, 'utf-8').catch(() => {});
      }
    }

    const appState = context.getAppState();
    const restoreMode = appState.toolPermissionContext.prePlanMode ?? 'default';

    context.setAppState(prev => {
      if (prev.toolPermissionContext.mode !== 'plan') return prev;
      return {
        ...prev,
        toolPermissionContext: {
          ...prev.toolPermissionContext,
          mode: restoreMode as 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto' | 'bubble',
          prePlanMode: undefined,
        },
      };
    });

    const hasTaskTool = context.options.tools.some(t =>
      toolMatchesName(t, AGENT_TOOL_NAME),
    );

    return {
      data: {
        plan,
        isAgent,
        filePath: input.planFilePath,
        hasTaskTool: hasTaskTool || undefined,
        planWasEdited: inputPlan !== undefined || undefined,
      },
    };
  },
  mapToolResultToToolResultBlockParam(
    { isAgent, plan, filePath, hasTaskTool, planWasEdited },
    toolUseID,
  ) {
    if (isAgent) {
      return {
        type: 'tool_result',
        content:
          'User has approved the plan. There is nothing else needed from you now. Please respond with "ok"',
        tool_use_id: toolUseID,
      };
    }

    if (!plan || plan.trim() === '') {
      return {
        type: 'tool_result',
        content: 'User has approved exiting plan mode. You can now proceed.',
        tool_use_id: toolUseID,
      };
    }

    const teamHint = hasTaskTool
      ? '\n\nIf this plan can be broken down into multiple independent tasks, consider using the Agent tool to create a team and parallelize the work.'
      : '';

    const planLabel = planWasEdited
      ? 'Approved Plan (edited by user)'
      : 'Approved Plan';

    return {
      type: 'tool_result',
      content: `User has approved your plan. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: ${filePath}
You can refer back to it if needed during implementation.${teamHint}

## ${planLabel}:
${plan}`,
      tool_use_id: toolUseID,
    };
  },
} satisfies ToolDef<InputSchema, Output>);