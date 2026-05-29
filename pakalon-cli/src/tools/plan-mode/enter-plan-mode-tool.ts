/**
 * EnterPlanModeTool
 *
 * Tool to enter plan mode for reviewing proposed changes before applying them.
 * In plan mode, all file modification and shell command tools are blocked.
 * Only read-only tools like Read, Glob, Grep, WebSearch, and WebFetch are allowed.
 */

import { z } from 'zod';
import {
  buildTool,
  type Tool,
  type ToolDef,
} from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { ENTER_PLAN_MODE_TOOL_NAME } from './constants.js';
import { ENTER_PLAN_MODE_TOOL_PROMPT } from './prompt.js';

const inputSchema = lazySchema(() =>
  z.strictObject({
    // No parameters needed
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('Confirmation that plan mode was entered'),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const EnterPlanModeTool: Tool<InputSchema, Output> = buildTool({
  name: ENTER_PLAN_MODE_TOOL_NAME,
  searchHint: 'switch to plan mode to design an approach before coding',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Requests permission to enter plan mode for complex tasks requiring exploration and design';
  },
  async prompt() {
    return ENTER_PLAN_MODE_TOOL_PROMPT;
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
    return true;
  },
  async call(_input, context) {
    if (context.agentId) {
      throw new Error('EnterPlanMode tool cannot be used in agent contexts');
    }

    const appState = context.getAppState();
    const currentMode = appState.toolPermissionContext.mode;

    if (currentMode === 'plan') {
      return {
        data: {
          message:
            'You are already in plan mode. Use ExitPlanMode when your plan is ready.',
        },
      };
    }

    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: {
        ...prev.toolPermissionContext,
        mode: 'plan',
        prePlanMode: currentMode,
      },
    }));

    return {
      data: {
        message:
          'Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.',
      },
    };
  },
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    const instructions = `${message}

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Design a concrete implementation strategy
5. When ready, use ExitPlanMode to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.`;

    return {
      type: 'tool_result',
      content: instructions,
      tool_use_id: toolUseID,
    };
  },
} satisfies ToolDef<InputSchema, Output>);