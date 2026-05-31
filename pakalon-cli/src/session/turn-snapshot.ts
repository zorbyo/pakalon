/**
 * Turn Snapshot System
 * 
 * Provides immutable state per turn based on pi's createTurnState() pattern.
 * Ensures that each turn uses a consistent snapshot of:
 * - Messages
 * - System prompt
 * - Model configuration
 * - Thinking level
 * - Tools
 * - Stream options
 * - Resources
 */

import logger from '../utils/logger.js';
import type { AgentMessage, AgentTool, ModelConfig, ThinkingLevel, StreamOptions, AgentHarnessResources } from '../engine/AgentHarnessEnhanced.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TurnSnapshot {
  /** Unique snapshot ID */
  id: string;
  /** Timestamp when snapshot was created */
  timestamp: Date;
  /** Messages at snapshot time */
  messages: AgentMessage[];
  /** System prompt at snapshot time */
  systemPrompt: string;
  /** Model configuration at snapshot time */
  model: ModelConfig;
  /** Thinking level at snapshot time */
  thinkingLevel: ThinkingLevel;
  /** Tools at snapshot time */
  tools: AgentTool[];
  /** Active tool names at snapshot time */
  activeToolNames: string[];
  /** Stream options at snapshot time */
  streamOptions: StreamOptions;
  /** Session ID */
  sessionId: string;
  /** Resources at snapshot time */
  resources: AgentHarnessResources;
  /** Turn number */
  turnNumber: number;
}

export interface TurnSnapshotOptions {
  messages: AgentMessage[];
  systemPrompt: string;
  model: ModelConfig;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool[];
  activeToolNames: string[];
  streamOptions: StreamOptions;
  sessionId: string;
  resources: AgentHarnessResources;
  turnNumber: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn Snapshot Manager
// ─────────────────────────────────────────────────────────────────────────────

export class TurnSnapshotManager {
  private snapshots: Map<string, TurnSnapshot> = new Map();
  private currentSnapshotId: string | null = null;
  private maxSnapshots: number;

  constructor(options?: { maxSnapshots?: number }) {
    this.maxSnapshots = options?.maxSnapshots ?? 100;
  }

  /**
   * Create a new turn snapshot
   */
  createSnapshot(options: TurnSnapshotOptions): TurnSnapshot {
    const id = `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    const snapshot: TurnSnapshot = {
      id,
      timestamp: new Date(),
      messages: [...options.messages],
      systemPrompt: options.systemPrompt,
      model: { ...options.model },
      thinkingLevel: options.thinkingLevel,
      tools: [...options.tools],
      activeToolNames: [...options.activeToolNames],
      streamOptions: { ...options.streamOptions },
      sessionId: options.sessionId,
      resources: { ...options.resources },
      turnNumber: options.turnNumber,
    };

    this.snapshots.set(id, snapshot);
    this.currentSnapshotId = id;

    // Cleanup old snapshots if needed
    this.cleanupOldSnapshots();

    logger.debug(`[TurnSnapshot] Created snapshot ${id} for turn ${options.turnNumber}`);
    return snapshot;
  }

  /**
   * Get the current snapshot
   */
  getCurrentSnapshot(): TurnSnapshot | null {
    if (!this.currentSnapshotId) return null;
    return this.snapshots.get(this.currentSnapshotId) ?? null;
  }

  /**
   * Get a snapshot by ID
   */
  getSnapshot(id: string): TurnSnapshot | null {
    return this.snapshots.get(id) ?? null;
  }

  /**
   * Get the previous snapshot
   */
  getPreviousSnapshot(): TurnSnapshot | null {
    if (!this.currentSnapshotId) return null;
    
    const current = this.snapshots.get(this.currentSnapshotId);
    if (!current) return null;

    // Find the snapshot with the previous turn number
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.turnNumber === current.turnNumber - 1) {
        return snapshot;
      }
    }
    
    return null;
  }

  /**
   * Get all snapshots for a session
   */
  getSessionSnapshots(sessionId: string): TurnSnapshot[] {
    return Array.from(this.snapshots.values())
      .filter(s => s.sessionId === sessionId)
      .sort((a, b) => a.turnNumber - b.turnNumber);
  }

  /**
   * Get snapshot count
   */
  getSnapshotCount(): number {
    return this.snapshots.size;
  }

  /**
   * Clear all snapshots
   */
  clear(): void {
    this.snapshots.clear();
    this.currentSnapshotId = null;
  }

  /**
   * Clear snapshots for a session
   */
  clearSession(sessionId: string): void {
    for (const [id, snapshot] of this.snapshots.entries()) {
      if (snapshot.sessionId === sessionId) {
        this.snapshots.delete(id);
      }
    }
    
    if (this.currentSnapshotId) {
      const current = this.snapshots.get(this.currentSnapshotId);
      if (!current || current.sessionId !== sessionId) {
        this.currentSnapshotId = null;
      }
    }
  }

  /**
   * Cleanup old snapshots to prevent memory leaks
   */
  private cleanupOldSnapshots(): void {
    if (this.snapshots.size <= this.maxSnapshots) return;

    const sortedSnapshots = Array.from(this.snapshots.values())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const toRemove = sortedSnapshots.slice(0, sortedSnapshots.length - this.maxSnapshots);
    for (const snapshot of toRemove) {
      this.snapshots.delete(snapshot.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot Comparison
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapshotDiff {
  modelChanged: boolean;
  thinkingLevelChanged: boolean;
  toolsChanged: boolean;
  activeToolsChanged: boolean;
  streamOptionsChanged: boolean;
  resourcesChanged: boolean;
}

/**
 * Compare two snapshots to detect changes
 */
export function compareSnapshots(a: TurnSnapshot, b: TurnSnapshot): SnapshotDiff {
  return {
    modelChanged: JSON.stringify(a.model) !== JSON.stringify(b.model),
    thinkingLevelChanged: a.thinkingLevel !== b.thinkingLevel,
    toolsChanged: JSON.stringify(a.tools) !== JSON.stringify(b.tools),
    activeToolsChanged: JSON.stringify(a.activeToolNames) !== JSON.stringify(b.activeToolNames),
    streamOptionsChanged: JSON.stringify(a.streamOptions) !== JSON.stringify(b.streamOptions),
    resourcesChanged: JSON.stringify(a.resources) !== JSON.stringify(b.resources),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

export const turnSnapshotManager = new TurnSnapshotManager();
