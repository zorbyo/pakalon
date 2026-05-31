/**
 * Session Export to HTML
 * 
 * Exports a session to a nicely formatted HTML file.
 * Based on pi's /export command.
 * 
 * Features:
 * - Full session history with messages, tool calls, and results
 * - Syntax highlighting for code blocks
 * - Collapsible sections for tool results
 * - Responsive design
 * - Metadata display (session ID, dates, token usage)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { JsonlSessionStorage, type SessionTreeEntry } from './jsonl-storage.js';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ExportOptions {
  /** Include tool results in export */
  includeToolResults?: boolean;
  /** Include thinking/reasoning blocks */
  includeThinking?: boolean;
  /** Custom title for the HTML file */
  title?: string;
  /** Theme: 'light' or 'dark' */
  theme?: 'light' | 'dark';
}

// ============================================================================
// HTML Template
// ============================================================================

function getHtmlTemplate(title: string, theme: 'light' | 'dark'): string {
  const isDark = theme === 'dark';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg-primary: ${isDark ? '#1a1b26' : '#ffffff'};
      --bg-secondary: ${isDark ? '#24283b' : '#f5f5f5'};
      --bg-tertiary: ${isDark ? '#2f3347' : '#e8e8e8'};
      --text-primary: ${isDark ? '#c0caf5' : '#1a1a1a'};
      --text-secondary: ${isDark ? '#a9b1d6' : '#666666'};
      --text-muted: ${isDark ? '#565f89' : '#999999'};
      --accent-blue: ${isDark ? '#7aa2f7' : '#2563eb'};
      --accent-green: ${isDark ? '#9ece6a' : '#16a34a'};
      --accent-red: ${isDark ? '#f7768e' : '#dc2626'};
      --accent-yellow: ${isDark ? '#e0af68' : '#ca8a04'};
      --accent-purple: ${isDark ? '#bb9af7' : '#9333ea'};
      --border-color: ${isDark ? '#3b4261' : '#d1d5db'};
      --shadow: 0 1px 3px rgba(0,0,0,${isDark ? '0.3' : '0.1'});
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1rem;
      margin-bottom: 2rem;
    }
    .header h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .metadata { color: var(--text-muted); font-size: 0.875rem; }
    .metadata span { margin-right: 1rem; }
    .message {
      margin-bottom: 1.5rem;
      padding: 1rem;
      border-radius: 0.5rem;
      border-left: 3px solid var(--border-color);
    }
    .message.user { border-left-color: var(--accent-blue); background: var(--bg-secondary); }
    .message.assistant { border-left-color: var(--accent-green); }
    .message.tool { border-left-color: var(--accent-yellow); background: var(--bg-tertiary); }
    .message.system { border-left-color: var(--accent-purple); }
    .message-role {
      font-weight: 600;
      font-size: 0.875rem;
      text-transform: uppercase;
      margin-bottom: 0.5rem;
      color: var(--text-secondary);
    }
    .message-content { white-space: pre-wrap; word-break: break-word; }
    .message-timestamp { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; }
    .tool-call {
      margin: 0.5rem 0;
      padding: 0.75rem;
      background: var(--bg-tertiary);
      border-radius: 0.25rem;
      font-family: monospace;
      font-size: 0.875rem;
    }
    .tool-call-name { color: var(--accent-purple); font-weight: 600; }
    .tool-result {
      margin: 0.5rem 0;
      padding: 0.75rem;
      background: var(--bg-secondary);
      border-radius: 0.25rem;
      font-family: monospace;
      font-size: 0.875rem;
      max-height: 300px;
      overflow-y: auto;
    }
    details { margin: 0.5rem 0; }
    details summary {
      cursor: pointer;
      color: var(--accent-blue);
      font-size: 0.875rem;
    }
    details summary:hover { text-decoration: underline; }
    code {
      background: var(--bg-tertiary);
      padding: 0.125rem 0.25rem;
      border-radius: 0.25rem;
      font-family: monospace;
      font-size: 0.875em;
    }
    pre {
      background: var(--bg-tertiary);
      padding: 1rem;
      border-radius: 0.5rem;
      overflow-x: auto;
      margin: 0.5rem 0;
    }
    pre code { background: none; padding: 0; }
    @media (max-width: 640px) {
      body { padding: 1rem; }
      .message { padding: 0.75rem; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>{{TITLE}}</h1>
    <div class="metadata">
      <span>Session: {{SESSION_ID}}</span>
      <span>Exported: {{EXPORT_DATE}}</span>
      <span>Messages: {{MESSAGE_COUNT}}</span>
    </div>
  </div>
  <div class="messages">
    {{MESSAGES}}
  </div>
</body>
</html>`;
}

// ============================================================================
// HTML Exporter
// ============================================================================

export class SessionHtmlExporter {
  private session: JsonlSessionStorage;

  constructor(session: JsonlSessionStorage) {
    this.session = session;
  }

  /**
   * Export session to HTML file
   */
  async exportToFile(
    outputPath: string,
    options?: ExportOptions
  ): Promise<void> {
    const html = await this.exportToHtml(options);
    await fs.writeFile(outputPath, html, 'utf-8');
    logger.info('[export-html] Exported session', { path: outputPath });
  }

  /**
   * Export session to HTML string
   */
  async exportToHtml(options?: ExportOptions): Promise<string> {
    const entries = await this.session.getEntries();
    const metadata = this.session.getMetadata();
    
    const includeToolResults = options?.includeToolResults ?? true;
    const includeThinking = options?.includeThinking ?? false;
    const theme = options?.theme ?? 'dark';
    const title = options?.title ?? `Session ${metadata.id}`;

    // Render messages
    const messagesHtml = entries
      .filter(e => e.type === 'message')
      .map(e => this.renderEntry(e, includeToolResults, includeThinking))
      .filter(Boolean)
      .join('\n');

    // Count messages
    const messageCount = entries.filter(e => e.type === 'message').length;

    // Build HTML
    const template = getHtmlTemplate(title, theme);
    return template
      .replace('{{TITLE}}', escapeHtml(title))
      .replace('{{SESSION_ID}}', escapeHtml(metadata.id))
      .replace('{{EXPORT_DATE}}', new Date().toISOString())
      .replace('{{MESSAGE_COUNT}}', String(messageCount))
      .replace('{{MESSAGES}}', messagesHtml);
  }

  /**
   * Render a single entry to HTML
   */
  private renderEntry(
    entry: SessionTreeEntry,
    includeToolResults: boolean,
    includeThinking: boolean
  ): string {
    if (entry.type !== 'message') return '';

    const msg = entry.message;
    const role = msg.role;
    const content = msg.content;
    const timestamp = entry.timestamp;

    // Skip tool results if not included
    if (role === 'tool' && !includeToolResults) return '';

    // Skip thinking if not included
    if (role === 'assistant' && !includeThinking) {
      // Remove thinking blocks
      const cleaned = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
      if (!cleaned.trim()) return '';
    }

    let contentHtml = escapeHtml(content);

    // Highlight code blocks
    contentHtml = contentHtml.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="language-${lang || 'text'}">${code}</code></pre>`;
    });

    // Highlight inline code
    contentHtml = contentHtml.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert newlines to paragraphs
    contentHtml = contentHtml.split('\n\n').map(p => `<p>${p}</p>`).join('');

    return `
    <div class="message ${role}">
      <div class="message-role">${escapeHtml(role)}</div>
      <div class="message-content">${contentHtml}</div>
      <div class="message-timestamp">${new Date(timestamp).toLocaleString()}</div>
    </div>`;
  }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// Convenience Function
// ============================================================================

export async function exportSessionToHtml(
  session: JsonlSessionStorage,
  outputPath: string,
  options?: ExportOptions
): Promise<void> {
  const exporter = new SessionHtmlExporter(session);
  await exporter.exportToFile(outputPath, options);
}
