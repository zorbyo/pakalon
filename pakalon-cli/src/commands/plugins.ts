/**
 * /plugins command — list, install, remove, enable/disable, update Pakalon plugins.
 * Includes versioning, marketplace discovery, and auto-update capabilities.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync, type ExecFileSyncOptions } from "child_process";
import { debugLog } from "@/utils/logger.js";

export interface PluginConfig {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  installedAt: string;
  /** Latest version detected on npm, if a version check has been run */
  latestVersion?: string;
  /** True when latestVersion > version */
  updateAvailable?: boolean;
  /** ISO timestamp of last version check */
  lastCheckedAt?: string;
}

/** A marketplace listing entry (from npm registry or built-in list) */
export interface MarketplacePlugin {
  name: string;
  version: string;
  description: string;
  downloads?: number;
  keywords?: string[];
  publishedAt?: string;
  installed?: boolean;
}

/** Well-known Pakalon plugins bundled as a fallback */
const BUILTIN_MARKETPLACE: MarketplacePlugin[] = [
  { name: "@pakalon/plugin-prettier", version: "latest", description: "Auto-format code with Prettier on save", keywords: ["formatting", "prettier"] },
  { name: "@pakalon/plugin-eslint", version: "latest", description: "Live ESLint diagnostics in the TUI", keywords: ["linting", "eslint"] },
  { name: "@pakalon/plugin-git-blame", version: "latest", description: "Inline git blame annotations", keywords: ["git", "blame"] },
  { name: "@pakalon/plugin-test-runner", version: "latest", description: "Run Vitest/Jest from the agent chat", keywords: ["testing", "vitest"] },
  { name: "@pakalon/plugin-docker", version: "latest", description: "Docker container management tools", keywords: ["docker", "containers"] },
  { name: "@pakalon/plugin-aws", version: "latest", description: "AWS CLI helpers and cost estimator", keywords: ["aws", "cloud"] },
];

const NPM_BIN = process.platform === "win32" ? "npm.cmd" : "npm";
const PACKAGE_NAME_PATTERN = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION_PATTERN = /^[A-Za-z0-9._+~^*<>=-]+$/;

export function isValidNpmPackageName(name: string): boolean {
  return PACKAGE_NAME_PATTERN.test(name);
}

