/**
 * AST Edit - Structural code rewrites using ast-grep
 * 
 * Rewrites code structurally with ast-grep. Each op is { pat, out }:
 * - pat matches an AST shape
 * - out is the replacement template
 * 
 * Patterns match structure, not text - whitespace and comments are ignored.
 * 
 * Features:
 * - MetavariableMatches: $A, $_, $$$ARGS, $$$
 * - Identity enforcement: $A == $A
 * - Language inference from file extensions
 * - Preview before apply
 * - Staging with resolve tool
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AstEditOp {
  pat: string;
  out: string;
}

export interface AstEditResult {
  success: boolean;
  file: string;
  replacements: number;
  preview?: string;
  error?: string;
}

export interface AstEditPreview {
  file: string;
  original: string;
  modified: string;
  diff: string;
  replacements: number;
}

export interface AstEditStagedChange {
  id: string;
  file: string;
  original: string;
  modified: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Language Detection
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
};

function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANGUAGE[ext] || null;
}

// ---------------------------------------------------------------------------
// AST-grep Operations
// ---------------------------------------------------------------------------

function execAstGrep(args: string): string {
  try {
    return execSync(`ast-grep ${args}`, { encoding: 'utf-8' });
  } catch (error) {
    throw new Error(`ast-grep error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function astGrepSearch(
  pattern: string,
  filePaths: string[],
  language?: string
): Array<{ file: string; line: number; text: string; matches: Record<string, string> }> {
  const results: Array<{ file: string; line: number; text: string; matches: Record<string, string> }> = [];
  
  for (const filePath of filePaths) {
    const lang = language || detectLanguage(filePath);
    if (!lang) continue;
    
    try {
      const output = execAstGrep(
        `pattern "${pattern}" --lang ${lang} ${filePath} --json`
      );
      
      if (output.trim()) {
        const matches = JSON.parse(output);
        for (const match of matches) {
          results.push({
            file: filePath,
            line: match.range?.start?.line || 0,
            text: match.text || '',
            matches: match.variables || {},
          });
        }
      }
    } catch {
      // Skip files that fail to parse
    }
  }
  
  return results;
}

export function astGrepReplace(
  pattern: string,
  replacement: string,
  filePaths: string[],
  language?: string,
  dryRun = false
): AstEditResult[] {
  const results: AstEditResult[] = [];
  
  for (const filePath of filePaths) {
    const lang = language || detectLanguage(filePath);
    if (!lang) {
      results.push({
        success: false,
        file: filePath,
        replacements: 0,
        error: `Unsupported file type: ${filePath}`,
      });
      continue;
    }
    
    try {
      const original = fs.readFileSync(filePath, 'utf-8');
      
      // First, count matches
      const countOutput = execAstGrep(
        `pattern "${pattern}" --lang ${lang} ${filePath} --json`
      );
      
      const matches = countOutput.trim() ? JSON.parse(countOutput) : [];
      const replacementCount = matches.length;
      
      if (replacementCount === 0) {
        results.push({
          success: true,
          file: filePath,
          replacements: 0,
        });
        continue;
      }
      
      if (dryRun) {
        // Just report what would be changed
        results.push({
          success: true,
          file: filePath,
          replacements: replacementCount,
          preview: `${replacementCount} replacement(s) would be made in ${filePath}`,
        });
        continue;
      }
      
      // Perform replacement
      execAstGrep(
        `pattern "${pattern}" --lang ${lang} ${filePath} --rewrite "${replacement}" -i`
      );
      
      const modified = fs.readFileSync(filePath, 'utf-8');
      
      results.push({
        success: true,
        file: filePath,
        replacements: replacementCount,
      });
    } catch (error) {
      results.push({
        success: false,
        file: filePath,
        replacements: 0,
        error: String(error),
      });
    }
  }
  
  return results;
}

// ---------------------------------------------------------------------------
// Staged Changes
// ---------------------------------------------------------------------------

const stagedChanges = new Map<string, AstEditStagedChange>();

export function stageChange(
  file: string,
  original: string,
  modified: string
): AstEditStagedChange {
  const id = `ast-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  const change: AstEditStagedChange = {
    id,
    file,
    original,
    modified,
    timestamp: new Date().toISOString(),
  };
  
  stagedChanges.set(id, change);
  return change;
}

export function getStagedChange(id: string): AstEditStagedChange | undefined {
  return stagedChanges.get(id);
}

export function applyStagedChange(id: string): boolean {
  const change = stagedChanges.get(id);
  if (!change) return false;
  
  try {
    fs.writeFileSync(change.file, change.modified, 'utf-8');
    stagedChanges.delete(id);
    return true;
  } catch {
    return false;
  }
}

export function discardStagedChange(id: string): boolean {
  return stagedChanges.delete(id);
}

export function clearStagedChanges(): void {
  stagedChanges.clear();
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const astEditToolDefinition = {
  name: 'ast_edit',
  description: 'Rewrite code structurally using ast-grep. Patterns match AST structure, not text.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pat: { type: 'string', description: 'AST pattern to match' },
            out: { type: 'string', description: 'Replacement template' },
          },
          required: ['pat', 'out'],
        },
        description: 'List of edit operations',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths or glob patterns to search',
      },
      lang: {
        type: 'string',
        description: 'Language (auto-detected from file extensions if not specified)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Preview changes without applying (default: true)',
        default: true,
      },
    },
    required: ['ops', 'paths'],
  },
  isReadOnly: false,
  isConcurrencySafe: false,

  async execute(input: { ops: AstEditOp[]; paths: string[]; lang?: string; dryRun?: boolean }) {
    const results: AstEditResult[] = [];
    
    for (const op of input.ops) {
      const opResults = astGrepReplace(
        op.pat,
        op.out,
        input.paths,
        input.lang,
        input.dryRun ?? true
      );
      results.push(...opResults);
    }
    
    const totalReplacements = results.reduce((sum, r) => sum + r.replacements, 0);
    const successCount = results.filter(r => r.success).length;
    
    return {
      success: successCount === results.length,
      totalReplacements,
      filesProcessed: results.length,
      results: results.map(r => ({
        file: r.file,
        replacements: r.replacements,
        success: r.success,
        error: r.error,
      })),
      message: input.dryRun 
        ? `Preview: ${totalReplacements} replacement(s) in ${results.length} file(s)`
        : `Applied ${totalReplacements} replacement(s) in ${results.length} file(s)`,
    };
  },
};

export const resolveToolDefinition = {
  name: 'resolve',
  description: 'Accept or reject staged AST edits. Call after ast_edit to finalize changes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['apply', 'discard'],
        description: 'Whether to apply or discard the staged changes',
      },
      changeId: {
        type: 'string',
        description: 'ID of the specific staged change to resolve',
      },
      reason: {
        type: 'string',
        description: 'Reason for the action',
      },
    },
    required: ['action'],
  },
  isReadOnly: false,
  isConcurrencySafe: false,

  async execute(input: { action: 'apply' | 'discard'; changeId?: string; reason?: string }) {
    if (input.changeId) {
      // Resolve specific change
      if (input.action === 'apply') {
        const success = applyStagedChange(input.changeId);
        return {
          success,
          message: success 
            ? `Applied change ${input.changeId}`
            : `Failed to apply change ${input.changeId}`,
        };
      } else {
        const success = discardStagedChange(input.changeId);
        return {
          success,
          message: success 
            ? `Discarded change ${input.changeId}`
            : `Failed to discard change ${input.changeId}`,
        };
      }
    } else {
      // Resolve all changes
      if (input.action === 'apply') {
        const allChanges = Array.from(stagedChanges.keys());
        let successCount = 0;
        for (const id of allChanges) {
          if (applyStagedChange(id)) successCount++;
        }
        return {
          success: successCount === allChanges.length,
          message: `Applied ${successCount}/${allChanges.length} changes`,
        };
      } else {
        clearStagedChanges();
        return {
          success: true,
          message: 'Discarded all staged changes',
        };
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Conflict Resolution (conflict:// URLs)
// ---------------------------------------------------------------------------

export interface ConflictBlock {
  index: number;
  startLine: number;
  endLine: number;
  base: string;
  ours: string;
  theirs: string;
  resolved?: string;
}

/**
 * Parse conflict markers from a file content
 */
