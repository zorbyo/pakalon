import * as fs from 'fs';
import * as path from 'path';
import { tool } from 'ai';
import { z } from 'zod';
import logger from '@/utils/logger.js';

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  isMain: boolean;
}

const WORKTREE_DIR = '.pakalon/worktrees';

let currentWorktree: WorktreeInfo | null = null;

export async function getGitWorktrees(cwd: string = process.cwd()): Promise<WorktreeInfo[]> {
  try {
    const result = await runGitCommand(['worktree', 'list', '--porcelain'], cwd);

    const worktrees: WorktreeInfo[] = [];
    const lines = result.split('\n');

    let currentWorktree: Partial<WorktreeInfo> | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (currentWorktree?.path) {
          worktrees.push(currentWorktree as WorktreeInfo);
        }
        const pathPart = line.slice(9).trim();
        currentWorktree = {
          path: pathPart,
          name: path.basename(pathPart),
          isMain: pathPart === cwd || pathPart === path.resolve(cwd),
        };
      } else if (line.startsWith('branch ') && currentWorktree) {
        currentWorktree.branch = line.slice(7).trim();
      }
    }

    if (currentWorktree?.path) {
      worktrees.push(currentWorktree as WorktreeInfo);
    }

    return worktrees;
  } catch (err) {
    logger.warn('Failed to get worktrees:', err);
    return [];
  }
}

export async function createWorktree(
  name: string,
  branch: string,
  cwd: string = process.cwd()
): Promise<WorktreeInfo | null> {
  const worktreePath = path.join(cwd, WORKTREE_DIR, name);

  if (fs.existsSync(worktreePath)) {
    logger.warn(`Worktree path already exists: ${worktreePath}`);
    return null;
  }

  try {
    await runGitCommand(['worktree', 'add', '-b', branch, worktreePath], cwd);

    const worktree: WorktreeInfo = {
      name,
      path: worktreePath,
      branch,
      isMain: false,
    };

    saveWorktreeInfo(worktree);

    return worktree;
  } catch (err) {
    logger.error(`Failed to create worktree ${name}:`, err);
    return null;
  }
}

export async function removeWorktree(name: string, cwd: string = process.cwd()): Promise<boolean> {
  const worktreePath = path.join(cwd, WORKTREE_DIR, name);

  if (!fs.existsSync(worktreePath)) {
    logger.warn(`Worktree does not exist: ${worktreePath}`);
    return false;
  }

  try {
    await runGitCommand(['worktree', 'remove', worktreePath, '--force'], cwd);

    removeWorktreeInfo(name, cwd);

    return true;
  } catch (err) {
    logger.error(`Failed to remove worktree ${name}:`, err);
    return false;
  }
}

export async function enterWorktree(name: string, cwd: string = process.cwd()): Promise<string | null> {
  const worktreePath = path.join(cwd, WORKTREE_DIR, name);

  if (!fs.existsSync(worktreePath)) {
    logger.warn(`Worktree does not exist: ${worktreePath}`);
    return null;
  }

  const worktreeInfo = await findWorktreeByName(name, cwd);
  if (worktreeInfo) {
    currentWorktree = worktreeInfo;
  }

  return worktreePath;
}

export async function exitWorktree(cwd: string = process.cwd()): Promise<string | null> {
  if (!currentWorktree) {
    return null;
  }

  const mainPath = cwd;
  currentWorktree = null;

  return mainPath;
}

async function runGitCommand(args: string[], cwd: string): Promise<string> {
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, shell: true });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Git command failed: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

function saveWorktreeInfo(worktree: WorktreeInfo, baseCwd: string = process.cwd()): void {
  const infoPath = path.join(baseCwd, WORKTREE_DIR, 'worktrees.json');

  let worktrees: WorktreeInfo[] = [];

  if (fs.existsSync(infoPath)) {
    try {
      worktrees = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    } catch {
      worktrees = [];
    }
  }

  const existingIndex = worktrees.findIndex((w) => w.name === worktree.name);
  if (existingIndex >= 0) {
    worktrees[existingIndex] = worktree;
  } else {
    worktrees.push(worktree);
  }

  fs.mkdirSync(path.dirname(infoPath), { recursive: true });
  fs.writeFileSync(infoPath, JSON.stringify(worktrees, null, 2), 'utf-8');
}

function removeWorktreeInfo(name: string, baseCwd: string = process.cwd()): void {
  const infoPath = path.join(baseCwd, WORKTREE_DIR, 'worktrees.json');

  if (!fs.existsSync(infoPath)) {
    return;
  }

  try {
    const worktrees: WorktreeInfo[] = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    const filtered = worktrees.filter((w) => w.name !== name);
    fs.writeFileSync(infoPath, JSON.stringify(filtered, null, 2), 'utf-8');
  } catch {
  }
}

async function findWorktreeByName(name: string, cwd: string = process.cwd()): Promise<WorktreeInfo | null> {
  const worktrees = await getGitWorktrees(cwd);
  return worktrees.find((w) => w.name === name) || null;
}

export function getCurrentWorktree(): WorktreeInfo | null {
  return currentWorktree;
}

export function isWorktreeModeEnabled(): boolean {
  return process.env.PAKALON_WORKTREE_MODE === '1' || process.env.PAKALON_WORKTREE_MODE === 'true';
}

export function enableWorktreeMode(): void {
  process.env.PAKALON_WORKTREE_MODE = '1';
}

export function disableWorktreeMode(): void {
  delete process.env.PAKALON_WORKTREE_MODE;
}

const enterWorktreeTool = tool({
  description: 'Enter a git worktree for isolated development. Creates a separate working directory with its own branch.',
  inputSchema: z.object({
    name: z.string().describe('Name of the worktree to enter'),
    branch: z.string().optional().describe('Branch name (only used if creating new worktree)'),
    create: z.boolean().optional().default(false).describe('Create worktree if it does not exist'),
  }),
  execute: async ({ arguments: args }) => {
    const { name, branch, create } = args;

    let worktree = await findWorktreeByName(name);

    if (!worktree && create) {
      if (!branch) {
        return { success: false, error: 'branch is required when creating a worktree' };
      }
      worktree = await createWorktree(name, branch);
      if (!worktree) {
        return { success: false, error: `Failed to create worktree ${name}` };
      }
    }

    if (!worktree) {
      return { success: false, error: `Worktree ${name} not found` };
    }

    const path = await enterWorktree(name);
    if (!path) {
      return { success: false, error: `Failed to enter worktree ${name}` };
    }

    return {
      success: true,
      name: worktree.name,
      path: worktree.path,
      branch: worktree.branch,
      message: `Entered worktree ${name} at ${path}`,
    };
  },
});

const exitWorktreeTool = tool({
  description: 'Exit the current worktree and return to the main working directory',
  inputSchema: z.object({}),
  execute: async () => {
    const path = await exitWorktree();

    if (!path) {
      return { success: false, error: 'Not currently in a worktree' };
    }

    return {
      success: true,
      path,
      message: `Exited worktree, returned to ${path}`,
    };
  },
});

const listWorktreesTool = tool({
  description: 'List all git worktrees in the current repository',
  inputSchema: z.object({}),
  execute: async () => {
    const worktrees = await getGitWorktrees();

    return {
      success: true,
      worktrees,
      current: currentWorktree?.name || null,
      count: worktrees.length,
    };
  },
});

export function getAllWorktreeTools() {
  return {
    enter_worktree: enterWorktreeTool,
    exit_worktree: exitWorktreeTool,
    list_worktrees: listWorktreesTool,
  };
}