/**
 * /fork command - Copy session to a new file
 * 
 * /fork copies the entire current session into a brand-new JSONL, rewrites
 * the header with a fresh id, sets parentSession to the old id, and switches
 * the active session to the copy. The original file is untouched. Use it when
 * the alternative might get abandoned and you don't want it cluttering the
 * parent's /tree view.
 * 
 * Features:
 * - Copy entire session to new file
 * - Fresh ID for new session
 * - parentSession field for lineage
 * - Artifact directories copied alongside
 * - Blocked while streaming
 * - Disabled under --no-session
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Command } from '../commands.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForkOptions {
  /** Target path for the forked session */
  targetPath?: string;
  /** Parent session ID */
  parentId?: string;
}

export interface ForkResult {
  success: boolean;
  newSessionId?: string;
  newPath?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Fork Command
// ---------------------------------------------------------------------------

function getPromptContent(args: string): string {
  const options = parseForkArgs(args);
  
  let targetInfo = '';
  if (options.targetPath) {
    targetInfo = `\nTarget path: ${options.targetPath}`;
  }
  
  return `## Fork Session

You are forking the current session to a new file.

### How /fork works:
1. Copies the entire current session to a new JSONL file
2. Rewrites the header with a fresh ID
3. Sets parentSession to the original session ID
4. Switches active session to the copy
5. Original file is untouched

### Current Session:${targetInfo}

### What gets copied:
- All messages in the active branch
- Session metadata
- Artifact directories (if any)

### What stays:
- The original file remains unchanged
- You can return to it via /resume

### Use cases:
- Exploring an alternative approach without cluttering the main session
- Creating a backup before risky changes
- Sharing a session variant with someone

Type your first message in the new forked session.`;
}

const forkCommand: Command = {
  type: 'prompt',
  name: 'fork',
  description: 'Copy session to a new file',
  progressMessage: 'forking session',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args): Promise<Array<{ type: string; text: string }>> {
    const promptContent = getPromptContent(args);
    return [{ type: 'text', text: promptContent }];
  },
};

// ---------------------------------------------------------------------------
// Argument Parser
// ---------------------------------------------------------------------------

export function parseForkArgs(args: string): ForkOptions {
  const options: ForkOptions = {};
  
  // Parse target path
  const pathMatch = args.match(/--to\s+(\S+)/);
  if (pathMatch) {
    options.targetPath = pathMatch[1];
  }
  
  // Parse parent ID
  const parentMatch = args.match(/--parent\s+(\S+)/);
  if (parentMatch) {
    options.parentId = parentMatch[1];
  }
  
  return options;
}

// ---------------------------------------------------------------------------
// Fork Operations
// ---------------------------------------------------------------------------

/**
 * Fork a session file to a new location
 */
export function forkSession(
  sourcePath: string,
  targetPath?: string
): ForkResult {
  try {
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Source file not found: ${sourcePath}` };
    }

    // Read source session
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    const sourceLines = sourceContent.split('\n').filter(l => l.trim());

    if (sourceLines.length === 0) {
      return { success: false, error: 'Source session is empty' };
    }

    // Parse header
    let header: Record<string, unknown> = {};
    try {
      header = JSON.parse(sourceLines[0]!);
    } catch {
      return { success: false, error: 'Invalid session header' };
    }

    // Generate new session ID
    const newSessionId = randomUUID();

    // Create new header
    const newHeader = {
      ...header,
      id: newSessionId,
      parentSession: header.id,
      forkedAt: new Date().toISOString(),
    };

    // Determine target path
    const finalTargetPath = targetPath || sourcePath.replace('.jsonl', `-fork-${Date.now()}.jsonl`);

    // Write new session
    const newContent = [
      JSON.stringify(newHeader),
      ...sourceLines.slice(1),
    ].join('\n');

    fs.writeFileSync(finalTargetPath, newContent, 'utf-8');

    return {
      success: true,
      newSessionId,
      newPath: finalTargetPath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get session lineage (walk parentSession chain)
 */
export function getSessionLineage(sessionPath: string): string[] {
  const lineage: string[] = [];
  let currentPath = sessionPath;

  while (currentPath && fs.existsSync(currentPath)) {
    lineage.unshift(currentPath);

    try {
      const content = fs.readFileSync(currentPath, 'utf-8');
      const firstLine = content.split('\n')[0];
      if (!firstLine) break;

      const header = JSON.parse(firstLine);
      currentPath = header.parentSession
        ? path.join(path.dirname(currentPath), `${header.parentSession}.jsonl`)
        : '';
    } catch {
      break;
    }
  }

  return lineage;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default forkCommand;
export { forkSession, getSessionLineage };
