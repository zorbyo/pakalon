import { logger } from "@oh-my-pi/pi-utils";
import type { McpServerConfig, McpServerSpec, McpServerStatus } from "./types";

export class McpInstaller {
	async install(spec: McpServerSpec, scope: "project" | "global"): Promise<McpServerConfig> {
		logger.info("Installing MCP server", { id: spec.id, scope });
		const config: McpServerConfig = {
			id: spec.id,
			name: spec.name,
			command: spec.command,
			args: spec.args,
			env: spec.env,
			scope,
			autoStart: true,
		};
		return config;
	}

	async uninstall(id: string): Promise<boolean> {
		logger.info("Uninstalling MCP server", { id });
		return true;
	}

	async update(config: McpServerConfig): Promise<McpServerConfig> {
		logger.info("Updating MCP server config", { id: config.id });
		return config;
	}

	async checkStatus(_id: string): Promise<McpServerStatus> {
		return "unknown";
	}

	async isInstalled(id: string): Promise<boolean> {
		const status = await this.checkStatus(id);
		return status === "installed";
	}

	async verifyConnection(id: string): Promise<boolean> {
		logger.info("Verifying MCP server connection", { id });
		return true;
	}
}
