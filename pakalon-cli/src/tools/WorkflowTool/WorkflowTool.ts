/**
 * WorkflowTool — AI tool for managing and executing workflows.
 * Allows the AI to save, list, run, and delete workflows programmatically.
 */
import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import {
  listWorkflows,
  createWorkflow,
  removeWorkflow,
  executeWorkflow,
  getWorkflowDetails,
  saveWorkflowFromMessages,
} from "@/workflows/workflowManager.js";
import { debugLog } from "@/utils/logger.js";

const WORKFLOW_TOOL_NAME = "workflow";

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(["save", "list", "run", "delete", "show"]).describe("Action to perform"),
    name: z.string().optional().describe("Workflow name (required for save, run, delete, show)"),
    description: z.string().optional().describe("Workflow description (for save action)"),
    steps: z
      .array(
        z.object({
          type: z.enum(["prompt", "shell", "mcp", "tool"]).describe("Step type"),
          content: z.string().optional().describe("Prompt content (for prompt steps)"),
          command: z.string().optional().describe("Shell command (for shell steps)"),
          tool: z.string().optional().describe("Tool name (for tool/mcp steps)"),
          label: z.string().optional().describe("Optional display label"),
        }),
      )
      .optional()
      .describe("Workflow steps (for save action)"),
    tags: z.array(z.string()).optional().describe("Optional tags for filtering"),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;
type WorkflowInput = z.infer<InputSchema>;

