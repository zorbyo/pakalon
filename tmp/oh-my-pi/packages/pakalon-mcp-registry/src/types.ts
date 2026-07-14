import { z } from "zod";

export type McpServerStatus = "installed" | "not-installed" | "unknown";
export type McpServerScope = "project" | "global";

export interface McpServerSpec {
	id: string;
	name: string;
	description: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	scope: McpServerScope;
	status: McpServerStatus;
	version?: string;
	homepage?: string;
}

export interface McpServerConfig {
	id: string;
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	scope: McpServerScope;
	autoStart?: boolean;
}

export interface McpToolSpec {
	serverId: string;
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export const McpServerConfigSchema = z.object({
	id: z.string(),
	name: z.string(),
	command: z.string(),
	args: z.array(z.string()),
	env: z.record(z.string()).optional(),
	scope: z.enum(["project", "global"]),
	autoStart: z.boolean().optional(),
});
