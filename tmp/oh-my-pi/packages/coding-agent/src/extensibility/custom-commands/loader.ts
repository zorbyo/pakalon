/**
 * Custom command loader - loads TypeScript command modules using native Bun import.
 *
 * Dependencies (the zod-backed typebox shim and pi-coding-agent) are injected via the
 * CustomCommandAPI to avoid import resolution issues with custom commands loaded from user directories.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, getProjectDir, isEnoent, logger } from "@oh-my-pi/pi-utils";
import * as zod from "zod/v4";
import { getConfigDirs } from "../../config";
import { execCommand } from "../../exec/exec";
import * as typebox from "../typebox";
import { GreenCommand } from "./bundled/ci-green";
import { PakalonCommand } from "./bundled/pakalon";
import { AgentsCommand } from "./bundled/pakalon/commands/agents";
import { AnsCommand } from "./bundled/pakalon/commands/ans";
import { AuditorCommand } from "./bundled/pakalon/commands/auditor";
import { AutomationsCommand } from "./bundled/pakalon/commands/automations";
import { BuildCommand } from "./bundled/pakalon/commands/build";
import { HelpCommand } from "./bundled/pakalon/commands/help";
import { HistoryCommand } from "./bundled/pakalon/commands/history";
import { InitCommand } from "./bundled/pakalon/commands/init";
import { LogoutCommand } from "./bundled/pakalon/commands/logout";
import { ModelsCommand } from "./bundled/pakalon/commands/models";
import { NewCommand } from "./bundled/pakalon/commands/new";
import { PenpotCommand } from "./bundled/pakalon/commands/penpot";
import { Phase1Command } from "./bundled/pakalon/commands/phase-1";
import { Phase2Command } from "./bundled/pakalon/commands/phase-2";
import { Phase3Command } from "./bundled/pakalon/commands/phase-3";
import { Phase4Command } from "./bundled/pakalon/commands/phase-4";
import { Phase5Command } from "./bundled/pakalon/commands/phase-5";
import { Phase6Command } from "./bundled/pakalon/commands/phase-6";
import { PlanCommand } from "./bundled/pakalon/commands/plan";
import { ResumeCommand } from "./bundled/pakalon/commands/resume";
import { SessionCommand } from "./bundled/pakalon/commands/session";
import { UndoCommand } from "./bundled/pakalon/commands/undo";
import { UpdateCommand } from "./bundled/pakalon/commands/update";
import { WebCommand } from "./bundled/pakalon/commands/web";
import { ReviewCommand } from "./bundled/review";
import type {
	CustomCommand,
	CustomCommandAPI,
	CustomCommandFactory,
	CustomCommandSource,
	CustomCommandsLoadResult,
	LoadedCustomCommand,
} from "./types";

/**
 * Load a single command module using native Bun import.
 */
async function loadCommandModule(
	commandPath: string,
	_cwd: string,
	sharedApi: CustomCommandAPI,
): Promise<{ commands: CustomCommand[] | null; error: string | null }> {
	try {
		const module = await import(commandPath);
		const factory = (module.default ?? module) as CustomCommandFactory;

		if (typeof factory !== "function") {
			return { commands: null, error: "Command must export a default function" };
		}

		const result = await factory(sharedApi);
		const commands = Array.isArray(result) ? result : [result];

		// Validate commands
		for (const cmd of commands) {
			if (!cmd.name || typeof cmd.name !== "string") {
				return { commands: null, error: "Command must have a name" };
			}
			if (!cmd.description || typeof cmd.description !== "string") {
				return { commands: null, error: `Command "${cmd.name}" must have a description` };
			}
			if (typeof cmd.execute !== "function") {
				return { commands: null, error: `Command "${cmd.name}" must have an execute function` };
			}
		}

		return { commands, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { commands: null, error: `Failed to load command: ${message}` };
	}
}

export interface DiscoverCustomCommandsOptions {
	/** Current working directory. Default: getProjectDir() */
	cwd?: string;
	/** Agent config directory. Default: from getAgentDir() */
	agentDir?: string;
}

export interface DiscoverCustomCommandsResult {
	/** Paths to command modules */
	paths: Array<{ path: string; source: CustomCommandSource }>;
}

/**
 * Discover custom command modules (TypeScript slash commands).
 * Markdown slash commands are handled by core/slash-commands.ts.
 */
export async function discoverCustomCommands(
	options: DiscoverCustomCommandsOptions = {},
): Promise<DiscoverCustomCommandsResult> {
	const cwd = options.cwd ?? getProjectDir();
	const agentDir = options.agentDir ?? getAgentDir();
	const paths: Array<{ path: string; source: CustomCommandSource }> = [];
	const seen = new Set<string>();

	const addPath = (commandPath: string, source: CustomCommandSource): void => {
		const resolved = path.resolve(commandPath);
		if (seen.has(resolved)) return;
		seen.add(resolved);
		paths.push({ path: resolved, source });
	};

	const commandDirs: Array<{ path: string; source: CustomCommandSource }> = [];
	if (agentDir) {
		const userCommandsDir = path.join(agentDir, "commands");
		if (fs.existsSync(userCommandsDir)) {
			commandDirs.push({ path: userCommandsDir, source: "user" });
		}
	}

	for (const entry of getConfigDirs("commands", { cwd, existingOnly: true })) {
		const source = entry.level === "user" ? "user" : "project";
		if (!commandDirs.some(d => d.path === entry.path)) {
			commandDirs.push({ path: entry.path, source });
		}
	}

	const indexCandidates = ["index.ts", "index.js", "index.mjs", "index.cjs"];
	for (const { path: commandsDir, source } of commandDirs) {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(commandsDir, { withFileTypes: true });
		} catch (error) {
			if (!isEnoent(error)) {
				logger.warn("Failed to read custom commands directory", { path: commandsDir, error: String(error) });
			}
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
			const commandDir = path.join(commandsDir, entry.name);

			for (const filename of indexCandidates) {
				const candidate = path.join(commandDir, filename);
				if (fs.existsSync(candidate)) {
					addPath(candidate, source);
					break;
				}
			}
		}
	}

	return { paths };
}

