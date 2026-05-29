/**
 * Sandbox Workflow Module
 *
 * Enables a review-before-apply workflow:
 * 1. Proposed changes are written to a sandbox directory
 * 2. User can preview changes (diffs)
 * 3. On approval, changes are applied to the real codebase
 * 4. On rejection, sandbox is discarded
 *
 * This ensures no destructive changes happen without review.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

/**
 * Simple line-by-line diff function (no external dependencies)
 */
function computeLineDiff(oldText: string, newText: string): Array<{ type: 'add' | 'remove' | 'context'; lines: string[] }> {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: Array<{ type: 'add' | 'remove' | 'context'; lines: string[] }> = [];

  // Simple LCS-based diff
  const lcs = longestCommonSubsequence(oldLines, newLines);

  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
      // This line is in LCS - it's unchanged or in new
      if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
        result.push({ type: 'context', lines: [oldLines[oldIdx]] });
        oldIdx++;
        newIdx++;
        lcsIdx++;
      } else {
        // Line added in new
        const addedLines: string[] = [];
        while (newIdx < newLines.length && (lcsIdx >= lcs.length || newLines[newIdx] !== lcs[lcsIdx])) {
          addedLines.push(newLines[newIdx]);
          newIdx++;
        }
        result.push({ type: 'add', lines: addedLines });
      }
    } else if (oldIdx < oldLines.length) {
      // Line removed from old
      const removedLines: string[] = [];
      while (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
        removedLines.push(oldLines[oldIdx]);
        oldIdx++;
      }
      result.push({ type: 'remove', lines: removedLines });
    }
  }

  return result;
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

export interface SandboxFile {
  sandboxPath: string;
  realPath: string;
  content: string;
  originalContent?: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface SandboxChange {
  id: string;
  timestamp: string;
  projectDir: string;
  files: Map<string, SandboxFile>;
  applied: boolean;
  discarded: boolean;
}

export interface SandboxDiff {
  file: string;
  status: 'added' | 'modified' | 'deleted';
  hunks: Array<{
    lines: string[];
    type: 'add' | 'remove' | 'context';
    lineNumber?: number;
  }>;
  totalAdditions: number;
  totalDeletions: number;
}

export class SandboxManager {
  private sandboxes: Map<string, SandboxChange> = new Map();
  private activeSandboxId: string | null = null;
  private isEnabled: boolean = false;

  /**
   * Create a new sandbox session
   */
  async createSandbox(projectDir: string): Promise<string> {
    const sandboxId = uuid();
    const sandbox: SandboxChange = {
      id: sandboxId,
      timestamp: new Date().toISOString(),
      projectDir,
      files: new Map(),
      applied: false,
      discarded: false,
    };

    this.sandboxes.set(sandboxId, sandbox);
    this.activeSandboxId = sandboxId;

    return sandboxId;
  }

  /**
   * Enable or disable sandbox mode
   */
  setSandboxMode(enabled: boolean, sandboxId?: string): void {
    this.isEnabled = enabled;
    if (sandboxId && this.sandboxes.has(sandboxId)) {
      this.activeSandboxId = sandboxId;
    }
  }

  /**
   * Check if sandbox mode is active
   */
  isSandboxActive(): boolean {
    return this.isEnabled && this.activeSandboxId !== null;
  }

  /**
   * Get current sandbox ID
   */
  getCurrentSandboxId(): string | null {
    return this.activeSandboxId;
  }

  /**
   * Get a sandbox by ID
   */
  getSandbox(sandboxId: string): SandboxChange | undefined {
    return this.sandboxes.get(sandboxId);
  }

  /**
   * Get all sandboxes for a project
   */
  getSandboxesForProject(projectDir: string): SandboxChange[] {
    return Array.from(this.sandboxes.values())
      .filter(s => s.projectDir === projectDir && !s.applied && !s.discarded);
  }

