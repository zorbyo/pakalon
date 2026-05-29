/**
 * Directory Trust Model — Copilot-style mandatory trust prompt.
 * Stores trusted directories in ~/.config/pakalon/trusted.json.
 *
 * Prevents malicious repo configs from executing code by requiring
 * explicit user consent before loading MCP/LSP/hook configurations.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrustedDirectory {
  path: string;
  trustedAt: string;
  /** Hash of directory for verification */
  hash: string;
}

export interface TrustConfig {
  trustedDirectories: TrustedDirectory[];
  /** Whether to skip trust prompts (dangerous) */
  skipTrustPrompts: boolean;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function getTrustConfigPath(): string {
  const configDir = process.env.PAKALON_CONFIG_DIR
    ?? path.join(os.homedir(), ".config", "pakalon");
  return path.join(configDir, "trusted.json");
}

function loadTrustConfig(): TrustConfig {
  try {
    const configPath = getTrustConfigPath();
    if (!fs.existsSync(configPath)) {
      return { trustedDirectories: [], skipTrustPrompts: false };
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as TrustConfig;
  } catch {
    return { trustedDirectories: [], skipTrustPrompts: false };
  }
}

function saveTrustConfig(config: TrustConfig): void {
  const configPath = getTrustConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Directory Hash
// ---------------------------------------------------------------------------

function hashDirectory(dirPath: string): string {
  const { createHash } = require("crypto") as typeof import("crypto");
  // Hash the absolute path + git root if available
  const hash = createHash("sha256");
  hash.update(path.resolve(dirPath));
  return hash.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a directory is trusted.
 */
export function isDirectoryTrusted(dirPath: string): boolean {
  const config = loadTrustConfig();

  if (config.skipTrustPrompts) return true;

  const resolved = path.resolve(dirPath);
  const hash = hashDirectory(resolved);

  return config.trustedDirectories.some(
    (td) => path.resolve(td.path) === resolved || td.hash === hash,
  );
}

/**
 * Mark a directory as trusted.
 */
export function trustDirectory(dirPath: string): void {
  const config = loadTrustConfig();
  const resolved = path.resolve(dirPath);

  // Check if already trusted
  if (isDirectoryTrusted(resolved)) return;

  config.trustedDirectories.push({
    path: resolved,
    trustedAt: new Date().toISOString(),
    hash: hashDirectory(resolved),
  });

  saveTrustConfig(config);
  logger.info("[trust] Directory trusted", { path: resolved });
}

/**
 * Remove trust for a directory.
 */
export function untrustDirectory(dirPath: string): boolean {
  const config = loadTrustConfig();
  const resolved = path.resolve(dirPath);
  const before = config.trustedDirectories.length;

  config.trustedDirectories = config.trustedDirectories.filter(
    (td) => path.resolve(td.path) !== resolved,
  );

  if (config.trustedDirectories.length < before) {
    saveTrustConfig(config);
    return true;
  }
  return false;
}

/**
 * List all trusted directories.
 */
export function listTrustedDirectories(): TrustedDirectory[] {
  return loadTrustConfig().trustedDirectories;
}

/**
 * Validate that a workspace is trusted before loading configs.
 * This should be called before loading MCP servers, LSP configs, or hooks.
 * Returns a trust check result — the caller decides whether to show a prompt.
 */
export function checkWorkspaceTrust(dirPath: string): {
  trusted: boolean;
  dirPath: string;
  firstTime: boolean;
} {
  const config = loadTrustConfig();
  const isFirstTime = config.trustedDirectories.length === 0 && !config.skipTrustPrompts;

  return {
    trusted: isDirectoryTrusted(dirPath),
    dirPath: path.resolve(dirPath),
    firstTime: isFirstTime,
  };
}

/**
 * Set skip trust prompts (for non-interactive mode).
 */
export function setSkipTrustPrompts(skip: boolean): void {
  const config = loadTrustConfig();
  config.skipTrustPrompts = skip;
  saveTrustConfig(config);
}
