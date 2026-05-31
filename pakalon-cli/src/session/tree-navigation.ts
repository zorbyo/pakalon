/**
 * Tree Navigation System
 * 
 * Implements pi's navigateTree functionality for session branching:
 * - Navigate to any entry in the session tree
 * - Generate branch summaries
 * - Track leaf position
 * - Common ancestor finding
 */

import logger from '../utils/logger.js';
import { SessionError, BranchSummaryError, type Result, ok, err } from './errors.js';
import { JsonlSessionStorage, type SessionTreeEntry, type BranchSummaryEntry } from './jsonl-storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TreePreparation {
  targetId: string;
  oldLeafId: string | null;
  commonAncestorId: string | null;
  entriesToSummarize: SessionTreeEntry[];
  userWantsSummary: boolean;
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}

export interface NavigateTreeResult {
  cancelled: boolean;
  editorText?: string;
  summaryEntry?: BranchSummaryEntry;
}

export interface BranchSummaryOptions {
  model?: { id: string; provider: string };
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  customInstructions?: string;
  replaceInstructions?: boolean;
}

export interface BranchSummaryResult {
  summary: string;
  readFiles: string[];
  modifiedFiles: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree Navigation
// ─────────────────────────────────────────────────────────────────────────────

export class TreeNavigator {
  private session: JsonlSessionStorage;

  constructor(session: JsonlSessionStorage) {
    this.session = session;
  }

  /**
   * Navigate to a target entry in the session tree
   */
  async navigateTo(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<NavigateTreeResult> {
    const oldLeafId = await this.session.getLeafId();
    
    if (oldLeafId === targetId) {
      return { cancelled: false };
    }

    const targetEntry = await this.session.getEntry(targetId);
    if (!targetEntry) {
      throw new SessionError("not_found", `Entry ${targetId} not found`);
    }

    // Collect entries for branch summary
    const { entries, commonAncestorId } = await this.collectEntriesForBranchSummary(oldLeafId, targetId);

    const preparation: TreePreparation = {
      targetId,
      oldLeafId,
      commonAncestorId,
      entriesToSummarize: entries,
      userWantsSummary: options?.summarize ?? false,
      customInstructions: options?.customInstructions,
      replaceInstructions: options?.replaceInstructions,
      label: options?.label,
    };

    // Generate summary if requested
    let summaryEntry: BranchSummaryEntry | undefined;
    let summaryText: string | undefined;
    
    if (options?.summarize && entries.length > 0) {
      try {
        const summary = await this.generateBranchSummary(entries, {
          customInstructions: options?.customInstructions,
          replaceInstructions: options?.replaceInstructions,
        });
        summaryText = summary.summary;
      } catch (error) {
        if (error instanceof BranchSummaryError && error.code === "aborted") {
          return { cancelled: true };
        }
        throw error;
      }
    }

    // Determine new leaf position
    let newLeafId: string | null;
    let editorText: string | undefined;
    
    if (targetEntry.type === "message" && targetEntry.message.role === "user") {
      newLeafId = targetEntry.parentId;
      editorText = targetEntry.message.content;
    } else if (targetEntry.type === "custom_message") {
      newLeafId = targetEntry.parentId;
      editorText = typeof targetEntry.content === "string" 
        ? targetEntry.content 
        : targetEntry.content;
    } else {
      newLeafId = targetId;
    }

    // Move to new position
    await this.session.setLeafId(newLeafId);
    
    // Get summary entry if created
    if (summaryText) {
      // Create a branch summary entry
      summaryEntry = {
        type: "branch_summary",
        id: await this.session.createEntryId(),
        parentId: null,
        timestamp: new Date().toISOString(),
        fromId: oldLeafId ?? "",
        summary: summaryText,
        details: { readFiles: [], modifiedFiles: [] },
        fromHook: false,
      };
      await this.session.appendEntry(summaryEntry);
    }

    return { cancelled: false, editorText, summaryEntry };
  }

  /**
   * Collect entries between two points for branch summary
   */
  private async collectEntriesForBranchSummary(
    fromId: string | null,
    toId: string,
  ): Promise<{ entries: SessionTreeEntry[]; commonAncestorId: string | null }> {
    if (!fromId) {
      return { entries: [], commonAncestorId: null };
    }

    const fromPath = await this.session.getPathToRoot(fromId);
    const toPath = await this.session.getPathToRoot(toId);

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
    const toEntries = await this.session.getEntries();
    let foundCommon = false;
    let foundTarget = false;

    for (const entry of toEntries) {
      if (entry.id === commonAncestorId) {
        foundCommon = true;
        continue;
      }
      if (entry.id === toId) {
        foundTarget = true;
        break;
      }
      if (foundCommon) {
        entries.push(entry);
      }
    }

    return { entries, commonAncestorId };
  }

  /**
   * Generate a branch summary
   */
  async generateBranchSummary(
    entries: SessionTreeEntry[],
    options?: BranchSummaryOptions,
  ): Promise<BranchSummaryResult> {
    // Extract read and modified files
    const readFiles = new Set<string>();
    const modifiedFiles = new Set<string>();

    for (const entry of entries) {
      if (entry.type === "message") {
        // Extract file references from message content
        const content = entry.message.content;
        const fileMatches = content.match(/(?:read|wrote|edited|modified)\s+([^\s]+)/gi);
        if (fileMatches) {
          for (const match of fileMatches) {
            const file = match.split(/\s+/)[1];
            if (file) {
              if (match.toLowerCase().startsWith("read")) {
                readFiles.add(file);
              } else {
                modifiedFiles.add(file);
              }
            }
          }
        }
      }
    }

    // Generate summary text
    let summary: string;
    
    if (options?.customInstructions) {
      summary = options.customInstructions;
    } else {
      // Simple extractive summary
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

    return {
      summary,
      readFiles: Array.from(readFiles),
      modifiedFiles: Array.from(modifiedFiles),
    };
  }

  /**
   * Get the current branch path
   */
  async getCurrentBranch(): Promise<SessionTreeEntry[]> {
    const leafId = await this.session.getLeafId();
    return this.session.getPathToRoot(leafId);
  }

  /**
   * Get all leaf nodes
   */
  async getLeafNodes(): Promise<SessionTreeEntry[]> {
    const entries = await this.session.getEntries();
    const entryMap = new Map(entries.map((e) => [e.id, e]));
    
    // Find entries that are not parents of any other entry
    const parentIds = new Set(entries.filter((e) => e.parentId).map((e) => e.parentId));
    return entries.filter((e) => !parentIds.has(e.id) && e.type !== "leaf");
  }

  /**
   * Get branch count
   */
  async getBranchCount(): Promise<number> {
    const leaves = await this.getLeafNodes();
    return leaves.length;
  }
}
