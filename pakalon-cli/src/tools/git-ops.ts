/**
 * Git Operations Tools - Copilot CLI Compatible
 * Implements git status, diff, commit using simple-git library
 */
import simpleGit, { SimpleGit, StatusResult, DiffResult } from 'simple-git';
import { z } from 'zod';
import * as path from 'path';

// ---------------------------------------------------------------------------
// GIT STATUS TOOL
// ---------------------------------------------------------------------------

export const gitStatusToolSchema = z.object({
  cwd: z.string().describe('Working directory (project root)'),
});

export const gitStatusTool = {
  name: 'git_status',
  description: 'Get git repository status (modified, staged, untracked files)',
  parameters: gitStatusToolSchema,
  
  async execute({ cwd }: z.infer<typeof gitStatusToolSchema>) {
    try {
      const git: SimpleGit = simpleGit(cwd);
      const status: StatusResult = await git.status();
      
      const modifiedCount = status.modified.length;
      const createdCount = status.not_added.length + status.created.length;
      const deletedCount = status.deleted.length;
      const stagedCount = status.staged.length;
      
      let summary = '';
      if (status.isClean()) {
        summary = 'Working directory clean (no changes)';
      } else {
        const parts: string[] = [];
        if (modifiedCount > 0) parts.push(`${modifiedCount} modified`);
        if (createdCount > 0) parts.push(`${createdCount} created`);
        if (deletedCount > 0) parts.push(`${deletedCount} deleted`);
        if (stagedCount > 0) parts.push(`${stagedCount} staged`);
        summary = parts.join(', ');
      }
      
      return {
        branch: status.current || 'unknown',
        modified: status.modified,
        created: status.not_added,
        deleted: status.deleted,
        staged: status.staged,
        renamed: status.renamed,
        ahead: status.ahead,
        behind: status.behind,
        isClean: status.isClean(),
        message: `Git status on branch ${status.current || 'unknown'}: ${summary}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git status failed: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// GIT DIFF TOOL
// ---------------------------------------------------------------------------

export const gitDiffToolSchema = z.object({
  cwd: z.string().describe('Working directory (project root)'),
  file: z.string().optional().describe('Specific file to diff (relative path)'),
  staged: z.boolean().optional().describe('Show staged changes (default: false)'),
});

export const gitDiffTool = {
  name: 'git_diff',
  description: 'Get git diff (shows changes in working directory or staged)',
  parameters: gitDiffToolSchema,
  
  async execute({ cwd, file, staged = false }: z.infer<typeof gitDiffToolSchema>) {
    try {
      const git: SimpleGit = simpleGit(cwd);
      
      const diffOptions = staged ? ['--cached'] : [];
      if (file) diffOptions.push(file);
      
      const diff = await git.diff(diffOptions);
      
      if (!diff || diff.trim() === '') {
        return {
          diff: '',
          lines: 0,
          hasChanges: false,
          message: `No changes ${staged ? '(staged)' : '(unstaged)'}${file ? ` in ${file}` : ''}`
        };
      }
      
      const lines = diff.split('\n').length;
      const filesChanged = (diff.match(/^diff --git/gm) || []).length;
      
      return {
        diff,
        lines,
        filesChanged,
        hasChanges: true,
        message: `Git diff ${staged ? '(staged)' : '(unstaged)'}${file ? ` for ${file}` : ''}: ${filesChanged} file${filesChanged === 1 ? '' : 's'} changed, ${lines} lines`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git diff failed: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// GIT COMMIT TOOL
// ---------------------------------------------------------------------------

export const gitCommitToolSchema = z.object({
  cwd: z.string().describe('Working directory (project root)'),
  message: z.string().describe('Commit message'),
  files: z.array(z.string()).optional().describe('Files to stage before commit (relative paths)'),
  addAll: z.boolean().optional().describe('Add all changes (git add -A) before commit'),
});

export const gitCommitTool = {
  name: 'git_commit',
  description: 'Create a git commit (optionally stages files first)',
  parameters: gitCommitToolSchema,
  
  async execute({ cwd, message, files, addAll = false }: z.infer<typeof gitCommitToolSchema>) {
    try {
      const git: SimpleGit = simpleGit(cwd);
      
      // Stage files if specified
      if (addAll) {
        await git.add('-A');
      } else if (files && files.length > 0) {
        await git.add(files);
      }
      
      // Commit with Copilot co-author trailer
      const commitMessage = `${message}\n\nCo-authored-by: Pakalon <pakalon@users.noreply.github.com>`;
      const result = await git.commit(commitMessage);
      
      return {
        commit: result.commit || 'unknown',
        summary: result.summary,
        branch: result.branch || 'unknown',
        filesChanged: result.summary?.changes || 0,
        insertions: result.summary?.insertions || 0,
        deletions: result.summary?.deletions || 0,
        message: `Created commit ${result.commit?.substring(0, 7) || 'unknown'} on ${result.branch || 'unknown'}: ${message}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git commit failed: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// GIT ADD TOOL
// ---------------------------------------------------------------------------

export const gitAddToolSchema = z.object({
  cwd: z.string().describe('Working directory (project root)'),
  files: z.array(z.string()).describe('Files to stage (relative paths)'),
});

export const gitAddTool = {
  name: 'git_add',
  description: 'Stage files for commit (git add)',
  parameters: gitAddToolSchema,
  
  async execute({ cwd, files }: z.infer<typeof gitAddToolSchema>) {
    try {
      const git: SimpleGit = simpleGit(cwd);
      await git.add(files);
      
      return {
        success: true,
        filesStaged: files.length,
        files,
        message: `Staged ${files.length} file${files.length === 1 ? '' : 's'} for commit`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git add failed: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// GIT LOG TOOL
// ---------------------------------------------------------------------------

export const gitLogToolSchema = z.object({
  cwd: z.string().describe('Working directory (project root)'),
  maxCount: z.number().optional().describe('Maximum number of commits to show (default: 10)'),
  file: z.string().optional().describe('Show log for specific file'),
});

export const gitLogTool = {
  name: 'git_log',
  description: 'Show git commit history',
  parameters: gitLogToolSchema,
  
  async execute({ cwd, maxCount = 10, file }: z.infer<typeof gitLogToolSchema>) {
    try {
      const git: SimpleGit = simpleGit(cwd);
      
      const options: any = {
        maxCount,
        format: {
          hash: '%H',
          abbrevHash: '%h',
          subject: '%s',
          authorName: '%an',
          authorDate: '%ai',
        }
      };
      
      if (file) {
        options.file = file;
      }
      
      const log = await git.log(options);
      
      return {
        total: log.total,
        commits: log.all.map((commit: any) => ({
          hash: commit.hash,
          shortHash: commit.hash.substring(0, 7),
          message: commit.subject,
          author: commit.authorName,
          date: commit.authorDate,
        })),
        message: `Git log${file ? ` for ${file}` : ''}: ${log.total} commit${log.total === 1 ? '' : 's'}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git log failed: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// Export all tools
// ---------------------------------------------------------------------------

export const gitOpsTools = {
  git_status: gitStatusTool,
  git_diff: gitDiffTool,
  git_commit: gitCommitTool,
  git_add: gitAddTool,
  git_log: gitLogTool,
};
