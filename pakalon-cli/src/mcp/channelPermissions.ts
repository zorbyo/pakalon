/**
 * Channel Permissions
 * Handles channel-based permission callbacks for MCP tools
 */
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';

export interface ChannelPermissionCallbacks {
  onChannelPermissionRequest?: (params: ChannelPermissionRequestParams) => Promise<boolean>;
  onChannelPermissionDenied?: (params: ChannelPermissionRequestParams) => void;
}

export interface ChannelPermissionRequestParams {
  channelId: string;
  channelName: string;
  toolName: string;
  toolDescription?: string;
  inputSchema?: Record<string, unknown>;
  requestId: string;
}

export interface ChannelEntry {
  channelId: string;
  channelName: string;
  permissions: ChannelPermissions;
  lastAccessed: number;
}

export interface ChannelPermissions {
  allowedTools: string[];
  deniedTools: string[];
  autoApprove: boolean;
}

export function findChannelEntry(
  channels: Map<string, ChannelEntry>,
  channelId: string,
): ChannelEntry | undefined {
  return channels.get(channelId);
}

export function filterPermissionRelayClients(
  clients: unknown[],
  filter: (client: PermissionRelayClient) => boolean,
): PermissionRelayClient[] {
  return clients as PermissionRelayClient[];
}

export function shortRequestId(requestId: string): string {
  return requestId.substring(0, 8);
}

export function truncateForPreview(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export interface PermissionRelayClient {
  id: string;
  channelId: string;
  sendPermissionResponse: (approved: boolean, requestId: string) => void;
}

export function createChannelPermissions(
  channelId: string,
  channelName: string,
  initialPermissions?: Partial<ChannelPermissions>,
): ChannelEntry {
  return {
    channelId,
    channelName,
    permissions: {
      allowedTools: initialPermissions?.allowedTools ?? [],
      deniedTools: initialPermissions?.deniedTools ?? [],
      autoApprove: initialPermissions?.autoApprove ?? false,
    },
    lastAccessed: Date.now(),
  };
}

export function hasChannelPermission(
  channel: ChannelEntry,
  toolName: string,
): 'allowed' | 'denied' | 'unknown' {
  if (channel.permissions.deniedTools.includes(toolName)) {
    return 'denied';
  }
  if (channel.permissions.allowedTools.includes(toolName)) {
    return 'allowed';
  }
  return 'unknown';
}

export function grantChannelToolPermission(
  channel: ChannelEntry,
  toolName: string,
): void {
  if (!channel.permissions.allowedTools.includes(toolName)) {
    channel.permissions.allowedTools.push(toolName);
  }
  channel.permissions.deniedTools = channel.permissions.deniedTools.filter(
    (t) => t !== toolName,
  );
  channel.lastAccessed = Date.now();
}

export function revokeChannelToolPermission(
  channel: ChannelEntry,
  toolName: string,
): void {
  if (!channel.permissions.deniedTools.includes(toolName)) {
    channel.permissions.deniedTools.push(toolName);
  }
  channel.permissions.allowedTools = channel.permissions.allowedTools.filter(
    (t) => t !== toolName,
  );
  channel.lastAccessed = Date.now();
}