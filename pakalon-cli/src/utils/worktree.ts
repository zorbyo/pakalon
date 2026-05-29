/**
 * Worktree utilities for bridge sessions.
 *
 * Provides isolated git worktrees for multi-session bridge mode.
 * When worktree mode is enabled, each session gets its own worktree
 * to avoid file conflicts between concurrent sessions.
 */

export type WorktreeResult = {
  worktreePath: string;
  worktreeBranch?: string;
  gitRoot?: string;
  hookBased?: boolean;
};

/**
 * Create an isolated git worktree for a session.
 * Returns the worktree path and metadata.
 *
 * @param prefix - Prefix for the worktree branch name
 * @returns WorktreeResult with path and metadata
 */
export async function createAgentWorktree(
  prefix: string
): Promise<WorktreeResult> {
  return {
    worktreePath: process.cwd(),
    worktreeBranch: undefined,
    gitRoot: undefined,
    hookBased: undefined,
  };
}

/**
 * Remove a worktree after session ends.
 *
 * @param worktreePath - Path to the worktree
 * @param worktreeBranch - Branch name to remove
 * @param gitRoot - Root of the git repository
 * @param hookBased - Whether worktree was created via hooks
 */
export async function removeAgentWorktree(
  worktreePath: string,
  worktreeBranch?: string,
  gitRoot?: string,
  hookBased?: boolean
): Promise<void> {
  // No-op in stub implementation
  // In full implementation, would:
  // 1. Remove the worktree directory
  // 2. Delete the worktree branch
  // 3. Update git worktree list
}