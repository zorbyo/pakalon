import type { McpServerConfig, McpServerSpec, McpServerStatus } from "./types";

export class McpRegistry {
	private servers: McpServerConfig[] = [];
	private specs: Map<string, McpServerSpec> = new Map();

	registerSpec(spec: McpServerSpec): void {
		this.specs.set(spec.id, spec);
	}

	registerConfig(config: McpServerConfig): void {
		const existing = this.servers.findIndex(s => s.id === config.id);
		if (existing >= 0) {
			this.servers[existing] = config;
		} else {
			this.servers.push(config);
		}
	}

	removeConfig(id: string): boolean {
		const len = this.servers.length;
		this.servers = this.servers.filter(s => s.id !== id);
		return this.servers.length < len;
	}

	getConfig(id: string): McpServerConfig | undefined {
		return this.servers.find(s => s.id === id);
	}

	getAllConfigs(): McpServerConfig[] {
		return [...this.servers];
	}

	getSpec(id: string): McpServerSpec | undefined {
		return this.specs.get(id);
	}

	getAllSpecs(): McpServerSpec[] {
		return [...this.specs.values()];
	}

	getStatus(id: string): McpServerStatus {
		const config = this.getConfig(id);
		return config ? "installed" : "not-installed";
	}

	getInstalledServers(): McpServerConfig[] {
		return this.servers;
	}

	getServersByScope(scope: "project" | "global"): McpServerConfig[] {
		return this.servers.filter(s => s.scope === scope);
	}

	clear(): void {
		this.servers = [];
	}

	count(): number {
		return this.servers.length;
	}
}
