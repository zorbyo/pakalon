/**
 * IRC - Inter-agent Communication
 * 
 * The irc tool delivers short prose messages between live agents
 * in the same process. The main agent is 0-Main; subagents reuse
 * their task id prefixed with their process slot, e.g. 2-AuthMap.
 * 
 * Features:
 * - op: "list" - enumerate currently visible peers
 * - op: "send" - deliver message to a peer or "all"
 * - Synchronous reply for direct messages
 * - Asymmetric handshake pattern for reliable communication
 * - Gated by irc.enabled config
 */

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IRCOperation = 'list' | 'send' | 'status' | 'broadcast';

export interface IRCMessage {
  id: string;
  from: string;
  to: string; // Peer ID or "all"
  content: string;
  timestamp: number;
  replyTo?: string;
  synchronous: boolean;
}

export interface IRCPeer {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'exiting';
  lastSeen: number;
  capabilities: string[];
}

export interface IRCChannel {
  id: string;
  name: string;
  peers: Set<string>;
  messages: IRCMessage[];
}

export interface IRCResult {
  success: boolean;
  messages?: IRCMessage[];
  peers?: IRCPeer[];
  error?: string;
}

// ---------------------------------------------------------------------------
// IRC Manager
// ---------------------------------------------------------------------------

export class IRCManager {
  private peers: Map<string, IRCPeer> = new Map();
  private channels: Map<string, IRCChannel> = new Map();
  private messageQueue: Map<string, IRCMessage[]> = new Map();
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
    // Create default channel
    this.channels.set('main', {
      id: 'main',
      name: 'Main Channel',
      peers: new Set(),
      messages: [],
    });
  }

  /**
   * Check if IRC is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable/disable IRC
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Register a peer
   */
  registerPeer(peer: IRCPeer): void {
    this.peers.set(peer.id, peer);
    // Add to main channel
    const mainChannel = this.channels.get('main');
    if (mainChannel) {
      mainChannel.peers.add(peer.id);
    }
  }

  /**
   * Unregister a peer
   */
  unregisterPeer(peerId: string): void {
    this.peers.delete(peerId);
    // Remove from all channels
    for (const channel of this.channels.values()) {
      channel.peers.delete(peerId);
    }
  }

  /**
   * List all visible peers
   */
  listPeers(): IRCPeer[] {
    return Array.from(this.peers.values()).filter(p => p.status !== 'exiting');
  }

  /**
   * Get peer by ID
   */
  getPeer(peerId: string): IRCPeer | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Send a message to a peer or broadcast
   */
  sendMessage(
    from: string,
    to: string,
    content: string,
    synchronous = false
  ): IRCResult {
    if (!this.enabled) {
      return { success: false, error: 'IRC is disabled' };
    }

    const message: IRCMessage = {
      id: randomUUID(),
      from,
      to,
      content,
      timestamp: Date.now(),
      synchronous,
    };

    // Handle broadcast
    if (to === 'all') {
      for (const peer of this.peers.values()) {
        if (peer.id !== from && peer.status === 'active') {
          const peerMessages = this.messageQueue.get(peer.id) || [];
          peerMessages.push(message);
          this.messageQueue.set(peer.id, peerMessages);
        }
      }
      return { success: true, messages: [message] };
    }

    // Handle direct message
    const targetPeer = this.peers.get(to);
    if (!targetPeer) {
      return { success: false, error: `Peer not found: ${to}` };
    }

    if (targetPeer.status === 'exiting') {
      return { success: false, error: `Peer is not available via IRC: ${to}` };
    }

    // Add to target's queue
    const peerMessages = this.messageQueue.get(to) || [];
    peerMessages.push(message);
    this.messageQueue.set(to, peerMessages);

    return { success: true, messages: [message] };
  }

  /**
   * Receive messages for a peer
   */
  receiveMessages(peerId: string): IRCMessage[] {
    const messages = this.messageQueue.get(peerId) || [];
    this.messageQueue.delete(peerId);
    return messages;
  }

  /**
   * Get message history for a channel
   */
  getChannelMessages(channelId: string, limit = 50): IRCMessage[] {
    const channel = this.channels.get(channelId);
    if (!channel) return [];
    return channel.messages.slice(-limit);
  }

  /**
   * Send message to a channel
   */
  sendToChannel(
    channelId: string,
    from: string,
    content: string
  ): IRCResult {
    if (!this.enabled) {
      return { success: false, error: 'IRC is disabled' };
    }

    const channel = this.channels.get(channelId);
    if (!channel) {
      return { success: false, error: `Channel not found: ${channelId}` };
    }

    const message: IRCMessage = {
      id: randomUUID(),
      from,
      to: channelId,
      content,
      timestamp: Date.now(),
      synchronous: false,
    };

    channel.messages.push(message);

    // Keep only last 100 messages
    if (channel.messages.length > 100) {
      channel.messages = channel.messages.slice(-100);
    }

    // Deliver to all peers in channel
    for (const peerId of channel.peers) {
      if (peerId !== from) {
        const peerMessages = this.messageQueue.get(peerId) || [];
        peerMessages.push(message);
        this.messageQueue.set(peerId, peerMessages);
      }
    }

    return { success: true, messages: [message] };
  }

  /**
   * Create a new channel
   */
  createChannel(id: string, name: string): IRCChannel {
    const channel: IRCChannel = {
      id,
      name,
      peers: new Set(),
      messages: [],
    };
    this.channels.set(id, channel);
    return channel;
  }

  /**
   * Join a channel
   */
  joinChannel(channelId: string, peerId: string): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) return false;
    channel.peers.add(peerId);
    return true;
  }

  /**
   * Leave a channel
   */
  leaveChannel(channelId: string, peerId: string): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) return false;
    channel.peers.delete(peerId);
    return true;
  }

  /**
   * Get peer status
   */
  getPeerStatus(peerId: string): IRCPeer | undefined {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.lastSeen = Date.now();
    }
    return peer;
  }

  /**
   * Mark peer as exiting
   */
  markExiting(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.status = 'exiting';
    }
  }

  /**
   * Cleanup stale peers
   */
  cleanupStalePeers(staleThresholdMs = 300000): void {
    const now = Date.now();
    for (const [peerId, peer] of this.peers) {
      if (now - peer.lastSeen > staleThresholdMs) {
        this.peers.delete(peerId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let defaultManager: IRCManager | null = null;

export function getIRCManager(enabled?: boolean): IRCManager {
  if (!defaultManager) {
    defaultManager = new IRCManager(enabled);
  }
  return defaultManager;
}

export function resetIRCManager(): void {
  defaultManager = null;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const ircToolDefinition = {
  name: 'irc',
  description: 'Send messages between agents in the same process',
  inputSchema: {
    type: 'object' as const,
    properties: {
      op: {
        type: 'string',
        enum: ['list', 'send', 'status'],
        description: 'Operation to perform',
      },
      to: {
        type: 'string',
        description: 'Target peer ID or "all" for broadcast',
      },
      message: {
        type: 'string',
        description: 'Message content',
      },
      synchronous: {
        type: 'boolean',
        description: 'Wait for synchronous reply (default: false)',
        default: false,
      },
    },
    required: ['op'],
  },
  isReadOnly: false,
  isConcurrencySafe: false,

  async execute(input: { op: string; to?: string; message?: string; synchronous?: boolean }) {
    const manager = getIRCManager();

    switch (input.op) {
      case 'list': {
        const peers = manager.listPeers();
        return {
          count: peers.length,
          peers: peers.map(p => ({
            id: p.id,
            name: p.name,
            status: p.status,
            lastSeen: new Date(p.lastSeen).toISOString(),
          })),
        };
      }

      case 'send': {
        if (!input.to || !input.message) {
          return { error: 'to and message required for send' };
        }
        const result = manager.sendMessage(
          '0-Main', // Main agent ID
          input.to,
          input.message,
          input.synchronous
        );
        return result;
      }

      case 'status': {
        if (!input.to) {
          return { error: 'to required for status' };
        }
        const peer = manager.getPeerStatus(input.to);
        if (!peer) {
          return { error: `Peer not found: ${input.to}` };
        }
        return {
          peer: {
            id: peer.id,
            name: peer.name,
            status: peer.status,
            lastSeen: new Date(peer.lastSeen).toISOString(),
          },
        };
      }

      default:
        return { error: `Unknown operation: ${input.op}` };
    }
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  IRCManager,
  getIRCManager,
  resetIRCManager,
  ircToolDefinition,
};
