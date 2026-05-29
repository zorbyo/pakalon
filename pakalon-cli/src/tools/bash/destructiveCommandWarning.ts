/**
 * Destructive Command Warning
 * Warns about potentially destructive commands
 */
import logger from '@/utils/logger.js';

export interface DestructiveCommandInfo {
  command: string;
  severity: 'warning' | 'danger' | 'critical';
  reason: string;
  canUndo: boolean;
  affectedFiles?: string[];
}

const DESTRUCTIVE_PATTERNS = [
  {
    pattern: /\brm\s+(-rf|-r --force|-f)\s+(\.|~\/|\/home|\/Users)/,
    severity: 'critical' as const,
    reason: 'Recursive force delete from home or root directory',
    canUndo: false,
  },
  {
    pattern: /\brm\s+(-rf|-r --force)\s+\*/,
    severity: 'critical' as const,
    reason: 'Recursive force delete of all files',
    canUndo: false,
  },
  {
    pattern: /\bdd\s+.*of=\/(dev|hd|sd)/,
    severity: 'critical' as const,
    reason: 'Direct disk write operation',
    canUndo: false,
  },
  {
    pattern: /\bmkfs\./,
    severity: 'critical' as const,
    reason: 'Filesystem format operation',
    canUndo: false,
  },
  {
    pattern: /\bfdisk\s+.*-W\s+always/,
    severity: 'critical' as const,
    reason: 'Partition table write',
    canUndo: false,
  },
  {
    pattern: /\brm\s+(-rf|-r)\s+(\.git|\.svn|\.hg)/,
    severity: 'danger' as const,
    reason: 'Delete version control directory',
    canUndo: false,
  },
  {
    pattern: /\brm\s+-R\s+node_modules/,
    severity: 'danger' as const,
    reason: 'Delete node_modules directory',
    canUndo: true,
  },
  {
    pattern: /\brm\s+-R\s+vendor/,
    severity: 'warning' as const,
    reason: 'Delete vendor dependencies',
    canUndo: true,
  },
  {
    pattern: /\bmv\s+(.*)\s+\/\s*$/,
    severity: 'danger' as const,
    reason: 'Move file to root directory',
    canUndo: true,
  },
  {
    pattern: /\bchmod\s+(-R\s+)?0[0-7]{3,4}/,
    severity: 'danger' as const,
    reason: 'Setting very permissive file permissions',
    canUndo: true,
  },
  {
    pattern: /\bchown\s+(-R\s+)?root/,
    severity: 'warning' as const,
    reason: 'Changing ownership to root',
    canUndo: true,
  },
  {
    pattern: /\bsudo\s+rm/,
    severity: 'warning' as const,
    reason: 'Privileged delete operation',
    canUndo: false,
  },
  {
    pattern: /\bsudo\s+mkfs/,
    severity: 'critical' as const,
    reason: 'Privileged filesystem format',
    canUndo: false,
  },
  {
    pattern: /:(){:|:&};:/,
    severity: 'critical' as const,
    reason: 'Fork bomb detected',
    canUndo: false,
  },
  {
    pattern: /\brsync\s+.*--delete/,
    severity: 'danger' as const,
    reason: 'Rsync with delete operation',
    canUndo: true,
  },
];

export function checkDestructiveCommand(command: string): DestructiveCommandInfo | null {
  for (const { pattern, severity, reason, canUndo } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      const affectedFiles = extractAffectedFiles(command);

      return {
        command,
        severity,
        reason,
        canUndo,
        affectedFiles,
      };
    }
  }

  return null;
}

export function isDestructive(command: string): boolean {
  return checkDestructiveCommand(command) !== null;
}

export function getDestructiveSeverity(command: string): DestructiveCommandInfo['severity'] | null {
  const info = checkDestructiveCommand(command);
  return info?.severity ?? null;
}

export function createDestructiveWarning(command: string): string | null {
  const info = checkDestructiveCommand(command);
  if (!info) return null;

  const severityLabel = {
    warning: 'WARNING',
    danger: 'DANGER',
    critical: 'CRITICAL',
  }[info.severity];

  let warning = `\nWarning:  ${severityLabel}: ${info.reason}\n`;
  warning += `Command: ${command}\n`;

  if (info.affectedFiles && info.affectedFiles.length > 0) {
    warning += `Affected: ${info.affectedFiles.join(', ')}\n`;
  }

  warning += `Can undo: ${info.canUndo ? 'Yes' : 'No'}\n`;

  return warning;
}

function extractAffectedFiles(command: string): string[] | undefined {
  const files: string[] = [];

  const rmMatch = command.match(/\brm\s+.*?\s+([^\s|>&]+)/g);
  if (rmMatch) {
    for (const match of rmMatch) {
      const parts = match.split(/\s+/);
      for (const part of parts.slice(2)) {
        if (!part.startsWith('-') && part.length > 1) {
          files.push(part.replace(/['"]/g, ''));
        }
      }
    }
  }

  const mvMatch = command.match(/\bmv\s+([^\s]+)\s+([^\s|>]+)/);
  if (mvMatch) {
    files.push(`From: ${mvMatch[1]}`, `To: ${mvMatch[2]}`);
  }

  return files.length > 0 ? [...new Set(files)] : undefined;
}

export function filterDestructiveCommands(commands: string[]): string[] {
  return commands.filter(cmd => !isDestructive(cmd));
}

export function getDestructiveCommands(commands: string[]): Array<{
  command: string;
  info: DestructiveCommandInfo;
}> {
  const destructive: Array<{ command: string; info: DestructiveCommandInfo }> = [];

  for (const command of commands) {
    const info = checkDestructiveCommand(command);
    if (info) {
      destructive.push({ command, info });
    }
  }

  return destructive;
}

export { DESTRUCTIVE_PATTERNS };