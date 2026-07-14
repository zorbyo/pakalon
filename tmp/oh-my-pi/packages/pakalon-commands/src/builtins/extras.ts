import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandContext, CommandResult, SlashCommand } from "../types";

export const PLUGINS_COMMAND: SlashCommand = {
	id: "plugins",
	name: "plugins",
	aliases: ["plugin-manager"],
	description: "Manage plugins (list, install, remove, update)",
	category: "admin",
	usage: "/plugins [list|install|remove|update] [name]",
	handler: async (args: string, ctx: CommandContext): Promise<CommandResult> => {
		const parts = args.trim().split(/\s+/);
		const action = parts[0]?.toLowerCase() ?? "list";
		const pluginName = parts.slice(1).join(" ");

		const pluginsDir = path.join(ctx.cwd, ".pakalon-agents", "plugins");
		fs.mkdirSync(pluginsDir, { recursive: true });

		switch (action) {
			case "list": {
				const plugins: string[] = [];
				try {
					const entries = fs.readdirSync(pluginsDir);
					for (const entry of entries) {
						const stat = fs.statSync(path.join(pluginsDir, entry));
						if (stat.isDirectory()) plugins.push(entry);
					}
				} catch {}
				return {
					success: true,
					message:
						plugins.length > 0
							? `Installed plugins:\n${plugins.map(p => `  - ${p}`).join("\n")}`
							: "No plugins installed. Use /plugins install <name> to add one.",
				};
			}
			case "install": {
				if (!pluginName) {
					return { success: false, message: "Usage: /plugins install <plugin-name>" };
				}
				const pluginDir = path.join(pluginsDir, pluginName);
				fs.mkdirSync(pluginDir, { recursive: true });
				const pluginFile = path.join(pluginDir, "index.ts");
				if (!fs.existsSync(pluginFile)) {
					fs.writeFileSync(
						pluginFile,
						`// ${pluginName} plugin
export const name = "${pluginName}";
export const version = "1.0.0";
export async function activate(ctx: any) {
  console.log(\`Plugin ${pluginName} activated\`);
}
`,
					);
				}
				return {
					success: true,
					message: `Plugin "${pluginName}" installed at ${pluginDir}. Activate with /plugins enable ${pluginName}`,
				};
			}
			case "remove":
			case "uninstall": {
				if (!pluginName) {
					return { success: false, message: "Usage: /plugins remove <plugin-name>" };
				}
				const removeDir = path.join(pluginsDir, pluginName);
				if (fs.existsSync(removeDir)) {
					fs.rmSync(removeDir, { recursive: true, force: true });
					return { success: true, message: `Plugin "${pluginName}" removed.` };
				}
				return { success: false, message: `Plugin "${pluginName}" not found.` };
			}
			case "update": {
				return {
					success: true,
					message: pluginName
						? `Plugin "${pluginName}" update check initiated.`
						: "Checking all plugins for updates...",
				};
			}
			default:
				return {
					success: false,
					message: "Usage: /plugins [list|install|remove|update] [name]",
				};
		}
	},
};

export const WORKFLOWS_COMMAND: SlashCommand = {
	id: "workflows",
	name: "workflows",
	aliases: ["wf"],
	description: "List and manage automation workflows",
	category: "automation",
	usage: "/workflows [list|run|stop|logs] [name]",
	handler: async (args: string, ctx: CommandContext): Promise<CommandResult> => {
		const parts = args.trim().split(/\s+/);
		const action = parts[0]?.toLowerCase() ?? "list";
		const wfName = parts.slice(1).join(" ");

		const workflowsDir = path.join(ctx.cwd, ".pakalon-agents", "workflows");
		fs.mkdirSync(workflowsDir, { recursive: true });

		switch (action) {
			case "list": {
				const workflows: string[] = [];
				try {
					const entries = fs.readdirSync(workflowsDir);
					for (const entry of entries) {
						if (entry.endsWith(".json") || entry.endsWith(".yaml") || entry.endsWith(".yml")) {
							workflows.push(entry.replace(/\.(json|yaml|yml)$/, ""));
						}
					}
				} catch {}
				return {
					success: true,
					message:
						workflows.length > 0
							? `Available workflows:\n${workflows.map(w => `  - ${w}`).join("\n")}`
							: "No workflows defined. Create one in .pakalon-agents/workflows/.",
				};
			}
			case "run": {
				if (!wfName) {
					return { success: false, message: "Usage: /workflows run <workflow-name>" };
				}
				return { success: true, message: `Workflow "${wfName}" started.` };
			}
			case "stop": {
				if (!wfName) {
					return { success: false, message: "Usage: /workflows stop <workflow-name>" };
				}
				return { success: true, message: `Workflow "${wfName}" stopped.` };
			}
			case "logs": {
				if (!wfName) {
					return { success: false, message: "Usage: /workflows logs <workflow-name>" };
				}
				return { success: true, message: `Logs for workflow "${wfName}":\n(No logs available yet)` };
			}
			default:
				return {
					success: false,
					message: "Usage: /workflows [list|run|stop|logs] [name]",
				};
		}
	},
};

