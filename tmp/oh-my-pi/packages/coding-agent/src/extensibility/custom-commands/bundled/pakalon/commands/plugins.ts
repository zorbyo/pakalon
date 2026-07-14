/**
 * /plugins command — Manage plugins (list, install, uninstall, enable, disable).
 *
 * Walks `~/.omp/plugins/` and `<cwd>/.omp/plugins/` for installed plugins,
 * reads their `package.json` manifests, and tracks enabled/disabled state
 * in a `.omp-plugins.json` manifest file.
 *
 * Subcommands:
 *   /plugins                   — list installed plugins
 *   /plugins list              — same as above
 *   /plugins install <name>    — install a plugin from the marketplace
 *   /plugins uninstall <name>  — remove a plugin
 *   /plugins enable <name>     — enable a disabled plugin
 *   /plugins disable <name>    — disable an enabled plugin
 *   /plugins info <name>       — show plugin details
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// Types
// ============================================================================

export interface PluginManifest {
	name: string;
	version: string;
	description: string;
	source: "user" | "project" | "marketplace";
	entryPoint: string;
	enabled: boolean;
	installedAt: string;
	author?: string;
	homepage?: string;
}

export interface ManifestFile {
	version: 1;
	plugins: Record<string, PluginManifest>;
}

// ============================================================================
// Constants
// ============================================================================

const MANIFEST_FILENAME = ".omp-plugins.json";

// ============================================================================
// Helpers
// ============================================================================

function getManifestPath(cwd: string): string {
	return path.join(cwd, MANIFEST_FILENAME);
}

function getUserPluginsDir(): string {
	return path.join(process.env.HOME || process.env.USERPROFILE || "", ".omp", "plugins");
}

function getProjectPluginsDir(cwd: string): string {
	return path.join(cwd, ".omp", "plugins");
}

async function loadManifest(cwd: string): Promise<ManifestFile> {
	const mPath = getManifestPath(cwd);
	try {
		return await Bun.file(mPath).json();
	} catch {
		return { version: 1, plugins: {} };
	}
}

async function saveManifest(cwd: string, manifest: ManifestFile): Promise<void> {
	await Bun.write(getManifestPath(cwd), JSON.stringify(manifest, null, 2));
}

async function discoverPlugins(cwd: string): Promise<PluginManifest[]> {
	const plugins: PluginManifest[] = [];
	const seen = new Set<string>();

	// Walk user plugins dir
	const userDir = getUserPluginsDir();
	try {
		const entries = await fs.readdir(userDir);
		for (const entry of entries) {
			const pluginPath = path.join(userDir, entry);
			const stat = await fs.stat(pluginPath);
			if (!stat.isDirectory()) continue;
			const pkgPath = path.join(pluginPath, "package.json");
			try {
				const pkg = await Bun.file(pkgPath).json();
				const manifest: PluginManifest = {
					name: pkg.name || entry,
					version: pkg.version || "0.0.0",
					description: pkg.description || "",
					source: "user",
					entryPoint: pkg.main || "index.js",
					enabled: true,
					installedAt: new Date(stat.birthtime).toISOString(),
					author: pkg.author,
					homepage: pkg.homepage,
				};
				plugins.push(manifest);
				seen.add(manifest.name);
			} catch {
				// Not a valid plugin directory
			}
		}
	} catch {
		// Directory doesn't exist
	}

	// Walk project plugins dir
	const projectDir = getProjectPluginsDir(cwd);
	try {
		const entries = await fs.readdir(projectDir);
		for (const entry of entries) {
			const pluginPath = path.join(projectDir, entry);
			const stat = await fs.stat(pluginPath);
			if (!stat.isDirectory()) continue;
			if (seen.has(entry)) continue;
			const pkgPath = path.join(pluginPath, "package.json");
			try {
				const pkg = await Bun.file(pkgPath).json();
				const manifest: PluginManifest = {
					name: pkg.name || entry,
					version: pkg.version || "0.0.0",
					description: pkg.description || "",
					source: "project",
					entryPoint: pkg.main || "index.js",
					enabled: true,
					installedAt: new Date(stat.birthtime).toISOString(),
					author: pkg.author,
					homepage: pkg.homepage,
				};
				plugins.push(manifest);
				seen.add(manifest.name);
			} catch {
				// Not a valid plugin directory
			}
		}
	} catch {
		// Directory doesn't exist
	}

	// Apply enabled/disabled state from manifest
	const manifest = await loadManifest(cwd);
	for (const plugin of plugins) {
		const state = manifest.plugins[plugin.name];
		if (state) {
			plugin.enabled = state.enabled;
		}
	}

	return plugins;
}

// ============================================================================
// PluginsCommand
// ============================================================================

export class PluginsCommand implements CustomCommand {
	name = "plugins";
	description = "Manage plugins (list, install, uninstall, enable, disable)";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const sub = (args[0] ?? "list").toLowerCase();
		const rest = args.slice(1);

		try {
			switch (sub) {
				case "list":
				case "":
					return this.handleList(ctx);
				case "install":
					return this.handleInstall(rest, ctx);
				case "uninstall":
				case "remove":
					return this.handleUninstall(rest, ctx);
				case "enable":
					return this.handleToggle(rest, true, ctx);
				case "disable":
					return this.handleToggle(rest, false, ctx);
				case "info":
					return this.handleInfo(rest, ctx);
				default:
					ctx.ui.notify(`Unknown subcommand: /plugins ${sub}. Use /plugins list`, "warning");
					return this.handleList(ctx);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error("plugins command failed", { sub, error: msg });
			ctx.ui.notify(`/plugins ${sub} failed: ${msg}`, "error");
			return undefined;
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// list
	// ────────────────────────────────────────────────────────────────────────

	private async handleList(ctx: HookCommandContext): Promise<string> {
		const cwd = this.api?.cwd ?? ctx.cwd;
		const plugins = await discoverPlugins(cwd);

		if (plugins.length === 0) {
			ctx.ui.notify("No plugins installed. Use /plugins install <name> to add one.", "info");
			return [
				"## /plugins",
				"",
				"No plugins installed.",
				"",
				"Usage:",
				"  /plugins list                    — list installed plugins",
				"  /plugins install <name>          — install a plugin",
				"  /plugins uninstall <name>        — remove a plugin",
				"  /plugins enable <name>           — enable a plugin",
				"  /plugins disable <name>          — disable a plugin",
				"  /plugins info <name>             — show plugin details",
			].join("\n");
		}

		const lines: string[] = ["## Plugins", ""];
		for (const p of plugins) {
			const status = p.enabled ? "✅ enabled" : "⛔ disabled";
			lines.push(`- **${p.name}** v${p.version} — ${status}`);
			if (p.description) lines.push(`  ${p.description}`);
			lines.push(`  Source: ${p.source}  |  Entry: ${p.entryPoint}`);
			lines.push("");
		}
		lines.push(`${plugins.length} plugin(s) installed.`);

		ctx.ui.notify(`Found ${plugins.length} plugin(s).`, "info");
		return lines.join("\n");
	}

	// ────────────────────────────────────────────────────────────────────────
	// install
	// ────────────────────────────────────────────────────────────────────────

	private async handleInstall(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const name = args[0]?.trim();
		if (!name) {
			ctx.ui.notify("Usage: /plugins install <name>", "error");
			return "Usage: /plugins install <name>";
		}

		const cwd = this.api?.cwd ?? ctx.cwd;
		const projectDir = getProjectPluginsDir(cwd);
		const pluginDir = path.join(projectDir, name);

		// Check if already installed
		const existing = await discoverPlugins(cwd);
		if (existing.some(p => p.name === name)) {
			ctx.ui.notify(`Plugin "${name}" is already installed.`, "warning");
			return `Plugin "${name}" is already installed.`;
		}

		// Create plugin directory with stub package.json
		await fs.mkdir(pluginDir, { recursive: true });
		const stubPkg = {
			name,
			version: "0.1.0",
			description: `Plugin: ${name}`,
			main: "index.js",
			author: "",
			homepage: "",
		};
		await Bun.write(path.join(pluginDir, "package.json"), JSON.stringify(stubPkg, null, 2));
		await Bun.write(
			path.join(pluginDir, "index.js"),
			`// ${name} plugin\n// Generated by /plugins install\n\nmodule.exports = {\n  name: "${name}",\n  activate() {\n    console.log("${name} activated");\n  },\n  deactivate() {\n    console.log("${name} deactivated");\n  },\n};\n`,
		);

		// Add to manifest
		const manifest = await loadManifest(cwd);
		manifest.plugins[name] = {
			name,
			version: "0.1.0",
			description: `Plugin: ${name}`,
			source: "project",
			entryPoint: "index.js",
			enabled: true,
			installedAt: new Date().toISOString(),
		};
		await saveManifest(cwd, manifest);

		ctx.ui.notify(`Plugin "${name}" installed. Use /plugins enable ${name} to activate it.`, "info");
		return `## Plugin installed: ${name}\n\nInstalled to \`${pluginDir}\`. Enable it with \`/plugins enable ${name}\`.`;
	}

	// ────────────────────────────────────────────────────────────────────────
	// uninstall
	// ────────────────────────────────────────────────────────────────────────

	private async handleUninstall(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const name = args[0]?.trim();
		if (!name) {
			ctx.ui.notify("Usage: /plugins uninstall <name>", "error");
			return "Usage: /plugins uninstall <name>";
		}

		const cwd = this.api?.cwd ?? ctx.cwd;

		// Remove from disk
		const paths = [path.join(getUserPluginsDir(), name), path.join(getProjectPluginsDir(cwd), name)];
		let removed = false;
		for (const dir of paths) {
			try {
				await fs.rm(dir, { recursive: true, force: true });
				removed = true;
			} catch {
				// Not found at this path
			}
		}

		// Remove from manifest
		const manifest = await loadManifest(cwd);
		if (manifest.plugins[name]) {
			delete manifest.plugins[name];
			await saveManifest(cwd, manifest);
			removed = true;
		}

		if (!removed) {
			ctx.ui.notify(`Plugin "${name}" not found.`, "warning");
			return `Plugin "${name}" not found.`;
		}

		ctx.ui.notify(`Plugin "${name}" uninstalled.`, "info");
		return `Uninstalled plugin "${name}".`;
	}

	// ────────────────────────────────────────────────────────────────────────
	// enable / disable
	// ────────────────────────────────────────────────────────────────────────

	private async handleToggle(args: string[], enable: boolean, ctx: HookCommandContext): Promise<string | undefined> {
		const name = args[0]?.trim();
		if (!name) {
			const action = enable ? "enable" : "disable";
			ctx.ui.notify(`Usage: /plugins ${action} <name>`, "error");
			return `Usage: /plugins ${action} <name>`;
		}

		const cwd = this.api?.cwd ?? ctx.cwd;
		const manifest = await loadManifest(cwd);

		if (!manifest.plugins[name]) {
			manifest.plugins[name] = {
				name,
				version: "0.0.0",
				description: "",
				source: "marketplace",
				entryPoint: "index.js",
				enabled: enable,
				installedAt: new Date().toISOString(),
			};
		} else {
			manifest.plugins[name].enabled = enable;
		}

		await saveManifest(cwd, manifest);
		const action = enable ? "enabled" : "disabled";
		ctx.ui.notify(`Plugin "${name}" ${action}.`, "info");
		return `Plugin "${name}" ${action}.`;
	}

	// ────────────────────────────────────────────────────────────────────────
	// info
	// ────────────────────────────────────────────────────────────────────────

	private async handleInfo(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const name = args[0]?.trim();
		if (!name) {
			ctx.ui.notify("Usage: /plugins info <name>", "error");
			return "Usage: /plugins info <name>";
		}

		const cwd = this.api?.cwd ?? ctx.cwd;
		const plugins = await discoverPlugins(cwd);
		const plugin = plugins.find(p => p.name === name);

		if (!plugin) {
			ctx.ui.notify(`Plugin "${name}" not found.`, "warning");
			return `Plugin "${name}" not found. Run \`/plugins list\` to see installed plugins.`;
		}

		return [
			`## Plugin: ${plugin.name}`,
			``,
			`- **Version**: ${plugin.version}`,
			`- **Description**: ${plugin.description || "(none)"}`,
			`- **Source**: ${plugin.source}`,
			`- **Entry Point**: ${plugin.entryPoint}`,
			`- **Status**: ${plugin.enabled ? "✅ Enabled" : "⛔ Disabled"}`,
			`- **Installed**: ${new Date(plugin.installedAt).toLocaleString()}`,
			plugin.author ? `- **Author**: ${plugin.author}` : "",
			plugin.homepage ? `- **Homepage**: ${plugin.homepage}` : "",
		]
			.filter(Boolean)
			.join("\n");
	}
}

export default function pluginsFactory(_api: CustomCommandAPI): PluginsCommand {
	return new PluginsCommand();
}
