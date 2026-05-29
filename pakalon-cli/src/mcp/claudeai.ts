/**
 * Claude AI MCP Integration
 * Handles MCP functionality specific to claude.ai integration
 */

let claudeAiMcpConnectedServers: Set<string> = new Set();

export function markClaudeAiMcpConnected(name: string): void {
  claudeAiMcpConnectedServers.add(name);
}

export function isClaudeAiMcpConnected(name: string): boolean {
  return claudeAiMcpConnectedServers.has(name);
}

export function clearClaudeAiMcpConnections(): void {
  claudeAiMcpConnectedServers.clear();
}

export function getConnectedClaudeAiMcpServers(): string[] {
  return Array.from(claudeAiMcpConnectedServers);
}

export function removeClaudeAiMcpConnection(name: string): void {
  claudeAiMcpConnectedServers.delete(name);
}