/**
 * Hot-reload watcher — watches extension directories for file changes
 * and triggers automatic reload.
 *
 * Uses fs.watch for file system monitoring.
 * Matches Copilot CLI's /extensions reload behavior.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HotReloadOptions {
  /** Directories to watch */
  directories: string[];
  /** Debounce delay in ms (default 500) */
  debounceMs?: number;
  /** File extensions to watch (default: .mjs, .js, .ts, .json) */
  extensions?: string[];
  /** Callback when a change is detected */
  onChange: (filePath: string, dirScope: "project" | "user") => void;
}

// ---------------------------------------------------------------------------
// Hot Reload Watcher
// ---------------------------------------------------------------------------

export class HotReloadWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private options: Required<HotReloadOptions>;
  private isRunning = false;

  constructor(options: HotReloadOptions) {
    this.options = {
      directories: options.directories,
      debounceMs: options.debounceMs ?? 500,
      extensions: options.extensions ?? [".mjs", ".js", ".ts", ".json"],
      onChange: options.onChange,
    };
  }

  /**
   * Start watching for file changes.
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("[hot-reload] Already watching");
      return;
    }

    for (const dir of this.options.directories) {
      if (!fs.existsSync(dir)) {
        logger.debug(`[hot-reload] Directory not found, skipping: ${dir}`);
        continue;
      }

      try {
        const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          this.handleFileChange(dir, filename);
        });

        watcher.on("error", (err) => {
          logger.error(`[hot-reload] Watcher error for ${dir}`, { error: err.message });
        });

        this.watchers.set(dir, watcher);
        logger.info(`[hot-reload] Watching: ${dir}`);
      } catch (err) {
        logger.error(`[hot-reload] Failed to watch ${dir}`, { error: String(err) });
      }
    }

    this.isRunning = true;
    logger.info(`[hot-reload] Started watching ${this.watchers.size} directories`);
  }

  /**
   * Stop watching for file changes.
   */
  stop(): void {
    for (const [dir, watcher] of this.watchers) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers.clear();

    // Clear debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.isRunning = false;
    logger.info("[hot-reload] Stopped watching");
  }

  /**
   * Handle a file change event with debouncing.
   */
  private handleFileChange(dir: string, filename: string): void {
    const ext = path.extname(filename);

    // Only watch configured extensions
    if (!this.options.extensions.includes(ext)) return;

    const filePath = path.join(dir, filename);
    const debounceKey = filePath;

    // Debounce: clear existing timer and set new one
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(debounceKey);

      // Determine scope
      const userDir = path.join(os.homedir(), ".pakalon", "extensions");
      const dirScope = dir.startsWith(userDir) ? "user" : "project";

      logger.info(`[hot-reload] File changed: ${filePath} (${dirScope})`);
      this.options.onChange(filePath, dirScope);
    }, this.options.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
  }

  /**
   * Get the list of watched directories.
   */
  get watchedDirectories(): string[] {
    return Array.from(this.watchers.keys());
  }

  /**
   * Whether the watcher is currently active.
   */
  get active(): boolean {
    return this.isRunning;
  }
}

// ---------------------------------------------------------------------------
// Convenience: Create a watcher that auto-reloads an ExtensionManager
// ---------------------------------------------------------------------------

import type { ExtensionManager } from "./registry.js";

/**
 * Create a hot-reload watcher that automatically reloads extensions when
 * their source files change.
 */
export function createAutoReloadWatcher(
  manager: ExtensionManager,
  cwd?: string
): HotReloadWatcher {
  const projectDir = path.join(cwd ?? process.cwd(), ".pakalon", "extensions");
  const userDir = path.join(os.homedir(), ".pakalon", "extensions");

  const watcher = new HotReloadWatcher({
    directories: [projectDir, userDir],
    debounceMs: 500,
    onChange: async (filePath, scope) => {
      // Find which extension this file belongs to
      const extDir = path.dirname(filePath);
      const extName = path.basename(extDir);

      try {
        logger.info(`[hot-reload] Reloading extension: ${extName}`);
        await manager.reload(extName);
      } catch (err) {
        logger.error(`[hot-reload] Failed to reload ${extName}`, { error: String(err) });
      }
    },
  });

  return watcher;
}