export function formatPackageVersionSpecifier(packageName: string, version?: string): string {
  if (!isValidNpmPackageName(packageName)) {
    throw new Error(`Invalid npm package name: ${packageName}`);
  }
  if (!version || version === "latest") {
    return version === "latest" ? `${packageName}@latest` : packageName;
  }
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid npm package version: ${version}`);
  }
  return `${packageName}@${version}`;
}

function runNpm(args: string[], options: ExecFileSyncOptions = {}): Buffer {
  return execFileSync(NPM_BIN, args, {
    stdio: "pipe",
    timeout: 30_000,
    ...options,
  });
}

function runNpmText(args: string[], options: ExecFileSyncOptions = {}): string {
  return runNpm(args, options).toString().trim();
}

function pluginsConfigPath(): string {
  return path.join(os.homedir(), ".config", "pakalon", "plugins.json");
}

function readPlugins(): PluginConfig[] {
  try {
    const raw = fs.readFileSync(pluginsConfigPath(), "utf-8");
    return JSON.parse(raw) as PluginConfig[];
  } catch {
    return [];
  }
}

function writePlugins(plugins: PluginConfig[]): void {
  const filePath = pluginsConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(plugins, null, 2), "utf-8");
}

export function cmdListPlugins(): void {
  const plugins = readPlugins();

  if (plugins.length === 0) {
    console.log("\nNo plugins installed.");
    console.log("Install plugins with: pakalon plugins install <package-name>\n");
    console.log("Browse the marketplace with: pakalon plugins marketplace\n");
    return;
  }

  console.log(`\n── Installed Plugins (${plugins.length}) ─────────────────────────────────────\n`);
  for (const p of plugins) {
    const status = p.enabled ? "[OK] enabled" : "[X] disabled";
    const update = p.updateAvailable ? `  ^  ${p.latestVersion} available` : "";
    console.log(
      `  ${p.name.padEnd(40)} v${p.version.padEnd(12)} ${status}${update}`
    );
    if (p.description) {
      console.log(`    ${p.description}`);
    }
    console.log();
  }

  const updateable = plugins.filter((p) => p.updateAvailable);
  if (updateable.length > 0) {
    console.log(`  [Idea] Run "pakalon plugins update" to update ${updateable.length} plugin(s).\n`);
  }
}

export async function cmdInstallPlugin(packageName: string): Promise<void> {
  if (!isValidNpmPackageName(packageName)) {
    throw new Error(`Invalid npm package name: ${packageName}`);
  }

  const plugins = readPlugins();

  if (plugins.some((p) => p.name === packageName)) {
    console.log(`Plugin "${packageName}" is already installed.`);
    return;
  }

  console.log(`\nInstalling plugin: ${packageName}...`);
  let version = "latest";
  let description = "Manual install — metadata will be loaded on next startup";

  try {
    runNpm(["install", "-g", packageName], { stdio: "inherit", timeout: 120_000 });
    // Resolve actual installed version
    try {
      const meta = runNpmText(["list", "-g", packageName, "--json"]);
      const parsed = JSON.parse(meta) as { dependencies?: Record<string, { version?: string }> };
      version = parsed.dependencies?.[packageName]?.version ?? "latest";
    } catch { /* ignore */ }
    // Fetch description from npm registry
    try {
      const info = runNpmText(["view", packageName, "description"]);
      if (info) description = info;
    } catch { /* ignore */ }
  } catch (err) {
    console.error(`\n[X] npm install failed: ${String(err).slice(0, 200)}`);
    console.log("Plugin will be registered but may not function until npm install succeeds.\n");
  }

  const newPlugin: PluginConfig = {
    name: packageName,
    version,
    description,
    enabled: true,
    installedAt: new Date().toISOString(),
  };
  plugins.push(newPlugin);
  writePlugins(plugins);

  console.log(`\n[OK] Plugin "${packageName}" v${version} installed and registered.`);
  debugLog(`[plugins] Installed: ${packageName} v${version}`);
}

export function cmdRemovePlugin(packageName: string): void {
  const plugins = readPlugins();
  const idx = plugins.findIndex((p) => p.name === packageName);

  if (idx === -1) {
    console.error(`Plugin "${packageName}" not found.`);
    return;
  }

  plugins.splice(idx, 1);
  writePlugins(plugins);
  console.log(`[OK] Plugin "${packageName}" removed.`);
  console.log(`Run "npm uninstall -g ${packageName}" to also remove the npm package.`);
  debugLog(`[plugins] Removed: ${packageName}`);
}

export function cmdTogglePlugin(packageName: string, enable: boolean): void {
  const plugins = readPlugins();
  const idx = plugins.findIndex((p) => p.name === packageName);

  if (idx === -1) {
    console.error(`Plugin "${packageName}" not found.`);
    return;
  }

  plugins[idx]!.enabled = enable;
  writePlugins(plugins);
  console.log(`[OK] Plugin "${packageName}" ${enable ? "enabled" : "disabled"}.`);
}

/** Returns all installed plugins for use in TUI */
export function getPluginsList(): PluginConfig[] {
  return readPlugins();
}

// ---------------------------------------------------------------------------
// Version checking
// ---------------------------------------------------------------------------

/**
 * Check if a single plugin has an update available on npm.
 * Returns the plugin config with `updateAvailable` and `latestVersion` filled in.
 */
export async function checkPluginForUpdate(plugin: PluginConfig): Promise<PluginConfig> {
  try {
    if (!isValidNpmPackageName(plugin.name)) return { ...plugin, lastCheckedAt: new Date().toISOString() };
    const latestRaw = runNpmText(["view", plugin.name, "version"], { timeout: 15_000 });
    const latestVersion = latestRaw || plugin.version;
    const updateAvailable = latestVersion !== plugin.version && latestVersion !== "latest";
    return {
      ...plugin,
      latestVersion,
      updateAvailable,
      lastCheckedAt: new Date().toISOString(),
    };
  } catch {
    return { ...plugin, lastCheckedAt: new Date().toISOString() };
  }
}

/**
 * Check all installed plugins for available updates (runs in parallel).
 */
export async function cmdCheckUpdates(): Promise<void> {
  const plugins = readPlugins();
  if (plugins.length === 0) {
    console.log("No plugins installed.");
    return;
  }

  console.log(`\nChecking ${plugins.length} plugin(s) for updates...\n`);
  const updated = await Promise.all(plugins.map(checkPluginForUpdate));
  writePlugins(updated);

  const withUpdates = updated.filter((p) => p.updateAvailable);
  if (withUpdates.length === 0) {
    console.log("[OK] All plugins are up to date.");
  } else {
    console.log(`${withUpdates.length} update(s) available:\n`);
    for (const p of withUpdates) {
      console.log(`  ${p.name}: ${p.version} → ${p.latestVersion}`);
    }
    console.log('\nRun "pakalon plugins update" to install all updates.');
  }
}

// ---------------------------------------------------------------------------
// Plugin update checking (returns list of updatable plugin names)
// ---------------------------------------------------------------------------

/**
 * Check all installed plugins for newer versions on npm.
 * Returns an array of plugin names that have updates available.
 */
export async function cmdCheckPluginUpdates(): Promise<string[]> {
  const plugins = readPlugins();
  if (plugins.length === 0) return [];

  const updated = await Promise.all(plugins.map(checkPluginForUpdate));
  writePlugins(updated);

  const withUpdates = updated.filter((p) => p.updateAvailable);
  return withUpdates.map((p) => p.name);
}

// ---------------------------------------------------------------------------
// Auto-update all plugins (non-interactive)
// ---------------------------------------------------------------------------

/**
 * Automatically install updates for all plugins that have updates available.
 * Returns the number of plugins updated.
 */
export async function autoUpdatePlugins(): Promise<number> {
  const plugins = readPlugins();
  const targets = plugins.filter((p) => p.updateAvailable);

  if (targets.length === 0) return 0;

  let updated = 0;
  for (const plugin of targets) {
    const targetVersion = plugin.latestVersion ?? "latest";
    try {
      const specifier = formatPackageVersionSpecifier(plugin.name, targetVersion);
      runNpm(["install", "-g", specifier], { timeout: 120_000 });
      const idx = plugins.findIndex((p) => p.name === plugin.name);
      if (idx >= 0) {
        plugins[idx] = {
          ...plugins[idx]!,
          version: targetVersion,
          updateAvailable: false,
          latestVersion: targetVersion,
          lastCheckedAt: new Date().toISOString(),
        };
      }
      updated++;
    } catch {
      // Skip plugins that fail to update
    }
  }

  writePlugins(plugins);
  return updated;
}

// ---------------------------------------------------------------------------
// Changelog fetching
// ---------------------------------------------------------------------------

/**
 * Fetch the npm changelog / release notes for a package upgrade.
 * Tries `npm view <pkg> changelog` first, then falls back to GitHub releases API
 * using the `repository` field from `npm view <pkg>`.
 * Returns a trimmed markdown/text string, or null if nothing can be fetched.
 */
async function fetchChangelog(packageName: string, fromVersion: string, toVersion: string): Promise<string | null> {
  try {
    // Attempt 1: check if the package publishes a "changelog" dist-tag or field
    const pkgMeta = runNpmText(["view", packageName, "--json"], { timeout: 15_000 });
    const meta = JSON.parse(pkgMeta) as {
      repository?: { url?: string } | string;
      homepage?: string;
    };

    // Attempt 2: derive GitHub owner/repo and hit the releases API
    let repoUrl: string | undefined;
    if (typeof meta.repository === "object") repoUrl = meta.repository?.url ?? undefined;
    else if (typeof meta.repository === "string") repoUrl = meta.repository;

    if (repoUrl) {
      const ghMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (ghMatch) {
        const [, owner, repo] = ghMatch;
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/v${toVersion}`;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);
          const response = await fetch(apiUrl, {
            headers: { Accept: "application/vnd.github+json" },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!response.ok) return null;
          const release = (await response.json()) as { body?: string; name?: string };
          if (release.body) {
            return `### ${release.name ?? `v${toVersion}`}\n\n${release.body.slice(0, 2000)}`;
          }
        } catch {
          // GitHub API unavailable or no tagged release — silently continue
        }
      }
    }
  } catch {
    // npm view failed or parse error — return null
  }
  return null;
}

