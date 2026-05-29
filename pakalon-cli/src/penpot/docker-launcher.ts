/**
 * Penpot Docker Launcher
 *
 * Manages the Penpot Docker container lifecycle for the Phase 2 agent.
 * Automatically starts Penpot via Docker Compose, waits for readiness,
 * and opens the browser.
 */

import { execFile, execSync } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DockerStatus {
  running: boolean;
  containerId?: string;
  error?: string;
}

export interface PenpotStatus {
  penpotReady: boolean;
  dockerRunning: boolean;
  url: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PENPOT_DEFAULT_URL = "http://localhost:3449";
const PENPOT_HEALTH_CHECK_RETRIES = 30;
const PENPOT_HEALTH_CHECK_INTERVAL_MS = 4000; // 4 seconds between retries
const MAX_WAIT_TIME_MS = PENPOT_HEALTH_CHECK_RETRIES * PENPOT_HEALTH_CHECK_INTERVAL_MS;

// ---------------------------------------------------------------------------
// Docker Compose detection
// ---------------------------------------------------------------------------

function findComposeFile(projectDir: string): string | null {
  // Search order: project root, python/ subdir, pakalon-cli root
  const candidates = [
    path.join(projectDir, "python", "penpot-compose.yml"),
    path.join(projectDir, "penpot-compose.yml"),
    path.join(process.cwd(), "python", "penpot-compose.yml"),
    path.join(process.cwd(), "penpot-compose.yml"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findDockerCmd(): string | null {
  try {
    execSync("docker --version", { stdio: "ignore", timeout: 5000 });
    return "docker";
  } catch {
    try {
      execSync("podman --version", { stdio: "ignore", timeout: 5000 });
      return "podman";
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Docker commands
// ---------------------------------------------------------------------------

function composeArgs(composeFile: string): string[] {
  return ["compose", "-f", composeFile];
}

async function runDockerCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const docker = findDockerCmd();
  if (!docker) {
    throw new Error("Docker not found. Please install Docker Desktop or Podman.");
  }

  return new Promise((resolve, reject) => {
    execFile(docker, args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Status checks
// ---------------------------------------------------------------------------

export function isDockerAvailable(): boolean {
  return findDockerCmd() !== null;
}

export async function isPenpotRunning(): Promise<boolean> {
  try {
    const response = await fetch(PENPOT_DEFAULT_URL, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    return response.ok || response.status === 302 || response.status === 304;
  } catch {
    return false;
  }
}

export async function checkDockerStatus(): Promise<DockerStatus> {
  try {
    const docker = findDockerCmd();
    if (!docker) {
      return { running: false, error: "Docker not found" };
    }

    const { stdout } = await runDockerCommand([
      "ps",
      "--filter", "name=penpot",
      "--format", "{{.ID}}",
    ]);

    if (stdout) {
      return { running: true, containerId: stdout.split("\n")[0] };
    }
    return { running: false };
  } catch (error) {
    return { running: false, error: String(error) };
  }
}

export async function getPenpotStatus(): Promise<PenpotStatus> {
  const [penpotReady, dockerStatus] = await Promise.all([
    isPenpotRunning(),
    checkDockerStatus(),
  ]);

  return {
    penpotReady,
    dockerRunning: dockerStatus.running,
    url: PENPOT_DEFAULT_URL,
  };
}

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

export async function startPenpot(projectDir?: string): Promise<boolean> {
  const composeFile = findComposeFile(projectDir ?? process.cwd());
  if (!composeFile) {
    throw new Error(
      "Penpot Docker Compose file not found. " +
      "Expected `python/penpot-compose.yml` in project root.",
    );
  }

  logger.info(`[Penpot] Starting Penpot with ${composeFile}...`);
  await runDockerCommand([...composeArgs(composeFile), "up", "-d"]);
  logger.info("[Penpot] Docker Compose started successfully");
  return true;
}

export async function stopPenpot(projectDir?: string): Promise<boolean> {
  const composeFile = findComposeFile(projectDir ?? process.cwd());
  if (!composeFile) {
    logger.warn("[Penpot] Compose file not found, cannot stop");
    return false;
  }

  try {
    logger.info("[Penpot] Stopping Penpot...");
    await runDockerCommand([...composeArgs(composeFile), "down"]);
    logger.info("[Penpot] Stopped successfully");
    return true;
  } catch (error) {
    logger.warn(`[Penpot] Failed to stop: ${error}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wait for readiness
// ---------------------------------------------------------------------------

export async function waitForPenpotReady(timeoutMs: number = MAX_WAIT_TIME_MS): Promise<boolean> {
  const retries = Math.ceil(timeoutMs / PENPOT_HEALTH_CHECK_INTERVAL_MS);
  logger.info(`[Penpot] Waiting for Penpot to be ready (up to ${Math.round(timeoutMs / 1000)}s)...`);

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`${PENPOT_DEFAULT_URL}/api/rpc/command/get-profile`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        logger.info(`[Penpot] Ready after ~${(i + 1) * PENPOT_HEALTH_CHECK_INTERVAL_MS / 1000}s`);
        return true;
      }
    } catch {
      // Not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, PENPOT_HEALTH_CHECK_INTERVAL_MS));
    logger.info(`[Penpot] Waiting... (${i + 1}/${retries})`);
  }

  logger.warn(`[Penpot] Not ready after ${Math.round(timeoutMs / 1000)}s`);
  return false;
}

// ---------------------------------------------------------------------------
// Browser launch
// ---------------------------------------------------------------------------

export async function launchPenpotBrowser(url?: string): Promise<void> {
  const targetUrl = url ?? PENPOT_DEFAULT_URL;
  try {
    const openModule = await import("open");
    await openModule.default(targetUrl);
    logger.info(`[Penpot] Browser opened to ${targetUrl}`);
  } catch (error) {
    logger.warn(`[Penpot] Could not open browser: ${error}`);
    logger.info(`[Penpot] Please open ${targetUrl} manually`);
  }
}

// ---------------------------------------------------------------------------
// Orchestrated lifecycle
// ---------------------------------------------------------------------------

export async function ensurePenpotRunning(projectDir?: string): Promise<PenpotStatus> {
  // Check if already running
  const alreadyRunning = await isPenpotRunning();
  if (alreadyRunning) {
    logger.info("[Penpot] Already running");
    return { penpotReady: true, dockerRunning: true, url: PENPOT_DEFAULT_URL };
  }

  // Check Docker availability
  if (!isDockerAvailable()) {
    throw new Error(
      "Docker is required to run Penpot. " +
      "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/",
    );
  }

  // Start Penpot
  try {
    await startPenpot(projectDir);
  } catch (error) {
    throw new Error(`Failed to start Penpot: ${error}`);
  }

  // Wait for readiness
  const ready = await waitForPenpotReady();
  if (!ready) {
    throw new Error("Penpot did not become ready in time. Check Docker logs for details.");
  }

  return { penpotReady: ready, dockerRunning: true, url: PENPOT_DEFAULT_URL };
}

export function getPenpotUrl(): string {
  return process.env.PENPOT_HOST ?? PENPOT_DEFAULT_URL;
}

export default {
  ensurePenpotRunning,
  stopPenpot,
  isPenpotRunning,
  isDockerAvailable,
  checkDockerStatus,
  getPenpotStatus,
  waitForPenpotReady,
  launchPenpotBrowser,
  getPenpotUrl,
  startPenpot,
};