/**
 * Share Command Implementation
 * Handles sharing conversations via links, files, or clipboard
 */

import React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { logEvent } from '../../services/analytics/index.js'
import { getSessionId } from '../../bootstrap/state.js'
import { ShareDialog } from './ShareDialog.js'

export type ShareFormat = 'link' | 'markdown' | 'json' | 'html' | 'clipboard'

export interface ShareOptions {
  format: ShareFormat
  includeToolResults?: boolean
  includeSystemMessages?: boolean
  expiresIn?: '1h' | '24h' | '7d' | '30d' | 'never'
  private?: boolean
}

export interface ShareResult {
  success: boolean
  url?: string
  content?: string
  error?: string
}

/**
 * Convert messages to markdown format
 */
function messagesToMarkdown(messages: Message[], options: ShareOptions): string {
  const lines: string[] = ['# Conversation Export\n']
  
  for (const msg of messages) {
    if (msg.type === 'system' && !options.includeSystemMessages) {
      continue
    }
    
    const role = msg.type === 'user' ? '## User' : msg.type === 'assistant' ? '## Assistant' : '## System'
    lines.push(`${role}\n`)
    
    if (msg.message?.content) {
      if (typeof msg.message.content === 'string') {
        lines.push(msg.message.content)
      } else if (Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            lines.push((block as { type: 'text'; text: string }).text)
          } else if (block.type === 'tool_use' && options.includeToolResults) {
            const toolBlock = block as { type: 'tool_use'; name: string; input: unknown }
            lines.push(`\n**Tool: ${toolBlock.name}**`)
            lines.push('```json')
            lines.push(JSON.stringify(toolBlock.input, null, 2))
            lines.push('```')
          }
        }
      }
    }
    
    lines.push('\n---\n')
  }
  
  return lines.join('\n')
}

/**
 * Convert messages to JSON format
 */
function messagesToJson(messages: Message[], options: ShareOptions): string {
  const filtered = options.includeSystemMessages 
    ? messages 
    : messages.filter(m => m.type !== 'system')
  
  return JSON.stringify({
    version: '1.0',
    exportedAt: new Date().toISOString(),
    messages: filtered,
  }, null, 2)
}

/**
 * Convert messages to HTML format
 */
function messagesToHtml(messages: Message[], options: ShareOptions): string {
  const lines: string[] = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <title>Conversation Export</title>',
    '  <style>',
    '    body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }',
    '    .message { margin: 20px 0; padding: 15px; border-radius: 8px; }',
    '    .user { background: #e3f2fd; }',
    '    .assistant { background: #f5f5f5; }',
    '    .system { background: #fff3e0; opacity: 0.7; }',
    '    .role { font-weight: bold; margin-bottom: 10px; }',
    '    pre { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 4px; overflow-x: auto; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <h1>Conversation Export</h1>',
  ]
  
  for (const msg of messages) {
    if (msg.type === 'system' && !options.includeSystemMessages) {
      continue
    }
    
    const roleClass = msg.type
    const roleLabel = msg.type.charAt(0).toUpperCase() + msg.type.slice(1)
    
    lines.push(`  <div class="message ${roleClass}">`)
    lines.push(`    <div class="role">${roleLabel}</div>`)
    
    if (msg.message?.content) {
      if (typeof msg.message.content === 'string') {
        lines.push(`    <div>${escapeHtml(msg.message.content)}</div>`)
      } else if (Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            const text = (block as { type: 'text'; text: string }).text
            lines.push(`    <div>${escapeHtml(text)}</div>`)
          } else if (block.type === 'tool_use' && options.includeToolResults) {
            const toolBlock = block as { type: 'tool_use'; name: string; input: unknown }
            lines.push(`    <div><strong>Tool: ${escapeHtml(toolBlock.name)}</strong></div>`)
            lines.push(`    <pre>${escapeHtml(JSON.stringify(toolBlock.input, null, 2))}</pre>`)
          }
        }
      }
    }
    
    lines.push('  </div>')
  }
  
  lines.push('</body>')
  lines.push('</html>')
  
  return lines.join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>')
}

