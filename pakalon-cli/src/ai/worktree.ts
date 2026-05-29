/**
 * Worktree Isolation — Git worktree management for agent sandboxing.
 *
 * Implements Claude Code-style worktree isolation:
 * - Create isolated git worktrees for agent operations
 * - Agent works in its own worktree without affecting main branch
 * - Worktree lifecycle management (create, remove, list)
 * - Support for branch-per-task isolation
 *
 * Usage:
 *   const wt = new WorktreeManager("/path/to/repo");
 *   const worktree = await wt.create("feature-auth");
 *   // Agent works in worktree.path
 *   await wt.remove(worktree.name);
 */

import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WorktreeInfo {
  /** Worktree name (also the branch name) */
  name: string;
  /** Absolute path to the worktree */
  path: string;
  /** Git branch associated with the worktree */
  branch: string;
  /** When the worktree was created */
  createdAt: Date;
  /** Current status */
  status: "active" | "locked" | "pruned";
  /** HEAD commit hash */
  head?: string;
}

export interface WorktreeCreateOptions {
  /** Branch name (default: derived from name) */
  branch?: string;
  /** Base branch to fork from (default: current branch) */
  baseBranch?: string;
  /** Whether to create as a detached HEAD */
  detached?: boolean;
}

export interface WorktreeManagerConfig {
  /** Base path for worktrees (default: <repo>/.worktrees/) */
  worktreeBasePath?: string;
  /** Whether to auto-cleanup stale worktrees on init */
  autoCleanup?: boolean;
  /** Default branch for new worktrees */
  defaultBranch?: string;
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
      { cwd, timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
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
// Worktree Manager
// ─────────────────────────────────────────────────────────────────────────────

export class WorktreeManager {
  private repoPath: string;
  private config: WorktreeManagerConfig;

  constructor(repoPath: string, config?: Partial<WorktreeManagerConfig>) {
    this.repoPath = path.resolve(repoPath);
    this.config = {
      worktreeBasePath: path.join(this.repoPath, ".worktrees"),
      autoCleanup: true,
      defaultBranch: "main",
      ...config,
    };
  }

  /**
   * Initialize the worktree manager.
   * Ensures the worktree base directory exists and optionally cleans up stale worktrees.
   */
  async initialize(): Promise<void> {
    const basePath = this.config.worktreeBasePath!;
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }

    if (this.config.autoCleanup) {
      await this.pruneStale();
    }

    logger.info("[Worktree] Manager initialized", { repo: this.repoPath });
  }

  /**
   * Create a new worktree for a task.
   *
   * @param name - Worktree name (used for directory and branch)
   * @param options - Creation options
   * @returns Worktree info
   */
  async create(
    name: string,
    options?: WorktreeCreateOptions,
  ): Promise<WorktreeInfo> {
    const safeName = this.sanitizeName(name);
    const branch = options?.branch ?? `wt/${safeName}`;
    const baseBranch = options?.baseBranch ?? await this.getCurrentBranch();
    const worktreePath = path.join(this.config.worktreeBasePath!, safeName);

    // Check if worktree already exists
    if (fs.existsSync(worktreePath)) {
      throw new Error(`Worktree already exists: ${name} at ${worktreePath}`);
    }

    // Ensure the branch doesn't already exist remotely
    const branchCheck = await execGit(["branch", "--list", branch], this.repoPath);
    if (branchCheck.stdout.trim()) {
      throw new Error(`Branch already exists: ${branch}`);
    }

    const baseCheck = await execGit(
      ["rev-parse", "--verify", baseBranch],
      this.repoPath,
    );
    if (baseCheck.exitCode !== 0) {
      throw new Error(`Base branch not found: ${baseBranch}`);
    }

    // Create the branch and worktree
    const args = ["worktree", "add"];
    if (options?.detached) {
      args.push("--detach");
    }
    args.push(worktreePath, branch);

    const result = await execGit(args, this.repoPath);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr}`);
    }

    const info: WorktreeInfo = {
      name: safeName,
      path: worktreePath,
      branch,
      createdAt: new Date(),
      status: "active",
    };

    logger.info("[Worktree] Created", { name, branch, path: worktreePath });
    return info;
  }

  /**
   * Remove a worktree by name.
   */
  async remove(name: string, force = false): Promise<boolean> {
    const worktree = await this.get(name);
    if (!worktree) {
      logger.warn("[Worktree] Not found", { name });
      return false;
    }

    const args = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push(worktree.path);

    const result = await execGit(args, this.repoPath);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to remove worktree: ${result.stderr}`);
    }

    // Clean up the directory
    try {
      if (fs.existsSync(worktree.path)) {
        fs.rmSync(worktree.path, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    // Delete the branch
    await execGit(["branch", "-D", worktree.branch], this.repoPath);

    logger.info("[Worktree] Removed", { name, branch: worktree.branch });
    return true;
  }

  /**
   * List all worktrees.
   */
  async list(): Promise<WorktreeInfo[]> {
    const result = await execGit(
      ["worktree", "list", "--porcelain"],
      this.repoPath,
    );

    if (result.exitCode !== 0) return [];

    return this.parseWorktreeList(result.stdout);
  }

  /**
   * Get a specific worktree by name.
   */
  async get(name: string): Promise<WorktreeInfo | null> {
    const worktrees = await this.list();
    return worktrees.find((w) => w.name === name || w.branch.endsWith(name)) ?? null;
  }

  /**
   * Check if a worktree exists.
   */
  async exists(name: string): Promise<boolean> {
    const wt = await this.get(name);
    return wt !== null;
  }

  /**
   * Get the current active worktree (or main repo).
   */
  async getActive(): Promise<WorktreeInfo | null> {
    const worktrees = await this.list();
    return worktrees.find((w) => w.status === "active") ?? null;
  }

  /**
   * Prune stale/dead worktrees.
   */
  async pruneStale(): Promise<number> {
    const result = await execGit(
      ["worktree", "prune", "--verbose"],
      this.repoPath,
    );

    if (result.exitCode !== 0) {
      logger.warn("[Worktree] Prune failed", { error: result.stderr });
      return 0;
    }

    // Count pruned by checking output lines
    const prunedCount = result.stderr
      ? result.stderr.split("\n").filter((l) => l.includes("pruning")).length
      : 0;

    if (prunedCount > 0) {
      logger.info("[Worktree] Pruned stale worktrees", { count: prunedCount });
    }

    return prunedCount;
  }

  /**
   * Lock a worktree to prevent accidental removal.
   */
  async lock(name: string, reason?: string): Promise<boolean> {
    const worktree = await this.get(name);
    if (!worktree) return false;

    const args = ["worktree", "lock"];
    if (reason) args.push("--reason", reason);
    args.push(worktree.path);

    const result = await execGit(args, this.repoPath);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to lock worktree: ${result.stderr}`);
    }

    logger.info("[Worktree] Locked", { name, reason });
    return true;
  }

  /**
   * Unlock a worktree.
   */
  async unlock(name: string): Promise<boolean> {
    const worktree = await this.get(name);
    if (!worktree) return false;

    const result = await execGit(
      ["worktree", "unlock", worktree.path],
      this.repoPath,
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to unlock worktree: ${result.stderr}`);
    }

    logger.info("[Worktree] Unlocked", { name });
    return true;
  }

  /**
   * Get status summary.
   */
  async getStatus(): Promise<{
    repoPath: string;
    currentBranch: string;
    worktreeCount: number;
    worktrees: WorktreeInfo[];
    basePath: string;
  }> {
    const currentBranch = await this.getCurrentBranch();
    const worktrees = await this.list();

    return {
      repoPath: this.repoPath,
      currentBranch,
      worktreeCount: worktrees.length,
      worktrees,
      basePath: this.config.worktreeBasePath!,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private async getCurrentBranch(): Promise<string> {
    const result = await execGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      this.repoPath,
    );
    return result.stdout.trim() || this.config.defaultBranch!;
  }

  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
  }

  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const blocks = output.split("\n\n").filter(Boolean);

    for (const block of blocks) {
      const lines = block.split("\n");
      if (lines.length < 2) continue;

      let wtPath = "";
      let head = "";
      let branch = "";
      let status: WorktreeInfo["status"] = "active";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          wtPath = line.slice(9).trim();
        } else if (line.startsWith("HEAD ")) {
          head = line.slice(5).trim();
        } else if (line.startsWith("branch ")) {
          branch = line.slice(7).trim().replace("refs/heads/", "");
        } else if (line === "detached") {
          status = "locked";
        }
      }

      if (wtPath) {
        const name = path.basename(wtPath);
        worktrees.push({
          name,
          path: wtPath,
          branch: branch || "detached",
          createdAt: new Date(),
          status,
          head: head || undefined,
        });
      }
    }

    return worktrees;
  }
}
