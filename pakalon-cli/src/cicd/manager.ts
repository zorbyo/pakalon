/**
 * CI/CD manager — pure TypeScript logic for environment management, deploy, rollback.
 * Replaces Python bridge /cicd/* endpoints.
 */
import * as fs from "fs";
import * as path from "path";
import { executeBash } from "@/tools/bash.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Environment {
  name: string;
  url?: string;
  status: "active" | "inactive" | "deploying" | "failed";
  lastDeploy?: string;
  version?: string;
}

export interface DeployResult {
  success: boolean;
  environment: string;
  version?: string;
  url?: string;
  error?: string;
  logs?: string;
}

export interface CICDConfig {
  environments: Environment[];
  deployCommand?: string;
  promoteCommand?: string;
  rollbackCommand?: string;
  history: Array<{
    environment: string;
    version: string;
    timestamp: string;
    status: "success" | "failed";
    user?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Config Management
// ---------------------------------------------------------------------------

function getConfigPath(projectDir: string): string {
  return path.join(projectDir, ".pakalon", "cicd.json");
}

function loadConfig(projectDir: string): CICDConfig {
  const configPath = getConfigPath(projectDir);
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8")) as CICDConfig;
    }
  } catch { /* ignore */ }

  return {
    environments: [
      { name: "development", status: "active" },
      { name: "staging", status: "inactive" },
      { name: "production", status: "inactive" },
    ],
    history: [],
  };
}

function saveConfig(projectDir: string, config: CICDConfig): void {
  const configPath = getConfigPath(projectDir);
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get CI/CD status for a project.
 */
export function getStatus(projectDir: string): CICDConfig {
  return loadConfig(projectDir);
}

/**
 * Deploy to an environment.
 */
export async function deploy(
  projectDir: string,
  environment: string,
  version?: string,
): Promise<DeployResult> {
  const config = loadConfig(projectDir);
  const env = config.environments.find((e) => e.name === environment);

  if (!env) {
    return { success: false, environment, error: `Environment '${environment}' not found` };
  }

  // Update status to deploying
  env.status = "deploying";
  saveConfig(projectDir, config);

  try {
    // Execute deploy command if configured
    if (config.deployCommand) {
      const result = await executeBash({
        command: config.deployCommand
          .replace("{{env}}", environment)
          .replace("{{version}}", version ?? "latest"),
        cwd: projectDir,
        timeout: 300000,
      });

      if (result.exitCode !== 0) {
        env.status = "failed";
        config.history.push({
          environment,
          version: version ?? "latest",
          timestamp: new Date().toISOString(),
          status: "failed",
        });
        saveConfig(projectDir, config);
        return {
          success: false,
          environment,
          error: result.stderr,
          logs: result.stdout,
        };
      }
    }

    // Success
    env.status = "active";
    env.lastDeploy = new Date().toISOString();
    env.version = version ?? "latest";
    config.history.push({
      environment,
      version: version ?? "latest",
      timestamp: new Date().toISOString(),
      status: "success",
    });
    saveConfig(projectDir, config);

    return {
      success: true,
      environment,
      version: env.version,
      url: env.url,
    };
  } catch (err) {
    env.status = "failed";
    saveConfig(projectDir, config);
    return { success: false, environment, error: String(err) };
  }
}

/**
 * Promote from one environment to another.
 */
export async function promote(
  projectDir: string,
  from: string,
  to: string,
): Promise<DeployResult> {
  const config = loadConfig(projectDir);
  const sourceEnv = config.environments.find((e) => e.name === from);

  if (!sourceEnv?.version) {
    return { success: false, environment: to, error: `No version deployed to '${from}'` };
  }

  return deploy(projectDir, to, sourceEnv.version);
}

/**
 * Rollback an environment to a previous version.
 */
export async function rollback(
  projectDir: string,
  environment: string,
  version?: string,
): Promise<DeployResult> {
  const config = loadConfig(projectDir);

  // Find version to rollback to
  let targetVersion = version;
  if (!targetVersion) {
    const envHistory = config.history
      .filter((h) => h.environment === environment && h.status === "success")
      .reverse();
    targetVersion = envHistory[1]?.version; // Previous successful version
  }

  if (!targetVersion) {
    return {
      success: false,
      environment,
      error: "No previous version to rollback to",
    };
  }

  return deploy(projectDir, environment, targetVersion);
}

/**
 * Configure deploy/promote/rollback commands.
 */
export function configure(
  projectDir: string,
  options: { deployCommand?: string; promoteCommand?: string; rollbackCommand?: string },
): void {
  const config = loadConfig(projectDir);
  if (options.deployCommand) config.deployCommand = options.deployCommand;
  if (options.promoteCommand) config.promoteCommand = options.promoteCommand;
  if (options.rollbackCommand) config.rollbackCommand = options.rollbackCommand;
  saveConfig(projectDir, config);
}

/**
 * Get deployment history.
 */
export function getHistory(
  projectDir: string,
  environment?: string,
  limit: number = 20,
): CICDConfig["history"] {
  const config = loadConfig(projectDir);
  let history = config.history;
  if (environment) {
    history = history.filter((h) => h.environment === environment);
  }
  return history.slice(-limit);
}