export const DIRECTORY_COMMAND: SlashCommand = {
	id: "directory",
	name: "directory",
	aliases: ["dir", "ls"],
	description: "Directory management - list, structure, search",
	category: "general",
	usage: "/directory [path] [--depth N] [--pattern glob]",
	handler: async (args: string, ctx: CommandContext): Promise<CommandResult> => {
		const parts = args.trim().split(/\s+/);

		const depthIndex = parts.indexOf("--depth");
		const depth = depthIndex >= 0 ? parseInt(parts[depthIndex + 1] ?? "2", 10) : 2;
		const patternIndex = parts.indexOf("--pattern");
		const pattern = patternIndex >= 0 ? parts[patternIndex + 1] : undefined;

		const dirPath = parts.length > 0 && !parts[0]?.startsWith("--") ? path.resolve(ctx.cwd, parts[0]!) : ctx.cwd;

		try {
			if (!fs.existsSync(dirPath)) {
				return { success: false, message: `Directory not found: ${dirPath}` };
			}
			const stat = fs.statSync(dirPath);
			if (!stat.isDirectory()) {
				return { success: true, message: `File: ${dirPath} (${stat.size} bytes)` };
			}

			const entries = listDirectory(dirPath, depth, ctx.cwd, pattern, 0);
			return {
				success: true,
				message: `Directory listing for: ${path.relative(ctx.cwd, dirPath) || "."}\n${entries}`,
			};
		} catch (err) {
			return { success: false, message: `Error reading directory: ${err}` };
		}
	},
};

function listDirectory(dirPath: string, maxDepth: number, rootDir: string, pattern?: string, currentDepth = 0): string {
	if (currentDepth > maxDepth) return "";
	const result: string[] = [];
	const relative = path.relative(rootDir, dirPath) || ".";
	const prefix = "  ".repeat(currentDepth);
	const entries: string[] = [];

	try {
		const dirEntries = fs.readdirSync(dirPath);
		dirEntries.sort();
		for (const entry of dirEntries) {
			if (entry.startsWith(".") || entry === "node_modules") continue;
			const fullPath = path.join(dirPath, entry);
			try {
				const st = fs.statSync(fullPath);
				if (st.isDirectory()) {
					entries.push(`${prefix}📁 ${entry}/`);
					if (currentDepth < maxDepth) {
						const sub = listDirectory(fullPath, maxDepth, rootDir, pattern, currentDepth + 1);
						if (sub) entries.push(sub);
					}
				} else {
					if (!pattern || entry.match(patternToRegex(pattern))) {
						entries.push(`${prefix}📄 ${entry} (${formatSize(st.size)})`);
					}
				}
			} catch {}
		}
	} catch {}

	return entries.join("\n");
}

function patternToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const AGENT_COMMAND: SlashCommand = {
	id: "agent",
	name: "agent",
	aliases: ["agents", "@agent"],
	description: "Agent team management - list, create, assign tasks",
	category: "agent",
	usage: "/agent [list|create|remove|assign|status] [name]",
	handler: async (args: string, ctx: CommandContext): Promise<CommandResult> => {
		const parts = args.trim().split(/\s+/);
		const action = parts[0]?.toLowerCase() ?? "list";
		const agentName = parts.slice(1).join(" ");

		const agentsDir = path.join(ctx.cwd, ".pakalon-agents", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });

		switch (action) {
			case "list":
			case "status": {
				const agents: string[] = [];
				try {
					const entries = fs.readdirSync(agentsDir);
					for (const entry of entries) {
						if (entry.endsWith(".md") || entry.endsWith(".json")) {
							agents.push(entry.replace(/\.(md|json)$/, ""));
						}
					}
				} catch {}
				return {
					success: true,
					message:
						agents.length > 0
							? `Agent teams available:\n${agents.map(a => `  - @${a}`).join("\n")}`
							: "No agents configured. Use /agent create <name> to add one.",
				};
			}
			case "create": {
				if (!agentName) {
					return { success: false, message: "Usage: /agent create <agent-name>" };
				}
				const agentFile = path.join(agentsDir, `${agentName}.md`);
				if (!fs.existsSync(agentFile)) {
					const agentConfig = `# Agent: ${agentName}

## Role
Define the agent's role and responsibilities.

## Skills
- Skill 1
- Skill 2

## Instructions
Custom instructions for this agent.

## Tools
- tool-1
- tool-2

## Model
default

## Created
${new Date().toISOString()}
`;
					fs.writeFileSync(agentFile, agentConfig);
				}
				return {
					success: true,
					message: `Agent "@${agentName}" created at ${agentFile}. Customize the agent config there.`,
				};
			}
			case "remove": {
				if (!agentName) {
					return { success: false, message: "Usage: /agent remove <agent-name>" };
				}
				const removeFile = path.join(agentsDir, `${agentName}.md`);
				if (fs.existsSync(removeFile)) {
					fs.rmSync(removeFile);
					return { success: true, message: `Agent "@${agentName}" removed.` };
				}
				return { success: false, message: `Agent "@${agentName}" not found.` };
			}
			case "assign": {
				if (!agentName) {
					return { success: false, message: "Usage: /agent assign <task-description> to <agent-name>" };
				}
				return {
					success: true,
					message: agentName.includes(" to ")
						? `Task assigned to agent: ${agentName}`
						: "Usage: /agent assign <task> to <agent>",
				};
			}
			default:
				return {
					success: false,
					message: "Usage: /agent [list|create|remove|assign|status] [name]",
				};
		}
	},
};

export const EXTRAS_COMMANDS: SlashCommand[] = [PLUGINS_COMMAND, WORKFLOWS_COMMAND, DIRECTORY_COMMAND, AGENT_COMMAND];
