/**
 * Read-Only Validation
 * Determines if operations should be allowed in read-only mode
 */
import * as path from 'path';
import logger from '@/utils/logger.js';

export interface ReadOnlyValidationResult {
  allowed: boolean;
  reason?: string;
  requiresWrite?: boolean;
}

const READ_ONLY_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'grep',
  'rg',
  'ag',
  'find',
  'ls',
  'stat',
  'file',
  'wc',
  'sort',
  'uniq',
  'cut',
  'tr',
  'tee',
  'echo',
  'printf',
  'pwd',
  'cd',
  'du',
  'df',
  'mount',
  'whoami',
  'id',
  'date',
  'cal',
  'which',
  'whereis',
  'type',
  'alias',
  'history',
  'help',
  'man',
  'info',
  'curl',
  'wget',
  'nc',
  'netcat',
]);

const WRITE_COMMANDS = new Set([
  'touch',
  'mkdir',
  'rmdir',
  'rm',
  'cp',
  'mv',
  'ln',
  'unlink',
  'chmod',
  'chown',
  'chgrp',
  'dd',
  'mkfs',
  'fdisk',
  'parted',
  'mount',
  'umount',
  'tar',
  'zip',
  'unzip',
  'gzip',
  'gunzip',
  'bzip2',
  'xz',
  'rsync',
  'scp',
  'sftp',
  'ftp',
  'wget',
  'curl',
]);

const MODIFY_FILE_COMMANDS = new Set([
  'vi',
  'vim',
  'nano',
  'emacs',
  'sed',
  'awk',
  'perl',
  'ruby',
  'python',
]);

const PROTECTED_PATTERNS = [
  /\.git\//,
  /\.svn\//,
  /\.hg\//,
  /\.bzr\//,
  /node_modules\//,
  /\.cache\//,
  /\.tmp\//,
  /\.log\//,
  /\.pid\//,
  /\.lock\//,
  /\/proc\//,
  /\/sys\//,
  /\/dev\//,
];

export function isReadOnlyCommand(command: string): boolean {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];

  if (!cmd) return false;

  return READ_ONLY_COMMANDS.has(cmd);
}

export function requiresWritePermission(command: string): ReadOnlyValidationResult {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];

  if (!cmd) {
    return { allowed: false, reason: 'Empty command', requiresWrite: false };
  }

  if (WRITE_COMMANDS.has(cmd)) {
    return {
      allowed: false,
      reason: `Command '${cmd}' requires write permission`,
      requiresWrite: true,
    };
  }

  if (MODIFY_FILE_COMMANDS.has(cmd)) {
    return {
      allowed: false,
      reason: `Command '${cmd}' may modify files`,
      requiresWrite: true,
    };
  }

  if (command.includes(' > ') || command.includes(' >> ')) {
    return {
      allowed: false,
      reason: 'Command redirects output to file',
      requiresWrite: true,
    };
  }

  if (command.includes('|') && (command.includes('tee') || command.includes('>'))) {
    return {
      allowed: false,
      reason: 'Command pipes to file',
      requiresWrite: true,
    };
  }

  return { allowed: true, requiresWrite: false };
}

export function isProtectedPath(filePath: string): boolean {
  const normalized = path.normalize(filePath);

  for (const pattern of PROTECTED_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

export function validateReadOnlyAccess(
  command: string,
  targetPath?: string,
): ReadOnlyValidationResult {
  if (targetPath && isProtectedPath(targetPath)) {
    return {
      allowed: false,
      reason: `Access to '${targetPath}' is protected in read-only mode`,
      requiresWrite: true,
    };
  }

  const writeCheck = requiresWritePermission(command);
  if (!writeCheck.allowed) {
    return writeCheck;
  }

  const readOnlyCheck = isReadOnlyCommand(command);
  if (!readOnlyCheck) {
    return {
      allowed: false,
      reason: 'Command may not be read-only',
      requiresWrite: true,
    };
  }

  return { allowed: true, requiresWrite: false };
}

export function getReadOnlyReason(command: string): string {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];

  if (PROTECTED_PATTERNS.some(p => p.test(command))) {
    return 'Command targets protected directory';
  }

  if (WRITE_COMMANDS.has(cmd)) {
    return `Write command '${cmd}' not allowed in read-only mode`;
  }

  if (command.includes(' > ')) {
    return 'Output redirection not allowed in read-only mode';
  }

  return 'Command not allowed in read-only mode';
}

export function isSafeReadOnly(command: string): boolean {
  const writeCheck = requiresWritePermission(command);
  return writeCheck.allowed;
}

export function shouldWarnReadOnly(command: string): boolean {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];

  if (cmd === 'curl' || cmd === 'wget') {
    return true;
  }

  if (cmd === 'find' && command.includes('-delete')) {
    return true;
  }

  return false;
}

export {
  READ_ONLY_COMMANDS,
  WRITE_COMMANDS,
  MODIFY_FILE_COMMANDS,
  PROTECTED_PATTERNS,
};