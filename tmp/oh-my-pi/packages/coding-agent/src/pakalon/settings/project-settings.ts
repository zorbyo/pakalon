/**
 * Settings.local.json — per-project permission persistence.
 *
 * When the user clicks "allow always" in any approval prompt, the
 * decision is saved here. On session start, the file is read and
 * merged with the project settings.
 *
 * File location: `<project>/.pakalon/settings.local.json`
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

const FILE = "settings.local.json";
const REL_DIR = ".pakalon";

export interface ProjectSettings {
	allowedPermissions: Record<string, boolean>;
	autoAcceptTools: string[];
	deniedTools: string[];
	defaultModel?: string;
	thinkingLevel?: "low" | "medium" | "high";
	permissionMode?: "plan" | "edit" | "auto-accept" | "bypass";
	/** A per-session override for the model id. */
	sessionModel?: string;
	/** Tools that should never prompt, even in edit mode. */
	alwaysAllow?: string[];
	/** A free-form notes field. */
	notes?: string;
}

const DEFAULT: ProjectSettings = {
	allowedPermissions: {},
	autoAcceptTools: [],
	deniedTools: [],
};

/** Path to the project's settings.local.json. */
export function settingsLocalPath(projectDir: string): string {
	return path.join(projectDir, REL_DIR, FILE);
}

/** Load (or create + return defaults) the project settings. */
export function loadProjectSettings(projectDir: string): ProjectSettings {
	const file = settingsLocalPath(projectDir);
	try {
		const raw = fs.readFileSync(file, "utf-8");
		return { ...DEFAULT, ...JSON.parse(raw) } as ProjectSettings;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return { ...DEFAULT };
		}
		logger.warn("settings.local.json: failed to parse, using defaults", { file, err });
		return { ...DEFAULT };
	}
}

/** Persist project settings. Auto-creates the `.pakalon` directory. */
export function saveProjectSettings(projectDir: string, settings: ProjectSettings): void {
	const file = settingsLocalPath(projectDir);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

/** Add or remove a single "always allow" rule. */
export function setAllowedPermission(projectDir: string, key: string, value: boolean): ProjectSettings {
	const current = loadProjectSettings(projectDir);
	const next: ProjectSettings = {
		...current,
		allowedPermissions: { ...current.allowedPermissions, [key]: value },
	};
	saveProjectSettings(projectDir, next);
	return next;
}

/** Mark a tool as auto-accept (skip the approval prompt). */
export function setAutoAcceptTool(projectDir: string, tool: string, on: boolean): ProjectSettings {
	const current = loadProjectSettings(projectDir);
	const tools = new Set(current.autoAcceptTools);
	if (on) tools.add(tool);
	else tools.delete(tool);
	const next: ProjectSettings = { ...current, autoAcceptTools: [...tools] };
	saveProjectSettings(projectDir, next);
	return next;
}

/** Mark a tool as always-denied. */
export function setDeniedTool(projectDir: string, tool: string, on: boolean): ProjectSettings {
	const current = loadProjectSettings(projectDir);
	const tools = new Set(current.deniedTools);
	if (on) tools.add(tool);
	else tools.delete(tool);
	const next: ProjectSettings = { ...current, deniedTools: [...tools] };
	saveProjectSettings(projectDir, next);
	return next;
}

/** Return the auto-accept list, merging with the global defaults. */
export function effectiveAutoAccept(projectDir: string, globalAutoAccept: readonly string[] = []): string[] {
	const local = loadProjectSettings(projectDir);
	return [...new Set([...globalAutoAccept, ...local.autoAcceptTools])];
}

/** Whether the given tool+command is explicitly allowed. */
export function isPermissionAllowed(projectDir: string, key: string): boolean {
	const local = loadProjectSettings(projectDir);
	return local.allowedPermissions[key] === true;
}

/**
 * Set a tool to "always allow" (no approval prompt for the rest of
 * the session, persisted across sessions). Per CLI-req.md §701:
 * "when the user have given the permission like 'allow always'
 * then those permission settings should be saved by creating
 * .pakalon/settings.local.json".
 */
export function setAlwaysAllow(projectDir: string, tool: string, on: boolean = true): ProjectSettings {
	const current = loadProjectSettings(projectDir);
	const set = new Set(current.alwaysAllow ?? []);
	if (on) set.add(tool);
	else set.delete(tool);
	const next: ProjectSettings = { ...current, alwaysAllow: [...set] };
	saveProjectSettings(projectDir, next);
	return next;
}

/** Whether the tool is in the alwaysAllow list. */
export function isAlwaysAllowed(projectDir: string, tool: string): boolean {
	const local = loadProjectSettings(projectDir);
	return (local.alwaysAllow ?? []).includes(tool);
}
