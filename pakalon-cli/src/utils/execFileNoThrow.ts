/**
 * Execute file without throwing
 *
 * Runs a command and returns the result without throwing on non-zero exit.
 */

import { execFile as execFileNode, ExecException } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileNode);

export interface ExecFileResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecFileOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: 'ignore' | 'pipe';
}

/**
 * Execute a file and return result without throwing
 */
export async function execFileNoThrow(
  command: string,
  args: string[],
  options?: ExecFileOptions,
): Promise<ExecFileResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options?.cwd,
      env: options?.env || process.env,
      stdio: options?.stdin === 'ignore' ? 'ignore' : undefined,
    });
    return { code: 0, stdout: stdout || '', stderr: stderr || '' };
  } catch (error) {
    const execError = error as ExecException;
    return {
      code: execError.code ?? 1,
      stdout: execError.stdout || '',
      stderr: execError.message || '',
    };
  }
}

/**
 * Execute a file with a working directory specified
 */
export async function execFileNoThrowWithCwd(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; stdin?: 'ignore' | 'pipe' },
): Promise<ExecFileResult> {
  return execFileNoThrow(command, args, options);
}