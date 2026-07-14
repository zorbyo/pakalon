import type { ModeName } from "./types";
import { MODE_CONFIGS } from "./types";

const ALWAYS_ALLOWED_TOOLS = new Set([
	"read",
	"search",
	"grep",
	"find",
	"glob",
	"lsp",
	"web_search",
	"ask",
	"todo_write",
	"task",
]);

const DESTRUCTIVE_TOOLS = new Set(["write", "edit", "bash", "execute", "github", "delete", "remove"]);

export function canExecuteTool(mode: ModeName, toolName: string): boolean {
	const config = MODE_CONFIGS[mode];
	if (config.allowedTools.length > 0) {
		return config.allowedTools.includes(toolName);
	}
	if (config.blockedTools.length > 0) {
		return !config.blockedTools.includes(toolName);
	}
	if (mode === "plan" && DESTRUCTIVE_TOOLS.has(toolName)) {
		return false;
	}
	return true;
}

export function requiresConfirmation(mode: ModeName, toolName: string): boolean {
	if (mode === "bypass") return false;
	if (mode === "auto-accept") return false;
	if (mode === "plan") return true;
	if (mode === "edit" && DESTRUCTIVE_TOOLS.has(toolName)) return true;
	if (ALWAYS_ALLOWED_TOOLS.has(toolName)) return false;
	return DESTRUCTIVE_TOOLS.has(toolName);
}

export function getAvailableTools(mode: ModeName, allTools: string[]): string[] {
	return allTools.filter(tool => canExecuteTool(mode, tool));
}

export function filterToolsByMode(mode: ModeName, tools: string[]): string[] {
	return getAvailableTools(mode, tools);
}

export function getConfirmationPrompt(mode: ModeName, toolName: string, args?: Record<string, unknown>): string {
	const lines: string[] = [];
	lines.push(`Mode: ${mode}`);
	lines.push(`Tool: ${toolName}`);
	if (args && Object.keys(args).length > 0) {
		lines.push(`Args: ${JSON.stringify(args, null, 2)}`);
	}
	lines.push("");
	lines.push("Approve this action? [y/N]:");
	return lines.join("\n");
}

export function isDestructiveTool(toolName: string): boolean {
	return DESTRUCTIVE_TOOLS.has(toolName);
}

export function getModeDescription(mode: ModeName): string {
	return MODE_CONFIGS[mode].description;
}
