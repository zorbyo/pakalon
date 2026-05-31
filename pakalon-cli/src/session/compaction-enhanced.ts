/**
 * Enhanced Compaction System
 * 
 * Adds compaction hooks and session_before_compact event
 * based on pi's compaction implementation.
 */

import logger from '../utils/logger.js';
import { CompactionError, type Result, ok, err } from './errors.js';
import { JsonlSessionStorage, type SessionTreeEntry, type CompactionEntry } from './jsonl-storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 10000,
  keepRecentTokens: 20000,
};

export interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: Array<{ role: string; content: string; timestamp: string }>;
  turnPrefixMessages: Array<{ role: string; content: string; timestamp: string }>;
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: FileOperations;
  settings: CompactionSettings;
}

export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

export interface CompactResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
}

export interface SessionBeforeCompactEvent {
  type: "session_before_compact";
  preparation: CompactionPreparation;
  branchEntries: SessionTreeEntry[];
  customInstructions?: string;
  signal: AbortSignal;
}

export interface SessionCompactEvent {
  type: "session_compact";
  compactionEntry: CompactionEntry;
  fromHook: boolean;
}

export interface SessionBeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compaction Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prepare compaction by analyzing session entries
 */
export function prepareCompaction(
  entries: SessionTreeEntry[],
  settings: CompactionSettings = DEFAULT_COMPACTION_SETTINGS,
): Result<CompactionPreparation | null, CompactionError> {
  if (!settings.enabled) {
    return ok(null);
  }

  // Find messages to summarize
  const messages: Array<{ role: string; content: string; timestamp: string }> = [];
  const fileOps: FileOperations = {
    read: new Set(),
    written: new Set(),
    edited: new Set(),
  };

  let tokensBefore = 0;
  let firstKeptEntryId: string | null = null;

  for (const entry of entries) {
    if (entry.type === "message") {
      const msg = entry.message;
      tokensBefore += estimateTokens(msg.content);
      
      // Track file operations
      const content = msg.content;
      const readFileMatches = content.match(/(?:read|opened)\s+([^\s]+)/gi);
      if (readFileMatches) {
        for (const match of readFileMatches) {
          const file = match.split(/\s+/)[1];
          if (file) fileOps.read.add(file);
        }
      }

      const writeFileMatches = content.match(/(?:wrote|created|saved)\s+([^\s]+)/gi);
      if (writeFileMatches) {
        for (const match of writeFileMatches) {
          const file = match.split(/\s+/)[1];
          if (file) fileOps.written.add(file);
        }
      }

      const editFileMatches = content.match(/(?:edited|modified|patched)\s+([^\s]+)/gi);
      if (editFileMatches) {
        for (const match of editFileMatches) {
          const file = match.split(/\s+/)[1];
          if (file) fileOps.edited.add(file);
        }
      }

      messages.push({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      });
    }
  }

  if (messages.length === 0) {
    return ok(null);
  }

  // Determine first kept entry
  // Keep recent messages based on token budget
  let keptTokens = 0;
  let firstKeptIndex = messages.length;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(messages[i]!.content);
    if (keptTokens + msgTokens > settings.keepRecentTokens) {
      break;
    }
    keptTokens += msgTokens;
    firstKeptIndex = i;
  }

  const messagesToSummarize = messages.slice(0, firstKeptIndex);
  const turnPrefixMessages = messages.slice(firstKeptIndex);

  return ok({
    firstKeptEntryId: firstKeptEntryId ?? "",
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: false,
    tokensBefore,
    fileOps,
    settings,
  });
}

/**
 * Estimate token count for text
 */
function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Generate compaction summary
 */
