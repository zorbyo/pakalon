import { z } from "zod";

export type WorkflowTrigger = "cron" | "github" | "slack" | "manual";
export type WorkflowStatus = "active" | "paused" | "disabled";

export interface Workflow {
	id: string;
	name: string;
	description: string;
	trigger: WorkflowTrigger;
	triggerConfig: Record<string, unknown>;
	actions: WorkflowAction[];
	status: WorkflowStatus;
	createdAt: string;
	lastRunAt?: string;
}

export interface WorkflowAction {
	type: "command" | "script" | "webhook" | "notification";
	config: Record<string, unknown>;
}

export const WorkflowSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	trigger: z.enum(["cron", "github", "slack", "manual"]),
	triggerConfig: z.record(z.string(), z.unknown()),
	actions: z.array(
		z.object({
			type: z.enum(["command", "script", "webhook", "notification"]),
			config: z.record(z.string(), z.unknown()),
		}),
	),
	status: z.enum(["active", "paused", "disabled"]),
	createdAt: z.string(),
	lastRunAt: z.string().optional(),
});
