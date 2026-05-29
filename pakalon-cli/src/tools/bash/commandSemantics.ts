/**
 * Command Semantics
 * Analyzes command semantics and intent
 */
import logger from '@/utils/logger.js';

export interface CommandSemantics {
  category: CommandCategory;
  intent: CommandIntent;
  scope: CommandScope;
  sideEffects: SideEffect[];
}

export type CommandCategory =
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'network'
  | 'process'
  | 'system'
  | 'git'
  | 'package_manager'
  | 'development'
  | 'unknown';

export type CommandIntent =
  | 'read'
  | 'write'
  | 'delete'
  | 'navigate'
  | 'search'
  | 'install'
  | 'configure'
  | 'execute'
  | 'monitor'
  | 'unknown';

export type CommandScope = 'local' | 'project' | 'system' | 'network' | 'global';

export interface SideEffect {
  type: SideEffectType;
  description: string;
  severity: 'low' | 'medium' | 'high';
  reversible: boolean;
}

export type SideEffectType =
  | 'file_created'
  | 'file_modified'
  | 'file_deleted'
  | 'directory_created'
  | 'directory_deleted'
  | 'network_request'
  | 'process_spawned'
  | 'permission_changed'
  | 'environment_changed'
  | 'git_commit'
  | 'git_push';

const CATEGORY_PATTERNS: Array<{
  category: CommandCategory;
  patterns: RegExp[];
}> = [
  {
    category: 'file_read',
    patterns: [
      /\bcat\b/,
      /\bhead\b/,
      /\btail\b/,
      /\bless\b/,
      /\bmore\b/,
      /\bgrep\b/,
      /\bfind\b.*-type\s+f/,
      /\bstat\b/,
      /\bfile\b/,
      /\bwc\b/,
    ],
  },
  {
    category: 'file_write',
    patterns: [
      /\becho\b.*>/,
      /\btee\b/,
      /\bprintf\b.*>/,
      /\btouch\b/,
      /\bmkdir\b/,
      /\bln\b.*-s/,
      /\bcp\b/,
      /\bmv\b/,
    ],
  },
  {
    category: 'file_delete',
    patterns: [
      /\brm\b/,
      /\brmdir\b/,
      /\bunlink\b/,
      /\bdel\b/,
    ],
  },
  {
    category: 'network',
    patterns: [
      /\bcurl\b/,
      /\bwget\b/,
      /\bnc\b/,
      /\bnetcat\b/,
      /\bncat\b/,
      /\bssh\b/,
      /\bscp\b/,
      /\bsftp\b/,
      /\brsync\b/,
    ],
  },
  {
    category: 'process',
    patterns: [
      /\bps\b/,
      /\btop\b/,
      /\bhtop\b/,
      /\bkill\b/,
      /\bpkill\b/,
      /\bkillall\b/,
      /\bjobs\b/,
      /\bbg\b/,
      /\bfg\b/,
    ],
  },
  {
    category: 'system',
    patterns: [
      /\bsudo\b/,
      /\bsu\b/,
      /\bsystemctl\b/,
      /\bservice\b/,
      /\bchmod\b/,
      /\bchown\b/,
      /\bchgrp\b/,
      /\bdf\b/,
      /\bdu\b/,
      /\bfree\b/,
    ],
  },
  {
    category: 'git',
    patterns: [
      /\bgit\s+commit\b/,
      /\bgit\s+push\b/,
      /\bgit\s+pull\b/,
      /\bgit\s+clone\b/,
      /\bgit\s+checkout\b/,
      /\bgit\s+branch\b/,
      /\bgit\s+merge\b/,
      /\bgit\s+rebase\b/,
      /\bgit\s+stash\b/,
    ],
  },
  {
    category: 'package_manager',
    patterns: [
      /\bnpm\s+(install|ci|uninstall|update)/,
      /\byarn\s+(add|remove|install)/,
      /\bpnpm\s+(install|add|remove)/,
      /\bpip\s+install\b/,
      /\bpip3\s+install\b/,
      /\bapt-get\s+install\b/,
      /\bapt\s+install\b/,
      /\byum\s+install\b/,
      /\bdnf\s+install\b/,
      /\bapk\s+add\b/,
      /\bbrew\s+install\b/,
      /\bcargo\s+install\b/,
      /\bgo\s+install\b/,
    ],
  },
  {
    category: 'development',
    patterns: [
      /\b(make|cmake)\s+(build|install)/,
      /\bmake\s+test\b/,
      /\bwebpack\b/,
      /\bvite\b/,
      /\brollup\b/,
      /\besbuild\b/,
      /\btsc\b/,
      /\beslint\b/,
      /\bprettier\b/,
      /\bjest\b/,
      /\bvitest\b/,
      /\bpytest\b/,
      /\brubocop\b/,
      /\bgo\s+build\b/,
      /\bgo\s+test\b/,
      /\bcargo\s+build\b/,
      /\bcargo\s+test\b/,
    ],
  },
];