export interface LoadCustomCommandsOptions {
	/** Current working directory. Default: getProjectDir() */
	cwd?: string;
	/** Agent config directory. Default: from getAgentDir() */
	agentDir?: string;
}

/**
 * Load bundled commands (shipped with pi-coding-agent).
 */
function loadBundledCommands(sharedApi: CustomCommandAPI): LoadedCustomCommand[] {
	const bundled: LoadedCustomCommand[] = [];

	// Add bundled commands here
	bundled.push({
		path: "bundled:green",
		resolvedPath: "bundled:green",
		command: new GreenCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:review",
		resolvedPath: "bundled:review",
		command: new ReviewCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon",
		resolvedPath: "bundled:pakalon",
		command: new PakalonCommand(sharedApi),
		source: "bundled",
	});

	// Pakalon slash commands
	bundled.push({
		path: "bundled:pakalon-init",
		resolvedPath: "bundled:pakalon-init",
		command: new InitCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-plan",
		resolvedPath: "bundled:pakalon-plan",
		command: new PlanCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-build",
		resolvedPath: "bundled:pakalon-build",
		command: new BuildCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-agents",
		resolvedPath: "bundled:pakalon-agents",
		command: new AgentsCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-history",
		resolvedPath: "bundled:pakalon-history",
		command: new HistoryCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-session",
		resolvedPath: "bundled:pakalon-session",
		command: new SessionCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-resume",
		resolvedPath: "bundled:pakalon-resume",
		command: new ResumeCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-new",
		resolvedPath: "bundled:pakalon-new",
		command: new NewCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-undo",
		resolvedPath: "bundled:pakalon-undo",
		command: new UndoCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-models",
		resolvedPath: "bundled:pakalon-models",
		command: new ModelsCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-update",
		resolvedPath: "bundled:pakalon-update",
		command: new UpdateCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-ans",
		resolvedPath: "bundled:pakalon-ans",
		command: new AnsCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-automations",
		resolvedPath: "bundled:pakalon-automations",
		command: new AutomationsCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-web",
		resolvedPath: "bundled:pakalon-web",
		command: new WebCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-logout",
		resolvedPath: "bundled:pakalon-logout",
		command: new LogoutCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-penpot",
		resolvedPath: "bundled:pakalon-penpot",
		command: new PenpotCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-phase-1",
		resolvedPath: "bundled:pakalon-phase-1",
		command: new Phase1Command(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-phase-2",
		resolvedPath: "bundled:pakalon-phase-2",
		command: new Phase2Command(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-phase-3",
		resolvedPath: "bundled:pakalon-phase-3",
		command: new Phase3Command(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-phase-4",
		resolvedPath: "bundled:pakalon-phase-4",
		command: new Phase4Command(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-phase-5",
		resolvedPath: "bundled:pakalon-phase-5",
		command: new Phase5Command(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-phase-6",
		resolvedPath: "bundled:pakalon-phase-6",
		command: new Phase6Command(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-auditor",
		resolvedPath: "bundled:pakalon-auditor",
		command: new AuditorCommand(sharedApi),
		source: "bundled",
	});
	bundled.push({
		path: "bundled:pakalon-help",
		resolvedPath: "bundled:pakalon-help",
		command: new HelpCommand(sharedApi),
		source: "bundled",
	});

	return bundled;
}

/**
 * Discover and load custom commands from standard locations.
 */
export async function loadCustomCommands(options: LoadCustomCommandsOptions = {}): Promise<CustomCommandsLoadResult> {
	const cwd = options.cwd ?? getProjectDir();
	const agentDir = options.agentDir ?? getAgentDir();

	const { paths } = await discoverCustomCommands({ cwd, agentDir });

	const commands: LoadedCustomCommand[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	const seenNames = new Set<string>();

	// Shared API object - all commands get the same instance
	const sharedApi: CustomCommandAPI = {
		cwd,
		exec: (command: string, args: string[], execOptions) =>
			execCommand(command, args, execOptions?.cwd ?? cwd, execOptions),
		typebox,
		zod,
		pi: await import("@oh-my-pi/pi-coding-agent"),
	};

	// 1. Load bundled commands first (lowest priority - can be overridden)
	for (const loaded of loadBundledCommands(sharedApi)) {
		seenNames.add(loaded.command.name);
		commands.push(loaded);
	}

	// 2. Load user/project commands (can override bundled)
	for (const { path: commandPath, source } of paths) {
		const { commands: loadedCommands, error } = await loadCommandModule(commandPath, cwd, sharedApi);

		if (error) {
			errors.push({ path: commandPath, error });
			continue;
		}

		if (loadedCommands) {
			for (const command of loadedCommands) {
				// Allow overriding bundled commands, but not user/project conflicts
				const existingIdx = commands.findIndex(c => c.command.name === command.name);
				if (existingIdx !== -1) {
					const existing = commands[existingIdx];
					if (existing.source === "bundled") {
						// Override bundled command
						commands.splice(existingIdx, 1);
						seenNames.delete(command.name);
					} else {
						// Conflict between user/project commands
						errors.push({
							path: commandPath,
							error: `Command name "${command.name}" conflicts with existing command`,
						});
						continue;
					}
				}

				seenNames.add(command.name);
				commands.push({
					path: commandPath,
					resolvedPath: path.resolve(commandPath),
					command,
					source,
				});
			}
		}
	}

	return { commands, errors };
}