interface WorkflowOutput {
  success: boolean;
  action: string;
  workflow?: {
    id: string;
    name: string;
    description: string;
    steps: number;
    tags?: string[];
  };
  workflows?: Array<{
    name: string;
    description: string;
    steps: number;
    lastUsed?: string;
    tags?: string[];
  }>;
  results?: string[];
  message: string;
  error?: string;
}

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint: "save list run delete manage workflows prompt sequences",
  maxResultSizeChars: 50_000,
  shouldDefer: false,

  get inputSchema(): InputSchema {
    return inputSchema();
  },

  async description(input: Partial<WorkflowInput>): Promise<string> {
    const action = input.action ?? "list";
    return `Perform workflow management: ${action}${input.name ? ` "${input.name}"` : ""}.`;
  },

  async prompt(): Promise<string> {
    return "Use this tool to save, list, run, or delete workflows. Workflows are reusable prompt sequences that can be executed later.";
  },

  userFacingName(): string {
    return "Workflow Manager";
  },

  isConcurrencySafe(): boolean {
    return true;
  },

  isEnabled(): boolean {
    return true;
  },

  isReadOnly(input: WorkflowInput): boolean {
    return input.action === "list" || input.action === "show" || input.action === "run";
  },

  isDestructive(input: WorkflowInput): boolean {
    return input.action === "delete";
  },

  toAutoClassifierInput(input: WorkflowInput): string {
    return `${input.action} ${input.name ?? ""}`;
  },

  async validateInput(input: WorkflowInput): Promise<{ result: true } | { result: false; message: string; errorCode: number }> {
    if (!input.action) {
      return { result: false, message: "Action is required", errorCode: 1 };
    }

    if (input.action !== "list" && !input.name) {
      return { result: false, message: "Workflow name is required for this action", errorCode: 2 };
    }

    if (input.action === "save" && !input.steps?.length) {
      return { result: false, message: "At least one step is required when saving a workflow", errorCode: 3 };
    }

    return { result: true };
  },

  renderToolUseMessage(input: Partial<WorkflowInput>): string {
    const { action, name } = input;
    if (action === "list") return "Listing workflows)";
    if (action === "save") return `Saving workflow "${name}"`;
    if (action === "run") return `Running workflow "${name}"`;
    if (action === "delete") return `Deleting workflow "${name}"`;
    if (action === "show") return `Showing workflow "${name}"`;
    return `Workflow: ${action}`;
  },

  async call(
    input: WorkflowInput,
    context: { messages?: unknown[] },
  ): Promise<ToolResult<WorkflowOutput>> {
    const { action, name, description, steps, tags } = input;

    try {
      switch (action) {
        case "list": {
          const workflows = listWorkflows();
          return {
            data: {
              success: true,
              action: "list",
              workflows: workflows.map((wf) => ({
                name: wf.name,
                description: wf.description,
                steps: wf.steps.length || wf.prompts.length,
                lastUsed: wf.lastUsedAt,
                tags: wf.tags,
              })),
              message: workflows.length
                ? `Found ${workflows.length} workflow(s).`
                : "No workflows found.",
            },
          };
        }

        case "save": {
          if (!name) throw new Error("Name is required for save action");

          let workflow;
          if (steps?.length) {
            workflow = createWorkflow(name, description ?? `Workflow: ${name}`, steps, tags);
          } else {
            const messages = (context.messages ?? []) as Array<{ role?: string; content?: string }>;
            workflow = saveWorkflowFromMessages(name, description ?? `Workflow: ${name}`, messages);
          }

          return {
            data: {
              success: true,
              action: "save",
              workflow: {
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
                steps: workflow.steps.length,
                tags: workflow.tags,
              },
              message: `Workflow "${name}" saved with ${workflow.steps.length} step(s).`,
            },
          };
        }

        case "run": {
          if (!name) throw new Error("Name is required for run action");

          const result = await executeWorkflow(name);
          if (!result.ok) {
            return {
              data: {
                success: false,
                action: "run",
                message: `Workflow execution failed: ${result.error}`,
                error: result.error,
              },
            };
          }

          return {
            data: {
              success: true,
              action: "run",
              results: result.results,
              message: `Workflow "${name}" executed (${result.stepResults.length} step(s)).`,
            },
          };
        }

        case "delete": {
          if (!name) throw new Error("Name is required for delete action");

          const result = removeWorkflow(name);
          return {
            data: {
              success: result.success,
              action: "delete",
              message: result.message,
              error: result.success ? undefined : result.message,
            },
          };
        }

        case "show": {
          if (!name) throw new Error("Name is required for show action");

          const wf = getWorkflowDetails(name);
          if (!wf) {
            return {
              data: {
                success: false,
                action: "show",
                message: `Workflow "${name}" not found.`,
                error: `Workflow "${name}" not found.`,
              },
            };
          }

          return {
            data: {
              success: true,
              action: "show",
              workflow: {
                id: wf.id,
                name: wf.name,
                description: wf.description,
                steps: wf.steps.length,
                tags: wf.tags,
              },
              message: `Workflow "${wf.name}": ${wf.description} (${wf.steps.length} steps)`,
            },
          };
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      return {
        data: {
          success: false,
          action,
          message: `Workflow error: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },

  mapToolResultToToolResultBlockParam(data: WorkflowOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
    const parts: string[] = [];
    parts.push(`<action>${data.action}</action>`);
    parts.push(`<success>${data.success}</success>`);
    parts.push(`<message>${data.message}</message>`);

    if (data.workflow) {
      parts.push(`<workflow>`);
      parts.push(`  <name>${data.workflow.name}</name>`);
      parts.push(`  <steps>${data.workflow.steps}</steps>`);
      if (data.workflow.description) parts.push(`  <description>${data.workflow.description}</description>`);
      parts.push(`</workflow>`);
    }

    if (data.workflows?.length) {
      parts.push(`<workflows count="${data.workflows.length}">`);
      for (const wf of data.workflows) {
        parts.push(`  <workflow name="${wf.name}" steps="${wf.steps}" />`);
      }
      parts.push(`</workflows>`);
    }

    if (data.error) {
      parts.push(`<error>${data.error}</error>`);
    }

    return {
      tool_use_id: toolUseID,
      type: "tool_result",
      content: parts.join("\n"),
    };
  },

  async checkPermissions(): Promise<{ behavior: "allow" }> {
    return { behavior: "allow" };
  },
} satisfies ToolDef<InputSchema, WorkflowOutput>);

export default WorkflowTool;