const INTENT_PATTERNS: Array<{
  intent: CommandIntent;
  patterns: RegExp[];
}> = [
  {
    intent: 'read',
    patterns: [/\bcat\b/, /\bgrep\b/, /\bfind\b/, /\bhead\b/, /\btail\b/],
  },
  {
    intent: 'write',
    patterns: [/\becho\b.*>/, /\btee\b/, /\btouch\b/, /\bmkdir\b/],
  },
  {
    intent: 'delete',
    patterns: [/\brm\b/, /\brmdir\b/, /\bunlink\b/],
  },
  {
    intent: 'navigate',
    patterns: [/\bcd\b/, /\bpushd\b/, /\bpopd\b/],
  },
  {
    intent: 'search',
    patterns: [/\bgrep\b/, /\bfind\b/, /\bwhich\b/, /\bwhereis\b/],
  },
  {
    intent: 'install',
    patterns: [
      /\b(install|add)\b.*\b(npm|yarn|pnpm|pip|apt|yum|brew|cargo|go)\b/,
    ],
  },
  {
    intent: 'configure',
    patterns: [/\bchmod\b/, /\bchown\b/, /\bconfig|configure\b/],
  },
  {
    intent: 'execute',
    patterns: [/\b(exec|runtime|run)\b/, /\bsh\b/, /\bbash\b/],
  },
  {
    intent: 'monitor',
    patterns: [/\bps\b/, /\btop\b/, /\bhtop\b/, /\bwatch\b/],
  },
];

export function analyzeCommandSemantics(command: string): CommandSemantics {
  const category = detectCategory(command);
  const intent = detectIntent(command);
  const scope = detectScope(command);
  const sideEffects = detectSideEffects(command, category);

  return {
    category,
    intent,
    scope,
    sideEffects,
  };
}

function detectCategory(command: string): CommandCategory {
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some(pattern => pattern.test(command))) {
      return category;
    }
  }
  return 'unknown';
}

function detectIntent(command: string): CommandIntent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some(pattern => pattern.test(command))) {
      return intent;
    }
  }

  if (command.includes(' > ')) return 'write';
  if (command.includes('|')) return 'read';

  return 'unknown';
}

function detectScope(command: string): CommandScope {
  if (command.includes('sudo') || command.includes('su ')) return 'system';
  if (command.includes('curl') || command.includes('wget') || command.includes('ssh')) {
    return 'network';
  }
  if (command.includes('.git') || command.includes('git')) return 'project';
  if (command.includes('/home') || command.includes('/Users') || command.includes('$HOME')) {
    return 'global';
  }
  return 'local';
}

function detectSideEffects(command: string, category: CommandCategory): SideEffect[] {
  const sideEffects: SideEffect[] = [];

  if (category === 'file_write') {
    sideEffects.push({
      type: 'file_modified',
      description: 'File content may be written',
      severity: 'medium',
      reversible: true,
    });
  }

  if (category === 'file_delete') {
    sideEffects.push({
      type: 'file_deleted',
      description: 'File or directory will be deleted',
      severity: 'high',
      reversible: false,
    });
  }

  if (command.includes(' > ') && !command.includes(' >> ')) {
    sideEffects.push({
      type: 'file_modified',
      description: 'File will be overwritten',
      severity: 'medium',
      reversible: true,
    });
  }

  if (command.includes(' >> ')) {
    sideEffects.push({
      type: 'file_modified',
      description: 'Content will be appended to file',
      severity: 'low',
      reversible: true,
    });
  }

  if (command.includes('|')) {
    sideEffects.push({
      type: 'process_spawned',
      description: 'Pipeline will be created',
      severity: 'low',
      reversible: false,
    });
  }

  if (category === 'network') {
    sideEffects.push({
      type: 'network_request',
      description: 'Network request will be made',
      severity: 'medium',
      reversible: false,
    });
  }

  if (command.includes('git commit')) {
    sideEffects.push({
      type: 'git_commit',
      description: 'Git commit will be created',
      severity: 'medium',
      reversible: true,
    });
  }

  if (command.includes('git push')) {
    sideEffects.push({
      type: 'git_push',
      description: 'Changes will be pushed to remote',
      severity: 'high',
      reversible: false,
    });
  }

  if (command.includes('chmod') || command.includes('chown')) {
    sideEffects.push({
      type: 'permission_changed',
      description: 'File permissions will be changed',
      severity: 'medium',
      reversible: true,
    });
  }

  return sideEffects;
}

export function hasSideEffect(command: string): boolean {
  const semantics = analyzeCommandSemantics(command);
  return semantics.sideEffects.length > 0;
}

export function getHighRiskSideEffects(command: string): SideEffect[] {
  const semantics = analyzeCommandSemantics(command);
  return semantics.sideEffects.filter(se => se.severity === 'high');
}

export {
  CATEGORY_PATTERNS,
  INTENT_PATTERNS,
};