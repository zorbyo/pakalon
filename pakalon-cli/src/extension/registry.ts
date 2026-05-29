/**
 * Extension Registry - discovers and loads extensions from disk.
 *
 * Discovery locations (matching Copilot CLI):
 * - Project-scoped: .pakalon/extensions/[name]/extension.mjs
 * - User-scoped: ~/.pakalon/extensions/[name]/extension.mjs
 *
 * Each extension directory must contain:
 * - extension.mjs (entry point)
 * - package.json with { name, description, version, main }
 *
 * OR:
 * - extension.mjs alone (minimal manifest extracted from filename)
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ExtensionManifest, ExtensionInstance } from "./types.js";
import { ExtensionRuntime } from "./runtime.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function getProjectExtensionsDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), ".pakalon", "extensions");
}

function getUserExtensionsDir(): string {
  return path.join(os.homedir(), ".pakalon", "extensions");
}

export interface DiscoveredExtension {
  manifest: ExtensionManifest;
  directory: string;
  scope: "project" | "user";
}

/**
 * Discover all extensions from project and user directories.
 */
export function discoverExtensions(cwd?: string): DiscoveredExtension[] {
  const discovered: DiscoveredExtension[] = [];

  // Project-scoped extensions
  const projectDir = getProjectExtensionsDir(cwd);
  if (fs.existsSync(projectDir)) {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const extDir = path.join(projectDir, entry.name);
      const ext = tryLoadManifest(extDir, entry.name);
      if (ext) {
        discovered.push({ manifest: ext, directory: extDir, scope: "project" });
      }
    }
  }

  // User-scoped extensions
  const userDir = getUserExtensionsDir();
  if (fs.existsSync(userDir)) {
    const entries = fs.readdirSync(userDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip if already discovered from project (project takes precedence)
      if (discovered.some((d) => d.manifest.name === entry.name)) continue;

      const extDir = path.join(userDir, entry.name);
      const ext = tryLoadManifest(extDir, entry.name);
      if (ext) {
        discovered.push({ manifest: ext, directory: extDir, scope: "user" });
      }
    }
  }

  return discovered;
}

/**
 * Try to load an extension manifest from a directory.
 * Supports both package.json and minimal entry-only configurations.
 */
function tryLoadManifest(dir: string, fallbackName: string): ExtensionManifest | null {
  // Check for entry point
  const entryCandidates = ["extension.mjs", "extension.js", "index.mjs", "index.js"];
  let entryFile: string | null = null;

  for (const candidate of entryCandidates) {
    if (fs.existsSync(path.join(dir, candidate))) {
      entryFile = candidate;
      break;
    }
  }

  if (!entryFile) return null;

  // Try package.json for metadata
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return {
        name: pkg.name ?? fallbackName,
        description: pkg.description,
        version: pkg.version ?? "0.0.0",
        entry: pkg.main ?? entryFile,
        author: pkg.author,
        permissions: pkg.permissions,
      };
    } catch {
      // Fall through to minimal manifest
    }
  }

  // Minimal manifest from entry file only
  return {
    name: fallbackName,
    description: `Extension: ${fallbackName}`,
    version: "0.0.0",
    entry: entryFile,
  };
}

// ---------------------------------------------------------------------------
// Extension Manager
// ---------------------------------------------------------------------------

export interface ExtensionManagerOptions {
  /** Working directory for project-scoped extension discovery */
  cwd?: string;
  /** Auto-start discovered extensions (default: true) */
  autoStart?: boolean;
}

export class ExtensionManager {
  private runtime: ExtensionRuntime;
  private discovered: DiscoveredExtension[] = [];
  private options: ExtensionManagerOptions;

  constructor(options: ExtensionManagerOptions = {}) {
    this.runtime = new ExtensionRuntime();
    this.options = options;
  }

  /**
   * Discover and optionally auto-start extensions.
   */
  async initialize(): Promise<void> {
    this.discovered = discoverExtensions(this.options.cwd);
    logger.info(`[extensions] Discovered ${this.discovered.length} extensions`, {
      project: this.discovered.filter((d) => d.scope === "project").length,
      user: this.discovered.filter((d) => d.scope === "user").length,
    });

    if (this.options.autoStart !== false) {
      await this.startAll();
    }
  }

  /**
   * Start all discovered extensions.
   */
  async startAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.discovered.map((ext) =>
        this.runtime.startExtension(ext.manifest, ext.directory)
      )
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const ext = this.discovered[i];
      if (result && result.status === "rejected") {
        logger.error(`[extensions] Failed to start ${ext?.manifest.name ?? "unknown"}`, {
          error: String((result as PromiseRejectedResult).reason),
        });
      }
    }
  }

  /**
   * Stop all extensions.
   */
  async stopAll(): Promise<void> {
    await this.runtime.stopAll();
  }

  /**
   * Hot-reload all extensions (re-scan directories, restart).
   */
  async reloadAll(): Promise<void> {
    await this.stopAll();
    this.discovered = discoverExtensions(this.options.cwd);
    await this.startAll();
    logger.info("[extensions] All extensions reloaded");
  }

  /**
   * Hot-reload a specific extension by name.
   */
  async reload(name: string): Promise<void> {
    const ext = this.discovered.find((d) => d.manifest.name === name);
    if (!ext) {
      throw new Error(`Extension not found: ${name}`);
    }
    await this.runtime.hotReload(name);
  }

  /**
   * Get the underlying runtime (for tool execution, hook firing, etc.).
   */
  getRuntime(): ExtensionRuntime {
    return this.runtime;
  }

  /**
   * Get all discovered extensions with their status.
   */
  getExtensions(): Array<DiscoveredExtension & { status: string }> {
    return this.discovered.map((ext) => {
      const instance = this.runtime.getExtension(ext.manifest.name);
      return {
        ...ext,
        status: instance?.status ?? "not started",
      };
    });
  }

  /**
   * Get a specific extension's full state.
   */
  getExtensionState(name: string): ExtensionInstance | undefined {
    return this.runtime.getExtension(name);
  }

  /**
   * List all registered tools from all extensions.
   */
  getAllExtensionTools(): Map<string, { tool: string; extension: string }> {
    const tools = new Map<string, { tool: string; extension: string }>();
    for (const ext of this.discovered) {
      const instance = this.runtime.getExtension(ext.manifest.name);
      if (!instance) continue;
      for (const tool of instance.registeredTools) {
        tools.set(tool.name, { tool: tool.name, extension: ext.manifest.name });
      }
    }
    return tools;
  }
}
