import fs from "fs/promises";
import path from "path";
import { watch, type FSWatcher } from "chokidar";

type PendingAction = "change" | "unlink";

export interface SyncBridgeOptions {
  cooldownMs?: number;
  wireframesDir?: string;
  fileId?: string;
}

export interface SyncBridgeState {
  projectDir: string;
  penpotExportDir: string;
  wireframesDir: string;
  fileId?: string;
  cooldownMs: number;
  watcher: FSWatcher;
}

export interface SyncBridgeStartResult {
  running: boolean;
  wireframesDir: string;
  penpotExportDir: string;
  cooldownMs: number;
}

let activeBridge: SyncBridgeState | null = null;
let cooldownTimer: NodeJS.Timeout | null = null;
const pendingChanges = new Map<string, PendingAction>();

function isSyncable(filePath: string): boolean {
  return /\.(svg|json)$/i.test(filePath);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function mirrorFile(sourceFile: string, sourceRoot: string, targetRoot: string): Promise<void> {
  const relativePath = path.relative(sourceRoot, sourceFile);
  const targetFile = path.join(targetRoot, relativePath);
  await ensureDir(path.dirname(targetFile));
  await fs.copyFile(sourceFile, targetFile);
}

async function removeMirroredFile(sourceFile: string, sourceRoot: string, targetRoot: string): Promise<void> {
  const relativePath = path.relative(sourceRoot, sourceFile);
  const targetFile = path.join(targetRoot, relativePath);
  await fs.rm(targetFile, { force: true });
}

async function flushChanges(): Promise<void> {
  if (!activeBridge) return;

  const snapshot = new Map(pendingChanges);
  pendingChanges.clear();

  for (const [filePath, action] of snapshot) {
    if (action === "unlink") {
      await removeMirroredFile(filePath, activeBridge.penpotExportDir, activeBridge.wireframesDir).catch(() => undefined);
      continue;
    }

    try {
      await mirrorFile(filePath, activeBridge.penpotExportDir, activeBridge.wireframesDir);
    } catch {
      // Keep watcher alive; next change will retry.
    }
  }
}

function scheduleFlush(): void {
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
  }

  const cooldownMs = activeBridge?.cooldownMs ?? 5000;
  cooldownTimer = setTimeout(() => {
    cooldownTimer = null;
    void flushChanges();
  }, cooldownMs);
}

export async function startSyncBridge(
  projectDir: string,
  penpotExportDir: string,
  options: SyncBridgeOptions = {},
): Promise<SyncBridgeStartResult> {
  if (activeBridge) {
    return {
      running: true,
      wireframesDir: activeBridge.wireframesDir,
      penpotExportDir: activeBridge.penpotExportDir,
      cooldownMs: activeBridge.cooldownMs,
    };
  }

  const wireframesDir = options.wireframesDir ?? path.join(projectDir, ".pakalon-agents", "wireframes");
  const envCooldown = Number.parseInt(process.env.PENPOT_SYNC_COOLDOWN_MS ?? "", 10);
  const cooldownMs = options.cooldownMs ?? (Number.isFinite(envCooldown) ? envCooldown : 5000);
  await ensureDir(wireframesDir);

  const watcher = watch(penpotExportDir, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 250 },
  });

  activeBridge = {
    projectDir,
    penpotExportDir,
    wireframesDir,
    fileId: options.fileId,
    cooldownMs,
    watcher,
  };

  const handleEvent = (filePath: string, action: PendingAction): void => {
    if (!isSyncable(filePath)) return;
    pendingChanges.set(filePath, action);
    scheduleFlush();
  };

  watcher
    .on("add", (filePath) => handleEvent(filePath, "change"))
    .on("change", (filePath) => handleEvent(filePath, "change"))
    .on("unlink", (filePath) => handleEvent(filePath, "unlink"));

  return {
    running: true,
    wireframesDir,
    penpotExportDir,
    cooldownMs,
  };
}

export function getSyncCooldownMs(overrideMs?: number): number {
  const envCooldown = Number.parseInt(process.env.PENPOT_SYNC_COOLDOWN_MS ?? "", 10);
  if (typeof overrideMs === "number" && Number.isFinite(overrideMs)) return overrideMs;
  if (Number.isFinite(envCooldown)) return envCooldown;
  return 5000;
}

export async function stopSyncBridge(): Promise<boolean> {
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }

  if (!activeBridge) return true;

  await activeBridge.watcher.close();
  activeBridge = null;
  pendingChanges.clear();
  return true;
}

function buildStandaloneSyncJs(projectDir: string, penpotExportDir: string, cooldownMs: number): string {
  return `#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { watch } = require('chokidar');

const projectDir = ${JSON.stringify(projectDir)};
const penpotExportDir = ${JSON.stringify(penpotExportDir)};
const wireframesDir = path.join(projectDir, '.pakalon-agents', 'wireframes');
const cooldownMs = ${JSON.stringify(cooldownMs)};

const pending = new Map();
let timer = null;

const isSyncable = (filePath) => /\.(svg|json)$/i.test(filePath);
const ensureDir = (dir) => fs.mkdir(dir, { recursive: true });

async function mirror(sourceFile, sourceRoot, targetRoot) {
  const relativePath = path.relative(sourceRoot, sourceFile);
  const targetFile = path.join(targetRoot, relativePath);
  await ensureDir(path.dirname(targetFile));
  await fs.copyFile(sourceFile, targetFile);
}

async function removeMirrored(sourceFile, sourceRoot, targetRoot) {
  const relativePath = path.relative(sourceRoot, sourceFile);
  const targetFile = path.join(targetRoot, relativePath);
  await fs.rm(targetFile, { force: true });
}

async function flush() {
  const entries = Array.from(pending.entries());
  pending.clear();
  for (const [filePath, action] of entries) {
    try {
      if (action === 'unlink') {
        await removeMirrored(filePath, penpotExportDir, wireframesDir);
      } else {
        await mirror(filePath, penpotExportDir, wireframesDir);
      }
    } catch {}
  }
}

function schedule(action, filePath) {
  if (!isSyncable(filePath)) return;
  pending.set(filePath, action);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, cooldownMs);
}

async function main() {
  await ensureDir(wireframesDir);
  const watcher = watch(penpotExportDir, { ignoreInitial: true, persistent: true, awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 250 } });
  watcher.on('add', (filePath) => schedule('change', filePath));
  watcher.on('change', (filePath) => schedule('change', filePath));
  watcher.on('unlink', (filePath) => schedule('unlink', filePath));

  process.on('SIGINT', async () => { await watcher.close(); process.exit(0); });
  process.on('SIGTERM', async () => { await watcher.close(); process.exit(0); });
  console.log('[sync.js] watching', penpotExportDir, '→', wireframesDir);
}

main().catch((error) => {
  console.error('[sync.js] failed:', error);
  process.exit(1);
});
`;
}

export async function generateSyncJs(projectDir: string, cooldownMs = getSyncCooldownMs()): Promise<string> {
  const penpotExportDir = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2");
  const syncJsPath = path.join(projectDir, ".pakalon-agents", "ai-agents", "sync.js");
  await ensureDir(path.dirname(syncJsPath));
  await fs.writeFile(syncJsPath, buildStandaloneSyncJs(projectDir, penpotExportDir, cooldownMs), "utf8");
  return syncJsPath;
}
