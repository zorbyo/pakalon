/**
 * Git Context — Git status extraction for system prompt inclusion.
 *
 * Provides real-time git status information that can be injected
 * into the agent's system prompt, matching Claude Code's behavior
 * of including repository context.
 *
 * Usage:
 *   const ctx = await getGitContext("/path/to/repo");
 *   // ctx contains: branch, status, recent commits, diff stats
 *
 *   // Then in system prompt builder:
 *   builder.addSection("Git Status", ctx.formatted);
 */

import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GitContext {
  /** Whether the directory is a git repository */
  isRepo: boolean;
  /** Current branch name */
  branch: string;
  /** Number of modified files */
  modifiedCount: number;
  /** Number of staged files */
  stagedCount: number;
  /** Number of untracked files */
  untrackedCount: number;
  /** Whether there are uncommitted changes */
  hasUncommitted: boolean;
  /** Recent commits (last 5) */
  recentCommits: Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
  }>;
  /** Diff stats (files changed, insertions, deletions) */
  diffStats: {
    files: number;
    insertions: number;
    deletions: number;
  };
  /** Current branch tracking info */
  upstreamInfo?: {
    remote: string;
    ahead: number;
    behind: number;
  };
  /** Formatted string for system prompt inclusion */
  formatted: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Git Helper
// ─────────────────────────────────────────────────────────────────────────────

function execGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 10000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error?.code ?? 0,
        });
      },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Git Context Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get formatted git context for a repository.
 * Returns null if the directory is not a git repository.
 */
export async function getGitContext(repoPath?: string): Promise<GitContext | null> {
  const dir = repoPath ?? process.cwd();

  // Check if it's a git repo
  const checkResult = await execGit(
    ["rev-parse", "--is-inside-work-tree"],
    dir,
  );

  if (checkResult.exitCode !== 0) {
    return null;
  }

  try {
    const [branch, statusResult, commitLog, diffStat, remoteResult] =
      await Promise.all([
        getBranch(dir),
        getStatus(dir),
        getRecentCommits(dir),
        getDiffStats(dir),
        getRemoteInfo(dir),
      ]);

    const ctx: GitContext = {
      isRepo: true,
      branch: branch ?? "unknown",
      modifiedCount: statusResult.modified,
      stagedCount: statusResult.staged,
      untrackedCount: statusResult.untracked,
      hasUncommitted:
        statusResult.modified > 0 ||
        statusResult.staged > 0 ||
        statusResult.untracked > 0,
      recentCommits: commitLog,
      diffStats,
      upstreamInfo: remoteResult,
      formatted: "",
    };

    ctx.formatted = formatGitContext(ctx);
    return ctx;
  } catch (err) {
    logger.warn("[GitContext] Failed to get git context", {
      error: String(err),
    });
    return null;
  }
}

/**
 * Get git status in a machine-readable format.
 */
async function getStatus(
  dir: string,
): Promise<{ modified: number; staged: number; untracked: number }> {
  const result = await execGit(
    ["status", "--porcelain", "--untracked-files=normal"],
    dir,
  );

  let modified = 0;
  let staged = 0;
  let untracked = 0;

  if (result.exitCode === 0 && result.stdout) {
    const lines = result.stdout.split("\n").filter(Boolean);
    for (const line of lines) {
      const status = line.slice(0, 2);
      if (status.includes("?")) {
        untracked++;
      } else if (
        status.includes("M") ||
        status.includes("A") ||
        status.includes("D") ||
        status.includes("R")
      ) {
        if (status[0] !== " ") staged++;
        if (status[1] !== " ") modified++;
      }
    }
  }

  return { modified, staged, untracked };
}

/**
 * Get the current branch name.
 */
async function getBranch(dir: string): Promise<string | null> {
  const result = await execGit(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    dir,
  );

  if (result.exitCode !== 0) return null;
  return result.stdout.trim();
}

/**
 * Get recent commits.
 */
async function getRecentCommits(
  dir: string,
): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
  const result = await execGit(
    [
      "log",
      "--oneline",
      "--format=%h|%s|%an|%ar",
      "-5",
      "--no-color",
    ],
    dir,
  );

  if (result.exitCode !== 0 || !result.stdout) return [];

  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|");
      return {
        hash: parts[0] ?? "",
        message: parts[1] ?? "",
        author: parts[2] ?? "",
        date: parts[3] ?? "",
      };
    });
}

/**
 * Get diff stats.
 */
async function getDiffStats(
  dir: string,
): Promise<{ files: number; insertions: number; deletions: number }> {
  const defaultStats = { files: 0, insertions: 0, deletions: 0 };

  // Check if there are any unstaged changes
  const diffResult = await execGit(
    ["diff", "--shortstat"],
    dir,
  );

  if (diffResult.exitCode !== 0 || !diffResult.stdout) {
    return defaultStats;
  }

  const match = diffResult.stdout.match(
    /(\d+)\s+file[s]?\s+changed(?:,\s+(\d+)\s+insertion[s]?\([+-]\))?(?:,\s+(\d+)\s+deletion[s]?\([+-]\))?/,
  );

  if (!match) return defaultStats;

  return {
    files: parseInt(match[1] ?? "0", 10),
    insertions: parseInt(match[2] ?? "0", 10),
    deletions: parseInt(match[3] ?? "0", 10),
  };
}

/**
 * Get remote tracking info (ahead/behind).
 */
async function getRemoteInfo(
  dir: string,
): Promise<{ remote: string; ahead: number; behind: number } | undefined> {
  const result = await execGit(
    ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    dir,
  );

  if (result.exitCode !== 0 || !result.stdout) return undefined;

  const parts = result.stdout.trim().split("\t");
  if (parts.length < 2) return undefined;

  return {
    remote: "@{upstream}",
    ahead: parseInt(parts[0] ?? "0", 10),
    behind: parseInt(parts[1] ?? "0", 10),
  };
}

/**
 * Format git context for system prompt inclusion.
 */
function formatGitContext(ctx: GitContext): string {
  const lines: string[] = [];

  lines.push(`Branch: ${ctx.branch}`);

  if (ctx.upstreamInfo) {
    const { ahead, behind } = ctx.upstreamInfo;
    if (ahead > 0 || behind > 0) {
      const parts: string[] = [];
      if (ahead > 0) parts.push(`${ahead} ahead`);
      if (behind > 0) parts.push(`${behind} behind`);
      lines.push(`Remote: ${parts.join(", ")}`);
    }
  }

  if (ctx.hasUncommitted) {
    const parts: string[] = [];
    if (ctx.stagedCount > 0) parts.push(`${ctx.stagedCount} staged`);
    if (ctx.modifiedCount > 0) parts.push(`${ctx.modifiedCount} modified`);
    if (ctx.untrackedCount > 0) parts.push(`${ctx.untrackedCount} untracked`);
    lines.push(`Changes: ${parts.join(", ")}`);
  }

  if (ctx.diffStats.files > 0) {
    lines.push(
      `Diff: ${ctx.diffStats.files} files, +${ctx.diffStats.insertions}/-${ctx.diffStats.deletions}`,
    );
  }

  if (ctx.recentCommits.length > 0) {
    lines.push("");
    lines.push("Recent commits:");
    for (const commit of ctx.recentCommits) {
      lines.push(`  ${commit.hash} ${commit.message} (${commit.author})`);
    }
  }

  return lines.join("\n");
}