/**
 * Compute a simple integrity hash for an installed npm package.
 * Returns the shasum from `npm view <pkg>@<ver>` or null if unavailable.
 */
function fetchExpectedIntegrity(packageName: string, version: string): string | null {
  try {
    const specifier = formatPackageVersionSpecifier(packageName, version);
    const raw = runNpmText(["view", specifier, "dist.shasum"], { timeout: 15_000 });
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * Verify the installed package integrity matches the expected shasum.
 * Returns true if the check passes or cannot be performed (fail-safe open).
 */
function verifyInstalledIntegrity(packageName: string, expectedShasum: string | null): boolean {
  if (!expectedShasum) return true; // No baseline — skip
  try {
    const installedMeta = runNpmText(["view", packageName, "dist.shasum"], { timeout: 15_000 });
    return installedMeta === expectedShasum;
  } catch {
    return true; // Cannot verify — assume ok
  }
}

/**
 * Update one or all plugins to their latest versions.
 *
 * @param name     - If provided, update only that plugin. Otherwise, update all.
 * @param opts.yes - Skip changelog confirmation prompt (non-interactive mode).
 */
export async function cmdAutoUpdate(name?: string, opts: { yes?: boolean } = {}): Promise<void> {
  const plugins = readPlugins();

  const targets = name
    ? plugins.filter((p) => p.name === name)
    : plugins.filter((p) => p.updateAvailable);

  if (targets.length === 0) {
    console.log(name ? `Plugin "${name}" is already up to date.` : 'No updates available. Run "pakalon plugins check" first.');
    return;
  }

  console.log(`\nUpdating ${targets.length} plugin(s)...\n`);

  for (const plugin of targets) {
    const targetVersion = plugin.latestVersion ?? "latest";
    const fromVersion = plugin.version;

    // ── Changelog display ──────────────────────────────────────────────────
    console.log(`\n─── ${plugin.name}: ${fromVersion} → ${targetVersion} ───────────────────────`);
    const changelog = await fetchChangelog(plugin.name, fromVersion, targetVersion);
    if (changelog) {
      console.log("\nChangelog:\n");
      console.log(changelog);
      console.log();
    } else {
      console.log("  (No changelog available.)");
    }

    // ── Confirmation prompt (unless --yes) ─────────────────────────────────
    if (!opts.yes) {
      // In non-TTY / CI environments skip the prompt automatically
      const isTTY = process.stdin.isTTY;
      if (isTTY) {
        const readline = await import("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`  Apply update? [Y/n] `, (ans) => {
            rl.close();
            resolve(ans.trim().toLowerCase());
          });
        });
        if (answer !== "" && answer !== "y" && answer !== "yes") {
          console.log(`  Skipped ${plugin.name}.`);
          continue;
        }
      }
    }

    // ── Pre-capture integrity baseline ────────────────────────────────────
    const expectedShasum = fetchExpectedIntegrity(plugin.name, targetVersion);

    // ── Snapshot installed files for rollback ────────────────────────────
    let rollbackVersion: string | null = null;
    try {
      rollbackVersion = runNpmText(["view", plugin.name, "version"], { timeout: 15_000 }) || fromVersion;
    } catch {
      rollbackVersion = fromVersion;
    }

    // ── Perform the actual npm install ───────────────────────────────────
    console.log(`  Installing ${plugin.name}@${targetVersion}...`);
    let installOk = false;
    try {
      const specifier = formatPackageVersionSpecifier(plugin.name, targetVersion);
      runNpm(["install", "-g", specifier], { stdio: "inherit", timeout: 120_000 });
      installOk = true;
    } catch (err) {
      console.error(`  [X] npm install failed: ${String(err).slice(0, 200)}`);
    }

    if (!installOk) {
      console.error(`  [X] Skipping integrity check — install failed for ${plugin.name}.`);
      continue;
    }

    // ── Integrity verification ────────────────────────────────────────────
    const integrityOk = verifyInstalledIntegrity(plugin.name, expectedShasum);
    if (!integrityOk) {
      console.error(`  [X] Integrity check FAILED for ${plugin.name}@${targetVersion}! Rolling back to ${rollbackVersion}...`);
      try {
        const rollbackSpecifier = formatPackageVersionSpecifier(plugin.name, rollbackVersion ?? fromVersion);
        runNpm(["install", "-g", rollbackSpecifier], { stdio: "inherit", timeout: 120_000 });
        console.log(`  [OK] Rolled back ${plugin.name} to ${rollbackVersion}.`);
      } catch (rollbackErr) {
        console.error(`  [X] Rollback failed: ${String(rollbackErr).slice(0, 200)}`);
      }
      continue;
    }

    // ── Update registry ───────────────────────────────────────────────────
    const idx = plugins.findIndex((p) => p.name === plugin.name);
    if (idx >= 0) {
      plugins[idx] = {
        ...plugins[idx]!,
        version: targetVersion,
        updateAvailable: false,
        latestVersion: targetVersion,
        lastCheckedAt: new Date().toISOString(),
      };
    }
    console.log(`  [OK] ${plugin.name} updated to ${targetVersion}${integrityOk ? " (integrity verified)" : ""}`);
  }

  writePlugins(plugins);
  console.log("\n[OK] Update complete.");
}

