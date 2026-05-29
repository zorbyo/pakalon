/**
 * Tool Rendering & Interrupt System
 *
 * Provides:
 * 1. Tool result rendering — formats tool results into user-visible messages
 * 2. Tool call rendering — formats tool calls for display in conversation
 * 3. Interrupt handling — search-read fallback when tools take too long
 * 4. Content replacement — allow tool results to be replaced for context savings
 */

import type { ToolResultReplacement, ContentReplacementState } from "./tool-types.js";
import type { ToolDefinition } from "./executor.js";

// ============================================================================
// Tool Call Rendering
// ============================================================================

/**
 * Render a tool call into a human-readable description.
 *
 * @param toolName The name of the tool being called
 * @param args The arguments passed to the tool
 * @returns A human-readable description of the tool call
 */
export function renderToolCallMessage(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const argString = Object.entries(args)
    .map(([key, value]) => {
      const val =
        typeof value === "string"
          ? value.length > 80
            ? value.slice(0, 80) + "..."
            : value
          : JSON.stringify(value);
      return `${key}: ${val}`;
    })
    .join(", ");

  return `**Tool: ${toolName}**${argString ? `\n${argString}` : ""}`;
}

/**
 * Render a tool result into a user-visible message.
 * Handles different result formats (text, error, etc).
 *
 * @param toolName The name of the tool
 * @param result The result from the tool execution
 * @returns A formatted result string
 */
export function renderToolResultMessage(
  toolName: string,
  result: unknown,
): string {
  if (result === null || result === undefined) {
    return `[${toolName}: empty result]`;
  }

  if (typeof result === "string") {
    if (result.length > 500) {
      return `[${toolName}: ${result.length} chars]`;
    }
    return result;
  }

  if (result instanceof Error) {
    return `[${toolName}: ${result.message}]`;
  }

  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (obj.error) {
      return `[${toolName} error: ${obj.error}]`;
    }
    if (obj.output) {
      return String(obj.output);
    }
  }

  const serialized = JSON.stringify(result, null, 2);
  if (serialized.length > 500) {
    return `[${toolName}: structured result (${serialized.length} chars)]`;
  }
  return serialized;
}

// ============================================================================
// Content Replacement
// ============================================================================

/**
 * Apply content replacement to a tool result.
 * This allows long tool results to be replaced with shortened versions
 * during compaction or context management.
 *
 * @param originalText The original tool result text
 * @param toolUseId The ID of the tool use
 * @param contentState The current content replacement state
 * @returns The replacement text, or the original if no replacement exists
 */
export function applyContentReplacement(
  originalText: string,
  toolUseId: string,
  contentState?: ContentReplacementState,
): string {
  if (!contentState) return originalText;

  const replacement = contentState.replacements.get(toolUseId);
  if (!replacement) return originalText;

  // Apply the replacement at the start of the text
  if (originalText.startsWith(replacement.originalText)) {
    return (
      replacement.replacementText + originalText.slice(replacement.originalText.length)
    );
  }

  return originalText;
}

/**
 * Create a content replacement entry for a tool result.
 *
 * @param originalText The original text to replace
 * @param replacementText The replacement text
 * @param toolUseId The ID of the tool use
 * @returns A ToolResultReplacement entry
 */
export function createContentReplacement(
  originalText: string,
  replacementText: string,
  toolUseId: string,
): ToolResultReplacement {
  return {
    originalText,
    replacementText,
    toolUseId,
  };
}

// ============================================================================
// Interrupt & Search-Read Fallback
// ============================================================================

/**
 * Check if a tool execution should be interrupted and fall back to
 * search+read behavior. This is triggered when:
 *   - The tool has been running for too long
 *   - Multiple sequential tool denials occur
 *   - The user explicitly requests interruption
 *
 * @param toolName The tool being executed
 * @param durationMs How long the tool has been running
 * @param denialCount Number of consecutive denials
 * @param maxDurationMs Maximum allowed duration before interrupt (default: 30s)
 * @returns Whether the tool should be interrupted
 */
export function shouldInterruptTool(
  toolName: string,
  durationMs: number,
  denialCount: number = 0,
  maxDurationMs: number = 30000,
): boolean {
  // If too many denials, interrupt to avoid repeated failed attempts
  if (denialCount >= 3) return true;

  // If the tool has been running too long, interrupt
  if (durationMs > maxDurationMs) {
    // Read-only tools get more time
    const readOnlyTools = [
      "read",
      "grep",
      "glob",
      "search",
      "list",
      "lsp",
    ];
    const isReadOnly = readOnlyTools.some((prefix) =>
      toolName.toLowerCase().startsWith(prefix),
    );
    if (!isReadOnly) return true;
  }

  return false;
}

/**
 * Generate a search-read suggestion message when a tool is interrupted.
 * Guides the model to use smaller, targeted searches instead of
 * broad operations.
 *
 * @param toolName The tool that was interrupted
 * @param reason Why the tool was interrupted
 * @returns A message to insert into the conversation
 */
export function generateSearchReadSuggestion(
  toolName: string,
  reason: string,
): string {
  return (
    `[Interrupted: ${toolName} — ${reason}]\n` +
    `Rather than running broad operations, try:\n` +
    `1. Use **GrepSearch**/\`ripgrep\` for targeted content search\n` +
    `2. Use **Glob** to find files by name patterns\n` +
    `3. Use **Read** to read specific files\n` +
    `4. Use **LSP** for code navigation (definitions, references)\n` +
    `Break the task into smaller, focused operations.`
  );
}

/**
 * Format tool use for display in the conversation transcript.
 *
 * @param toolName Tool name
 * @param args Tool arguments
 * @returns Formatted tool use string
 */
export function formatToolUse(toolName: string, args: Record<string, unknown>): string {
  const lines: string[] = [`[Using ${toolName}]`];
  for (const [key, value] of Object.entries(args)) {
    if (key === "command" || key === "content") {
      const str = String(value);
      if (str.length > 200) {
        lines.push(`  ${key}: ${str.slice(0, 200)}...`);
      } else {
        lines.push(`  ${key}: ${str}`);
      }
    } else {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Format tool result for display in the conversation transcript.
 *
 * @param toolName Tool name
 * @param result Tool result
 * @param truncateAt Maximum length before truncation (default: 1000)
 * @returns Formatted result string
 */
export function formatToolResult(
  toolName: string,
  result: unknown,
  truncateAt: number = 1000,
): string {
  const text = renderToolResultMessage(toolName, result);
  if (text.length > truncateAt) {
    return `[${toolName}] ${text.slice(0, truncateAt)}...\n[Result truncated (${text.length} total chars)]`;
  }
  return `[${toolName}] ${text}`;
}
