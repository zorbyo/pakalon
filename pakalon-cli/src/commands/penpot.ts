/**
 * /penpot command — Live Penpot sync management.
 */
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { debugLog } from "@/utils/logger.js";
import { resolvePenpotProjectState } from "@/utils/penpot-state.js";
import { useStore } from "@/store/index.js";
import penpotSync from "@/ai/penpot-sync.js";
import { generateSyncJs } from "@/penpot/sync-bridge.js";
import { startPenpotWithLifecycle, stopPenpotWithLifecycle } from "@/penpot/client.js";
import type { CommandDefinition } from "./types.js";

const BRIDGE_URL = process.env.PAKALON_BRIDGE_URL ?? "http://127.0.0.1:7432";

export interface PenpotSyncStatus {
  connected: boolean;
  message: string;
  sync_status: {
    status: string;
    last_sync: string | null;
    direction: string;
    conflicts_count: number;
    local_version: string;
    remote_version: string;
    error: string | null;
  };
  files?: Array<{
    name: string;
    path: string;
    size: number;
    modified: string;
  }>;
}

/**
 * Test connection to Penpot and get sync status.
 */
export async function cmdPenpotStatus(): Promise<PenpotSyncStatus> {
  const { token } = useStore.getState();
  const cooldownMs = Number(process.env.PENPOT_SYNC_COOLDOWN_MS ?? 5000);

  try {
    const res = await fetch(`${BRIDGE_URL}/penpot/status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      return await res.json() as PenpotSyncStatus;
    }

    return {
      connected: false,
      message: `HTTP ${res.status} (cooldown ${cooldownMs}ms)`,
      sync_status: {
        status: "error",
        last_sync: null,
        direction: "bidirectional",
        conflicts_count: 0,
        local_version: "",
        remote_version: "",
        error: `HTTP ${res.status}`,
      },
    };
  } catch (err) {
    debugLog(`[penpot] Status failed: ${err}`);
    const localStatus = penpotSync.getStatus();
    return {
      connected: localStatus.isRunning || localStatus.isPenpotRunning,
      message: localStatus.isRunning
        ? `Local Penpot sync bridge is running (cooldown ${cooldownMs}ms)`
        : `Bridge connection failed; local Penpot ${localStatus.isPenpotRunning ? "is running" : "is not running"} (cooldown ${cooldownMs}ms)`,
      sync_status: {
        status: localStatus.isRunning ? "running" : "disconnected",
        last_sync: localStatus.lastSyncTime?.toISOString() ?? null,
        direction: "bidirectional",
        conflicts_count: 0,
        local_version: localStatus.wireframesDir ?? "",
        remote_version: localStatus.penpotExportDir ?? "",
        error: localStatus.isRunning ? null : String(err),
      },
    };
  }
}

/**
 * Start Penpot sync.
 */
export async function cmdPenpotSyncStart(
  direction: "import" | "export" | "bidirectional" = "bidirectional"
): Promise<{ status: string; direction: string }> {
  const { token } = useStore.getState();

  const res = await fetch(`${BRIDGE_URL}/penpot/sync/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ direction }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Failed to start sync: HTTP ${res.status}`);
  }

  return await res.json();
}

/**
 * Stop Penpot sync.
 */
export async function cmdPenpotSyncStop(): Promise<{ status: string }> {
  const { token } = useStore.getState();

  const res = await fetch(`${BRIDGE_URL}/penpot/sync/stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Failed to stop sync: HTTP ${res.status}`);
  }

  return await res.json();
}

/**
 * Import designs from Penpot.
 */
export async function cmdPenpotImport(): Promise<{
  status: string;
  files: Array<{ name: string; path: string; size: number; modified: string }>;
}> {
  const { token } = useStore.getState();

  const res = await fetch(`${BRIDGE_URL}/penpot/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`Failed to import: HTTP ${res.status}`);
  }

  return await res.json();
}

/**
 * Export designs to Penpot.
 */
export async function cmdPenpotExport(): Promise<{
  status: string;
  files: Array<{ name: string; path: string; size: number; modified: string }>;
}> {
  const { token } = useStore.getState();

  try {
    const res = await fetch(`${BRIDGE_URL}/penpot/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });

    if (res.ok) {
      return await res.json();
    }

    debugLog(`[penpot] Bridge export failed with HTTP ${res.status}; falling back to local phase-2 artifacts`);
  } catch (error) {
    debugLog(`[penpot] Bridge export unavailable; falling back to local phase-2 artifacts: ${error}`);
  }

  return exportLocalPhase2Artifacts(process.cwd());
}

/**
 * Configure Penpot connection.
 */
export async function cmdPenpotConfigure(options: {
  apiUrl?: string;
  apiToken?: string;
  projectId?: string;
}): Promise<{ status: string; message: string }> {
  const { token } = useStore.getState();

  const res = await fetch(`${BRIDGE_URL}/penpot/configure`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(options),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Failed to configure: HTTP ${res.status}`);
  }

  return await res.json();
}

