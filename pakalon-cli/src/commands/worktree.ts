/**
 * worktree.ts — Git Worktree management for parallel Pakalon agents.
 * 
 * When multiple Pakalon agents work on the same project simultaneously,
 * git worktrees allow isolated work without conflicts.
 */

import { execSync, exec as execCb } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const exec = promisify(execCb);

export interface WorktreeInfo {
  id: string;
  path: string;
  branch: string;
  agentName: string;
  createdAt: Date;
  status: "active" | "completed" | "failed";
}

export interface WorktreeResult {
  ok: boolean;
  worktree?: WorktreeInfo;
  output: string;
  error?: string;
}

// Store active worktrees in memory (in production, use a database)
const activeWorktrees = new Map<string, WorktreeInfo>();

/**
 * Get the main repository path
 */
export function getMainRepoPath(): string {
  return process.cwd();
}

/**
 * Get the worktrees base directory
 */
export function getWorktreesDir(): string {
  const mainRepo = getMainRepoPath();
  return path.join(mainRepo, ".pakalon", "worktrees");
}

/**
 * Ensure worktrees directory exists
 */
async function ensureWorktreesDir(): Promise<void> {
  const dir = getWorktreesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Check if we're in a git repository
 */
async function isGitRepo(): Promise<boolean> {
  try {
    const { stdout } = await exec("git rev-parse --is-inside-work-tree", { cwd: getMainRepoPath() });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * List all git worktrees
 */
export async function listGitWorktrees(): Promise<Array<{ path: string; branch: string; HEAD: string }>> {
  try {
    const { stdout } = await exec("git worktree list --porcelain", { cwd: getMainRepoPath() });
    const worktrees: Array<{ path: string; branch: string; HEAD: string }> = [];
    const lines = stdout.trim().split("\n");
    
    let current: { path?: string; branch?: string; HEAD?: string } = {};
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          worktrees.push(current as { path: string; branch: string; HEAD: string });
        }
        current = { path: line.slice(9) };
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7);
      } else if (line.startsWith("HEAD ")) {
        current.HEAD = line.slice(5);
      }
    }
    if (current.path) {
      worktrees.push(current as { path: string; branch: string; HEAD: string });
    }
    
    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Create a new worktree for an agent
 */
export async function createWorktree(
  agentName: string,
  options: {
    branch?: string;
    baseBranch?: string;
    id?: string;
  } = {}
): Promise<WorktreeResult> {
  try {
    if (!(await isGitRepo())) {
      return { ok: false, output: "", error: "Not a git repository" };
    }

    await ensureWorktreesDir();

    const worktreeId = options.id || crypto.randomBytes(8).toString("hex");
    const branchName = options.branch || `pakalon/${agentName}/${worktreeId}`;
    const baseBranch = options.baseBranch || "HEAD";
    const worktreePath = path.join(getWorktreesDir(), worktreeId);

    // Check if worktree already exists
    if (fs.existsSync(worktreePath)) {
      return { ok: false, output: "", error: `Worktree already exists: ${worktreePath}` };
    }

    // Create the worktree
    const createCmd = `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`;
    const { stdout, stderr } = await exec(createCmd, { cwd: getMainRepoPath() });

    const worktreeInfo: WorktreeInfo = {
      id: worktreeId,
      path: worktreePath,
      branch: branchName,
      agentName,
      createdAt: new Date(),
      status: "active",
    };

    activeWorktrees.set(worktreeId, worktreeInfo);

    return {
      ok: true,
      worktree: worktreeInfo,
      output: `Created worktree for agent "${agentName}" at ${worktreePath}\nBranch: ${branchName}\n${stdout}${stderr ? `\n[stderr] ${stderr}` : ""}`,
    };
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string };
    return { ok: false, output: "", error: e.stderr || e.message || String(err) };
  }
}

/**
 * Remove a worktree
 */
export async function removeWorktree(worktreeId: string): Promise<WorktreeResult> {
  try {
    const worktreeInfo = activeWorktrees.get(worktreeId);
    if (!worktreeInfo) {
      return { ok: false, output: "", error: `Worktree not found: ${worktreeId}` };
    }

    // Remove the worktree
    const removeCmd = `git worktree remove "${worktreeInfo.path}" --force`;
    const { stdout, stderr } = await exec(removeCmd, { cwd: getMainRepoPath() });

    // Update status
    worktreeInfo.status = "completed";
    activeWorktrees.set(worktreeId, worktreeInfo);

    return {
      ok: true,
      worktree: worktreeInfo,
      output: `Removed worktree: ${worktreeInfo.path}\n${stdout}${stderr ? `\n[stderr] ${stderr}` : ""}`,
    };
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string };
    return { ok: false, output: "", error: e.stderr || e.message || String(err) };
  }
}

/**
 * Get worktree info by ID
 */
export function getWorktree(worktreeId: string): WorktreeInfo | undefined {
  return activeWorktrees.get(worktreeId);
}

/**
 * List all active worktrees managed by Pakalon
 */
export function listActiveWorktrees(): WorktreeInfo[] {
  return Array.from(activeWorktrees.values()).filter(w => w.status === "active");
}

/**
 * Execute a command in a specific worktree
 */
