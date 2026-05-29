import { z } from 'zod';
import { buildTool, type ToolDef } from '../tools/tool-types.js';
import { lazySchema } from '../utils/lazySchema.js';
import {
  getWorkflow,
  getAllWorkflows,
  executeWorkflow,
  formatWorkflowOutput,
} from './workflowUtils.js';
import {
  WORKFLOW_TOOL_NAME,
  LIST_WORKFLOWS_TOOL_NAME,
  SHOW_WORKFLOW_TOOL_NAME,
  WORKFLOW_SEARCH_HINT,
  LIST_WORKFLOWS_SEARCH_HINT,
  SHOW_WORKFLOW_SEARCH_HINT,
} from './constants.js';
import {
  PROMPT,
  DESCRIPTION,
  LIST_WORKFLOWS_PROMPT,
  LIST_WORKFLOWS_DESCRIPTION,
  SHOW_WORKFLOW_PROMPT,
  SHOW_WORKFLOW_DESCRIPTION,
} from './prompt.js';
import type {
  WorkflowToolInput,
  ListWorkflowsInput,
  ShowWorkflowInput,
  WorkflowToolOutput,
  ListWorkflowsOutput,
  ShowWorkflowOutput,
} from './types.js';

const WorkflowToolInputSchema = lazySchema(() =>
  z.strictObject({
    workflow: z.string().describe('Name of the workflow to execute'),
    context: z.record(z.string()).optional().describe('Variables to pass to the workflow'),
    wait: z.boolean().optional().default(true).describe('Wait for workflow to complete'),
  })
);
type WorkflowToolInputSchema = ReturnType<typeof WorkflowToolInputSchema>;

const ListWorkflowsInputSchema = lazySchema(() =>
  z.strictObject({
    includeDescription: z
      .boolean()
      .optional()
      .default(true)
      .describe('Include workflow descriptions'),
  })
);
type ListWorkflowsInputSchema = ReturnType<typeof ListWorkflowsInputSchema>;

const ShowWorkflowInputSchema = lazySchema(() =>
  z.strictObject({
    workflow: z.string().describe('Name of the workflow to show'),
    includeSteps: z.boolean().optional().default(true).describe('Include step details'),
  })
);
type ShowWorkflowInputSchema = ReturnType<typeof ShowWorkflowInputSchema>;

const WorkflowToolOutputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    workflowName: z.string(),
    executedSteps: z.number(),
    totalSteps: z.number(),
    results: z.record(z.unknown()),
    errors: z.array(z.object({ step: z.number(), error: z.string() })),
    duration: z.number(),
    output: z.string().optional(),
  })
);
type WorkflowToolOutputSchema = ReturnType<typeof WorkflowToolOutputSchema>;

const ListWorkflowsOutputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    workflows: z.array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        version: z.string().optional(),
        steps: z.number(),
      })
    ),
    count: z.number(),
  })
);
type ListWorkflowsOutputSchema = ReturnType<typeof ListWorkflowsOutputSchema>;

const ShowWorkflowOutputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    workflow: z
      .object({
        name: z.string(),
        description: z.string().optional(),
        version: z.string().optional(),
        steps: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            tool: z.string(),
            args: z.record(z.unknown()),
            condition: z.string().optional(),
            onError: z.string().optional(),
          })
        ),
        variables: z.record(z.string()).optional(),
        timeout: z.number().optional(),
      })
      .optional(),
    error: z.string().optional(),
  })
);
type ShowWorkflowOutputSchema = ReturnType<typeof ShowWorkflowOutputSchema>;

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint: WORKFLOW_SEARCH_HINT,
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return DESCRIPTION;
  },
  async prompt() {
    return PROMPT;
  },
  get inputSchema(): WorkflowToolInputSchema {
    return WorkflowToolInputSchema();
  },
  get outputSchema(): WorkflowToolOutputSchema {
    return WorkflowToolOutputSchema();
  },
  userFacingName() {
    return 'Workflow';
  },
  shouldDefer: false,
  isEnabled() {
    return true;
  },
  isConcurrencySafe(input) {
    return false;
  },
  isReadOnly() {
    return false;
  },
  toAutoClassifierInput(input: WorkflowToolInput) {
    return `workflow:${input.workflow}`;
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input as unknown as Record<string, unknown> };
  },
  renderToolUseMessage() {
    return null;
  },
  async call({ workflow: workflowName, context, wait = true }, _context) {
    const wf = getWorkflow(workflowName);

    if (!wf) {
      const result: WorkflowToolOutput = {
        success: false,
        workflowName,
        executedSteps: 0,
        totalSteps: 0,
        results: {},
        errors: [{ step: 0, error: `Workflow not found: ${workflowName}` }],
        duration: 0,
        output: `Workflow "${workflowName}" not found. Use ListWorkflows to see available workflows.`,
      };
      return { data: result };
    }

    const result = await executeWorkflow(workflowName, context);

    return {
      data: {
        ...result,
        output: formatWorkflowOutput(result),
      } as WorkflowToolOutput,
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const output = content as WorkflowToolOutput;
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.output || formatWorkflowOutput(output),
    };
  },
} satisfies ToolDef<WorkflowToolInputSchema, WorkflowToolOutput>);

