/**
 * IRC Tool
 * 
 * Inter-agent communication via short prose messages.
 * Based on OMP's irc tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

interface IRCMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  read: boolean;
}

interface IRCChannel {
  name: string;
  participants: string[];
  messages: IRCMessage[];
}

// ============================================================================
// IRC Manager
// ============================================================================

class IRCManager {
  private channels: Map<string, IRCChannel> = new Map();
  private messages: IRCMessage[] = [];
  private maxMessages: number = 1000;

  /**
   * Send a message to a channel
   */
  send(
    channel: string,
    from: string,
    content: string
  ): IRCMessage {
    const message: IRCMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from,
      to: channel,
      content,
      timestamp: Date.now(),
      read: false,
    };

    this.messages.push(message);
    this.cleanupOldMessages();

    // Add to channel
    let channelObj = this.channels.get(channel);
    if (!channelObj) {
      channelObj = { name: channel, participants: [from], messages: [] };
      this.channels.set(channel, channelObj);
    }
    channelObj.messages.push(message);
    if (!channelObj.participants.includes(from)) {
      channelObj.participants.push(from);
    }

    logger.debug('[irc] Sent message', { channel, from, contentLength: content.length });

    return message;
  }

  /**
   * Read messages from a channel
   */
  read(
    channel: string,
    options?: {
      limit?: number;
      since?: number;
      markAsRead?: boolean;
    }
  ): IRCMessage[] {
    const limit = options?.limit || 50;
    const since = options?.since || 0;
    const markAsRead = options?.markAsRead ?? true;

    const channelMessages = this.messages
      .filter(m => m.to === channel && m.timestamp > since)
      .slice(-limit);

    if (markAsRead) {
      for (const msg of channelMessages) {
        msg.read = true;
      }
    }

    return channelMessages;
  }

  /**
   * Get unread messages
   */
  getUnread(channel?: string): IRCMessage[] {
    return this.messages.filter(m => !m.read && (!channel || m.to === channel));
  }

  /**
   * List channels
   */
  listChannels(): IRCChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get channel info
   */
  getChannel(name: string): IRCChannel | undefined {
    return this.channels.get(name);
  }

  /**
   * Join a channel
   */
  join(channel: string, participant: string): void {
    let channelObj = this.channels.get(channel);
    if (!channelObj) {
      channelObj = { name: channel, participants: [], messages: [] };
      this.channels.set(channel, channelObj);
    }
    if (!channelObj.participants.includes(participant)) {
      channelObj.participants.push(participant);
    }
  }

  /**
   * Leave a channel
   */
  leave(channel: string, participant: string): void {
    const channelObj = this.channels.get(channel);
    if (channelObj) {
      channelObj.participants = channelObj.participants.filter(p => p !== participant);
      if (channelObj.participants.length === 0) {
        this.channels.delete(channel);
      }
    }
  }

  /**
   * Cleanup old messages
   */
  private cleanupOldMessages(): void {
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  /**
   * Clear all messages and channels
   */
  clear(): void {
    this.messages = [];
    this.channels.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let ircManagerInstance: IRCManager | null = null;

function getIRCManager(): IRCManager {
  if (!ircManagerInstance) {
    ircManagerInstance = new IRCManager();
  }
  return ircManagerInstance;
}

// ============================================================================
// IRC Tool
// ============================================================================

const ircInputSchema = z.object({
  action: z.enum(['send', 'read', 'unread', 'list', 'join', 'leave']).describe('IRC action to perform'),
  channel: z.string().describe('Channel name'),
  content: z.string().optional().describe('Message content (for send)'),
  from: z.string().optional().describe('Sender name'),
  limit: z.number().optional().default(50).describe('Max messages to read'),
  since: z.number().optional().describe('Read messages since timestamp'),
});

export const ircTool = buildTool({
  name: 'irc',
  description: 'Inter-agent communication via short prose messages on channels.',
  inputSchema: ircInputSchema,
  isReadOnly: false,
  isConcurrencySafe: true,
  requiresUserInteraction: false,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { action, channel, content, from, limit, since } = args;
    
    try {
      const manager = getIRCManager();
      const sender = from || ctx.agentId?.id || 'user';
      
      switch (action) {
        case 'send': {
          if (!content) {
            return { data: 'content is required for send action' };
          }
          const message = manager.send(channel, sender, content);
          return { data: `Message sent to ${channel} (ID: ${message.id})` };
        }
        
        case 'read': {
          const messages = manager.read(channel, { limit, since });
          if (messages.length === 0) {
            return { data: `No messages in ${channel}` };
          }
          const formatted = messages.map(m => {
            const time = new Date(m.timestamp).toISOString();
            return `[${time}] ${m.from}: ${m.content}`;
          }).join('\n');
          return { data: `Messages in ${channel}:\n${formatted}` };
        }
        
        case 'unread': {
          const unread = manager.getUnread(channel);
          if (unread.length === 0) {
            return { data: 'No unread messages' };
          }
          const formatted = unread.map(m => {
            const time = new Date(m.timestamp).toISOString();
            return `[${m.to}] ${m.from}: ${m.content}`;
          }).join('\n');
          return { data: `Unread messages:\n${formatted}` };
        }
        
        case 'list': {
          const channels = manager.listChannels();
          if (channels.length === 0) {
            return { data: 'No channels' };
          }
          const list = channels.map(c => `${c.name} (${c.participants.length} participants, ${c.messages.length} messages)`).join('\n');
          return { data: `Channels:\n${list}` };
        }
        
        case 'join': {
          manager.join(channel, sender);
          return { data: `Joined ${channel}` };
        }
        
        case 'leave': {
          manager.leave(channel, sender);
          return { data: `Left ${channel}` };
        }
        
        default:
          return { data: `Unknown action: ${action}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[irc] Command failed', { error: message });
      return { data: `IRC command failed: ${message}` };
    }
  },
  
  userFacingName: () => 'IRC',
  
  renderToolUseMessage: (input) => {
    const action = typeof input.action === 'string' ? input.action : 'unknown';
    const channel = typeof input.channel === 'string' ? input.channel : '';
    return `IRC ${action}: ${channel}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
