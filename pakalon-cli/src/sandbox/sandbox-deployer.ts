/**
 * SandboxDeployer
 *
 * Deploys the built application into the AIO Sandbox.
 *
 * Workflow:
 *   1. Copy built application files into the sandbox filesystem (via MCP file_write)
 *   2. Install dependencies inside the sandbox (via MCP shell_exec)
 *   3. Start the application server (via MCP shell_exec)
 *   4. Verify the health endpoint responds
 *
 * Falls back to direct Docker commands if MCP is not available.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import logger from '@/utils/logger.js';
import type {
  SandboxSession,
  DeployOptions,
  DeployResult,
} from './types.js';
import { SandboxMcpClient } from './mcp-client.js';
import { runDockerCommand } from './lifecycle-manager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HEALTH_ENDPOINT = '/';
const DEFAULT_APP_PORT = 3000;
const MAX_HEALTH_RETRIES = 15;
const HEALTH_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// Deployer
// ---------------------------------------------------------------------------

export class SandboxDeployer {
  private mcpClient?: SandboxMcpClient;

  /**
   * Deploy the built application into the sandbox.
   */
  async deployApp(
    session: SandboxSession,
    options: DeployOptions,
  ): Promise<DeployResult> {
    const startTime = Date.now();
    const appPort = options.appPort ?? DEFAULT_APP_PORT;

    logger.info('[SandboxDeployer] Deploying application to sandbox...');
    logger.info(`[SandboxDeployer] Project: ${options.projectDir}`);
    logger.info(`[SandboxDeployer] Target: ${session.url}`);

    try {
      // Connect to sandbox MCP
      this.mcpClient = new SandboxMcpClient(session.mcpUrl);
      await this.mcpClient.connect();

      // Step 1: Copy built files into sandbox
      await this.copyFiles(session, options.projectDir);

      // Step 2: Install dependencies
      await this.installDependencies(options.projectDir, options.buildCommand);

      // Step 3: Start the application server
      const serverPid = await this.startServer(options.startCommand, appPort, options.env);

      // Step 4: Verify health endpoint
      const appBaseUrl = session.appUrl ?? `http://localhost:${session.appHostPort || appPort}`;
      const appUrl = `${appBaseUrl.replace(/\/$/, '')}${options.healthEndpoint ?? DEFAULT_HEALTH_ENDPOINT}`;
      const healthOk = await this.verifyHealth(appUrl);

      if (!healthOk) {
        return {
          success: false,
          appUrl,
          message: 'Application started but health check failed',
          duration: Date.now() - startTime,
        };
      }

      logger.info('[SandboxDeployer] Application deployed and healthy');

      return {
        success: true,
        appUrl,
        serverPid: serverPid ?? undefined,
        message: 'Application deployed successfully',
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[SandboxDeployer] Deployment failed: ${message}`);
      return {
        success: false,
        appUrl: session.url,
        message: `Deployment failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Copy built application files into the sandbox filesystem.
   */
  private async copyFiles(session: SandboxSession, projectDir: string): Promise<void> {
    logger.info('[SandboxDeployer] Copying application files...');

    await this.mcpClient!.callTool('shell_exec', {
      command: 'rm -rf /app && mkdir -p /app',
      timeout: 30_000,
    });

    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pakalon-sandbox-upload-'));
    try {
      await this.copyProjectToStaging(projectDir, stagingDir);
      await runDockerCommand(['cp', `${stagingDir}${path.sep}.`, `${session.containerId}:/app`]);
      logger.info('[SandboxDeployer] File copy complete via docker cp');
      return;
    } catch (error) {
      logger.warn(`[SandboxDeployer] docker cp failed, falling back to MCP text copy: ${error}`);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }

    await this.copyTextFilesViaMcp(projectDir);

    logger.info('[SandboxDeployer] File copy complete');
  }

  /**
   * Install dependencies inside the sandbox using the appropriate package manager.
   */
  private async installDependencies(projectDir: string, buildCommand?: string): Promise<void> {
    try {
      await fs.access(path.join(projectDir, 'package.json'));
    } catch {
      logger.info('[SandboxDeployer] No package.json found — skipping dependency installation');
      return;
    }

    logger.info('[SandboxDeployer] Installing dependencies...');

    // Detect package manager from project files
    const pm = await this.detectPackageManager(projectDir);
    const installCmd = await this.getInstallCommand(projectDir, pm);

    logger.info(`[SandboxDeployer] Running: ${installCmd}`);
    const installResult = await this.mcpClient!.callTool('shell_exec', {
      command: `cd /app && ${installCmd}`,
      timeout: 120_000,
    });

    logger.info(`[SandboxDeployer] Install output: ${installResult}`);

    // Run build command if provided
    if (buildCommand) {
      logger.info(`[SandboxDeployer] Running build: ${buildCommand}`);
      const buildResult = await this.mcpClient!.callTool('shell_exec', {
        command: `cd /app && ${buildCommand}`,
        timeout: 180_000,
      });
      logger.info(`[SandboxDeployer] Build output: ${buildResult}`);
    }
  }

  /**
   * Start the application server inside the sandbox.
   */
  private async startServer(startCommand?: string, port?: number, env?: Record<string, string>): Promise<string> {
    logger.info('[SandboxDeployer] Starting application server...');

    const cmd = startCommand ?? 'npm start';
    const appPort = port ?? DEFAULT_APP_PORT;
    const envPrefix = this.formatEnv({ ...env, PORT: String(appPort), HOST: '0.0.0.0' });

    // Start the server in background
    const startResult = await this.mcpClient!.callTool('shell_exec', {
      command: `cd /app && ${envPrefix} sh -lc ${this.shellQuote(`${cmd} > /tmp/pakalon-app.log 2>&1 & echo $!`)}`,
      timeout: 15_000,
    });

    logger.info(`[SandboxDeployer] Server start output: ${startResult}`);

    // Give the server a moment to start
    await new Promise(r => setTimeout(r, 3000));

    return startResult;
  }

  /**
   * Verify the application health endpoint responds.
   */
  private async verifyHealth(appUrl: string): Promise<boolean> {
    logger.info(`[SandboxDeployer] Verifying health at ${appUrl}`);

    for (let i = 0; i < MAX_HEALTH_RETRIES; i++) {
      try {
        const response = await fetch(appUrl, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          logger.info(`[SandboxDeployer] Health check passed after ${i + 1} attempts`);
          return true;
        }
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, HEALTH_INTERVAL_MS));
    }

    logger.warn('[SandboxDeployer] Health check failed — all retries exhausted');
    return false;
  }

  /**
   * Collect build artifacts and source files to copy into sandbox.
   */
  private async collectBuildArtifacts(projectDir: string): Promise<string[]> {
    const files: string[] = [];
    const skipDirs = new Set([
      'node_modules',
      '.git',
      '.pakalon-agents',
      'coverage',
      '.turbo',
      '.cache',
      '.vercel',
    ]);

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (
          entry.name.endsWith('.ts') ||
          entry.name.endsWith('.tsx') ||
          entry.name.endsWith('.js') ||
          entry.name.endsWith('.jsx') ||
          entry.name.endsWith('.json') ||
          entry.name.endsWith('.yml') ||
          entry.name.endsWith('.yaml') ||
          entry.name.endsWith('.md')
        ) {
          files.push(fullPath);
        }
      }
    };

    await walk(projectDir);
    return files;
  }

  private async copyProjectToStaging(projectDir: string, stagingDir: string): Promise<void> {
    const files = await this.collectProjectFiles(projectDir);
    for (const file of files) {
      const relativePath = path.relative(projectDir, file);
      const destination = path.join(stagingDir, relativePath);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(file, destination);
    }
  }

  private async collectProjectFiles(projectDir: string): Promise<string[]> {
    const files: string[] = [];
    const skipDirs = new Set([
      'node_modules',
      '.git',
      '.pakalon-agents',
      'coverage',
      '.turbo',
      '.cache',
      '.vercel',
    ]);

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (skipDirs.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    };

    await walk(projectDir);
    return files;
  }

  private async copyTextFilesViaMcp(projectDir: string): Promise<void> {
    const filesToCopy = await this.collectBuildArtifacts(projectDir);
    for (const file of filesToCopy) {
      const relativePath = path.relative(projectDir, file);
      const normalizedPath = relativePath.replace(/\\/g, '/');
      try {
        const content = await fs.readFile(file, 'utf-8');
        await this.mcpClient!.callTool('shell_exec', {
          command: `mkdir -p ${this.shellQuote(path.posix.dirname(`/app/${normalizedPath}`))}`,
          timeout: 10_000,
        });
        await this.mcpClient!.callTool('file_write', {
          path: `/app/${normalizedPath}`,
          content,
        });
      } catch (err) {
        logger.warn(`[SandboxDeployer] Skipping non-text file ${normalizedPath}: ${err}`);
      }
    }
  }

  private async detectPackageManager(projectDir: string): Promise<'npm' | 'yarn' | 'pnpm' | 'bun'> {
    try {
      await fs.access(path.join(projectDir, 'bun.lock'));
      return 'bun';
    } catch {
      try {
        await fs.access(path.join(projectDir, 'pnpm-lock.yaml'));
        return 'pnpm';
      } catch {
        try {
          await fs.access(path.join(projectDir, 'yarn.lock'));
          return 'yarn';
        } catch {
          return 'npm';
        }
      }
    }
  }

  private async getInstallCommand(projectDir: string, pm: 'npm' | 'yarn' | 'pnpm' | 'bun'): Promise<string> {
    switch (pm) {
      case 'bun': return 'bun install || npm install';
      case 'pnpm': return 'pnpm install || npm install';
      case 'yarn': return 'yarn install || npm install';
      default: {
        const hasPackageLock = await fs.access(path.join(projectDir, 'package-lock.json')).then(() => true).catch(() => false);
        return hasPackageLock ? 'npm ci' : 'npm install';
      }
    }
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private formatEnv(env: Record<string, string>): string {
    const entries = Object.entries(env)
      .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && value !== undefined)
      .map(([key, value]) => `${key}=${this.shellQuote(value)}`);
    return entries.length > 0 ? `${entries.join(' ')} ` : '';
  }

  /**
   * Clean up MCP connection.
   */
  async disconnect(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.disconnect();
      this.mcpClient = undefined;
    }
  }
}

export default SandboxDeployer;
