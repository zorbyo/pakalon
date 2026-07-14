export type ModeName = "plan" | "edit" | "auto-accept" | "bypass";
export type PermissionLevel = "read-only" | "confirm" | "auto-accept" | "full-auto";

export interface ModeConfig {
	name: ModeName;
	description: string;
	permissionLevel: PermissionLevel;
	requiresConfirmation: boolean;
	allowedTools: string[];
	blockedTools: string[];
}

export interface ModeState {
	currentMode: ModeName;
	previousMode: ModeName | null;
	changedAt: string;
	autoAcceptEnabled: boolean;
	persisted: boolean;
}

export const MODE_ORDER: ModeName[] = ["plan", "edit", "auto-accept", "bypass"];

export const MODE_CONFIGS: Record<ModeName, ModeConfig> = {
	plan: {
		name: "plan",
		description: "Read-only planning mode. Agent plans but cannot execute destructive actions.",
		permissionLevel: "read-only",
		requiresConfirmation: true,
		allowedTools: ["read", "search", "grep", "find", "glob", "lsp", "web_search"],
		blockedTools: ["write", "edit", "bash", "execute", "task", "github"],
	},
	edit: {
		name: "edit",
		description: "Edit mode with human confirmation. Agent can edit files with user approval.",
		permissionLevel: "confirm",
		requiresConfirmation: true,
		allowedTools: [],
		blockedTools: [],
	},
	"auto-accept": {
		name: "auto-accept",
		description: "Auto-accept mode. All tool calls are automatically accepted.",
		permissionLevel: "auto-accept",
		requiresConfirmation: false,
		allowedTools: [],
		blockedTools: [],
	},
	bypass: {
		name: "bypass",
		description: "YOLO mode. Full autonomy - no confirmation for any tool call.",
		permissionLevel: "full-auto",
		requiresConfirmation: false,
		allowedTools: [],
		blockedTools: [],
	},
};
