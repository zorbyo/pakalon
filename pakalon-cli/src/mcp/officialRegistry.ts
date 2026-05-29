/**
 * Official MCP Registry
 * Registry of official/verified MCP servers
 */
import type { McpServerDefinition } from './types.js';

export interface OfficialMcpServer {
  name: string;
  description: string;
  publisher: string;
  verified: boolean;
  tools: string[];
  tags: string[];
}

const officialServers: Map<string, OfficialMcpServer> = new Map();

export function registerOfficialServer(server: OfficialMcpServer): void {
  officialServers.set(server.name, server);
}

export function getOfficialServer(name: string): OfficialMcpServer | undefined {
  return officialServers.get(name);
}

export function listOfficialServers(): OfficialMcpServer[] {
  return Array.from(officialServers.values());
}

export function isOfficialServer(name: string): boolean {
  return officialServers.has(name);
}

export function getVerifiedServers(): OfficialMcpServer[] {
  return listOfficialServers().filter((s) => s.verified);
}

export function searchServers(query: string): OfficialMcpServer[] {
  const lowerQuery = query.toLowerCase();
  return listOfficialServers().filter(
    (s) =>
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery) ||
      s.tags.some((t) => t.toLowerCase().includes(lowerQuery)),
  );
}

export function initializeOfficialRegistry(): void {
  registerOfficialServer({
    name: 'filesystem',
    description: 'File system operations',
    publisher: 'Official',
    verified: true,
    tools: ['read_file', 'write_file', 'list_directory'],
    tags: ['filesystem', 'io'],
  });

  registerOfficialServer({
    name: 'git',
    description: 'Git operations',
    publisher: 'Official',
    verified: true,
    tools: ['git_status', 'git_log', 'git_diff'],
    tags: ['git', 'vcs'],
  });
}

initializeOfficialRegistry();