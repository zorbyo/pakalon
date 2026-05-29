/**
 * Bash Command Helpers
 * Utility functions for bash command handling
 */
import * as child_process from 'child_process';
import * as path from 'path';
import logger from '@/utils/logger.js';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface ParsedCommand {
  command: string;
  args: string[];
  redirectStdin?: string;
  redirectStdout?: string;
  redirectStderr?: string;
  pipeTo?: string;
  background?: boolean;
}

const SHELL_SPECIAL_CHARS = /[<>&|;()$`]/;
const QUOTE_CHARS = /['"]/;

export function parseCommandLine(commandLine: string): ParsedCommand | null {
  if (!commandLine || typeof commandLine !== 'string') {
    return null;
  }

  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < commandLine.length; i++) {
    const char = commandLine[i];

    if (char === '\\' && i + 1 < commandLine.length) {
      current += commandLine[i + 1];
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (char === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    return null;
  }

  const parsed: ParsedCommand = {
    command: tokens[0],
    args: [],
  };

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '2>' || token === '1>' || token === '>') {
      if (token === '2>' && tokens[i + 1]) {
        parsed.redirectStderr = tokens[i + 1];
        i++;
      } else if ((token === '1>' || token === '>') && tokens[i + 1]) {
        parsed.redirectStdout = tokens[i + 1];
        i++;
      }
    } else if (token === '2>&1') {
      parsed.redirectStderr = parsed.redirectStdout;
    } else if (token === '<') {
      if (tokens[i + 1]) {
        parsed.redirectStdin = tokens[i + 1];
        i++;
      }
    } else if (token === '|') {
      if (tokens[i + 1]) {
        parsed.pipeTo = tokens.slice(i + 1).join(' ');
        break;
      }
    } else if (token === '&' && tokens[i + 1] === 'bg') {
      parsed.background = true;
    } else {
      parsed.args.push(token);
    }
  }

  return parsed;
}

export async function executeCommand(
  command: string,
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  } = {},
): Promise<CommandResult> {
  const { cwd = process.cwd(), env = process.env, timeout = 30000 } = options;

  return new Promise((resolve) => {
    const startTime = Date.now();

    try {
      const child = child_process.spawn(command, [], {
        cwd,
        env,
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({
          stdout,
          stderr,
          exitCode: 124,
          error: 'Command timed out',
        });
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: 1,
          error: error.message,
        });
      });
    } catch (error) {
      resolve({
        stdout: '',
        stderr: '',
        exitCode: 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export function escapeShellArgument(arg: string): string {
  if (!arg.includes(' ') && !SHELL_SPECIAL_CHARS.test(arg)) {
    return arg;
  }

  if (arg.includes("'")) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }

  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function joinCommandArgs(args: string[]): string {
  return args.map(escapeShellArgument).join(' ');
}

export function isValidCommand(command: string): boolean {
  if (!command || typeof command !== 'string') {
    return false;
  }

  if (command.length === 0) {
    return false;
  }

  if (command.includes('\x00')) {
    return false;
  }

  return true;
}

export function hasUnbalancedQuotes(command: string): boolean {
  let singleQuotes = 0;
  let doubleQuotes = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (char === "'" && !inDouble) {
      if (inSingle) {
        singleQuotes--;
        inSingle = false;
      } else {
        singleQuotes++;
        inSingle = true;
      }
    } else if (char === '"' && !inSingle) {
      if (inDouble) {
        doubleQuotes--;
        inDouble = false;
      } else {
        doubleQuotes++;
        inDouble = true;
      }
    }
  }

  return singleQuotes !== 0 || doubleQuotes !== 0;
}

export function expandEnvironmentVariables(
  command: string,
  env: Record<string, string> = process.env,
): string {
  return command.replace(/\$(\w+)|\${([^}]+)}/g, (match, name1, name2) => {
    const name = name1 || name2;
    return env[name] ?? '';
  });
}

export function getCommandName(command: string): string {
  const parsed = parseCommandLine(command);
  return parsed?.command ?? command.split(/\s+/)[0] ?? '';
}

export function getCommandArgs(command: string): string[] {
  const parsed = parseCommandLine(command);
  return parsed?.args ?? [];
}

export function isBackgroundCommand(command: string): boolean {
  const parsed = parseCommandLine(command);
  return parsed?.background ?? command.trim().endsWith('&');
}

export function normalizeCommand(command: string): string {
  return command
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\\\\n/g, '\\n')
    .replace(/\\\\t/g, '\\t');
}

export function splitCommandPipeline(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if ((char === '"' || char === "'") && command[i - 1] !== '\\') {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      }
    }

    if (char === '|' && !inQuote) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

export function truncateCommand(command: string, maxLength: number): string {
  if (command.length <= maxLength) {
    return command;
  }

  return command.substring(0, maxLength - 3) + '...';
}

export function maskSecrets(command: string): string {
  return command
    .replace(/-p\s+['"]?(\S+)['"]?/g, '-p ****')
    .replace(/--password[=\s]+['"]?(\S+)['"]?/g, '--password ****')
    .replace(/--token[=\s]+['"]?(\S+)['"]?/g, '--token ****')
    .replace(/--api-key[=\s]+['"]?(\S+)['"]?/g, '--api-key ****')
    .replace(/\b[A-Za-z0-9_]{32,}\b/g, '****');
}

export {
  SHELL_SPECIAL_CHARS,
  QUOTE_CHARS,
};