/**
 * Path Validation Utilities
 *
 * Provides security checks for file paths to prevent:
 * - UNC path attacks (\\server\share)
 * - Path traversal attacks (../)
 - Symlink attacks
 * - Access to sensitive system files
 */

import * as path from 'path';
import * as fs from 'fs';

// Sensitive paths that should be blocked
const SENSITIVE_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '~/.ssh',
  '~/.gnupg',
  '~/.aws',
  '~/.kube',
  '~/.docker',
  '/proc',
  '/sys',
  '/dev',
];

// Sensitive file patterns
const SENSITIVE_FILE_PATTERNS = [
  /\.env$/,
  /\.env\.\w+$/,
  /\.pem$/,
  /\.key$/,
  /\.cert$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /id_rsa/,
  /id_ed25519/,
  /id_ecdsa/,
  /credentials\.json/,
  /service-account\.json/,
];

export interface PathValidationResult {
  valid: boolean;
  reason?: string;
  resolvedPath?: string;
}

/**
 * Check if a path is a UNC path (Windows network path)
 */
export function isUncPath(filePath: string): boolean {
  return /^([\\/]{2})/.test(filePath.trim());
}

/**
 * Check if a path contains path traversal sequences
 */
export function hasPathTraversal(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  return normalized.includes('..') || normalized.includes('~');
}

/**
 * Check if a path targets a sensitive file
 */
export function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(basename));
}

/**
 * Check if a path targets a sensitive system directory
 */
export function isSensitivePath(filePath: string): boolean {
  const normalized = path.resolve(filePath).toLowerCase();
  return SENSITIVE_PATHS.some((sensitive) => {
    const expanded = sensitive.replace('~', process.env.HOME || process.env.USERPROFILE || '');
    return normalized.startsWith(expanded.toLowerCase());
  });
}

/**
 * Validate a file path for security
 */
export function validatePath(filePath: string, options?: { allowAbsolute?: boolean; cwd?: string }): PathValidationResult {
  const { allowAbsolute = true, cwd = process.cwd() } = options ?? {};

  // Check for UNC paths
  if (isUncPath(filePath)) {
    return {
      valid: false,
      reason: `Blocked UNC path: ${filePath}`,
    };
  }

  // Check for path traversal
  if (hasPathTraversal(filePath)) {
    return {
      valid: false,
      reason: `Blocked path traversal: ${filePath}`,
    };
  }

  // Check for sensitive files
  if (isSensitiveFile(filePath)) {
    return {
      valid: false,
      reason: `Blocked access to sensitive file: ${filePath}`,
    };
  }

  // Check for sensitive paths
  if (isSensitivePath(filePath)) {
    return {
      valid: false,
      reason: `Blocked access to sensitive path: ${filePath}`,
    };
  }

  // Resolve the path
  const resolvedPath = path.resolve(cwd, filePath);

  // Check if absolute path is allowed
  if (!allowAbsolute && path.isAbsolute(filePath)) {
    return {
      valid: false,
      reason: `Absolute path not allowed: ${filePath}`,
    };
  }

  // Check if path exists and is accessible
  try {
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile() && !stats.isDirectory()) {
      return {
        valid: false,
        reason: `Path is not a file or directory: ${filePath}`,
      };
    }
  } catch (error) {
    // Path doesn't exist - that's okay for write operations
    // Just validate the parent directory
    const parentDir = path.dirname(resolvedPath);
    try {
      fs.accessSync(parentDir, fs.constants.W_OK);
    } catch {
      return {
        valid: false,
        reason: `Parent directory is not writable: ${parentDir}`,
      };
    }
  }

  return {
    valid: true,
    resolvedPath,
  };
}

/**
 * Validate a file path for read operations
 */
export function validateReadPath(filePath: string, cwd?: string): PathValidationResult {
  const result = validatePath(filePath, { allowAbsolute: true, cwd });
  if (!result.valid) {
    return result;
  }

  // Check if file exists for read operations
  const resolvedPath = result.resolvedPath!;
  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK);
  } catch {
    return {
      valid: false,
      reason: `File is not readable: ${filePath}`,
    };
  }

  return result;
}

/**
 * Validate a file path for write operations
 */
export function validateWritePath(filePath: string, cwd?: string): PathValidationResult {
  const result = validatePath(filePath, { allowAbsolute: true, cwd });
  if (!result.valid) {
    return result;
  }

  const resolvedPath = result.resolvedPath!;

  // Check if file exists
  try {
    const stats = fs.statSync(resolvedPath);
    if (stats.isFile()) {
      // Check if file is writable
      try {
        fs.accessSync(resolvedPath, fs.constants.W_OK);
      } catch {
        return {
          valid: false,
          reason: `File is not writable: ${filePath}`,
        };
      }
    }
  } catch {
    // File doesn't exist - check if parent directory is writable
    const parentDir = path.dirname(resolvedPath);
    try {
      fs.accessSync(parentDir, fs.constants.W_OK);
    } catch {
      return {
        valid: false,
        reason: `Parent directory is not writable: ${parentDir}`,
      };
    }
  }

  return result;
}

/**
 * Sanitize a path by removing dangerous sequences
 */
export function sanitizePath(filePath: string): string {
  // Remove path traversal sequences
  let sanitized = filePath.replace(/\.\./g, '');
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  // Remove UNC prefix
  if (isUncPath(sanitized)) {
    sanitized = sanitized.replace(/^([\\/]{2})/, '');
  }
  
  return sanitized;
}
