/**
 * @mention Parser - Detects and parses @agentname mentions from user messages
 *
 * This module provides functionality to:
 * 1. Extract @mentions from messages (e.g., "@explorer look at the codebase")
 * 2. Detect agent names from mentions
 * 3. Split the message into agent task and regular text
 *
 * In Claude Code, @mentions invoke specific agents. For example:
 *   "@explorer analyze this code" → spawns explorer agent with the task
 *   "@code why is this broken" → spawns coder agent with the question
 *
 * The remaining non-mention text can either:
 * - Be sent to the invoked agent as additional context
 * - Be sent as a separate message to the main AI
 */

import type { AgentDefinition } from "@/agents/types.js";
import { getAgentDefinition, getAgentDefinitions } from "@/agents/loadAgents.js";
import { getBuiltInAgents } from "@/agents/builtInAgents.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MentionParseResult {
  /** The agent name that was mentioned (e.g., "explorer") */
  agentName: string;
  /** The task/instruction after the @mention (e.g., "look at the codebase") */
  task: string;
  /** The full mention text including @ (e.g., "@explorer") */
  mentionText: string;
  /** Start index of the mention in the original message */
  startIndex: number;
  /** End index of the mention in the original message */
  endIndex: number;
}

export interface ParsedMessage {
  /** All @mentions found in the message */
  mentions: MentionParseResult[];
  /** The message with @mentions removed (trimmed) */
  cleanMessage: string;
  /** Whether any valid agent mentions were found */
  hasValidMentions: boolean;
  /** Whether any invalid/unknown agent mentions were found */
  hasInvalidMentions: boolean;
}

// ---------------------------------------------------------------------------
// Agent Name Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an agent mention to a canonical name.
 * Handles variations like "@explorer", "@Explorer", "@explorer-agent"
 */
export function normalizeAgentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@/, "")           // Remove leading @
    .replace(/[-_\s]+/g, "-")   // Normalize separators to dashes
    .replace(/-+/g, "-")         // Collapse multiple dashes
    .trim();
}

// ---------------------------------------------------------------------------
// Agent Resolution
// ---------------------------------------------------------------------------

/**
 * Check if a mention matches a known agent
 */
