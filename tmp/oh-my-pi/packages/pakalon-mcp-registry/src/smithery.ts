import { logger } from "@oh-my-pi/pi-utils";
import type { McpServerConfig } from "./types";

export interface SmitheryPackage {
	id: string;
	name: string;
	description: string;
	version: string;
	command: string;
	args: string[];
}

export class SmitheryRegistry {
	private packages: SmitheryPackage[] = [];

	async search(query: string): Promise<SmitheryPackage[]> {
		logger.info("Searching Smithery registry", { query });
		return this.packages.filter(
			p =>
				p.name.toLowerCase().includes(query.toLowerCase()) ||
				p.description.toLowerCase().includes(query.toLowerCase()),
		);
	}

	async getPackage(id: string): Promise<SmitheryPackage | undefined> {
		return this.packages.find(p => p.id === id);
	}

	async installFromSmithery(pkg: SmitheryPackage): Promise<McpServerConfig> {
		logger.info("Installing MCP server from Smithery", { id: pkg.id });
		return {
			id: pkg.id,
			name: pkg.name,
			command: pkg.command,
			args: pkg.args,
			scope: "global",
			autoStart: true,
		};
	}

	async listAvailable(): Promise<SmitheryPackage[]> {
		return [...this.packages];
	}

	registerPackage(pkg: SmitheryPackage): void {
		this.packages.push(pkg);
	}
}