export function parseConflictMarkers(content: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  const lines = content.split('\n');
  
  let inConflict = false;
  let currentBlock: Partial<ConflictBlock> = {};
  let currentSection: 'base' | 'ours' | 'theirs' = 'base';
  let blockContent: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Start of conflict
    if (line.startsWith('<<<<<<<')) {
      inConflict = true;
      currentBlock = {
        index: blocks.length,
        startLine: i + 1,
      };
      currentSection = 'ours';
      blockContent = [];
      continue;
    }
    
    // Middle marker
    if (line.startsWith('=======') && inConflict) {
      currentBlock.ours = blockContent.join('\n');
      currentSection = 'theirs';
      blockContent = [];
      continue;
    }
    
    // End of conflict
    if (line.startsWith('>>>>>>>') && inConflict) {
      currentBlock.theirs = blockContent.join('\n');
      currentBlock.endLine = i + 1;
      blocks.push(currentBlock as ConflictBlock);
      inConflict = false;
      currentBlock = {};
      blockContent = [];
      continue;
    }
    
    // Content line
    if (inConflict) {
      blockContent.push(line);
    }
  }
  
  return blocks;
}

/**
 * Resolve a conflict block by choosing a side or merging
 */
export function resolveConflictBlock(
  block: ConflictBlock,
  resolution: 'ours' | 'theirs' | 'base' | 'merged',
  mergedContent?: string
): string {
  switch (resolution) {
    case 'ours':
      return block.ours;
    case 'theirs':
      return block.theirs;
    case 'base':
      return block.base;
    case 'merged':
      return mergedContent || block.ours;
    default:
      return block.ours;
  }
}

