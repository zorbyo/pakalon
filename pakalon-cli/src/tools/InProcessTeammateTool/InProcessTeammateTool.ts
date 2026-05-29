import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { IN_PROCESS_TEAMMATE_TOOL_NAME } from "./constants.js";
import { getInProcessTeammateToolPrompt, getInProcessTeammateToolDescription } from "./prompt.js";
import {
	createTeammateIdentity,
	createTeammateTaskState,
	formatTeammateStatus,
	listTeammateTasks,
	findTeammateByName,
	findTeammateByAgentId,
	cancelTeammateTask,
	generateTeammateTaskId,
	getTeammateColor,
	type InProcessTeammateTaskState,
} from "@/tools/utils/inProcessTeammateHelpers.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		action: z.enum(["spawn", "cancel", "status", "list", "message"]).describe("Action to perform"),
		name: z.string().optional().describe("Teammate name (for spawn, cancel, status, message)"),
		prompt: z.string().optional().describe("Initial prompt (for spawn action)"),
		teamName: z.string().optional().describe("Team name (for spawn action)"),
		model: z.string().optional().describe("Model to use (for spawn action)"),
		agentType: z.string().optional().describe("Agent type (for spawn action)"),
		message: z.string().optional().describe("Message to send (for message action)"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type InProcessTeammateInput = z.infer<InputSchema>;

interface InProcessTeammateOutput {
	success: boolean;
	action: string;
	message: string;
	teammate?: {
		agentId: string;
		name: string;
		taskId: string;
		status: string;
		color?: string;
		model?: string;
		teamName?: string;
	};
	teammates?: Array<{
		agentId: string;
		name: string;
		status: string;
		prompt: string;
	}>;
}

export const InProcessTeammateTool = buildTool({
	name: IN_PROCESS_TEAMMATE_TOOL_NAME,
	searchHint: "spawn manage in-process teammates same process",
	maxResultSizeChars: 100_000,
	shouldDefer: true,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<InProcessTeammateInput>): Promise<string> {
		return getInProcessTeammateToolDescription(input as InProcessTeammateInput);
	},

	async prompt(): Promise<string> {
		return getInProcessTeammateToolPrompt();
	},

	userFacingName(): string {
		return "In-Process Teammate";
	},

	isConcurrencySafe(): boolean {
		return false;
	},

	isEnabled(): boolean {
		return true;
	},

	isReadOnly(input: InProcessTeammateInput): boolean {
		return input.action === "list" || input.action === "status";
	},

	isDestructive(input: InProcessTeammateInput): boolean {
		return input.action === "cancel";
	},

	toAutoClassifierInput(input: InProcessTeammateInput): string {
		return `${input.action} ${input.name ?? ""}`;
	},

	async validateInput(input: InProcessTeammateInput): Promise<{ result: true } | { result: false; message: string; errorCode: number }> {
		if (input.action === "spawn") {
			if (!input.name) return { result: false, message: "Name is required for spawn", errorCode: 1 };
			if (!input.prompt) return { result: false, message: "Prompt is required for spawn", errorCode: 2 };
			if (!input.teamName) return { result: false, message: "Team name is required for spawn", errorCode: 3 };
		}
		if ((input.action === "cancel" || input.action === "status" || input.action === "message") && !input.name) {
			return { result: false, message: "Teammate name is required for this action", errorCode: 4 };
		}
		if (input.action === "message" && !input.message) {
			return { result: false, message: "Message content is required", errorCode: 5 };
		}
		return { result: true };
	},

	renderToolUseMessage(input: Partial<InProcessTeammateInput>): string {
		const { action, name } = input;
		if (action === "spawn") return `Spawning teammate "${name}"`;
		if (action === "cancel") return `Cancelling teammate "${name}"`;
		if (action === "status") return `Checking status of "${name}"`;
		if (action === "list") return "Listing in-process teammates";
		if (action === "message") return `Messaging teammate "${name}"`;
		return `In-Process Teammate: ${action}`;
	},

	async call(input: InProcessTeammateInput, context: { getAppState: () => Record<string, unknown>; setAppState: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void }): Promise<ToolResult<InProcessTeammateOutput>> {
		const { action, name, prompt, teamName, model, agentType, message } = input;
		const appState = context.getAppState();

		switch (action) {
			case "spawn": {
				if (!name || !prompt || !teamName) {
					return {
						data: {
							success: false,
							action: "spawn",
							message: "Name, prompt, and teamName are required for spawn.",
						},
					};
				}

				const taskId = generateTeammateTaskId();
				const color = getTeammateColor(name);
				const identity = createTeammateIdentity(name, teamName, color, false);
				const taskState = createTeammateTaskState(taskId, identity, prompt);

				const tasks = { ...(appState.tasks as Record<string, unknown> | {}) };
				tasks[taskId] = taskState;

				context.setAppState(prev => ({ ...prev, tasks }));

				return {
					data: {
						success: true,
						action: "spawn",
						message: `Spawned in-process teammate "${name}" (ID: ${identity.agentId}, Task: ${taskId}).`,
						teammate: {
							agentId: identity.agentId,
							name: identity.agentName,
							taskId,
							status: "running",
							color,
							model,
							teamName,
						},
					},
				};
			}

			case "cancel": {
				if (!name) {
					return {
						data: { success: false, action: "cancel", message: "Teammate name is required." },
					};
				}

				const task = findTeammateByName(name, appState);
				if (!task) {
					return {
						data: { success: false, action: "cancel", message: `Teammate "${name}" not found.` },
					};
				}

				const cancelled = cancelTeammateTask(task.identity.agentId, context.setAppState);
				return {
					data: {
						success: cancelled,
						action: "cancel",
						message: cancelled ? `Cancelled teammate "${name}".` : `Failed to cancel teammate "${name}".`,
					},
				};
			}

			case "status": {
				if (!name) {
					return {
						data: { success: false, action: "status", message: "Teammate name is required." },
					};
				}

				const task = findTeammateByName(name, appState);
				if (!task) {
					return {
						data: { success: false, action: "status", message: `Teammate "${name}" not found.` },
					};
				}

				return {
					data: {
						success: true,
						action: "status",
						message: formatTeammateStatus(task),
						teammate: {
							agentId: task.identity.agentId,
							name: task.identity.agentName,
							taskId: task.identity.agentId,
							status: task.status,
							color: task.identity.color,
						},
					},
				};
			}

			case "list": {
				const tasks = listTeammateTasks(appState);
				if (tasks.length === 0) {
					return {
						data: {
							success: true,
							action: "list",
							message: "No in-process teammates active.",
						},
					};
				}

				return {
					data: {
						success: true,
						action: "list",
						message: `${tasks.length} in-process teammate(s) active.`,
						teammates: tasks.map(t => ({
							agentId: t.identity.agentId,
							name: t.identity.agentName,
							status: t.status,
							prompt: t.prompt.length > 80 ? `${t.prompt.slice(0, 80)}...` : t.prompt,
						})),
					},
				};
			}

			case "message": {
				if (!name || !message) {
					return {
						data: { success: false, action: "message", message: "Teammate name and message are required." },
					};
				}

				const task = findTeammateByName(name, appState);
				if (!task) {
					return {
						data: { success: false, action: "message", message: `Teammate "${name}" not found.` },
					};
				}

				const updatedMessages = [...(task.pendingUserMessages ?? []), message];
				const tasks = { ...(appState.tasks as Record<string, unknown> | {}) };
				tasks[task.identity.agentId] = { ...task, pendingUserMessages: updatedMessages };
				context.setAppState(prev => ({ ...prev, tasks }));

				return {
					data: {
						success: true,
						action: "message",
						message: `Message queued for teammate "${name}".`,
					},
				};
			}

			default:
				return {
					data: {
						success: false,
						action,
						message: `Unknown action: ${action}`,
					},
				};
		}
	},

	mapToolResultToToolResultBlockParam(data: InProcessTeammateOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<action>${data.action}</action>`);
		parts.push(`<success>${data.success}</success>`);
		parts.push(`<message>${data.message}</message>`);

		if (data.teammate) {
			parts.push(`<teammate>`);
			parts.push(`  <agent_id>${data.teammate.agentId}</agent_id>`);
			parts.push(`  <name>${data.teammate.name}</name>`);
			parts.push(`  <status>${data.teammate.status}</status>`);
			if (data.teammate.taskId) parts.push(`  <task_id>${data.teammate.taskId}</task_id>`);
			if (data.teammate.color) parts.push(`  <color>${data.teammate.color}</color>`);
			if (data.teammate.model) parts.push(`  <model>${data.teammate.model}</model>`);
			if (data.teammate.teamName) parts.push(`  <team_name>${data.teammate.teamName}</team_name>`);
			parts.push(`</teammate>`);
		}

		if (data.teammates?.length) {
			parts.push(`<teammates count="${data.teammates.length}">`);
			for (const t of data.teammates) {
				parts.push(`  <teammate name="${t.name}" status="${t.status}" agent_id="${t.agentId}" />`);
			}
			parts.push(`</teammates>`);
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
} satisfies ToolDef<InputSchema, InProcessTeammateOutput>);

export default InProcessTeammateTool;