/**
 * Open Penpot in browser - opens the design for the current project session.
 *
 * Resolution order for fileId / URL:
 *  1. Caller supplies explicit fileId
 *  2. Read the canonical project state from .pakalon/penpot.json
 *  3. Fall back to legacy phase-2 manifests for backward compatibility
 *  3. Fall back to Penpot workspace root (http://localhost:3449)
 *
 * Also launches sync.js in --lifecycle mode so the sync bridge tracks the
 * Penpot container's state automatically for this project session.
 */
export async function cmdPenpotOpen(
  fileId?: string,
  projectDir?: string,
  options: { penpotCooldownMs?: number } = {},
): Promise<{ status: string; url: string; syncRunning?: boolean; syncJsPath?: string }> {
  const dir = projectDir ?? process.cwd();
  const resolvedState = resolvePenpotProjectState(dir);
  const penpotHost = (resolvedState?.baseUrl ?? process.env.PENPOT_HOST ?? process.env.PENPOT_BASE_URL ?? "http://localhost:3449").replace(/\/$/, "");
  const agentsDir = path.join(dir, ".pakalon-agents");
  const agentsInitialized = fs.existsSync(agentsDir);

  // 1. Try to resolve file ID from project metadata
  const resolvedFileId = fileId ?? resolvedState?.fileId ?? undefined;
  if (resolvedFileId) {
    debugLog(`[penpot] Resolved file ID from project state: ${resolvedFileId}`);
  }

  if (!agentsInitialized) {
    throw new Error("Penpot design is not ready yet. Initialize Pakalon and complete Phase 2 before opening Penpot.");
  }

  // 2. Build URL
  let url: string | null = null;
  if (fileId && resolvedState?.projectId) {
    url = `${penpotHost}/view/${resolvedState.projectId}/${fileId}`;
  } else if (resolvedFileId && resolvedState?.projectUrl) {
    url = resolvedState.projectUrl;
  } else if (resolvedFileId && resolvedState?.fileUrl) {
    url = resolvedState.fileUrl;
  } else if (resolvedFileId) {
    url = `${penpotHost}/view/${resolvedFileId}`;
  }

  if (!url) {
    throw new Error("No Penpot design metadata was found for this project yet. Finish Phase 2 or Phase 3 first so Pakalon can open the generated design directly.");
  }

  // 3. Start local sync lifecycle. This replaces the removed Python sync.js
  // bridge with the TypeScript watcher and a generated project-local sync.js.
  let syncRunning = false;
  let syncJsPath: string | undefined;
  try {
    syncJsPath = await generateSyncJs(dir, options.penpotCooldownMs);
    syncRunning = await penpotSync.startSync({
      outputDir: dir,
      fileId: resolvedFileId,
      cooldownPeriod: Number(process.env.PENPOT_SYNC_COOLDOWN_MS ?? 30000),
      cooldownMs: options.penpotCooldownMs,
    });
  } catch (error) {
    debugLog(`[penpot] Local sync lifecycle could not start: ${error}`);
  }

  // 4. Open browser
  if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", url]);
  } else if (process.platform === "darwin") {
    execFile("open", [url]);
  } else {
    execFile("xdg-open", [url]);
  }

  debugLog(`[penpot] Sync lifecycle ${syncRunning ? "started" : "not running"}${syncJsPath ? ` (${syncJsPath})` : ""}`);

  return { status: "success", url, syncRunning, syncJsPath };
}

/**
 * Start Penpot Docker container
 */
export async function cmdPenpotStart(projectDir = process.cwd()): Promise<{ status: string; message: string }> {
  const { token } = useStore.getState();

  try {
    const res = await fetch(`${BRIDGE_URL}/penpot/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (error) {
    debugLog(`[penpot] Bridge start unavailable; using local lifecycle: ${error}`);
  }

  const started = await startPenpotWithLifecycle(projectDir, { autoOpenBrowser: false });
  if (!started.success) {
    throw new Error(started.error ?? "Failed to start Penpot");
  }
  return { status: "success", message: `Penpot started locally at ${started.url ?? "http://localhost:3000"}` };
}

/**
 * Stop Penpot Docker container
 */
export async function cmdPenpotStop(projectDir = process.cwd()): Promise<{ status: string; message: string }> {
  const { token } = useStore.getState();

  try {
    const res = await fetch(`${BRIDGE_URL}/penpot/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) {
      await penpotSync.stopSync();
      return await res.json();
    }
  } catch (error) {
    debugLog(`[penpot] Bridge stop unavailable; using local lifecycle: ${error}`);
  }

  await penpotSync.stopSync();
  const stopped = await stopPenpotWithLifecycle(projectDir);
  if (!stopped.success) {
    throw new Error(stopped.error ?? "Failed to stop Penpot");
  }
  return { status: "success", message: "Penpot stopped locally" };
}

