/**
 * SandboxLifecycleManager
 *
 * Manages the AIO Sandbox Docker container lifecycle.
 * Follows the same Docker launch pattern as src/penpot/docker-launcher.ts.
 *
 * Lifecycle:
 *   1. provision() — pull & start the AIO Sandbox container, wait for MCP endpoint
 *   2. destroy()   — stop & remove the container
 *   3. getStatus() — check if the sandbox is running
 */

import { execFile, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createServer } from 'net';
import { v4 as uuid } from 'uuid';
import logger from '@/utils/logger.js';
import { registerSandboxMcp, unregisterSandboxMcp } from '@/mcp/manager.js';
import type {
  SandboxSession,
  DockerStatus,
  SandboxStateFile,
} from './types.js';
import {
  SANDBOX_STATE_FILE,
  SANDBOX_STATE_DIR,
  DEFAULT_SANDBOX_PORT,
  DEFAULT_APP_PORT,
  DEFAULT_SANDBOX_IMAGE,
  DEFAULT_CONTAINER_NAME,
  MCP_ENDPOINT_PATH,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_CHECK_INTERVAL_MS,
  PAKALON_SANDBOX_NETWORK,
  isSandboxUsableStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Docker helpers
// ---------------------------------------------------------------------------

export function findDockerCmd(): string | null {
  try {
    execSync('docker --version', { stdio: 'ignore', timeout: 5000 });
    return 'docker';
  } catch {
    try {
      execSync('podman --version', { stdio: 'ignore', timeout: 5000 });
      return 'podman';
    } catch {
      return null;
    }
  }
}

export function runDockerCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const docker = findDockerCmd();
  if (!docker) {
    return Promise.reject(new Error('Docker not found. Please install Docker Desktop or Podman.'));
  }
  return new Promise((resolve, reject) => {
    execFile(docker, args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export function isDockerAvailable(): boolean {
  return findDockerCmd() !== null;
}

// ---------------------------------------------------------------------------
// Application size detection
// ---------------------------------------------------------------------------

/**
 * Count the number of project files (excluding node_modules, .git, etc.).
 */
export async function countProjectFiles(projectDir: string): Promise<number> {
  const skipDirs = new Set(['node_modules', '.git', '.pakalon', '.pakalon-agents', 'dist', '.next', 'build', 'coverage']);
  let count = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) await walk(path.join(dir, entry.name));
      } else {
        count++;
      }
    }
  };
  await walk(projectDir);
  return count;
}

/**
 * Count the number of dependencies in package.json.
 */
