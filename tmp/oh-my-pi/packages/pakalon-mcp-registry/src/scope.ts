import type { McpServerConfig, McpServerScope } from "./types";

export function getScopeDir(projectDir: string, scope: McpServerScope): string {
	if (scope === "project") {
		return projectDir;
	}
	return process.env.HOME ?? process.env.USERPROFILE ?? "~";
}

export function getMcpConfigPath(projectDir: string, scope: McpServerScope): string {
	const base = getScopeDir(projectDir, scope);
	return `${base}/.pakalon/mcp-servers.json`;
}

export function scopeFilter(servers: McpServerConfig[], scope: McpServerScope): McpServerConfig[] {
	return servers.filter(s => s.scope === scope);
}

export function isGlobal(config: McpServerConfig): boolean {
	return config.scope === "global";
}

export function isProject(config: McpServerConfig): boolean {
	return config.scope === "project";
}
