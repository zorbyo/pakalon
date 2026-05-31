/**
 * Bash Comment Label
 * 
 * Provides annotation capabilities for bash commands.
 * Adds human-readable labels and comments to command output
 * for better traceability and debugging.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandAnnotation {
  command: string;
  label: string;
  description: string;
  timestamp: number;
  category: CommandCategory;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export type CommandCategory = 
  | 'file-operation'
  | 'network'
  | 'build'
  | 'test'
  | 'deploy'
  | 'database'
  | 'git'
  | 'package-manager'
  | 'system'
  | 'unknown';

// ---------------------------------------------------------------------------
// Command Pattern Matching
// ---------------------------------------------------------------------------

const COMMAND_PATTERNS: Record<CommandCategory, RegExp[]> = {
  'file-operation': [
    /\b(cat|head|tail|less|more|cp|mv|rm|mkdir|rmdir|touch|chmod|chown|find|ls|stat)\b/,
    /\b(ln|readlink|realpath|basename|dirname)\b/,
  ],
  'network': [
    /\b(curl|wget|ssh|scp|sftp|rsync|nc|netcat|telnet|ftp)\b/,
    /\b(docker|kubectl|helm)\b.*\b(push|pull|deploy)\b/,
  ],
  'build': [
    /\b(make|cmake|cargo|npm|yarn|pnpm|bun|go|javac|gcc|g\+\+|clang)\b/,
    /\b(npx|nx|turbo|lerna|gradle|mvn)\b/,
    /\b(tsc|esbuild|webpack|vite|rollup|parcel)\b/,
  ],
  'test': [
    /\b(jest|mocha|vitest|pytest|cargo test|go test|npm test|yarn test)\b/,
    /\b(cypress|playwright|selenium|testcafe)\b/,
  ],
  'deploy': [
    /\b(docker|podman|kubectl|helm|terraform|ansible|aws|gcloud|az)\b/,
    /\b(nginx|apache|caddy|pm2|systemctl)\b/,
  ],
  'database': [
    /\b(mysql|psql|mongo|redis-cli|sqlite|pg_dump|mysqldump)\b/,
    /\b(drizzle|prisma|knex|sequelize|typeorm)\b/,
  ],
  'git': [
    /\b(git)\b/,
    /\b(gh|hub|lazygit|tig)\b/,
  ],
  'package-manager': [
    /\b(npm|yarn|pnpm|bun|pip|poetry|cargo|go|brew|apt|yum|dnf|pacman)\b/,
    /\b(npx|pipx|cargo install)\b/,
  ],
  'system': [
    /\b(sudo|su|chmod|chown|chgrp|mount|umount|systemctl|service)\b/,
    /\b(ps|top|htop|kill|killall|pkill|pgrep)\b/,
    /\b(df|du|free|uptime|uname|whoami|id)\b/,
  ],
  'unknown': [],
};

// ---------------------------------------------------------------------------
// Risk Assessment
// ---------------------------------------------------------------------------

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\brm\s+.*(-rf|-r\s+--force)\b/,
  /\bmkfs\b/,
  /\bdd\b.*of=/,
  /\bfdisk\b/,
  /\bformat\b/,
  /\bchmod\s+[0-7]*7[0-7]*\b/,
  /\bsudo\b/,
  /\bsu\b/,
  /\bkill\s+-9\b/,
  /\bpkill\b/,
  /\bkillall\b/,
];

const MEDIUM_RISK_PATTERNS: RegExp[] = [
  /\brm\b/,
  /\bmv\b.*\//,
  /\bcp\b.*\//,
  /\bchmod\b/,
  /\bchown\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bssh\b/,
];

// ---------------------------------------------------------------------------
// Label Generation
// ---------------------------------------------------------------------------

function detectCategory(command: string): CommandCategory {
  const normalized = command.toLowerCase().trim();
  
  for (const [category, patterns] of Object.entries(COMMAND_PATTERNS)) {
    if (category === 'unknown') continue;
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return category as CommandCategory;
      }
    }
  }
  
  return 'unknown';
}

function assessRisk(command: string): CommandAnnotation['riskLevel'] {
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(command)) return 'critical';
  }
  
  for (const pattern of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(command)) return 'medium';
  }
  
  return 'low';
}

function generateLabel(command: string, category: CommandCategory): string {
  const categoryLabels: Record<CommandCategory, string> = {
    'file-operation': '📁 File',
    'network': '🌐 Network',
    'build': '🔨 Build',
    'test': '🧪 Test',
    'deploy': '🚀 Deploy',
    'database': '🗄️ Database',
    'git': '📦 Git',
    'package-manager': '📋 Package',
    'system': '⚙️ System',
    'unknown': '❓ Unknown',
  };
  
  return categoryLabels[category] || '❓ Unknown';
}

function generateDescription(command: string, category: CommandCategory): string {
  const cmd = command.split(/\s+/)[0] || command;
  
  const descriptions: Record<string, string> = {
    // File operations
    'cat': 'Display file contents',
    'head': 'Display first lines of file',
    'tail': 'Display last lines of file',
    'cp': 'Copy files or directories',
    'mv': 'Move or rename files',
    'rm': 'Remove files or directories',
    'mkdir': 'Create directories',
    'touch': 'Create empty file or update timestamp',
    'chmod': 'Change file permissions',
    'chown': 'Change file ownership',
    'find': 'Search for files',
    'ls': 'List directory contents',
    'stat': 'Display file status',
    
    // Network
    'curl': 'Transfer data from URLs',
    'wget': 'Download files from web',
    'ssh': 'Secure shell connection',
    'scp': 'Secure copy over network',
    
    // Build
    'make': 'Build automation tool',
    'cargo': 'Rust package manager',
    'npm': 'Node.js package manager',
    'yarn': 'Package manager',
    'pnpm': 'Package manager',
    'go': 'Go compiler',
    'javac': 'Java compiler',
    'gcc': 'C compiler',
    'g++': 'C++ compiler',
    
    // Test
    'jest': 'JavaScript testing framework',
    'mocha': 'JavaScript testing framework',
    'vitest': 'Vite testing framework',
    'pytest': 'Python testing framework',
    
    // Git
    'git': 'Version control system',
    'gh': 'GitHub CLI',
    
    // Package managers
    'pip': 'Python package installer',
    'brew': 'macOS package manager',
    'apt': 'Debian package manager',
    'yum': 'Red Hat package manager',
    
    // System
    'ps': 'List processes',
    'kill': 'Terminate process',
    'df': 'Display disk usage',
    'du': 'Estimate file space usage',
    'free': 'Display memory usage',
    'uptime': 'System uptime',
    'uname': 'System information',
    'whoami': 'Current user',
  };
  
  return descriptions[cmd] || `Execute ${cmd} command`;
}

// ---------------------------------------------------------------------------
// Main Functions
// ---------------------------------------------------------------------------

export function annotateCommand(command: string): CommandAnnotation {
  const category = detectCategory(command);
  const riskLevel = assessRisk(command);
  const label = generateLabel(command, category);
  const description = generateDescription(command, category);
  
  return {
    command,
    label,
    description,
    timestamp: Date.now(),
    category,
    riskLevel,
  };
}

export function formatAnnotation(annotation: CommandAnnotation): string {
  const riskEmoji = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
  }[annotation.riskLevel];
  
  return `${annotation.label} | ${riskEmoji} ${annotation.riskLevel.toUpperCase()} | ${annotation.description}`;
}

export function formatAnnotationForLog(annotation: CommandAnnotation): string {
  const timestamp = new Date(annotation.timestamp).toISOString();
  return `[${timestamp}] ${annotation.label}: ${annotation.command}`;
}

export function shouldShowWarning(annotation: CommandAnnotation): boolean {
  return annotation.riskLevel === 'high' || annotation.riskLevel === 'critical';
}

export function getWarningMessage(annotation: CommandAnnotation): string {
  if (annotation.riskLevel === 'critical') {
    return `⚠️  CRITICAL: This command may cause irreversible damage. Please verify before proceeding.`;
  }
  if (annotation.riskLevel === 'high') {
    return `⚠️  WARNING: This command has elevated risk. Please review carefully.`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Batch Annotation
// ---------------------------------------------------------------------------

export function annotateCommands(commands: string[]): CommandAnnotation[] {
  return commands.map(annotateCommand);
}

export function filterByCategory(annotations: CommandAnnotation[], category: CommandCategory): CommandAnnotation[] {
  return annotations.filter(a => a.category === category);
}

export function filterByRisk(annotations: CommandAnnotation[], minRisk: CommandAnnotation['riskLevel']): CommandAnnotation[] {
  const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
  const minLevel = riskOrder[minRisk];
  return annotations.filter(a => riskOrder[a.riskLevel] >= minLevel);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  annotateCommand,
  formatAnnotation,
  formatAnnotationForLog,
  shouldShowWarning,
  getWarningMessage,
  annotateCommands,
  filterByCategory,
  filterByRisk,
  detectCategory,
  assessRisk,
};