export const ListWorkflowsTool = buildTool({
  name: LIST_WORKFLOWS_TOOL_NAME,
  searchHint: LIST_WORKFLOWS_SEARCH_HINT,
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return LIST_WORKFLOWS_DESCRIPTION;
  },
  async prompt() {
    return LIST_WORKFLOWS_PROMPT;
  },
  get inputSchema(): ListWorkflowsInputSchema {
    return ListWorkflowsInputSchema();
  },
  get outputSchema(): ListWorkflowsOutputSchema {
    return ListWorkflowsOutputSchema();
  },
  userFacingName() {
    return 'ListWorkflows';
  },
  shouldDefer: false,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  toAutoClassifierInput() {
    return 'list workflows';
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input as unknown as Record<string, unknown> };
  },
  renderToolUseMessage() {
    return null;
  },
  async call({ includeDescription = true }, _context) {
    const workflows = getAllWorkflows();

    const workflowList = workflows.map((wf) => ({
      name: wf.name,
      description: includeDescription ? wf.description : undefined,
      version: wf.version,
      steps: wf.steps.length,
    }));

    return {
      data: {
        success: true,
        workflows: workflowList,
        count: workflowList.length,
      } as ListWorkflowsOutput,
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const output = content as ListWorkflowsOutput;
    if (output.workflows.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No workflows available.',
      };
    }

    const lines = output.workflows.map(
      (wf) =>
        `• ${wf.name}${wf.description ? ` - ${wf.description}` : ''} (${wf.steps} steps)`
    );

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Available workflows (${output.count}):\n${lines.join('\n')}`,
    };
  },
} satisfies ToolDef<ListWorkflowsInputSchema, ListWorkflowsOutput>);

export const ShowWorkflowTool = buildTool({
  name: SHOW_WORKFLOW_TOOL_NAME,
  searchHint: SHOW_WORKFLOW_SEARCH_HINT,
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return SHOW_WORKFLOW_DESCRIPTION;
  },
  async prompt() {
    return SHOW_WORKFLOW_PROMPT;
  },
  get inputSchema(): ShowWorkflowInputSchema {
    return ShowWorkflowInputSchema();
  },
  get outputSchema(): ShowWorkflowOutputSchema {
    return ShowWorkflowOutputSchema();
  },
  userFacingName() {
    return 'ShowWorkflow';
  },
  shouldDefer: false,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  toAutoClassifierInput(input: ShowWorkflowInput) {
    return `show workflow:${input.workflow}`;
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input as unknown as Record<string, unknown> };
  },
  renderToolUseMessage() {
    return null;
  },
  async call({ workflow: workflowName, includeSteps = true }, _context) {
    const wf = getWorkflow(workflowName);

    if (!wf) {
      return {
        data: {
          success: false,
          error: `Workflow "${workflowName}" not found.`,
        } as ShowWorkflowOutput,
      };
    }

    return {
      data: {
        success: true,
        workflow: {
          name: wf.name,
          description: wf.description,
          version: wf.version,
          steps: includeSteps
            ? wf.steps.map((s) => ({
                id: s.id,
                name: s.name,
                tool: s.tool,
                args: s.args,
                condition: s.condition,
                onError: s.onError,
              }))
            : [],
          variables: wf.variables,
          timeout: wf.timeout,
        },
      } as ShowWorkflowOutput,
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const output = content as ShowWorkflowOutput;

    if (!output.success || !output.workflow) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: output.error || 'Workflow not found.',
      };
    }

    const wf = output.workflow;
    const lines: string[] = [];

    lines.push(`Workflow: ${wf.name}`);
    if (wf.description) lines.push(`Description: ${wf.description}`);
    if (wf.version) lines.push(`Version: ${wf.version}`);
    if (wf.variables && Object.keys(wf.variables).length > 0) {
      lines.push(`Variables: ${JSON.stringify(wf.variables)}`);
    }
    if (wf.timeout) lines.push(`Timeout: ${wf.timeout}ms`);

    if (wf.steps.length > 0) {
      lines.push(`\nSteps (${wf.steps.length}):`);
      for (const step of wf.steps) {
        lines.push(`  ${step.id}. [${step.tool}] ${step.name}`);
        if (step.condition) lines.push(`     Condition: ${step.condition}`);
        if (step.onError) lines.push(`     On Error: ${step.onError}`);
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    };
  },
} satisfies ToolDef<ShowWorkflowInputSchema, ShowWorkflowOutput>);

export function getAllWorkflowTools() {
  return {
    workflow: WorkflowTool,
    list_workflows: ListWorkflowsTool,
    show_workflow: ShowWorkflowTool,
  };
}