function formatFiles(files: Array<{ name: string; path: string; size: number; modified: string }> = []): string {
  if (files.length === 0) return "No files returned.";
  return files
    .map((file) => `  - ${file.name} (${file.size} bytes) -> ${file.path}`)
    .join("\n");
}

export const penpotCommand: CommandDefinition = {
  name: "penpot",
  description: "Manage the Penpot design workflow and sync bridge",
  usage: "/penpot [open|status|start|stop|import|export|configure]",
  category: "integrations",
  permissions: ["network", "execute", "filesystem"],
  async execute(context, args) {
    const subcommand = args[0]?.toLowerCase() ?? "open";
    const projectDir = context.cwd ?? process.cwd();

    try {
      if (subcommand === "status") {
        const status = await cmdPenpotStatus();
        return {
          success: true,
          message: [
            `Penpot: ${status.connected ? "connected" : "disconnected"}`,
            status.message,
            `Sync status: ${status.sync_status.status}`,
            status.sync_status.error ? `Error: ${status.sync_status.error}` : "",
          ].filter(Boolean).join("\n"),
          data: { status },
        };
      }

      if (subcommand === "start") {
        const result = await cmdPenpotStart(projectDir);
        return { success: true, message: result.message, data: result };
      }

      if (subcommand === "stop") {
        const result = await cmdPenpotStop(projectDir);
        return { success: true, message: result.message, data: result };
      }

      if (subcommand === "import") {
        const result = await cmdPenpotImport();
        return {
          success: true,
          message: `Imported Penpot design files:\n${formatFiles(result.files)}`,
          data: result,
        };
      }

      if (subcommand === "export") {
        const result = await cmdPenpotExport();
        return {
          success: true,
          message: `Exported Penpot design files:\n${formatFiles(result.files)}`,
          data: result,
        };
      }

      if (subcommand === "configure") {
        const options: { apiUrl?: string; apiToken?: string; projectId?: string } = {};
        for (let i = 1; i < args.length; i++) {
          const key = args[i];
          const value = args[i + 1];
          if (!value) continue;
          if (key === "--api-url") options.apiUrl = value;
          if (key === "--api-token") options.apiToken = value;
          if (key === "--project-id") options.projectId = value;
          if (key?.startsWith("--")) i++;
        }
        const result = await cmdPenpotConfigure(options);
        return { success: true, message: result.message, data: result };
      }

      const knownSubcommands = new Set(["open", "status", "start", "stop", "import", "export", "configure"]);
      if (!knownSubcommands.has(subcommand)) {
        const result = await cmdPenpotOpen(args[0], projectDir);
        return {
          success: true,
          message: `Penpot opened: ${result.url}${result.syncRunning ? "\nSync bridge started." : ""}`,
          data: result,
        };
      }

      if (subcommand !== "open") {
        return {
          success: false,
          message: "Usage: /penpot [open|status|start|stop|import|export|configure]",
        };
      }

      const result = await cmdPenpotOpen(args[1], projectDir);
      return {
        success: true,
        message: `Penpot opened: ${result.url}${result.syncRunning ? "\nSync bridge started." : ""}`,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: `Penpot command failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

async function exportLocalPhase2Artifacts(projectDir: string): Promise<{
  status: string;
  files: Array<{ name: string; path: string; size: number; modified: string }>;
}> {
  const state = resolvePenpotProjectState(projectDir);
  const phase2Dir = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2");
  const exportDir = path.join(projectDir, ".pakalon-agents", "wireframes");
  const candidates = [
    state?.localSvgPath,
    state?.localJsonPath,
    path.join(phase2Dir, "Wireframe_generated.penpot"),
  ].filter((file): file is string => Boolean(file));

  fs.mkdirSync(exportDir, { recursive: true });

  const files: Array<{ name: string; path: string; size: number; modified: string }> = [];
  for (const source of candidates) {
    if (!fs.existsSync(source)) continue;
    const target = path.join(exportDir, path.basename(source));
    fs.copyFileSync(source, target);
    const stat = fs.statSync(target);
    files.push({
      name: path.basename(target),
      path: target,
      size: stat.size,
      modified: stat.mtime.toISOString(),
    });
  }

  return { status: files.length > 0 ? "exported-local" : "no-local-artifacts", files };
}
