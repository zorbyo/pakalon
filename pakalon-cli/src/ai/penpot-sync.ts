/**
 * Penpot Sync Service - TypeScript implementation
 *
 * Manages the sync between Penpot frontend changes and backend files.
 * This service:
 * - Starts/stops the Penpot Docker container
 * - Monitors Penpot container lifecycle
 * - Handles cooldown-based file sync via sync-bridge
 *
 * Delegates actual file watching to src/penpot/sync-bridge.ts which provides
 * real-time cooldown-based sync with proper file change detection.
 *
 * Used by the /penpot CLI command
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { startSyncBridge, stopSyncBridge, type SyncBridgeStartResult } from "@/penpot/sync-bridge.js";

const DEFAULT_COOLDOWN_MS = 30000;

export interface SyncOptions {
  projectId?: string;
  fileId?: string;
  outputDir?: string;
  pollInterval?: number;
  cooldownPeriod?: number;
  cooldownMs?: number;
}

export interface SyncStatus {
  isRunning: boolean;
  isPenpotRunning: boolean;
  lastSyncTime: Date | null;
  lastChangeTime: Date | null;
  inCooldown: boolean;
  wireframesDir?: string;
  penpotExportDir?: string;
}

class PenpotSyncService {
  private syncResult: SyncBridgeStartResult | null = null;
  private options: SyncOptions = {};
  private lastSyncTime: Date | null = null;
  private lastChangeTime: Date | null = null;
  private cooldownEndTime: number = 0;

  /**
   * Check if Penpot Docker container is running
   */
  isPenpotRunning(): boolean {
    try {
      execSync("docker inspect -f '{{.State.Running}}' pakalon-penpot 2>/dev/null", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start Penpot container
   * Tries to start existing container first, then looks for compose file at repo root
   */
  async startPenpot(): Promise<boolean> {
    console.log("[penpot-sync] Starting Penpot container...");
    try {
      // Try starting existing container first
      execSync("docker start pakalon-penpot", { stdio: "inherit", timeout: 60000 });
      return true;
    } catch {
      // Container doesn't exist, try compose file at repo root
      try {
        const composePath = path.join(process.cwd(), "docker-compose.yml");
        if (existsSync(composePath)) {
          execSync("docker compose -f docker-compose.yml up -d", { stdio: "inherit", timeout: 120000 });
          return true;
        }
        console.warn("[penpot-sync] No docker-compose.yml found. Start Penpot manually with: docker compose -f <path-to-compose> up -d");
        return false;
      } catch {
        return false;
      }
    }
  }

  /**
   * Stop Penpot container
   */
  async stopPenpot(): Promise<boolean> {
    console.log("[penpot-sync] Stopping Penpot container...");
    try {
      execSync("docker stop pakalon-penpot", { stdio: "inherit", timeout: 30000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start the sync process using sync-bridge for cooldown-based file watching
   */
  async startSync(options: SyncOptions = {}): Promise<boolean> {
    this.options = {
      pollInterval: 5000,
      cooldownPeriod: DEFAULT_COOLDOWN_MS,
      outputDir: ".pakalon-agents",
      ...options,
    };

    const projectDir = this.options.outputDir ?? process.cwd();
    const penpotExportDir = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2");

    console.log("[penpot-sync] Starting sync with sync-bridge...");
    console.log("[penpot-sync] Watching:", penpotExportDir, "→ wireframes/");

    // Start Penpot if not running
    if (!this.isPenpotRunning()) {
      await this.startPenpot();
    }

    try {
      // Use sync-bridge for actual file watching with cooldown
      this.syncResult = await startSyncBridge(projectDir, penpotExportDir, {
        cooldownMs: this.options.cooldownMs ?? this.options.cooldownPeriod ?? DEFAULT_COOLDOWN_MS,
        fileId: this.options.fileId,
      });

      console.log("[penpot-sync] Sync bridge started, cooldown:", this.syncResult.cooldownMs, "ms");
      this.lastChangeTime = new Date();
      return true;
    } catch (err) {
      console.error("[penpot-sync] Failed to start sync bridge:", err);
      return false;
    }
  }

  /**
   * Stop the sync process via sync-bridge
   */
  async stopSync(): Promise<boolean> {
    console.log("[penpot-sync] Stopping sync process...");
    try {
      await stopSyncBridge();
      this.syncResult = null;
      return true;
    } catch (err) {
      console.error("[penpot-sync] Failed to stop sync bridge:", err);
      return false;
    }
  }

  /**
   * Open Penpot in browser
   */
  openInBrowser(fileId?: string): void {
    const { exec } = require("child_process");
    const url = fileId
      ? `http://localhost:3449/#/project/${fileId}`
      : "http://localhost:3449";

    if (process.platform === "win32") {
      exec(`start "" "${url}"`);
    } else if (process.platform === "darwin") {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }

    console.log("[penpot-sync] Opened Penpot in browser:", url);
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return {
      isRunning: this.syncResult?.running ?? false,
      isPenpotRunning: this.isPenpotRunning(),
      lastSyncTime: this.lastSyncTime,
      lastChangeTime: this.lastChangeTime,
      inCooldown: Date.now() < this.cooldownEndTime,
      wireframesDir: this.syncResult?.wireframesDir,
      penpotExportDir: this.syncResult?.penpotExportDir,
    };
  }

  /**
   * Trigger cooldown manually
   */
  triggerCooldown(): void {
    const cooldownPeriod = this.options.cooldownPeriod || DEFAULT_COOLDOWN_MS;
    this.cooldownEndTime = Date.now() + cooldownPeriod;
    this.lastChangeTime = new Date();
    console.log(`[penpot-sync] Cooldown triggered for ${cooldownPeriod / 1000}s`);
  }

  /**
   * Check if in cooldown period
   */
  isInCooldown(): boolean {
    return Date.now() < this.cooldownEndTime;
  }
}

// Export singleton instance
export const penpotSync = new PenpotSyncService();
export default penpotSync;