  /**
   * Write a file to sandbox instead of real location
   */
  async writeSandboxFile(
    filePath: string,
    content: string,
    projectDir: string
  ): Promise<void> {
    if (!this.isEnabled || !this.activeSandboxId) {
      // Sandbox disabled - write directly
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return;
    }

    const sandbox = this.sandboxes.get(this.activeSandboxId)!;
    const relativePath = path.relative(projectDir, filePath);
    const sandboxDir = path.join(projectDir, '.pakalon-sandbox', this.activeSandboxId);
    const sandboxPath = path.join(sandboxDir, relativePath);

    // Read original content if file exists (for diff)
    let originalContent: string | undefined;
    try {
      originalContent = await fs.readFile(filePath, 'utf-8');
    } catch {
      // File doesn't exist yet - it's a new file
    }

    // Determine status
    const status: 'added' | 'modified' = originalContent ? 'modified' : 'added';

    // Write to sandbox directory
    await fs.mkdir(path.dirname(sandboxPath), { recursive: true });
    await fs.writeFile(sandboxPath, content, 'utf-8');

    // Track the file
    sandbox.files.set(relativePath, {
      sandboxPath,
      realPath: filePath,
      content,
      originalContent,
      status,
    });
  }

  /**
   * Delete a file in sandbox (mark for deletion)
   */
  async deleteSandboxFile(filePath: string, projectDir: string): Promise<void> {
    if (!this.isEnabled || !this.activeSandboxId) {
      // Sandbox disabled - delete directly
      await fs.unlink(filePath);
      return;
    }

    const sandbox = this.sandboxes.get(this.activeSandboxId)!;
    const relativePath = path.relative(projectDir, filePath);
    const sandboxDir = path.join(projectDir, '.pakalon-sandbox', this.activeSandboxId);

    // Read original content for diff
    let originalContent: string | undefined;
    try {
      originalContent = await fs.readFile(filePath, 'utf-8');
    } catch {
      return; // File doesn't exist
    }

    // Create marker file indicating deletion
    const markerPath = path.join(sandboxDir, `${relativePath}.deleted`);
    await fs.mkdir(path.dirname(markerPath), { recursive: true });
    await fs.writeFile(markerPath, '', 'utf-8');

    sandbox.files.set(relativePath, {
      sandboxPath: markerPath,
      realPath: filePath,
      content: '',
      originalContent,
      status: 'deleted',
    });
  }

