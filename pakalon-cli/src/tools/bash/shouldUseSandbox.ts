/**
 * Sandbox Detection
 * Determines when bash commands should run in a sandbox
 */
import type { PermissionMode } from '@/tools/agent-tool/types';
import logger from '@/utils/logger.js';

export interface SandboxDecision {
  shouldSandbox: boolean;
  reason: string;
  sandboxType: 'none' | 'container' | 'vm' | 'bwrap' | 'chroot';
}

const SANDBOX_TRIGGERS = [
  { pattern: /apt-get|apt\s+install|yum\s+install|dnf\s+install|apk\s+add/, type: 'chroot' as const },
  { pattern: /docker\s+run|docker\s+exec|podman\s+run/, type: 'container' as const },
  { pattern: /npm\s+install|npm\s+ci|yarn\s+install|pnpm\s+install/, type: 'bwrap' as const },
  { pattern: /pip\s+install|pip3\s+install|python.*-m\s+pip/, type: 'bwrap' as const },
  { pattern: /cargo\s+build|cargo\s+install/, type: 'bwrap' as const },
  { pattern: /make\s+install|cmake\s+.*|make\s+build/, type: 'bwrap' as const },
  { pattern: /curl.*\.sh|wget.*\.sh|\|.*sh$/, type: 'chroot' as const },
  { pattern: /eval|exec\s+\$|bash\s+-c/, type: 'container' as const },
  { pattern: /sudo\s+su|sudo\s+-i/, type: 'vm' as const },
  { pattern: /fdisk|mkfs|dd\s+.*of=/, type: 'vm' as const },
  { pattern: /iptables|firewall-cmd|ufw/, type: 'vm' as const },
];

const SAFE_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'ls',
  'stat',
  'file',
  'wc',
  'sort',
  'uniq',
  'pwd',
  'date',
  'whoami',
  'id',
  'echo',
  'printf',
]);

export function shouldUseSandbox(
  command: string,
  permissionMode?: PermissionMode,
): SandboxDecision {
  if (permissionMode === 'bypassPermissions') {
    return {
      shouldSandbox: false,
      reason: 'Bypass permissions mode - no sandbox',
      sandboxType: 'none',
    };
  }

  const parsed = parseCommand(command);
  if (!parsed) {
    return {
      shouldSandbox: false,
      reason: 'Unable to parse command',
      sandboxType: 'none',
    };
  }

  const { cmd } = parsed;

  if (SAFE_COMMANDS.has(cmd)) {
    return {
      shouldSandbox: false,
      reason: 'Command is safe and does not require sandbox',
      sandboxType: 'none',
    };
  }

  for (const trigger of SANDBOX_TRIGGERS) {
    if (trigger.pattern.test(command)) {
      logger.debug(`[Sandbox] Command matches trigger for ${trigger.type}: ${command.slice(0, 50)}...`);
      return {
        shouldSandbox: true,
        reason: `Command matches sandbox trigger pattern`,
        sandboxType: trigger.type,
      };
    }
  }

  if (command.includes('curl') || command.includes('wget')) {
    if (command.includes('sudo') || command.includes('install')) {
      return {
        shouldSandbox: true,
        reason: 'Network fetch with elevated privileges',
        sandboxType: 'bwrap',
      };
    }
  }

  if (command.includes('git') && command.includes('push')) {
    return {
      shouldSandbox: true,
      reason: 'Git push modifies remote repository',
      sandboxType: 'bwrap',
    };
  }

  if (command.includes('npm') && (command.includes('publish') || command.includes('unpublish'))) {
    return {
      shouldSandbox: true,
      reason: 'Package publication may affect package registry',
      sandboxType: 'bwrap',
    };
  }

  return {
    shouldSandbox: false,
    reason: 'Command does not require sandbox',
    sandboxType: 'none',
  };
}

function parseCommand(command: string): { cmd: string; args: string[] } | null {
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
    cmd: tokens[0],
    args: tokens.slice(1),
  };
}

export function getSandboxTypeForCommand(command: string): SandboxDecision['sandboxType'] {
  const decision = shouldUseSandbox(command);
  return decision.sandboxType;
}

export function isSandboxAvailable(type: SandboxDecision['sandboxType']): boolean {
  switch (type) {
    case 'none':
      return true;
    case 'bwrap':
      return isCommandAvailable('bwrap');
    case 'chroot':
      return isCommandAvailable('chroot');
    case 'container':
      return isCommandAvailable('docker') || isCommandAvailable('podman');
    case 'vm':
      return false;
    default:
      return false;
  }
}

function isCommandAvailable(cmd: string): boolean {
  try {
    require('child_process').execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function getSandboxCommand(
  type: SandboxDecision['sandboxType'],
  command: string,
): string {
  switch (type) {
    case 'bwrap':
      return `bwrap --ro-bind / / --dev /dev --proc /proc ${command}`;
    case 'chroot':
      return `chroot /srv ${command}`;
    case 'container':
      return `docker run --rm -v "$(pwd)":/workdir -w /workdir alpine ${command}`;
    default:
      return command;
  }
}

export { SANDBOX_TRIGGERS, SAFE_COMMANDS };