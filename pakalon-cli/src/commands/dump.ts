/**
 * /dump command - Copy plaintext transcript to clipboard
 * 
 * /dump copies a plaintext transcript to the clipboard — system prompt,
 * tools, messages, results. All three render the active root→leaf path,
 * not the whole file.
 * 
 * Features:
 * - Plaintext format
 * - System prompt included
 * - Tool definitions included
 * - Messages and results included
 * - Copies to clipboard
 */

import * as fs from 'fs';
import type { Command } from '../commands.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DumpOptions {
  /** Output file path (instead of clipboard) */
  outputPath?: string;
  /** Include system prompt */
  includeSystem?: boolean;
  /** Include tool definitions */
  includeTools?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Dump Command
// ---------------------------------------------------------------------------

function getPromptContent(args: string): string {
  const options = parseDumpArgs(args);
  
  let includeInfo = '';
  if (options.includeSystem) {
    includeInfo += '\n- System prompt';
  }
  if (options.includeTools) {
    includeInfo += '\n- Tool definitions';
  }
  
  return `## Dump Session

You are dumping the current session as plaintext.

### How /dump works:
1. Renders the active root→leaf path
2. Formats as plaintext
3. Copies to clipboard (or saves to file)

### What's included:
- Messages with roles${includeInfo || '\n- Messages only'}
- Timestamps
- Tool calls and results

### Format:
\`\`\`
[SYSTEM]
System prompt text...

[TOOLS]
tool1: description
tool2: description

[USER] 2024-01-15 10:30:00
User message content

[ASSISTANT] 2024-01-15 10:30:15
Assistant response content

[TOOL] 2024-01-15 10:30:20
Tool call result
\`\`\`

The transcript will be copied to clipboard or saved to file.`;
}

const dumpCommand: Command = {
  type: 'prompt',
  name: 'dump',
  description: 'Copy plaintext transcript to clipboard',
  progressMessage: 'dumping transcript',
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

export function parseDumpArgs(args: string): DumpOptions {
  const options: DumpOptions = {};
  
  // Parse flags
  if (args.includes('--system') || args.includes('-s')) {
    options.includeSystem = true;
  }
  if (args.includes('--tools') || args.includes('-t')) {
    options.includeTools = true;
  }
  if (args.includes('--verbose') || args.includes('-v')) {
    options.verbose = true;
  }
  
  // Parse output path
  const pathMatch = args.match(/--output\s+(\S+)/);
  if (pathMatch) {
    options.outputPath = pathMatch[1];
  }
  
  return options;
}

// ---------------------------------------------------------------------------
// Dump Operations
// ---------------------------------------------------------------------------

/**
 * Generate plaintext transcript
 */
export function generateTranscript(
  messages: Array<{
    role: string;
    content: string;
    timestamp: string;
    toolCalls?: Array<{ name: string; args: unknown; result?: unknown }>;
  }>,
  options: DumpOptions = {}
): string {
  const lines: string[] = [];
  
  for (const msg of messages) {
    const role = msg.role.toUpperCase();
    const time = new Date(msg.timestamp).toLocaleString();
    
    lines.push(`[${role}] ${time}`);
    lines.push(msg.content);
    lines.push('');
    
    // Include tool calls if verbose
    if (options.verbose && msg.toolCalls) {
      for (const tool of msg.toolCalls) {
        lines.push(`  [TOOL CALL] ${tool.name}`);
        lines.push(`  Args: ${JSON.stringify(tool.args, null, 2)}`);
        if (tool.result) {
          lines.push(`  Result: ${JSON.stringify(tool.result, null, 2)}`);
        }
        lines.push('');
      }
    }
  }
  
  return lines.join('\n');
}

/**
 * Dump transcript to file
 */
export function dumpToFile(
  transcript: string,
  outputPath: string
): { success: boolean; error?: string } {
  try {
    fs.writeFileSync(outputPath, transcript, 'utf-8');
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Copy transcript to clipboard (platform-specific)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Try different clipboard methods based on platform
    if (process.platform === 'darwin') {
      const { execSync } = await import('child_process');
      execSync('pbcopy', { input: text });
      return true;
    } else if (process.platform === 'win32') {
      const { execSync } = await import('child_process');
      execSync('clip', { input: text });
      return true;
    } else {
      // Linux - try xclip or xsel
      const { execSync } = await import('child_process');
      try {
        execSync('xclip -selection clipboard', { input: text });
        return true;
      } catch {
        try {
          execSync('xsel --clipboard --input', { input: text });
          return true;
        } catch {
          return false;
        }
      }
    }
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default dumpCommand;
export { generateTranscript, dumpToFile, copyToClipboard };
