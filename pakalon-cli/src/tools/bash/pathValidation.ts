/**
 * Path Validation
 * Validates file paths for security and correctness
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '@/utils/logger.js';

export interface PathValidationResult {
  valid: boolean;
  normalizedPath?: string;
  error?: string;
  isDirectory?: boolean;
  exists?: boolean;
  isSymlink?: boolean;
  isReadonly?: boolean;
}

export interface PathSecurityResult {
  safe: boolean;
  reason?: string;
  riskLevel: 'low' | 'medium' | 'high';
}

const BLOCKED_PATH_PREFIXES = [
  '/sys',
  '/proc',
  '/dev',
  '/.git',
  '/.svn',
  '/node_modules/.cache',
];

const DANGEROUS_PATTERNS = [
  /\.\.\//,
  /\.\.$/,
  /~root/,
  /\/root\//,
  /\.git\/config$/,
  /\.git\/hooks$/,
  /\.env$/,
  /\.npmrc$/,
  /\.bashrc$/,
  /\.bash_history$/,
  /id_rsa/,
  /id_dsa/,
  /\.ssh\//,
];

const READONLY_PROTECTED_PATTERNS = [
  /\.git\/objects\//,
  /\.git\/refs\//,
];

const MAX_PATH_LENGTH = 4096;

export function validatePath(
  filePath: string,
  options: {
    allowSymlinks?: boolean;
    maxLength?: number;
    checkExists?: boolean;
    basePath?: string;
  } = {},
): PathValidationResult {
  const {
    allowSymlinks = false,
    maxLength = MAX_PATH_LENGTH,
    checkExists = false,
    basePath,
  } = options;

  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'Path must be a non-empty string' };
  }

  if (filePath.length > maxLength) {
    return { valid: false, error: `Path exceeds maximum length of ${maxLength}` };
  }

  if (filePath.includes('\x00')) {
    return { valid: false, error: 'Path contains null byte' };
  }

  const normalizedPath = path.normalize(filePath);

  if (normalizedPath !== filePath) {
    logger.debug(`[PathValidation] Path was normalized: ${filePath} -> ${normalizedPath}`);
  }

  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (normalizedPath.startsWith(prefix)) {
      return { valid: false, error: `Path access to '${prefix}' is blocked` };
    }
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return { valid: false, error: `Path matches blocked pattern` };
    }
  }

  if (basePath) {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(basePath, filePath);
    const absoluteBase = path.resolve(basePath);

    if (!absolutePath.startsWith(absoluteBase)) {
      return { valid: false, error: 'Path escapes base directory' };
    }
  }

  return { valid: true, normalizedPath };
}

export async function validatePathAsync(
  filePath: string,
  options: {
    allowSymlinks?: boolean;
    maxLength?: number;
    checkExists?: boolean;
    basePath?: string;
    checkReadonly?: boolean;
  } = {},
): Promise<PathValidationResult> {
  const baseValidation = validatePath(filePath, options);

  if (!baseValidation.valid) {
    return baseValidation;
  }

  const normalizedPath = baseValidation.normalizedPath!;

  if (options.checkExists) {
    try {
      const stats = await fs.stat(normalizedPath);

      if (stats.isSymbolicLink() && !options.allowSymlinks) {
        return { valid: false, error: 'Symbolic links are not allowed' };
      }

      if (options.checkReadonly) {
        try {
          await fs.access(normalizedPath, fs.constants.W_OK);
          return {
            valid: true,
            normalizedPath,
            isDirectory: stats.isDirectory(),
            exists: true,
            isSymlink: stats.isSymbolicLink(),
            isReadonly: false,
          };
        } catch {
          return {
            valid: true,
            normalizedPath,
            isDirectory: stats.isDirectory(),
            exists: true,
            isSymlink: stats.isSymbolicLink(),
            isReadonly: true,
          };
        }
      }

      return {
        valid: true,
        normalizedPath,
        isDirectory: stats.isDirectory(),
        exists: true,
        isSymlink: stats.isSymbolicLink(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          valid: true,
          normalizedPath,
          exists: false,
        };
      }
      return { valid: false, error: `Error checking path: ${error}` };
    }
  }

  return { valid: true, normalizedPath };
}

export function isPathSafe(filePath: string, basePath: string): PathSecurityResult {
  const validation = validatePath(filePath, { basePath });

  if (!validation.valid) {
    return {
      safe: false,
      reason: validation.error,
      riskLevel: 'high',
    };
  }

  const normalizedPath = validation.normalizedPath!;

  for (const pattern of READONLY_PROTECTED_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return {
        safe: false,
        reason: 'Path is in a protected read-only area',
        riskLevel: 'medium',
      };
    }
  }

  return {
    safe: true,
    riskLevel: 'low',
  };
}

export function isPathReadonlyProtected(filePath: string): boolean {
  for (const pattern of READONLY_PROTECTED_PATTERNS) {
    if (pattern.test(filePath)) {
      return true;
    }
  }
  return false;
}

export function getPathDepth(filePath: string): number {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep).filter(p => p && p !== '.');
  return parts.length;
}

export function getParentDirectories(filePath: string): string[] {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep).filter(p => p && p !== '.');
  const parents: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    parents.push(path.join(...parts.slice(0, i)));
  }

  return parents;
}

export function isAncestorDirectory(ancestor: string, descendant: string): boolean {
  const normalizedAncestor = path.normalize(ancestor);
  const normalizedDescendant = path.normalize(descendant);

  return normalizedDescendant.startsWith(normalizedAncestor + path.sep) ||
         normalizedDescendant === normalizedAncestor;
}

export function findCommonBasePath(paths: string[]): string | null {
  if (paths.length === 0) return null;
  if (paths.length === 1) return path.dirname(paths[0]);

  const splitPaths = paths.map(p => path.normalize(p).split(path.sep).filter(ep => ep));
  const minLength = Math.min(...splitPaths.map(p => p.length));

  let commonParts: string[] = [];

  for (let i = 0; i < minLength; i++) {
    const part = splitPaths[0][i];
    if (splitPaths.every(p => p[i] === part)) {
      commonParts.push(part);
    } else {
      break;
    }
  }

  if (commonParts.length === 0) {
    return null;
  }

  return path.sep + commonParts.join(path.sep);
}

export function makeRelativePath(from: string, to: string): string {
  return path.relative(from, to);
}

export function isHiddenFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return baseName.startsWith('.');
}

export function hasDangerousExtension(filePath: string): boolean {
  const dangerousExts = [
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.sh',
    '.bash',
    '.zsh',
    '.fish',
    '.ps1',
    '.bat',
    '.cmd',
    '.scr',
    '.pif',
    '.application',
    '.gadget',
    '.jar',
    '.js',
    '.jse',
    '.mse',
    '.vbs',
    '.vbe',
    '.ws',
    '.wsf',
    '.wsh',
    '.msc',
  ];

  const ext = path.extname(filePath).toLowerCase();
  return dangerousExts.includes(ext);
}

export function getSafeFileName(fileName: string): string {
  return fileName
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\x00/g, '')
    .trim();
}

export function resolvePathSafely(filePath: string, basePath: string): string | null {
  const validation = validatePath(filePath, { basePath });
  if (!validation.valid) {
    return null;
  }

  try {
    const resolved = path.resolve(basePath, validation.normalizedPath!);
    const normalizedResolved = path.normalize(resolved);

    const absoluteBase = path.resolve(basePath);
    if (!normalizedResolved.startsWith(absoluteBase)) {
      return null;
    }

    return normalizedResolved;
  } catch {
    return null;
  }
}

export {
  BLOCKED_PATH_PREFIXES,
  DANGEROUS_PATTERNS,
  READONLY_PROTECTED_PATTERNS,
  MAX_PATH_LENGTH,
};