export function resolveAgent(mention: string): AgentDefinition | null {
  const normalized = normalizeAgentName(mention);

  // Check built-in agents first
  const builtInAgents = getBuiltInAgents();
  for (const agent of builtInAgents) {
    const agentName = normalizeAgentName(agent.name);
    if (agentName === normalized || agentName.includes(normalized)) {
      return {
        name: agent.name,
        agentType: agent.agentType,
        description: agent.description,
      } as AgentDefinition;
    }
  }

  // Check loaded custom agents
  const customAgents = getAgentDefinitions();
  for (const agent of customAgents) {
    const agentName = normalizeAgentName(agent.name);
    if (agentName === normalized || agentName.includes(normalized)) {
      return agent;
    }
  }

  // Try exact match via getAgentDefinition
  const exactMatch = getAgentDefinition(normalized);
  if (exactMatch) {
    return exactMatch;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mention Detection Regex
// ---------------------------------------------------------------------------

// Matches @agentname patterns:
// - @explorer
// - @explorer-agent
// - @code reviewer
// - @CodeReviewer
// Does NOT match:
// - email addresses (has dot or @ later in string)
// - URLs
const MENTION_REGEX = /(?:^|\s)(@([a-zA-Z][a-zA-Z0-9_-]*))/g;

/**
 * Find all @mentions in a message
 */
export function findMentions(message: string): MentionParseResult[] {
  const results: MentionParseResult[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  const regex = new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags);

  while ((match = regex.exec(message)) !== null) {
    const fullMatch = match[0];
    const mentionText = match[1];
    const agentName = match[2];

    // Skip if we've already seen this exact mention
    if (seen.has(fullMatch)) continue;
    seen.add(fullMatch);

    // Skip email-like patterns (contain . or have @ later)
    const afterMention = message.slice(match.index + mentionText.length);
    if (mentionText.includes(".") || afterMention.includes("@")) continue;

    // Find the task text after the mention
    const mentionEnd = match.index + fullMatch.length;
    const afterMentionText = message.slice(mentionEnd).trim();

    // Task continues until:
    // - End of string
    // - Another @mention
    // - Some other logical break (handled by cleanMessage)

    results.push({
      agentName,
      task: afterMentionText,
      mentionText,
      startIndex: match.index,
      endIndex: mentionEnd,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Message Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a message and extract all @mentions and their tasks
 */
export function parseMessageWithMentions(message: string): ParsedMessage {
  const mentions = findMentions(message);
  const validMentions: MentionParseResult[] = [];
  const invalidMentions: MentionParseResult[] = [];

  // Categorize mentions as valid or invalid
  for (const mention of mentions) {
    if (resolveAgent(mention.agentName)) {
      validMentions.push(mention);
    } else {
      invalidMentions.push(mention);
    }
  }

  // Build clean message by removing @mentions
  let cleanMessage = message;
  // Process in reverse order to maintain correct indices
  const sortedMentions = [...mentions].sort((a, b) => b.startIndex - a.startIndex);

  for (const mention of sortedMentions) {
    const before = cleanMessage.slice(0, mention.startIndex);
    const after = cleanMessage.slice(mention.endIndex);
    // Remove the mention and normalize whitespace
    cleanMessage = `${before} ${after}`.replace(/\s+/g, " ").trim();
  }

  return {
    mentions,
    cleanMessage: cleanMessage || "",
    hasValidMentions: validMentions.length > 0,
    hasInvalidMentions: invalidMentions.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Agent Task Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the task for a specific agent from a message.
 * Returns the text that should be sent to that agent.
 */
export function extractAgentTask(
  message: string,
  agentName: string
): string | null {
  const mentions = findMentions(message);
  const normalizedTarget = normalizeAgentName(agentName);

  for (const mention of mentions) {
    if (normalizeAgentName(mention.agentName) === normalizedTarget) {
      return mention.task;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Multi-mention Handling
// ---------------------------------------------------------------------------

/**
 * Get all valid agent mentions with their tasks.
 * Returns only mentions that match known agents.
 */
export function getValidMentionsWithTasks(
  message: string
): Array<{ agent: AgentDefinition; task: string }> {
  const mentions = findMentions(message);
  const results: Array<{ agent: AgentDefinition; task: string }> = [];

  for (const mention of mentions) {
    const agent = resolveAgent(mention.agentName);
    if (agent) {
      results.push({
        agent,
        task: mention.task,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Suggestion Helpers (for autocomplete validation)
// ---------------------------------------------------------------------------

/**
 * Get available agent names for autocomplete
 */
export function getAvailableAgents(): Array<{ name: string; description: string }> {
  const agents: Array<{ name: string; description: string }> = [];

  // Built-in agents
  for (const agent of getBuiltInAgents()) {
    agents.push({
      name: `@${agent.name.toLowerCase()}`,
      description: agent.description || "",
    });
  }

  // Custom agents
  for (const agent of getAgentDefinitions()) {
    const name = `@${agent.name.toLowerCase()}`;
    if (!agents.some((a) => a.name === name)) {
      agents.push({
        name,
        description: agent.description || "",
      });
    }
  }

  return agents;
}

/**
 * Check if a mention matches any known agent (for validation)
 */
export function isValidAgentMention(mention: string): boolean {
  return resolveAgent(mention) !== null;
}

// ---------------------------------------------------------------------------
// CLI Output Helpers
// ---------------------------------------------------------------------------

/**
 * Format a list of mentions for CLI output
 */
export function formatMentionsList(mentions: MentionParseResult[]): string {
  if (mentions.length === 0) return "No mentions found";

  return mentions
    .map((m) => {
      const status = resolveAgent(m.agentName) ? "(valid)" : "(unknown)";
      return `  ${m.mentionText} → ${status} "${m.task || "(no task)"}"`;
    })
    .join("\n");
}

/**
 * Format invalid mentions warning
 */
export function formatInvalidMentionsWarning(
  invalidMentions: string[]
): string | null {
  if (invalidMentions.length === 0) return null;

  const agents = getAvailableAgents();
  const available = agents.map((a) => a.name.replace("@", "")).join(", ");

  return [
    `Warning: Unknown agent mentions: ${invalidMentions.join(", ")}`,
    `Available agents: ${available}`,
  ].join("\n");
}