  /**
   * Edit a file in sandbox
   */
  async editSandboxFile(
    filePath: string,
    oldString: string,
    newString: string,
    projectDir: string
  ): Promise<void> {
    if (!this.isEnabled || !this.activeSandboxId) {
      // Sandbox disabled - edit directly
      const content = await fs.readFile(filePath, 'utf-8');
      const updated = content.replace(oldString, newString);
      await fs.writeFile(filePath, updated, 'utf-8');
      return;
    }

    const sandbox = this.sandboxes.get(this.activeSandboxId)!;
    const relativePath = path.relative(projectDir, filePath);
    const sandboxDir = path.join(projectDir, '.pakalon-sandbox', this.activeSandboxId);
    const sandboxPath = path.join(sandboxDir, relativePath);

    // Read original
    let originalContent: string | undefined;
    try {
      originalContent = await fs.readFile(filePath, 'utf-8');
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    // Apply edit
    if (!originalContent.includes(oldString)) {
      throw new Error(`String not found in file: ${oldString}`);
    }
    const updatedContent = originalContent.replace(oldString, newString);

    // Write to sandbox
    await fs.mkdir(path.dirname(sandboxPath), { recursive: true });
    await fs.writeFile(sandboxPath, updatedContent, 'utf-8');

    sandbox.files.set(relativePath, {
      sandboxPath,
      realPath: filePath,
      content: updatedContent,
      originalContent,
      status: 'modified',
    });
  }

  /**
   * Get diff for a specific file
   */
  getFileDiff(filePath: string): SandboxDiff | null {
    if (!this.activeSandboxId) return null;

    const sandbox = this.sandboxes.get(this.activeSandboxId);
    if (!sandbox) return null;

    const sandboxFile = sandbox.files.get(filePath);
    if (!sandboxFile) return null;

    const hunks: SandboxDiff['hunks'] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    if (sandboxFile.status === 'deleted') {
      // Show the deleted content
      const lines = (sandboxFile.originalContent || '').split('\n');
      hunks.push({
        type: 'remove',
        lines,
        lineNumber: 1,
      });
      totalDeletions = lines.length;
    } else {
      // Calculate diff
      const changes = diffLines(
        sandboxFile.originalContent || '',
        sandboxFile.content
      );

      let lineNum = 1;
      for (const change of changes) {
        const lines = change.value.split('\n').filter(l => l !== '');
        if (change.added) {
          hunks.push({ type: 'add', lines, lineNumber: lineNum });
          totalAdditions += lines.length;
          lineNum += lines.length;
        } else if (change.removed) {
          hunks.push({ type: 'remove', lines, lineNumber: lineNum });
          totalDeletions += lines.length;
        } else {
          hunks.push({ type: 'context', lines, lineNumber: lineNum });
          lineNum += lines.length;
        }
      }
    }

    return {
      file: filePath,
      status: sandboxFile.status,
      hunks,
      totalAdditions,
      totalDeletions,
    };
  }

  /**
   * Get all diffs in the current sandbox
   */
  getAllDiffs(): SandboxDiff[] {
    if (!this.activeSandboxId) return [];

    const sandbox = this.sandboxes.get(this.activeSandboxId);
    if (!sandbox) return [];

    const diffs: SandboxDiff[] = [];
    for (const [filePath] of sandbox.files) {
      const diff = this.getFileDiff(filePath);
      if (diff) diffs.push(diff);
    }
    return diffs;
  }

  /**
   * Apply sandbox changes to real filesystem
   */
  async applySandbox(sandboxId?: string): Promise<{ success: boolean; applied: number; errors: string[] }> {
    const id = sandboxId || this.activeSandboxId;
    if (!id) return { success: false, applied: 0, errors: ['No active sandbox'] };

    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return { success: false, applied: 0, errors: ['Sandbox not found'] };

    const errors: string[] = [];
    let applied = 0;

    for (const [relativePath, sandboxFile] of sandbox.files) {
      try {
        if (sandboxFile.status === 'deleted') {
          // Delete the actual file
          await fs.unlink(sandboxFile.realPath);
          applied++;
        } else {
          // Ensure directory exists
          await fs.mkdir(path.dirname(sandboxFile.realPath), { recursive: true });
          // Copy from sandbox to real location
          await fs.copyFile(sandboxFile.sandboxPath, sandboxFile.realPath);
          applied++;
        }
      } catch (err) {
        errors.push(`Failed to apply ${relativePath}: ${err}`);
      }
    }

    sandbox.applied = true;
    this.isEnabled = false;
    this.activeSandboxId = null;

    return {
      success: errors.length === 0,
      applied,
      errors,
    };
  }

  /**
   * Discard sandbox and cleanup
   */
  async discardSandbox(sandboxId?: string): Promise<void> {
    const id = sandboxId || this.activeSandboxId;
    if (!id) return;

    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return;

    // Clean up sandbox directory
    const sandboxDir = path.join(sandbox.projectDir, '.pakalon-sandbox', id);
    try {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    sandbox.discarded = true;
    this.isEnabled = false;
    this.activeSandboxId = null;
  }

  /**
   * Preview sandbox - list all changes without applying
   */
  previewSandbox(sandboxId?: string): {
    totalFiles: number;
    added: number;
    modified: number;
    deleted: number;
    files: Array<{ path: string; status: string; additions: number; deletions: number }>;
  } {
    const id = sandboxId || this.activeSandboxId;
    if (!id) return { totalFiles: 0, added: 0, modified: 0, deleted: 0, files: [] };

    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return { totalFiles: 0, added: 0, modified: 0, deleted: 0, files: [] };

    const stats = { totalFiles: 0, added: 0, modified: 0, deleted: 0, files: [] as any[] };

    for (const [filePath, sandboxFile] of sandbox.files) {
      stats.totalFiles++;
      stats[sandboxFile.status]++;

      const diff = this.getFileDiff(filePath);
      stats.files.push({
        path: filePath,
        status: sandboxFile.status,
        additions: diff?.totalAdditions || 0,
        deletions: diff?.totalDeletions || 0,
      });
    }

    return stats;
  }
}

// Singleton instance
export const sandboxManager = new SandboxManager();

export default sandboxManager;