/**
 * Permission caching — session-level + permanent per-directory cache.
 * Matches Copilot CLI's permission caching model.
 *
 * Improves UX by remembering user approvals:
 * - "Approve for Session" persists across all similar tool calls in session
 * - "Approve Permanently" stores in ~/.config/pakalon/permissions.json per directory
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PermanentPermission {
  /** Tool name pattern (e.g., "bash", "readFile", or "bash:ls") */
  tool: string;
  /** Directory this permission applies to */
  directory: string;
  /** Allowed action pattern (e.g., command prefix, file pattern) */
  pattern?: string;
  /** When this permission was granted */
  grantedAt: string;
}

export interface PermissionCacheConfig {
  permissions: PermanentPermission[];
}

// ---------------------------------------------------------------------------
// Session Cache (in-memory)
// ---------------------------------------------------------------------------

/** Per-session tool approvals: { "tool:pattern" → true } */
const sessionCache = new Map<string, boolean>();

/**
 * Generate a cache key for a tool + pattern.
 */
function cacheKey(tool: string, pattern?: string): string {
  return pattern ? `${tool}:${pattern}` : tool;
}

/**
 * Check if a tool call is approved for this session.
 */
export function isSessionApproved(tool: string, pattern?: string): boolean {
  return sessionCache.get(cacheKey(tool, pattern)) === true
    || sessionCache.get(tool) === true; // Wildcard approval
}

/**
 * Mark a tool as approved for this session.
 */
export function approveForSession(tool: string, pattern?: string): void {
  sessionCache.set(cacheKey(tool, pattern), true);
  logger.debug("[permission-cache] Session approved", { tool, pattern });
}

/**
 * Clear session approvals.
 */
export function clearSessionApprovals(): void {
  sessionCache.clear();
}

// ---------------------------------------------------------------------------
// Permanent Cache (disk)
// ---------------------------------------------------------------------------

function getPermissionCachePath(): string {
  const configDir = process.env.PAKALON_CONFIG_DIR
    ?? path.join(os.homedir(), ".config", "pakalon");
  return path.join(configDir, "permissions.json");
}

function loadPermanentPermissions(): PermissionCacheConfig {
  try {
    const configPath = getPermissionCachePath();
    if (!fs.existsSync(configPath)) return { permissions: [] };
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as PermissionCacheConfig;
  } catch {
    return { permissions: [] };
  }
}

function savePermanentPermissions(config: PermissionCacheConfig): void {
  const configPath = getPermissionCachePath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Check if a tool call is permanently approved for a directory.
 */
export function isPermanentlyApproved(
  tool: string,
  directory: string,
  pattern?: string,
): boolean {
  const config = loadPermanentPermissions();
  const resolvedDir = path.resolve(directory);

  return config.permissions.some((p) => {
    if (p.tool !== tool) return false;
    if (path.resolve(p.directory) !== resolvedDir) return false;
    if (pattern && p.pattern && p.pattern !== pattern) return false;
    return true;
  });
}

/**
 * Mark a tool as permanently approved for a directory.
 */
export function approvePermanently(
  tool: string,
  directory: string,
  pattern?: string,
): void {
  const config = loadPermanentPermissions();
  const resolvedDir = path.resolve(directory);

  // Check for existing permission
  const exists = config.permissions.some((p) =>
    p.tool === tool &&
    path.resolve(p.directory) === resolvedDir &&
    p.pattern === pattern
  );

  if (exists) return;

  config.permissions.push({
    tool,
    directory: resolvedDir,
    pattern,
    grantedAt: new Date().toISOString(),
  });

  savePermanentPermissions(config);
  logger.info("[permission-cache] Permanently approved", { tool, directory: resolvedDir, pattern });
}

/**
 * Remove a permanent permission.
 */
export function revokePermanentPermission(tool: string, directory: string): boolean {
  const config = loadPermanentPermissions();
  const resolvedDir = path.resolve(directory);
  const before = config.permissions.length;

  config.permissions = config.permissions.filter(
    (p) => !(p.tool === tool && path.resolve(p.directory) === resolvedDir),
  );

  if (config.permissions.length < before) {
    savePermanentPermissions(config);
    return true;
  }
  return false;
}

/**
 * List all permanent permissions for a directory.
 */
export function listPermanentPermissions(directory?: string): PermanentPermission[] {
  const config = loadPermanentPermissions();
  if (!directory) return config.permissions;

  const resolvedDir = path.resolve(directory);
  return config.permissions.filter((p) => path.resolve(p.directory) === resolvedDir);
}

/**
 * Clear all permanent permissions.
 */
export function clearAllPermanentPermissions(): void {
  savePermanentPermissions({ permissions: [] });
}

// ---------------------------------------------------------------------------
// Combined Check
// ---------------------------------------------------------------------------

/**
 * Check if a tool call is approved (session or permanent).
 */
export function isApproved(
  tool: string,
  directory: string,
  pattern?: string,
): boolean {
  return isSessionApproved(tool, pattern) || isPermanentlyApproved(tool, directory, pattern);
}