export async function countDependencies(projectDir: string): Promise<number> {
  try {
    const pkgRaw = await fs.readFile(path.join(projectDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    const deps = pkg.dependencies ? Object.keys(pkg.dependencies).length : 0;
    const devDeps = pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0;
    return deps + devDeps;
  } catch {
    return 0;
  }
}

/**
 * Simple heuristic: only sandbox applications that are "large enough".
 */
export async function isApplicationLargeEnough(projectDir: string): Promise<boolean> {
  const fileCount = await countProjectFiles(projectDir);
  const dependencyCount = await countDependencies(projectDir);
  return fileCount > 20 || dependencyCount > 10;
}

// ---------------------------------------------------------------------------
// State file helpers
// ---------------------------------------------------------------------------

function stateFilePath(projectDir: string): string {
  return path.join(projectDir, SANDBOX_STATE_DIR, SANDBOX_STATE_FILE);
}

async function writeState(projectDir: string, session: SandboxSession): Promise<void> {
  const dir = path.dirname(stateFilePath(projectDir));
  await fs.mkdir(dir, { recursive: true });
  const stateFile: SandboxStateFile = {
    sandboxId: session.sandboxId,
    containerId: session.containerId,
    containerName: session.containerName,
    image: session.image,
    url: session.url,
    mcpUrl: session.mcpUrl,
    appUrl: session.appUrl,
    mcpHostPort: session.mcpHostPort,
    appPort: session.appPort,
    appHostPort: session.appHostPort,
    provisionedAt: session.provisionedAt,
    updatedAt: new Date().toISOString(),
    status: session.status,
    deployStatus: session.deployStatus,
    testResults: session.testResults,
    policyResult: session.policyResult,
    iteration: session.iteration,
  };
  await fs.writeFile(stateFilePath(projectDir), JSON.stringify(stateFile, null, 2));
}

export async function loadSandboxState(projectDir: string): Promise<SandboxStateFile | null> {
  try {
    const raw = await fs.readFile(stateFilePath(projectDir), 'utf-8');
    return JSON.parse(raw) as SandboxStateFile;
  } catch {
    return null;
  }
}

export async function clearSandboxState(projectDir: string): Promise<void> {
  try {
    await fs.unlink(stateFilePath(projectDir));
  } catch {
    // File may not exist
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

async function waitForMcpEndpoint(
  mcpUrl: string,
  timeoutMs: number = HEALTH_CHECK_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const response = await fetch(mcpUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json, text/event-stream',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok || response.status === 400 || response.status === 405 || response.status === 406) {
        logger.info(`[Sandbox] MCP endpoint ready after ~${attempt * (HEALTH_CHECK_INTERVAL_MS / 1000)}s`);
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
  }
  logger.warn(`[Sandbox] MCP endpoint not ready after ${timeoutMs / 1000}s`);
  return false;
}

// ---------------------------------------------------------------------------
// Pre-pull (Risk 2: startup latency mitigation)
// ---------------------------------------------------------------------------

/**
 * Pre-pull the AIO Sandbox Docker image in the background.
 * Called during Phase 2 so the image is cached by the time Phase 3 provisions.
 * This is intentionally fire-and-forget — failures are only logged.
 */
export async function prePullSandboxImage(image?: string): Promise<void> {
  const targetImage = image ?? DEFAULT_SANDBOX_IMAGE;
  logger.info(`[Sandbox] Pre-pulling image in background: ${targetImage}`);
  try {
    const { stdout } = await runDockerCommand(['pull', targetImage]);
    const lines = stdout.split('\n').filter(l => l.trim());
    const summary = lines.length > 0 ? lines[lines.length - 1] : 'ok';
    logger.info(`[Sandbox] Pre-pull complete for ${targetImage}: ${summary}`);
  } catch (error) {
    // Non-fatal: the pull will be retried during provision()
    logger.warn(`[Sandbox] Pre-pull failed (will retry during provision): ${error}`);
  }
}

// ---------------------------------------------------------------------------
// Docker network (Risk 5 mitigation: shared network for sandbox + DAST)
// ---------------------------------------------------------------------------

/**
 * Ensure the shared Docker network for sandbox + DAST containers exists.
 * Creates it idempotently if it does not already exist.
 * Returns the network name.
 */
export async function ensureSandboxNetwork(): Promise<string> {
  const networkName = PAKALON_SANDBOX_NETWORK;

  // Check if it already exists
  try {
    const { stdout } = await runDockerCommand(['network', 'inspect', networkName, '--format', '{{.Name}}']);
    if (stdout.trim() === networkName) {
      logger.debug(`[Sandbox] Network ${networkName} already exists`);
      return networkName;
    }
  } catch {
    // Does not exist — create it
  }

  logger.info(`[Sandbox] Creating shared Docker network: ${networkName}`);
  await runDockerCommand(['network', 'create', '--driver', 'bridge', networkName]);
  logger.info(`[Sandbox] Network ${networkName} created`);
  return networkName;
}

/**
 * Remove the shared Docker network. Called during sandbox cleanup
 * when no more sandbox sessions use it.
 */
export async function removeSandboxNetwork(): Promise<void> {
  try {
    // Only remove if no containers are attached
    const { stdout } = await runDockerCommand([
      'network', 'inspect', PAKALON_SANDBOX_NETWORK,
      '--format', '{{range .Containers}}{{.Name}} {{end}}',
    ]);
    if (stdout.trim().length > 0) {
      logger.debug(`[Sandbox] Network ${PAKALON_SANDBOX_NETWORK} still has attached containers — not removing`);
      return;
    }
    await runDockerCommand(['network', 'rm', PAKALON_SANDBOX_NETWORK]);
    logger.info(`[Sandbox] Network ${PAKALON_SANDBOX_NETWORK} removed`);
  } catch (error) {
    logger.warn(`[Sandbox] Network removal skipped: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// Port allocation (dynamic to avoid conflicts)
// ---------------------------------------------------------------------------

async function findFreePort(preferred: number): Promise<number> {
  const ports = [
    preferred,
    preferred + 1,
    preferred + 2,
    preferred + 3,
    preferred + 4,
    preferred + 5,
  ];
  for (const port of ports) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  return 0; // Let Docker assign
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function getMappedHostPort(containerId: string, containerPort: number): Promise<number> {
  const { stdout } = await runDockerCommand([
    'inspect',
    containerId,
    '--format',
    `{{(index (index .NetworkSettings.Ports "${containerPort}/tcp") 0).HostPort}}`,
  ]);
  const parsed = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Could not resolve host port for container port ${containerPort}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class SandboxLifecycleManager {
  private sessions = new Map<string, SandboxSession>();

  /**
   * Provision a new AIO Sandbox Docker container.
   * Returns the session with connection details.
   */
  async provision(projectDir: string, options?: {
    image?: string;
    containerName?: string;
    port?: number;
    appPort?: number;
    appHostPort?: number;
    memoryMb?: number;
  }): Promise<SandboxSession> {
    logger.info('[Sandbox] Provisioning AIO Sandbox...');

    // Check Docker availability
    if (!isDockerAvailable()) {
      throw new Error(
        'Docker is required to provision the AIO Sandbox. ' +
        'Please install Docker Desktop from https://www.docker.com/products/docker-desktop/',
      );
    }

    const image = options?.image ?? DEFAULT_SANDBOX_IMAGE;
    const containerName = options?.containerName ?? `${DEFAULT_CONTAINER_NAME}-${Date.now()}`;
    const mcpHostPort = await findFreePort(options?.port ?? DEFAULT_SANDBOX_PORT);
    const appPort = options?.appPort ?? DEFAULT_APP_PORT;
    const appHostPort = await findFreePort(options?.appHostPort ?? appPort);

    // Ensure shared Docker network exists for sandbox + DAST containers
    const networkName = await ensureSandboxNetwork();

    // Pull the image first (non-blocking)
    logger.info(`[Sandbox] Pulling image: ${image}`);
    runDockerCommand(['pull', image]).catch(err =>
      logger.warn(`[Sandbox] Image pull background: ${err}`),
    );

    // Build docker run arguments
    const runArgs: string[] = [
      'run', '--rm', '-d',
      '--name', containerName,
      '--label', 'pakalon-sandbox=true',
      '--network', networkName,
      '--network-alias', 'pakalon-sandbox',
    ];

    // Memory limit
    if (options?.memoryMb) {
      runArgs.push('--memory', `${options.memoryMb}m`);
    }

    // Port mapping. Bind to localhost so the sandbox services are only exposed
    // to this machine while still being reachable by host-side scanners.
    if (mcpHostPort > 0) {
      runArgs.push('-p', `127.0.0.1:${mcpHostPort}:${DEFAULT_SANDBOX_PORT}`);
    } else {
      runArgs.push('-p', `${DEFAULT_SANDBOX_PORT}`);
    }

    if (appHostPort > 0) {
      runArgs.push('-p', `127.0.0.1:${appHostPort}:${appPort}`);
    } else {
      runArgs.push('-p', `${appPort}`);
    }

    // Add host.docker.internal DNS for backward compatibility with host-side scanners
    runArgs.push('--add-host', 'host.docker.internal:host-gateway');

    runArgs.push(image);

    // Start container
    logger.info(`[Sandbox] Starting container: ${containerName}`);
    const { stdout: containerId } = await runDockerCommand(runArgs);
    const containerIdTrimmed = containerId.trim();

    const actualMcpHostPort = mcpHostPort === 0
      ? await getMappedHostPort(containerIdTrimmed, DEFAULT_SANDBOX_PORT)
      : mcpHostPort;
    const actualAppHostPort = appHostPort === 0
      ? await getMappedHostPort(containerIdTrimmed, appPort)
      : appHostPort;

    const sandboxUrl = `http://localhost:${actualMcpHostPort}`;
    const mcpUrl = `${sandboxUrl}${MCP_ENDPOINT_PATH}`;
    const appUrl = `http://localhost:${actualAppHostPort}`;

    // Wait for MCP endpoint readiness
    const ready = await waitForMcpEndpoint(mcpUrl);
    if (!ready) {
      // Clean up on failure
      await runDockerCommand(['rm', '-f', containerIdTrimmed]).catch(() => {});
      throw new Error(`AIO Sandbox did not become ready after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s`);
    }

    const session: SandboxSession = {
      sandboxId: uuid(),
      containerId: containerIdTrimmed,
      containerName,
      image,
      url: sandboxUrl,
      mcpUrl,
      appUrl,
      mcpHostPort: actualMcpHostPort,
      appPort,
      appHostPort: actualAppHostPort,
      provisionedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      networkName,
    };

    this.sessions.set(session.sandboxId, session);
    await writeState(projectDir, session);

    // Register sandbox MCP as a managed MCP server so agents can discover it
    registerSandboxMcp(mcpUrl, projectDir).catch(err =>
      logger.warn(`[Sandbox] MCP registration failed: ${err}`),
    );

    logger.info(`[Sandbox] Provisioned: ${sandboxUrl} (MCP: ${mcpUrl})`);
    return session;
  }

  /**
   * Destroy the sandbox container and clean up state.
   */
  async destroy(sandboxId: string, projectDir?: string): Promise<void> {
    const session = this.sessions.get(sandboxId) ?? await this.findSessionFromState(sandboxId, projectDir);
    if (!session) {
      logger.warn(`[Sandbox] No session found for ${sandboxId}`);
      return;
    }

    logger.info(`[Sandbox] Destroying sandbox: ${sandboxId}`);
    session.status = 'destroying';

    try {
      await runDockerCommand(['rm', '-f', session.containerId]);
      logger.info(`[Sandbox] Container ${session.containerId} removed`);
    } catch (error) {
      logger.warn(`[Sandbox] Container removal failed (may already be stopped): ${error}`);
    }

    session.status = 'destroyed';
    this.sessions.delete(sandboxId);

    if (projectDir) {
      await clearSandboxState(projectDir);
      // Unregister sandbox MCP from managed MCP server list
      unregisterSandboxMcp(projectDir);
    }

    // Clean up the shared Docker network if no more sandbox containers use it
    await removeSandboxNetwork();
  }

  /**
   * Get the status of a sandbox session.
   */
  async getStatus(sandboxId: string, projectDir?: string): Promise<DockerStatus> {
    const session = this.sessions.get(sandboxId) ?? await this.findSessionFromState(sandboxId, projectDir);
    if (!session) {
      return { available: false, error: 'Session not found' };
    }

    return this.getContainerStatus(session.containerId);
  }

  /**
   * Check if a container is running by ID. This works even after process restart
   * when the in-memory session map is empty but sandbox-state.json is present.
   */
  async getContainerStatus(containerId: string): Promise<DockerStatus> {
    if (!containerId) {
      return { available: false, error: 'Container ID missing' };
    }

    try {
      const { stdout } = await runDockerCommand([
        'ps', '--filter', `id=${containerId}`,
        '--format', '{{.ID}}',
      ]);
      const running = stdout.trim().length > 0;
      return {
        available: running,
        containerId: running ? containerId : undefined,
        error: running ? undefined : 'Container not running',
      };
    } catch (error) {
      return { available: false, error: String(error) };
    }
  }

  async getLogs(sandboxId: string, projectDir?: string, lines = 100): Promise<string> {
    const session = this.sessions.get(sandboxId) ?? await this.findSessionFromState(sandboxId, projectDir);
    if (!session) {
      throw new Error(`No session found for ${sandboxId}`);
    }

    const { stdout, stderr } = await runDockerCommand([
      'logs',
      '--tail',
      String(lines),
      session.containerId,
    ]);
    return stdout || stderr;
  }

  /**
   * Update session state and persist to disk.
   */
  async updateSession(
    sandboxId: string,
    patch: Partial<SandboxSession>,
    projectDir?: string,
  ): Promise<void> {
    const session = this.sessions.get(sandboxId) ?? await this.findSessionFromState(sandboxId, projectDir);
    if (!session) {
      logger.warn(`[Sandbox] Cannot update unknown session: ${sandboxId}`);
      return;
    }
    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    if (projectDir) {
      await writeState(projectDir, session);
    }
  }

  /**
   * Get all active sessions.
   */
  getSessions(): SandboxSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status !== 'destroyed');
  }

  /**
   * Check if any sandbox is currently provisioned.
   */
  async isSandboxActive(projectDir?: string): Promise<boolean> {
    if (this.sessions.size > 0) return true;
    if (projectDir) {
      // Check state file as fallback
      const state = await loadSandboxState(projectDir);
      return state !== null && isSandboxUsableStatus(state.status);
    }
    return false;
  }

  private async findSessionFromState(
    sandboxId: string,
    projectDir?: string,
  ): Promise<SandboxSession | undefined> {
    if (!projectDir) return undefined;
    const state = await loadSandboxState(projectDir);
    if (!state || state.sandboxId !== sandboxId) return undefined;

    const session: SandboxSession = {
      ...state,
      status: state.status,
      mcpHostPort: state.mcpHostPort ?? DEFAULT_SANDBOX_PORT,
      appPort: state.appPort ?? DEFAULT_APP_PORT,
      appHostPort: state.appHostPort ?? DEFAULT_APP_PORT,
      appUrl: state.appUrl,
      deployStatus: state.deployStatus,
    };
    this.sessions.set(sandboxId, session);
    return session;
  }
}

// Singleton instance
export const sandboxLifecycleManager = new SandboxLifecycleManager();

export default sandboxLifecycleManager;
