/**
 * Per-scope MCP server installation.
 *
 * Global scope: `~/.pakalon/mcp-servers/<name>/`
 * Project scope: `<project>/.pakalon-agents/mcp-servers/<name>/`
 *
 * The CLI looks for installed servers in this order:
 *   1. project-scope (highest priority)
 *   2. global-scope
 *   3. bundled defaults
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export type MCPScope = "global" | "project";

export interface MCPServerSpec {
	name: string;
	/** Either an npm package name, a docker image, or a local path. */
	source: string;
	scope: MCPScope;
	/** Optional env vars to set when launching the server. */
	env?: Record<string, string>;
	/** Optional args appended after the resolved entrypoint. */
	args?: string[];
	/** Persisted at install time. */
	installedAt: string;
}

export interface MCPInstallResult {
	ok: boolean;
	path?: string;
	error?: string;
}

const GLOBAL_DIR = path.join(os.homedir(), ".pakalon", "mcp-servers");

function globalDir(): string {
	return GLOBAL_DIR;
}

function projectDir(projectRoot: string): string {
	return path.join(projectRoot, ".pakalon-agents", "mcp-servers");
}

function ensureDir(p: string): void {
	if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function specFile(scopeDir: string, name: string): string {
	return path.join(scopeDir, name, "spec.json");
}

function readSpec(scopeDir: string, name: string): MCPServerSpec | null {
	try {
		return JSON.parse(fs.readFileSync(specFile(scopeDir, name), "utf-8")) as MCPServerSpec;
	} catch {
		return null;
	}
}

/**
 * Install (or update) an MCP server spec into the requested scope.
 * The actual MCP server binary is expected to be launched by the
 * existing MCP client in packages/mcp/ — this module only manages
 * the spec file that tells the client where the binary lives.
 */
export function installMCPServer(
	name: string,
	source: string,
	scope: MCPScope,
	projectRoot?: string,
	extra?: Pick<MCPServerSpec, "env" | "args">,
): MCPInstallResult {
	if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
		return { ok: false, error: "invalid name (allowed: a-z, 0-9, _, ., -)" };
	}
	const dir = scope === "global" ? globalDir() : projectDir(projectRoot ?? process.cwd());
	if (scope === "project" && !projectRoot) {
		return { ok: false, error: "project scope requires a project root" };
	}
	ensureDir(dir);
	const target = path.join(dir, name);
	ensureDir(target);

	const spec: MCPServerSpec = {
		name,
		source,
		scope,
		env: extra?.env,
		args: extra?.args,
		installedAt: new Date().toISOString(),
	};
	fs.writeFileSync(specFile(dir, name), JSON.stringify(spec, null, 2), { mode: 0o644 });
	logger.info("MCP server installed", { name, scope, target });
	return { ok: true, path: target };
}

export function removeMCPServer(name: string, scope: MCPScope, projectRoot?: string): MCPInstallResult {
	const dir = scope === "global" ? globalDir() : projectDir(projectRoot ?? process.cwd());
	const target = path.join(dir, name);
	if (!fs.existsSync(target)) return { ok: false, error: "not installed" };
	fs.rmSync(target, { recursive: true, force: true });
	logger.info("MCP server removed", { name, scope });
	return { ok: true };
}

/**
 * List installed MCP servers across both scopes. Project-scope wins
 * when the same name is installed in both.
 */
export function listMCPServers(projectRoot?: string): MCPServerSpec[] {
	const out: MCPServerSpec[] = [];
	if (fs.existsSync(globalDir())) {
		for (const name of fs.readdirSync(globalDir())) {
			const spec = readSpec(globalDir(), name);
			if (spec) out.push({ ...spec, scope: "global" });
		}
	}
	if (projectRoot && fs.existsSync(projectDir(projectRoot))) {
		for (const name of fs.readdirSync(projectDir(projectRoot))) {
			const spec = readSpec(projectDir(projectRoot), name);
			if (spec) out.push({ ...spec, scope: "project" });
		}
	}
	return out;
}

/**
 * Resolve a single MCP server by name, with project-scope taking
 * priority over global. Returns the spec + its on-disk path.
 */
export function resolveMCPServer(name: string, projectRoot?: string): { spec: MCPServerSpec; path: string } | null {
	if (projectRoot) {
		const spec = readSpec(projectDir(projectRoot), name);
		if (spec) return { spec, path: path.join(projectDir(projectRoot), name) };
	}
	const spec = readSpec(globalDir(), name);
	if (spec) return { spec, path: path.join(globalDir(), name) };
	return null;
}
