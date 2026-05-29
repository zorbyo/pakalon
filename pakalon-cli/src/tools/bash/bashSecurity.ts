/**
 * Bash Security Validation
 * Comprehensive security checks for bash command execution
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '@/utils/logger.js';

export interface SecurityValidationResult {
  valid: boolean;
  errors: SecurityError[];
  warnings: SecurityWarning[];
}

export interface SecurityError {
  code: string;
  message: string;
  position?: number;
}

export interface SecurityWarning {
  code: string;
  message: string;
}

const BLOCKED_PATTERNS = [
  /\[\s*\]\s*&&\s*/,
  /\[\s*\[/,
  /\beval\s+\$/,
  /\bexec\s+\$/,
  /;\s*rm\s+/,
  /\|\s*rm\s+/,
  /&\s*rm\s+/,
  /\$\([^)]*\|\s*rm/,
  /`[^`]*\|\s*rm/,
  /\b:wq?\b/,
  /\b:!\b/,
  /\bquit\!\b/,
  /\bexit\!\b/,
];

const SUSPICIOUS_PATTERNS = [
  { pattern: /\|\s*nc\s+/, code: 'SUSPICIOUS_NETCAT' },
  { pattern: /\|\s*ncat\s+/, code: 'SUSPICIOUS_NCAT' },
  { pattern: /\bcurl\s+.*\|\s*sh\b/, code: 'PIPE_TO_SHELL' },
  { pattern: /\bwget\s+.*\|\s*sh\b/, code: 'PIPE_TO_SHELL' },
  { pattern: /\bbase64\s+-d\s+/, code: 'BASE64_DECODE' },
  { pattern: /\bxxd\s+-r\s+-p\b/, code: 'HEXDUMP_DECODE' },
  { pattern: /\bpython\s+.*\s+-c\s+.*import\s+os/, code: 'PYTHON_IMPORT_OS' },
  { pattern: /\bperl\s+.*-e\s+.*system/, code: 'PERL_SYSTEM' },
  { pattern: /\bruby\s+.*-e\s+.*exec/, code: 'RUBY_EXEC' },
  { pattern: /\bphp\s+.*-r\s+.*eval/, code: 'PHP_EVAL' },
];

const PATH_TRAVERSAL_PATTERN = /\.\.\//;
const NULL_BYTE_PATTERN = /\x00/;
const SHELL_METACHAR_PATTERN = /[;&`$|]/;

export function validateSecurity(command: string): SecurityValidationResult {
  const errors: SecurityError[] = [];
  const warnings: SecurityWarning[] = [];

  if (!command || typeof command !== 'string') {
    errors.push({
      code: 'INVALID_INPUT',
      message: 'Command must be a non-empty string',
    });
    return { valid: false, errors, warnings };
  }

  if (NULL_BYTE_PATTERN.test(command)) {
    errors.push({
      code: 'NULL_BYTE_INJECTION',
      message: 'Command contains null byte - possible injection attempt',
      position: command.indexOf('\x00'),
    });
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      errors.push({
        code: 'BLOCKED_PATTERN',
        message: `Command contains blocked pattern: ${pattern.source}`,
      });
    }
  }

  for (const { pattern, code } of SUSPICIOUS_PATTERNS) {
    if (pattern.test(command)) {
      warnings.push({
        code,
        message: `Command contains suspicious pattern: ${code}`,
      });
    }
  }

  if (PATH_TRAVERSAL_PATTERN.test(command)) {
    warnings.push({
      code: 'PATH_TRAVERSAL',
      message: 'Command contains path traversal (..)',
    });
  }

  const hasShellMeta = SHELL_METACHAR_PATTERN.test(command);
  if (hasShellMeta && !isQuoted(command)) {
    warnings.push({
      code: 'UNQUOTED_SHELL_METACHARS',
      message: 'Command contains unquoted shell metacharacters',
    });
  }

  const parsed = parseSecurityCommand(command);
  if (parsed) {
    if (parsed.command === 'sudo' && parsed.args.includes('su')) {
      errors.push({
        code: 'SUDO_SU',
        message: 'sudo su is not allowed',
      });
    }

    if (parsed.command === 'chmod' && hasDangerousPerms(parsed.args)) {
      warnings.push({
        code: 'DANGEROUS_PERMISSIONS',
        message: 'Setting potentially dangerous file permissions',
      });
    }

    if (parsed.command === 'chown' && hasRecursiveOption(parsed.args)) {
      warnings.push({
        code: 'RECURSIVE_CHOWN',
        message: 'Recursive ownership change may affect many files',
      });
    }

    if ((parsed.command === 'rm' || parsed.command === 'del') && hasDangerousRm(parsed.args)) {
      errors.push({
        code: 'DANGEROUS_DELETE',
        message: 'Recursive force delete detected',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function parseSecurityCommand(command: string): { command: string; args: string[] } | null {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      } else {
        current += char;
      }
    } else if (char === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    return null;
  }

  return {
    command: tokens[0],
    args: tokens.slice(1),
  };
}

function hasDangerousPerms(args: string[]): boolean {
  const dangerousPerms = ['777', '000', '6777', '4777', '2777'];
  return args.some(arg => dangerousPerms.some(perm => arg.includes(perm)));
}

function hasRecursiveOption(args: string[]): boolean {
  return args.some(arg => arg === '-R' || arg === '-r' || arg === '--recursive');
}

function hasDangerousRm(args: string[]): boolean {
  const hasRecursive = args.includes('-rf') || args.includes('-fr') || args.includes('-r') || args.includes('-f');
  const hasRoot = args.some(arg => arg === '/' || arg === '~' || arg === '$HOME');
  return hasRecursive && hasRoot;
}

function isQuoted(command: string): boolean {
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (char === '"' || char === "'") {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
    } else if (char === ' ' && !inQuote) {
      continue;
    } else if (SHELL_METACHAR_PATTERN.test(char) && !inQuote) {
      return false;
    }
  }

  return true;
}

export function validatePath(pathToCheck: string, basePath: string): SecurityValidationResult {
  const errors: SecurityError[] = [];
  const warnings: SecurityWarning[] = [];

  if (!pathToCheck || typeof pathToCheck !== 'string') {
    errors.push({
      code: 'INVALID_PATH',
      message: 'Path must be a non-empty string',
    });
    return { valid: false, errors, warnings };
  }

  if (pathToCheck.includes('\x00')) {
    errors.push({
      code: 'NULL_BYTE_INJECTION',
      message: 'Path contains null byte',
    });
  }

  const resolvedPath = path.resolve(basePath, pathToCheck);
  const resolvedBase = path.resolve(basePath);

  if (!resolvedPath.startsWith(resolvedBase)) {
    errors.push({
      code: 'PATH_ESCAPE',
      message: 'Path escapes base directory',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function checkPathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export function sanitizeCommand(command: string): string {
  return command
    .replace(/\x00/g, '')
    .replace(/[\r\n]/g, ' ')
    .trim();
}

export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function escapeShellArgs(args: string[]): string[] {
  return args.map(escapeShellArg);
}

export function isCommandSafe(command: string): boolean {
  const result = validateSecurity(command);
  return result.valid;
}

export function getSecurityWarnings(command: string): SecurityWarning[] {
  const result = validateSecurity(command);
  return result.warnings;
}

export function getSecurityErrors(command: string): SecurityError[] {
  const result = validateSecurity(command);
  return result.errors;
}

export {
  BLOCKED_PATTERNS,
  SUSPICIOUS_PATTERNS,
  PATH_TRAVERSAL_PATTERN,
  NULL_BYTE_PATTERN,
  SHELL_METACHAR_PATTERN,
};