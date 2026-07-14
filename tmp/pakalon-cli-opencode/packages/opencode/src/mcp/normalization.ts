/**
 * MCP Name Normalization
 *
 * Pure utility functions for MCP name normalization.
 * This file has no dependencies to avoid circular imports.
 */

// Claude.ai server names are prefixed with this string
const CLAUDEAI_SERVER_PREFIX = "claude.ai "

/**
 * Normalize server names to be compatible with the API pattern ^[a-zA-Z0-9_-]{1,64}$
 * Replaces any invalid characters (including dots and spaces) with underscores.
 *
 * For claude.ai servers (names starting with "claude.ai "), also collapses
 * consecutive underscores and strips leading/trailing underscores to prevent
 * interference with the __ delimiter used in MCP tool names.
 */
export function normalizeNameForMCP(name: string): string {
  let normalized = name.replace(/[^a-zA-Z0-9_-]/g, "_")
  if (name.startsWith(CLAUDEAI_SERVER_PREFIX)) {
    normalized = normalized.replace(/_+/g, "_").replace(/^_|_$/g, "")
  }
  return normalized
}

/**
 * Validate that a name is valid for MCP
 */
export function isValidMcpName(name: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name)
}

/**
 * Create a valid MCP name from any string
 */
export function toValidMcpName(name: string): string {
  const normalized = normalizeNameForMCP(name)
  // Truncate to 64 characters
  return normalized.slice(0, 64)
}

export default {
  normalizeNameForMCP,
  isValidMcpName,
  toValidMcpName,
}
