/**
 * Git utilities
 *
 * Provides git-related helper functions for worktree operations.
 */

import { execFileNoThrow } from './execFileNoThrow.js';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Get the git executable path
 */
export function gitExe(): string {
  return 'git';
}

/**
 * Find the git root directory from a given path
 */
export async function findGitRoot(cwd: string): Promise<string | null> {
  const { code, stdout } = await execFileNoThrow(
    gitExe(),
    ['rev-parse', '--show-toplevel'],
    { cwd },
  );
  if (code === 0) {
    return stdout.trim();
  }
  return null;
}

/**
 * Find the canonical git root (resolves through worktrees to main repo)
 */
export async function findCanonicalGitRoot(cwd: string): Promise<string | null> {
  const result = await findGitRoot(cwd);
  if (!result) {
    return null;
  }

  // Check if we're in a worktree by looking for commondir
  const { code, stdout } = await execFileNoThrow(
    gitExe(),
    ['rev-parse', '--git-dir'],
    { cwd: result },
  );

  if (code === 0) {
    const gitDir = stdout.trim();
    // If git-dir is not .git, we're in a worktree
    if (gitDir !== '.git') {
      // Get the main repo's worktree directory
      const { code: commondirCode, stdout: commondirStdout } = await execFileNoThrow(
        gitExe(),
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: result },
      );
      if (commondirCode === 0) {
        const commonDir = commondirStdout.trim();
        // The common dir is usually the main repo's .git
        // Go up from .git to find the repo root
        const mainGitDir = existsSync(join(commonDir, 'worktrees'))
          ? commonDir
          : join(commonDir, '..');
        return join(mainGitDir, '..').replace(/\\/g, '/');
      }
    }
  }

  return result;
}

/**
 * Get the current branch name
 */
export async function getBranch(cwd: string): Promise<string | null> {
  const { code, stdout } = await execFileNoThrow(
    gitExe(),
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd },
  );
  if (code === 0) {
    return stdout.trim();
  }
  return null;
}

/**
 * Get the default branch name (main or master)
 */
export async function getDefaultBranch(cwd: string): Promise<string> {
  // Try main first, then master
  const remotes = await execFileNoThrow(gitExe(), ['remote'], { cwd });
  if (remotes.code !== 0 || !remotes.stdout.trim()) {
    return 'main';
  }

  const remote = remotes.stdout.trim().split('\n')[0];

  // Check if origin/main exists
  const mainCheck = await execFileNoThrow(
    gitExe(),
    ['rev-parse', '--verify', '--quiet', `origin/main`],
    { cwd },
  );
  if (mainCheck.code === 0) {
    return 'main';
  }

  // Check if origin/master exists
  const masterCheck = await execFileNoThrow(
    gitExe(),
    ['rev-parse', '--verify', '--quiet', `origin/master`],
    { cwd },
  );
  if (masterCheck.code === 0) {
    return 'master';
  }

  return 'main';
}