export async function execInWorktree(
  worktreeId: string,
  command: string
): Promise<{ ok: boolean; output: string; error?: string }> {
  const worktreeInfo = activeWorktrees.get(worktreeId);
  if (!worktreeInfo) {
    return { ok: false, output: "", error: `Worktree not found: ${worktreeId}` };
  }

  try {
    const { stdout, stderr } = await exec(command, { cwd: worktreeInfo.path });
    return {
      ok: true,
      output: stdout + (stderr ? `\n[stderr] ${stderr}` : ""),
    };
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string; stdout?: string };
    return {
      ok: false,
      output: e.stdout || "",
      error: e.stderr || e.message || String(err),
    };
  }
}

/**
 * Merge worktree changes back to main branch
 */
export async function mergeWorktree(worktreeId: string): Promise<WorktreeResult> {
  const worktreeInfo = activeWorktrees.get(worktreeId);
  if (!worktreeInfo) {
    return { ok: false, output: "", error: `Worktree not found: ${worktreeId}` };
  }

  try {
    // First, commit any changes in the worktree
    await exec("git add -A && git commit -m 'Pakalon agent changes'", { cwd: worktreeInfo.path }).catch(() => {});

    // Switch to main repo and merge
    const mainBranch = "main"; // Could be detected dynamically
    const mergeCmd = `git checkout ${mainBranch} && git merge ${worktreeInfo.branch} --no-ff -m "Merge worktree from ${worktreeInfo.agentName}"`;
    const { stdout, stderr } = await exec(mergeCmd, { cwd: getMainRepoPath() });

    return {
      ok: true,
      worktree: worktreeInfo,
      output: `Merged worktree ${worktreeId} into ${mainBranch}\n${stdout}${stderr ? `\n[stderr] ${stderr}` : ""}`,
    };
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string };
    return { ok: false, output: "", error: e.stderr || e.message || String(err) };
  }
}

/**
 * Clean up all completed worktrees
 */
export async function cleanupWorktrees(): Promise<{ removed: number; errors: string[] }> {
  const errors: string[] = [];
  let removed = 0;

  for (const [id, worktree] of activeWorktrees.entries()) {
    if (worktree.status !== "active") {
      try {
        await removeWorktree(id);
        removed++;
      } catch (err) {
        errors.push(`Failed to remove ${id}: ${err}`);
      }
    }
  }

  // Also run git worktree prune
  try {
    await exec("git worktree prune", { cwd: getMainRepoPath() });
  } catch {
    // Ignore prune errors
  }

  return { removed, errors };
}

/**
 * Create a sub-agent that works in a worktree
 */
export async function createSubAgent(
  agentName: string,
  task: string,
  options: {
    baseBranch?: string;
    autoMerge?: boolean;
  } = {}
): Promise<{
  agentId: string;
  worktree: WorktreeInfo;
  instructions: string;
}> {
  const result = await createWorktree(agentName, {
    baseBranch: options.baseBranch,
  });

  if (!result.ok || !result.worktree) {
    throw new Error(result.error || "Failed to create worktree");
  }

  const instructions = `
## Sub-Agent: ${agentName}
**Worktree:** ${result.worktree.path}
**Branch:** ${result.worktree.branch}
**Task:** ${task}

### Instructions:
1. Work exclusively in the worktree directory: ${result.worktree.path}
2. Make your changes and commit them
3. When complete, your changes will be merged back to the main branch
4. Do NOT modify files outside your worktree

### Available Commands:
- \`git status\` - Check your changes
- \`git diff\` - See what you've changed
- \`git add . && git commit -m "Your message"\` - Commit changes
`;

  return {
    agentId: result.worktree.id,
    worktree: result.worktree,
    instructions,
  };
}

// Export the worktree command handler for slash commands
export async function handleWorktreeCommand(args: string[]): Promise<{ ok: boolean; output: string }> {
  const [subCommand, ...rest] = args;

  switch (subCommand) {
    case "create": {
      const agentName = rest[0] || `agent-${Date.now()}`;
      const task = rest.slice(1).join(" ") || "No specific task";
      const result = await createSubAgent(agentName, task);
      return {
        ok: true,
        output: `Created sub-agent "${agentName}"\n${result.instructions}`,
      };
    }

    case "list": {
      const worktrees = listActiveWorktrees();
      if (worktrees.length === 0) {
        return { ok: true, output: "No active worktrees." };
      }
      const list = worktrees.map(w => 
        `  • ${w.agentName} (${w.id}): ${w.branch} at ${w.path}`
      ).join("\n");
      return { ok: true, output: `Active worktrees:\n${list}` };
    }

    case "remove": {
      const id = rest[0];
      if (!id) {
        return { ok: false, output: "Usage: /worktree remove <id>" };
      }
      const result = await removeWorktree(id);
      return { ok: result.ok, output: result.output || result.error || "" };
    }

    case "merge": {
      const id = rest[0];
      if (!id) {
        return { ok: false, output: "Usage: /worktree merge <id>" };
      }
      const result = await mergeWorktree(id);
      return { ok: result.ok, output: result.output || result.error || "" };
    }

    case "cleanup": {
      const { removed, errors } = await cleanupWorktrees();
      let output = `Cleaned up ${removed} worktrees.`;
      if (errors.length > 0) {
        output += `\nErrors:\n${errors.join("\n")}`;
      }
      return { ok: true, output };
    }

    default:
      return {
        ok: true,
        output: [
          "Worktree commands:",
          "  /worktree create <name> [task]  — Create a new agent worktree",
          "  /worktree list                  — List active worktrees",
          "  /worktree remove <id>           — Remove a worktree",
          "  /worktree merge <id>            — Merge worktree changes",
          "  /worktree cleanup               — Clean up completed worktrees",
        ].join("\n"),
      };
  }
}