/**
 * Create a shareable link (placeholder - would integrate with backend)
 */
async function createShareLink(messages: Message[], options: ShareOptions): Promise<ShareResult> {
  const sessionId = getSessionId()
  
  // Log share event
  logEvent('tengu_share_created', {
    format: 'link',
    expires_in: options.expiresIn || '7d',
    private: options.private || false,
    message_count: messages.length,
  })
  
  // In a real implementation, this would:
  // 1. Send the conversation to a backend service
  // 2. Get back a shareable link
  // For now, return a mock response
  
  return {
    success: true,
    url: `https://pakalon.share/${sessionId}?expires=${options.expiresIn || '7d'}`,
  }
}

/**
 * Parse share arguments
 */
function parseShareArgs(args: string): Partial<ShareOptions> {
  const parts = args.trim().toLowerCase().split(/\s+/)
  const options: Partial<ShareOptions> = {}
  
  for (const part of parts) {
    if (['link', 'markdown', 'json', 'html', 'clipboard'].includes(part)) {
      options.format = part as ShareFormat
    } else if (['1h', '24h', '7d', '30d', 'never'].includes(part)) {
      options.expiresIn = part as ShareOptions['expiresIn']
    } else if (part === 'private') {
      options.private = true
    } else if (part === 'with-tools') {
      options.includeToolResults = true
    } else if (part === 'with-system') {
      options.includeSystemMessages = true
    }
  }
  
  return options
}

/**
 * Main share command call function
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const parsedOptions = parseShareArgs(args)
  
  // If format is specified, execute directly
  if (parsedOptions.format) {
    const options: ShareOptions = {
      format: parsedOptions.format,
      includeToolResults: parsedOptions.includeToolResults ?? false,
      includeSystemMessages: parsedOptions.includeSystemMessages ?? false,
      expiresIn: parsedOptions.expiresIn ?? '7d',
      private: parsedOptions.private ?? false,
    }
    
    const result = await executeShare(context.messages, options)
    
    if (result.success) {
      if (result.url) {
        onDone(`Share link created: ${result.url}`, { display: 'system' })
      } else if (result.content) {
        onDone(`Content exported successfully (${result.content.length} characters)`, { display: 'system' })
      }
    } else {
      onDone(`Share failed: ${result.error || 'Unknown error'}`, { display: 'system' })
    }
    
    return null
  }
  
  // Show interactive dialog
  return (
    <ShareDialog
      messages={context.messages}
      onShare={async (options) => {
        const result = await executeShare(context.messages, options)
        
        if (result.success) {
          if (result.url) {
            onDone(`Share link created: ${result.url}`, { display: 'system' })
          } else {
            onDone('Content shared successfully!', { display: 'system' })
          }
        } else {
          onDone(`Share failed: ${result.error || 'Unknown error'}`, { display: 'system' })
        }
      }}
      onCancel={() => {
        onDone('Share cancelled.', { display: 'system' })
      }}
    />
  )
}

/**
 * Execute the share action
 */
async function executeShare(messages: Message[], options: ShareOptions): Promise<ShareResult> {
  logEvent('tengu_share_started', {
    format: options.format,
    message_count: messages.length,
  })
  
  try {
    switch (options.format) {
      case 'link':
        return createShareLink(messages, options)
        
      case 'markdown':
        return {
          success: true,
          content: messagesToMarkdown(messages, options),
        }
        
      case 'json':
        return {
          success: true,
          content: messagesToJson(messages, options),
        }
        
      case 'html':
        return {
          success: true,
          content: messagesToHtml(messages, options),
        }
        
      case 'clipboard':
        const markdown = messagesToMarkdown(messages, options)
        // In a real implementation, this would copy to clipboard
        return {
          success: true,
          content: markdown,
        }
        
      default:
        return {
          success: false,
          error: `Unknown format: ${options.format}`,
        }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export { executeShare, messagesToMarkdown, messagesToJson, messagesToHtml }
