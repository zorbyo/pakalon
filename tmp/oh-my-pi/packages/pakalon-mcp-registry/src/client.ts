import { logger } from "@oh-my-pi/pi-utils";
import type { McpServerConfig, McpToolSpec } from "./types";

export interface McpClientOptions {
	server: McpServerConfig;
	timeout?: number;
}

export class McpClient {
	private server: McpServerConfig;
	private connected = false;
	private tools: McpToolSpec[] = [];

	constructor(options: McpClientOptions) {
		this.server = options.server;
	}

	async connect(): Promise<boolean> {
		logger.info("Connecting to MCP server", { id: this.server.id });
		this.connected = true;
		return true;
	}

	async disconnect(): Promise<void> {
		this.connected = false;
	}

	async listTools(): Promise<McpToolSpec[]> {
		return [...this.tools];
	}

	async callTool(name: string, _args: Record<string, unknown>): Promise<unknown> {
		logger.info("Calling MCP tool", { server: this.server.id, tool: name });
		return { status: "ok" };
	}

	isConnected(): boolean {
		return this.connected;
	}
}
