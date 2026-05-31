/**
 * /export command - Export session as HTML
 * 
 * /export [path] and omp --export <file> write a self-contained HTML rendering.
 * All three render the active root→leaf path, not the whole file. Branches
 * you abandoned with /tree won't appear in the HTML.
 * 
 * Features:
 * - Self-contained HTML output
 * - Active path only (no abandoned branches)
 * - Styled with embedded CSS
 * - Shareable via file
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Command } from '../commands.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** Output file path */
  outputPath?: string;
  /** Include full tree (not just active path) */
  fullTree?: boolean;
  /** Format: html, json, markdown */
  format?: 'html' | 'json' | 'markdown';
}

// ---------------------------------------------------------------------------
// Export Command
// ---------------------------------------------------------------------------

function getPromptContent(args: string): string {
  const options = parseExportArgs(args);
  
  let formatInfo = '';
  if (options.format) {
    formatInfo = `\nFormat: ${options.format}`;
  }
  
  let pathInfo = '';
  if (options.outputPath) {
    pathInfo = `\nOutput: ${options.outputPath}`;
  }
  
  return `## Export Session

You are exporting the current session.

### How /export works:
1. Renders the active root→leaf path
2. Excludes abandoned branches
3. Creates self-contained output
4. Saves to file or clipboard

### Current:${formatInfo}${pathInfo}

### Export formats:
- HTML: Self-contained, styled, shareable
- JSON: Raw session data
- Markdown: Plain text with formatting

### What's included:
- Active conversation path only
- Messages with roles and timestamps
- Tool calls and results
- Labels and metadata

### What's excluded:
- Abandoned branches (use /tree to see them)
- System internals
- Temporary state

The export will be saved to the specified path or default location.`;
}

const exportCommand: Command = {
  type: 'prompt',
  name: 'export',
  description: 'Export session as HTML, JSON, or Markdown',
  progressMessage: 'exporting session',
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

export function parseExportArgs(args: string): ExportOptions {
  const options: ExportOptions = {};
  
  // Parse format
  const formatMatch = args.match(/--format\s+(html|json|markdown)/);
  if (formatMatch) {
    options.format = formatMatch[1] as ExportOptions['format'];
  }
  
  // Parse full tree flag
  if (args.includes('--full') || args.includes('-f')) {
    options.fullTree = true;
  }
  
  // Parse output path (remaining after flags)
  const remaining = args.replace(/--\S+(\s+\S+)?/g, '').trim();
  if (remaining) {
    options.outputPath = remaining;
  }
  
  return options;
}

// ---------------------------------------------------------------------------
// Export Operations
// ---------------------------------------------------------------------------

/**
 * Export session to HTML
 */
export function exportToHtml(
  messages: Array<{ role: string; content: string; timestamp: string }>,
  outputPath: string
): { success: boolean; path?: string; error?: string } {
  try {
    const html = generateHtml(messages);
    fs.writeFileSync(outputPath, html, 'utf-8');
    return { success: true, path: outputPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate HTML from messages
 */
function generateHtml(messages: Array<{ role: string; content: string; timestamp: string }>): string {
  const messageHtml = messages.map(msg => {
    const roleClass = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system';
    const roleLabel = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    const time = new Date(msg.timestamp).toLocaleString();
    
    return `
      <div class="message ${roleClass}">
        <div class="header">
          <span class="role">${roleLabel}</span>
          <span class="time">${time}</span>
        </div>
        <div class="content">${escapeHtml(msg.content)}</div>
      </div>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Export</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .message {
      background: white;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .message.user {
      border-left: 4px solid #2196F3;
    }
    .message.assistant {
      border-left: 4px solid #4CAF50;
    }
    .message.system {
      border-left: 4px solid #9E9E9E;
    }
    .header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 0.9em;
    }
    .role {
      font-weight: bold;
      color: #333;
    }
    .time {
      color: #666;
    }
    .content {
      white-space: pre-wrap;
      line-height: 1.5;
    }
    h1 {
      text-align: center;
      color: #333;
    }
  </style>
</head>
<body>
  <h1>Session Export</h1>
  <p>Exported: ${new Date().toLocaleString()}</p>
  <p>Messages: ${messages.length}</p>
  ${messageHtml}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default exportCommand;
export { exportToHtml };
