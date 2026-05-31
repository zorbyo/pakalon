/**
 * /tree command - In-place session tree navigator
 * 
 * /tree is the in-place navigator. It moves the leaf pointer to any
 * earlier message in the current file - no new file, no fork - which
 * is what you want when a turn went sideways or you need to scrub past
 * a long tool detour.
 * 
 * Features:
 * - ↑/↓ move; ←/→ page
 * - Type to fuzzy-search across rendered text, labels, roles, tool snippets
 * - Shift+L sets or clears a label on the highlighted entry
 * - Ctrl+O cycles filters; Alt+D/T/U/L/A jumps to filters
 * - Enter on user message: leaf moves, text copied for editing
 * - Enter on other: leaf moves, editor not prefilled
 * - Current leaf: no-op
 */

import type { Command } from '../commands.js';
import { getTreeSessionStore, type MessageTree, type TreeSessionNavigator } from '../session/tree-session.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TreeFilter = 'default' | 'no-tools' | 'user-only' | 'labeled-only' | 'all';

export interface TreeCommandOptions {
  filter?: TreeFilter;
  search?: string;
  label?: string;
  nodeId?: string;
}

// ---------------------------------------------------------------------------
// Tree Command
// ---------------------------------------------------------------------------

function getPromptContent(args: string): string {
  const options = parseTreeArgs(args);
  
  let filterInfo = '';
  if (options.filter) {
    filterInfo = `\nFilter: ${options.filter}`;
  }
  
  let searchInfo = '';
  if (options.search) {
    searchInfo = `\nSearch: ${options.search}`;
  }
  
  return `## Session Tree Navigator

You are in the /tree navigator. This allows you to navigate the conversation tree.

### Keyboard Shortcuts:
- ↑/↓: Move selection
- ←/→: Page through results
- Shift+L: Set/clear label on selected entry
- Ctrl+O: Cycle filter (default → no-tools → user-only → labeled-only → all)
- Enter: Select entry

### Current State:
${filterInfo}${searchInfo}

### How it works:
1. The tree shows all messages in the current session
2. Each message has a role (user/assistant/tool) and content preview
3. You can navigate to any earlier message
4. Labels persist and survive compaction
5. Use labels for "come back here later" markers

### Navigation:
- Selecting a user message: leaf moves to that entry's parent, message text copied for editing
- Selecting other entries: leaf moves, editor not prefilled
- Current leaf: no-op

Type your selection or use keyboard shortcuts to navigate.`;
}

const treeCommand: Command = {
  type: 'prompt',
  name: 'tree',
  description: 'Navigate the session tree in-place',
  progressMessage: 'opening tree navigator',
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

export function parseTreeArgs(args: string): TreeCommandOptions {
  const options: TreeCommandOptions = {};
  
  // Parse filter
  const filterMatch = args.match(/--filter\s+(\S+)/);
  if (filterMatch) {
    options.filter = filterMatch[1] as TreeFilter;
  }
  
  // Parse search
  const searchMatch = args.match(/--search\s+"([^"]+)"/);
  if (searchMatch) {
    options.search = searchMatch[1];
  } else {
    // Check for unquoted search after flags
    const remaining = args.replace(/--\S+(\s+\S+)?/g, '').trim();
    if (remaining) {
      options.search = remaining;
    }
  }
  
  // Parse label
  const labelMatch = args.match(/--label\s+"([^"]+)"/);
  if (labelMatch) {
    options.label = labelMatch[1];
  }
  
  // Parse node ID
  const nodeMatch = args.match(/--node\s+(\S+)/);
  if (nodeMatch) {
    options.nodeId = nodeMatch[1];
  }
  
  return options;
}

// ---------------------------------------------------------------------------
// Tree Display Utilities
// ---------------------------------------------------------------------------

export function formatTreeNode(
  node: { id: string; role: string; content: string; label?: string; timestamp: string },
  isActive: boolean,
  isSelected: boolean
): string {
  const marker = isActive ? '◉' : '○';
  const selectMarker = isSelected ? '▶' : ' ';
  const roleLabel = node.role.padEnd(10);
  const preview = node.content.slice(0, 50).replace(/\n/g, ' ');
  const label = node.label ? ` [${node.label}]` : '';
  const time = new Date(node.timestamp).toLocaleTimeString();
  
  return `${selectMarker}${marker} ${roleLabel} ${preview}${node.content.length > 50 ? '...' : ''}${label} (${time})`;
}

export function formatTreeTree(
  tree: MessageTree,
  activeNodeId: string,
  selectedNodeId?: string
): string {
  const lines: string[] = [];
  
  const traverse = (nodeId: string, indent: string = ''): void => {
    const node = tree.getNode(nodeId);
    if (!node) return;
    
    const isActive = nodeId === activeNodeId;
    const isSelected = nodeId === selectedNodeId;
    const roleLabel = node.role.padEnd(10);
    const preview = node.content.slice(0, 40).replace(/\n/g, ' ');
    const marker = isActive ? '◉' : '○';
    const label = node.label ? ` [${node.label}]` : '';
    
    lines.push(`${indent}${marker} ${roleLabel} ${preview}${node.content.length > 40 ? '...' : ''}${label}`);
    
    for (const childId of node.children) {
      traverse(childId, indent + '  ');
    }
  };
  
  traverse(tree.rootId);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Filter Utilities
// ---------------------------------------------------------------------------

export function applyFilter(
  nodes: Array<{ role: string; content: string; label?: string }>,
  filter: TreeFilter
): typeof nodes {
  switch (filter) {
    case 'no-tools':
      return nodes.filter(n => n.role !== 'tool');
    case 'user-only':
      return nodes.filter(n => n.role === 'user');
    case 'labeled-only':
      return nodes.filter(n => n.label !== undefined);
    case 'all':
      return nodes;
    default:
      return nodes;
  }
}

export function cycleFilter(current: TreeFilter): TreeFilter {
  const filters: TreeFilter[] = ['default', 'no-tools', 'user-only', 'labeled-only', 'all'];
  const idx = filters.indexOf(current);
  return filters[(idx + 1) % filters.length];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default treeCommand;
export { formatTreeNode, formatTreeTree, applyFilter, cycleFilter };