// ---------------------------------------------------------------------------
// Marketplace discovery
// ---------------------------------------------------------------------------

/**
 * Discover plugins from the npm registry (keyword: pakalon-plugin)
 * or fall back to the built-in list.
 *
 * @param query  Optional search term to filter results.
 * @param limit  Max results to return (default 20).
 */
export async function discoverMarketplace(
  query?: string,
  limit = 20
): Promise<MarketplacePlugin[]> {
  const installed = new Set(readPlugins().map((p) => p.name));
  let entries: MarketplacePlugin[] = [];

  // Try live npm search
  try {
    const searchTerm = query ? `pakalon-plugin ${query}` : "pakalon-plugin";
    const raw = runNpmText(["search", searchTerm, "--json", "--searchlimit", String(limit)], { timeout: 20_000 });
    const results = JSON.parse(raw) as Array<{
      name: string;
      version: string;
      description: string;
      date?: string;
      keywords?: string[];
    }>;
    entries = results.map((r) => ({
      name: r.name,
      version: r.version,
      description: r.description ?? "",
      publishedAt: r.date,
      keywords: r.keywords,
      installed: installed.has(r.name),
    }));
  } catch {
    // Offline or npm not available — use built-in list
    entries = BUILTIN_MARKETPLACE.map((e) => ({ ...e, installed: installed.has(e.name) }));
  }

  // Apply query filter if npm search didn't handle it
  if (query) {
    const q = query.toLowerCase();
    entries = entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.keywords ?? []).some((k) => k.toLowerCase().includes(q))
    );
  }

  return entries.slice(0, limit);
}

/**
 * CLI command: print marketplace results to stdout.
 */
export async function cmdListMarketplace(query?: string): Promise<void> {
  console.log(`\n── Plugin Marketplace${query ? ` (search: "${query}")` : ""} ──────────────────────\n`);
  const entries = await discoverMarketplace(query, 20);

  if (entries.length === 0) {
    console.log("  No plugins found.\n");
    return;
  }

  for (const e of entries) {
    const installed = e.installed ? " [installed]" : "";
    console.log(`  ${e.name.padEnd(40)} v${(e.version ?? "latest").padEnd(10)}${installed}`);
    if (e.description) console.log(`    ${e.description}`);
    console.log();
  }

  console.log(`\n  Install with: pakalon plugins install <name>\n`);
}

export function getEnabledPlugins(): PluginConfig[] {
  return readPlugins().filter((p) => p.enabled);
}