/**
 * Resolve all conflicts in a file
 */
export function resolveAllConflicts(
  content: string,
  resolution: 'ours' | 'theirs' | 'base' | 'merged',
  mergedContents?: Record<number, string>
): string {
  const blocks = parseConflictMarkers(content);
  const lines = content.split('\n');
  
  // Process blocks in reverse order to maintain line numbers
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const resolved = mergedContents?.[block.index]
      ? resolveConflictBlock(block, 'merged', mergedContents[block.index])
      : resolveConflictBlock(block, resolution);
    
    // Replace the conflict block with resolved content
    const resolvedLines = resolved.split('\n');
    lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...resolvedLines);
  }
  
  return lines.join('\n');
}

/**
 * Read a file and return conflict:// URLs for each block
 */
export function readConflicts(filePath: string): ConflictBlock[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseConflictMarkers(content);
  } catch {
    return [];
  }
}

/**
 * Resolve a specific conflict by index
 */
export function resolveConflict(
  filePath: string,
  blockIndex: number,
  resolution: 'ours' | 'theirs' | 'base' | 'merged',
  mergedContent?: string
): { success: boolean; content?: string; error?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const blocks = parseConflictMarkers(content);
    
    if (blockIndex < 0 || blockIndex >= blocks.length) {
      return { success: false, error: `Invalid block index: ${blockIndex}` };
    }
    
    const block = blocks[blockIndex];
    const resolved = mergedContent
      ? resolveConflictBlock(block, 'merged', mergedContent)
      : resolveConflictBlock(block, resolution);
    
    const lines = content.split('\n');
    const resolvedLines = resolved.split('\n');
    lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...resolvedLines);
    
    const newContent = lines.join('\n');
    fs.writeFileSync(filePath, newContent, 'utf-8');
    
    return { success: true, content: newContent };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Resolve all conflicts in a file at once
 */
export function resolveAllConflictsInFile(
  filePath: string,
  resolution: 'ours' | 'theirs' | 'base' | 'merged',
  mergedContents?: Record<number, string>
): { success: boolean; resolved: number; error?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const blocks = parseConflictMarkers(content);
    
    if (blocks.length === 0) {
      return { success: true, resolved: 0 };
    }
    
    const newContent = resolveAllConflicts(content, resolution, mergedContents);
    fs.writeFileSync(filePath, newContent, 'utf-8');
    
    return { success: true, resolved: blocks.length };
  } catch (error) {
    return { success: false, resolved: 0, error: String(error) };
  }
}

/**
 * Tool definition for conflict resolution
 */
export const conflictResolutionToolDefinition = {
  name: 'conflict_resolution',
  description: 'Resolve git merge conflicts using conflict:// URL scheme',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'resolve', 'resolve_all'],
        description: 'Action to perform',
      },
      file: { type: 'string', description: 'File path with conflicts' },
      blockIndex: { type: 'number', description: 'Index of the conflict block to resolve' },
      resolution: {
        type: 'string',
        enum: ['ours', 'theirs', 'base', 'merged'],
        description: 'Resolution strategy',
      },
      mergedContent: { type: 'string', description: 'Merged content for custom resolution' },
    },
    required: ['action'],
  },
  isReadOnly: false,
  isConcurrencySafe: false,

  async execute(input: { action: string; file?: string; blockIndex?: number; resolution?: string; mergedContent?: string }) {
    switch (input.action) {
      case 'list': {
        if (!input.file) return { error: 'file required' };
        const blocks = readConflicts(input.file);
        return {
          file: input.file,
          conflictCount: blocks.length,
          blocks: blocks.map(b => ({
            index: b.index,
            startLine: b.startLine,
            endLine: b.endLine,
            oursPreview: b.ours.slice(0, 100),
            theirsPreview: b.theirs.slice(0, 100),
          })),
        };
      }

      case 'resolve': {
        if (!input.file || input.blockIndex === undefined || !input.resolution) {
          return { error: 'file, blockIndex, and resolution required' };
        }
        const result = resolveConflict(
          input.file,
          input.blockIndex,
          input.resolution as 'ours' | 'theirs' | 'base' | 'merged',
          input.mergedContent
        );
        return result;
      }

      case 'resolve_all': {
        if (!input.file || !input.resolution) {
          return { error: 'file and resolution required' };
        }
        const result = resolveAllConflictsInFile(
          input.file,
          input.resolution as 'ours' | 'theirs' | 'base' | 'merged'
        );
        return result;
      }

      default:
        return { error: `Unknown action: ${input.action}` };
    }
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  astGrepSearch,
  astGrepReplace,
  stageChange,
  getStagedChange,
  applyStagedChange,
  discardStagedChange,
  clearStagedChanges,
  astEditToolDefinition,
  resolveToolDefinition,
  parseConflictMarkers,
  resolveConflictBlock,
  resolveAllConflicts,
  readConflicts,
  resolveConflict,
  resolveAllConflictsInFile,
  conflictResolutionToolDefinition,
};
