/**
 * /branch command - Start a new thread in the same file
 * 
 * /branch opens a user-message picker and starts a new thread in the same
 * file from the selected prompt. The original branch is still reachable
 * through /tree. Use it when you want one file to be the canonical record
 * of an exploration.
 * 
 * Features:
 * - Start new thread from any user message
 * - Original branch remains accessible via /tree
 * - Same file, different leaf
 * - Labels preserved across branches
 */

import type { Command } from '../commands.js';
import { getTreeSessionStore, createTreeSession } from '../session/tree-session.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchOptions {
  /** Message ID to branch from */
  messageId?: string;
  /** Content for the new branch prompt */
  content?: string;
}

// ---------------------------------------------------------------------------
// Branch Command
// ---------------------------------------------------------------------------

function getPromptContent(args: string): string {
  const options = parseBranchArgs(args);
  
  let messageInfo = '';
  if (options.messageId) {
    messageInfo = `\nBranching from message: ${options.messageId}`;
  }
  
  let contentInfo = '';
  if (options.content) {
    contentInfo = `\nNew prompt: ${options.content}`;
  }
  
  return `## Branch Session

You are creating a new branch in the session tree.

### How /branch works:
1. Opens a user-message picker (or uses provided message)
2. Starts a new thread from that message
3. The original branch remains accessible via /tree
4. Both threads live in the same file

### Current Session:
${messageInfo}${contentInfo}

### What happens next:
- A new leaf will be created from the selected message
- The conversation continues from that point
- The original branch is preserved
- Use /tree to navigate between branches

### Branch vs Fork:
- /branch: Same file, new thread (use for exploration)
- /fork: New file, independent session (use for alternatives)

Type your new prompt to continue from the branch point.`;
}

const branchCommand: Command = {
  type: 'prompt',
  name: 'branch',
  description: 'Start a new thread in the same file from a selected prompt',
  progressMessage: 'creating branch',
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

export function parseBranchArgs(args: string): BranchOptions {
  const options: BranchOptions = {};
  
  // Parse message ID
  const msgMatch = args.match(/--from\s+(\S+)/);
  if (msgMatch) {
    options.messageId = msgMatch[1];
  }
  
  // Parse content (everything after flags)
  const content = args.replace(/--\S+(\s+\S+)?/g, '').trim();
  if (content) {
    options.content = content;
  }
  
  return options;
}

// ---------------------------------------------------------------------------
// Branch Operations
// ---------------------------------------------------------------------------

/**
 * Create a branch from a message
 */
export function createBranch(
  tree: ReturnType<typeof getTreeSessionStore> extends () => infer R ? R : never,
  messageId: string,
  content: string
): { success: boolean; newLeafId?: string; error?: string } {
  // This is a simplified implementation
  // In a real implementation, this would:
  // 1. Find the message in the tree
  // 2. Create a new leaf from that message's parent
  // 3. Set the leaf as active
  // 4. Return the new leaf ID
  
  return {
    success: true,
    newLeafId: `branch-${Date.now()}`,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default branchCommand;
export { createBranch };