export async function generateCompactionSummary(
  preparation: CompactionPreparation,
  options?: {
    model?: { id: string; provider: string };
    apiKey?: string;
    customInstructions?: string;
  },
): Promise<Result<CompactResult, CompactionError>> {
  try {
    // Simple extractive summary for now
    // In production, this would call an LLM to generate a summary
    const summary = preparation.messagesToSummarize
      .slice(0, 20)
      .map((msg) => {
        const preview = msg.content.slice(0, 100).replace(/\n/g, " ");
        return `- ${msg.role}: ${preview}${msg.content.length > 100 ? "..." : ""}`;
      })
      .filter(Boolean)
      .join("\n");

    return ok({
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: {
        readFiles: Array.from(preparation.fileOps.read),
        writtenFiles: Array.from(preparation.fileOps.written),
        editedFiles: Array.from(preparation.fileOps.edited),
      },
    });
  } catch (error) {
    return err(new CompactionError(
      "summarization_failed",
      `Failed to generate compaction summary: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined,
    ));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch Summary
// ─────────────────────────────────────────────────────────────────────────────

export interface BranchSummaryOptions {
  model?: { id: string; provider: string };
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  customInstructions?: string;
  replaceInstructions?: boolean;
  reserveTokens?: number;
}

export interface BranchSummaryResult {
  summary: string;
  readFiles: string[];
  modifiedFiles: string[];
}

/**
 * Collect entries for branch summary between two points
 */
export async function collectEntriesForBranchSummary(
  session: JsonlSessionStorage,
  fromId: string | null,
  toId: string,
): Promise<{ entries: SessionTreeEntry[]; commonAncestorId: string | null }> {
  if (!fromId) {
    return { entries: [], commonAncestorId: null };
  }

  const fromPath = await session.getPathToRoot(fromId);
  const toPath = await session.getPathToRoot(toId);

  // Find common ancestor
  let commonAncestorId: string | null = null;
  const fromIds = new Set(fromPath.map((e) => e.id));
  
  for (const entry of toPath) {
    if (fromIds.has(entry.id)) {
      commonAncestorId = entry.id;
      break;
    }
  }

  // Collect entries between common ancestor and target
  const entries: SessionTreeEntry[] = [];
  const allEntries = await session.getEntries();
  let foundCommon = false;

  for (const entry of allEntries) {
    if (entry.id === commonAncestorId) {
      foundCommon = true;
      continue;
    }
    if (entry.id === toId) {
      break;
    }
    if (foundCommon) {
      entries.push(entry);
    }
  }

  return { entries, commonAncestorId };
}

/**
 * Generate branch summary
 */
export async function generateBranchSummary(
  entries: SessionTreeEntry[],
  options?: BranchSummaryOptions,
): Promise<Result<BranchSummaryResult, CompactionError>> {
  try {
    // Extract file references
    const readFiles = new Set<string>();
    const modifiedFiles = new Set<string>();

    for (const entry of entries) {
      if (entry.type === "message") {
        const content = entry.message.content;
        
        const readFileMatches = content.match(/(?:read|opened)\s+([^\s]+)/gi);
        if (readFileMatches) {
          for (const match of readFileMatches) {
            const file = match.split(/\s+/)[1];
            if (file) readFiles.add(file);
          }
        }

        const writeFileMatches = content.match(/(?:wrote|created|saved|edited|modified)\s+([^\s]+)/gi);
        if (writeFileMatches) {
          for (const match of writeFileMatches) {
            const file = match.split(/\s+/)[1];
            if (file) modifiedFiles.add(file);
          }
        }
      }
    }

    // Generate summary
    let summary: string;
    
    if (options?.customInstructions) {
      summary = options.customInstructions;
    } else {
      const messageEntries = entries.filter((e) => e.type === "message");
      summary = messageEntries
        .slice(0, 10)
        .map((e) => {
          const msg = e.type === "message" ? e.message : null;
          if (!msg) return "";
          const preview = msg.content.slice(0, 100).replace(/\n/g, " ");
          return `- ${msg.role}: ${preview}${msg.content.length > 100 ? "..." : ""}`;
        })
        .filter(Boolean)
        .join("\n");
    }

    return ok({
      summary,
      readFiles: Array.from(readFiles),
      modifiedFiles: Array.from(modifiedFiles),
    });
  } catch (error) {
    return err(new CompactionError(
      "summarization_failed",
      `Failed to generate branch summary: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined,
    ));
  }
}
