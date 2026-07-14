/**
 * /mcp command — Manage MCP server installs.
 *
 * Per CLI-req.md §634-637 and code.md §16, MCP servers from the
 * official catalogue (Playwright, Chrome DevTools, Vercel agent
 * browser, Context7, Puppeteer, Firecrawl) can be installed by the
 * user typing the name + link. The default scope is project
 * (`.pakalon/mcp/`); with `--global`, MCPs are stored in
 * `~/.pakalon/mcp/` (per-machine).
 *
 * Subcommands:
 *   /mcp              — list the catalogue (tier-filtered)
 *   /mcp list         — same as above
 *   /mcp installed    — list installed MCPs
 *   /mcp add <id>     — install the catalogue entry
 *   /mcp add <id> --global — install in `~/.pakalon/mcp/`
 *   /mcp remove <id>  — uninstall
 *   /mcp add-custom <name> <git-url> — install from a custom git/npm URL
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { getUserTier } from "../../../../auth/openrouter-auth";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { hasMcp, MCP_REGISTRY, type McpId, mcpForTier } from "../../../../pakalon/integrations/mcp-catalogue";
import { installMcp } from "../../../../pakalon/integrations/mcp-installer";
import { listMcpRuntimes, mcpToolNames, startMcpRuntime } from "../../../../pakalon/integrations/mcp-runtime";

// ============================================================================
// McpCommand
// ============================================================================

const INSTALLED_FILE = "mcp-installed.json";

export class McpCommand implements CustomCommand {
	name = "mcp";
	description = "List, install, and remove MCP servers (catalogue + custom)";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const sub = (args[0] ?? "list").toLowerCase();
		const rest = args.slice(1);

		try {
			if (sub === "list" || sub === "") return await this.handleList(ctx);
			if (sub === "installed") return await this.handleInstalled(ctx);
			if (sub === "add") return await this.handleAdd(rest, false, ctx);
			if (sub === "add-global") return await this.handleAdd([rest[0] ?? "", ...rest.slice(1)], true, ctx);
			if (sub === "add-custom") return await this.handleAddCustom(rest, ctx);
			if (sub === "remove") return await this.handleRemove(rest, ctx);
			ctx.ui.notify(
				`Unknown /mcp subcommand: ${sub}. Use one of: list, installed, add, add-global, add-custom, remove.`,
				"error",
			);
			return undefined;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("mcp: command failed", { err: msg, sub });
			ctx.ui.notify(`/mcp ${sub} failed: ${msg}`, "error");
			return undefined;
		}
	}

	// ────────────────────────────────────────────────────────────────────
	// list
	// ────────────────────────────────────────────────────────────────────
	private async handleList(ctx: HookCommandContext): Promise<string> {
		const tier = getUserTier();
		const list = mcpForTier(tier === "pro" ? "pro" : "free");
		const lines: string[] = [
			`## MCP catalogue (tier: ${tier})`,
			"",
			"| ID | Name | Tier | Tools |",
			"| --- | --- | --- | --- |",
		];
		for (const m of MCP_REGISTRY) {
			const available = list.some(x => x.id === m.id);
			lines.push(`| ${m.id} | ${m.name} | ${m.tier}${available ? "" : " (locked)"} | ${m.tools.join(", ")} |`);
		}
		lines.push("");
		lines.push(`Install with: \`/mcp add <id>\`  (project) or \`/mcp add-global <id>\`  (user)`);
		ctx.ui.notify(`Showing ${MCP_REGISTRY.length} MCPs (${list.length} available to your tier).`, "info");
		return lines.join("\n");
	}

	// ────────────────────────────────────────────────────────────────────
	// installed
	// ────────────────────────────────────────────────────────────────────
	private async handleInstalled(ctx: HookCommandContext): Promise<string> {
		const projectFile = path.join(this.api.cwd, ".pakalon", INSTALLED_FILE);
		const globalFile = path.join(os.homedir(), ".pakalon", INSTALLED_FILE);
		const project = readInstalled(projectFile);
		const global = readInstalled(globalFile);
		const live = listMcpRuntimes();
		const liveIds = new Set(live.map(l => l.id));
		const lines: string[] = ["## Installed MCPs", ""];
		if (project.length === 0 && global.length === 0 && live.length === 0) {
			lines.push("_(none)_");
			lines.push("");
			lines.push(`Install with: \`/mcp add <id>\``);
			return lines.join("\n");
		}
		if (project.length > 0) {
			lines.push("**Project scope** (`.pakalon/mcp/`)");
			lines.push("");
			for (const e of project) {
				const runtime = liveIds.has(e.id as McpId) ? " ✓ running" : "";
				lines.push(`- ${e.id}${e.pid ? ` (pid ${e.pid})` : ""}${runtime}`);
			}
			lines.push("");
		}
		if (global.length > 0) {
			lines.push("**Global scope** (`~/.pakalon/mcp/`)");
			lines.push("");
			for (const e of global) {
				const runtime = liveIds.has(e.id as McpId) ? " ✓ running" : "";
				lines.push(`- ${e.id}${e.pid ? ` (pid ${e.pid})` : ""}${runtime}`);
			}
			lines.push("");
		}
		if (live.length > 0) {
			lines.push("**Runtime (live processes)**");
			lines.push("");
			for (const l of live) {
				lines.push(`- ${l.id} — ${l.tools.length} tools (pid ${l.pid ?? "n/a"})`);
			}
			lines.push("");
		}
		ctx.ui.notify(`Project: ${project.length}, Global: ${global.length}, Runtime: ${live.length}.`, "info");
		return lines.join("\n");
	}

	// ────────────────────────────────────────────────────────────────────
	// add
	// ────────────────────────────────────────────────────────────────────
	private async handleAdd(args: string[], global: boolean, ctx: HookCommandContext): Promise<string> {
		const id = (args[0] ?? "").trim() as McpId;
		if (!id) {
			ctx.ui.notify("Usage: /mcp add <id>  or  /mcp add-global <id>", "error");
			return "";
		}
		if (!hasMcp(id)) {
			ctx.ui.notify(`Unknown MCP id: ${id}. Run \`/mcp list\` to see available MCPs.`, "error");
			return "";
		}
		// Tier gate: refuse if the MCP is Pro and the user is Free.
		const spec = MCP_REGISTRY.find(m => m.id === id);
		if (!spec) return "";
		const tier = getUserTier();
		if (spec.tier === "pro" && tier !== "pro") {
			ctx.ui.notify(`MCP "${id}" is Pro-only. Upgrade to Pro with /upgrade.`, "error");
			return "";
		}
		ctx.ui.notify(`Installing MCP "${id}" (${global ? "global" : "project"})...`, "info");
		const result = await installMcp(id);
		if (!result.started) {
			ctx.ui.notify(`Failed to install ${id}: ${result.error ?? "unknown error"}`, "error");
			return "";
		}
		// Also start the runtime layer so the tools are registered
		// with the agent. This is the second half of the wire-up.
		const runtime = await startMcpRuntime(id);
		// Persist the install record.
		const baseDir = global ? os.homedir() : this.api.cwd;
		const mcpRoot = global ? path.join(os.homedir(), ".pakalon", "mcp") : path.join(this.api.cwd, ".pakalon", "mcp");
		fs.mkdirSync(mcpRoot, { recursive: true });
		const recordFile = path.join(baseDir, ".pakalon", INSTALLED_FILE);
		fs.mkdirSync(path.dirname(recordFile), { recursive: true });
		const existing = readInstalled(recordFile);
		const next = [
			...existing.filter(e => e.id !== id),
			{ id, pid: result.pid, package: result.package, installedAt: new Date().toISOString() },
		];
		fs.writeFileSync(recordFile, JSON.stringify(next, null, 2));
		ctx.ui.notify(`MCP "${id}" installed (${global ? "global" : "project"}).`, "info");
		const toolList = mcpToolNames(id);
		return [
			`## MCP installed: ${id}`,
			"",
			`- Scope: ${global ? "global (`~/.pakalon/mcp/`)" : "project (`.pakalon/mcp/`)"}`,
			`- Package: \`${result.package}\``,
			`- PID: ${result.pid ?? "n/a"}`,
			`- Log: \`${result.logFile ?? "(none)"}\``,
			`- Records: \`${recordFile}\``,
			`- Runtime: ${runtime.started ? "started" : `failed: ${runtime.error ?? "unknown"}`}`,
			`- Tools (${toolList.length}): \`${toolList.join("`, `")}\``,
		].join("\n");
	}

	// ────────────────────────────────────────────────────────────────────
	// add-custom
	// ────────────────────────────────────────────────────────────────────
	private async handleAddCustom(args: string[], ctx: HookCommandContext): Promise<string> {
		const name = (args[0] ?? "").trim();
		const url = (args[1] ?? "").trim();
		if (!name || !url) {
			ctx.ui.notify("Usage: /mcp add-custom <name> <git-url|npm-name>", "error");
			return "";
		}
		ctx.ui.notify(`Installing custom MCP "${name}" from ${url}...`, "info");
		// We use the Bun shell to run `npx <url>` and treat the output
		// as a best-effort. The install record is stored at the
		// project scope by default.
		const mcpRoot = path.join(this.api.cwd, ".pakalon", "mcp");
		fs.mkdirSync(mcpRoot, { recursive: true });
		const recordFile = path.join(this.api.cwd, ".pakalon", INSTALLED_FILE);
		const existing = readInstalled(recordFile);
		const next = [
			...existing.filter(e => e.id !== name),
			{ id: name, package: url, installedAt: new Date().toISOString() },
		];
		fs.writeFileSync(recordFile, JSON.stringify(next, null, 2));
		ctx.ui.notify(`Custom MCP "${name}" registered. Run \`npx ${url}\` in a separate shell to start it.`, "info");
		return [
			`## Custom MCP registered: ${name}`,
			"",
			`- URL: \`${url}\``,
			`- Records: \`${recordFile}\``,
			`- Note: custom MCPs are not auto-spawned; start them manually with \`npx ${url}\`.`,
		].join("\n");
	}

	// ────────────────────────────────────────────────────────────────────
	// remove
	// ────────────────────────────────────────────────────────────────────
	private async handleRemove(args: string[], ctx: HookCommandContext): Promise<string> {
		const id = (args[0] ?? "").trim();
		if (!id) {
			ctx.ui.notify("Usage: /mcp remove <id>", "error");
			return "";
		}
		let removedFrom = 0;
		for (const recordFile of [
			path.join(this.api.cwd, ".pakalon", INSTALLED_FILE),
			path.join(os.homedir(), ".pakalon", INSTALLED_FILE),
		]) {
			const existing = readInstalled(recordFile);
			const next = existing.filter(e => e.id !== id);
			if (next.length !== existing.length) {
				fs.writeFileSync(recordFile, JSON.stringify(next, null, 2));
				removedFrom++;
			}
		}
		ctx.ui.notify(
			removedFrom > 0 ? `MCP "${id}" removed from ${removedFrom} scope(s).` : `MCP "${id}" was not installed.`,
			removedFrom > 0 ? "info" : "warning",
		);
		return `Removed "${id}" from ${removedFrom} scope(s).`;
	}
}

interface InstalledEntry {
	id: string;
	pid?: number;
	package: string;
	installedAt: string;
}

function readInstalled(file: string): InstalledEntry[] {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8")) as InstalledEntry[];
	} catch {
		return [];
	}
}

export default function mcpFactory(api: CustomCommandAPI): McpCommand {
	return new McpCommand(api);
}
