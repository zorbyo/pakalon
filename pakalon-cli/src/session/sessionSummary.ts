/**
 * Session Summary Service
 * 
 * Tracks file diffs (additions, deletions, files changed) during sessions.
 * Modeled after opencode's session/summary.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FileDiff {
  file: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface SessionSummary {
  additions: number;
  deletions: number;
  files: number;
  diffs: FileDiff[];
  computedAt: string;
}

export interface DiffResult {
  sessionSummary: SessionSummary;
  messageDiffs?: FileDiff[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────

function getSummaryDir(): string {
  const dir = path.join(os.homedir(), '.pakalon', 'session-summaries');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSummaryPath(sessionId: string): string {
  return path.join(getSummaryDir(), `${sessionId}.json`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class SessionSummaryService {
  private summaries: Map<string, SessionSummary> = new Map();

  /**
   * Compute diff summary from file changes
   */
  computeDiff(filesChanged: Array<{ path: string; additions: number; deletions: number }>): FileDiff[] {
    return filesChanged.map(f => ({
      file: f.path,
      additions: f.additions,
      deletions: f.deletions,
      status: f.additions > 0 && f.deletions === 0 ? 'added' :
              f.additions === 0 && f.deletions > 0 ? 'deleted' : 'modified',
    }));
  }

  /**
   * Summarize a session's file changes
   */
  summarize(sessionId: string, filesChanged: Array<{ path: string; additions: number; deletions: number }>): SessionSummary {
    const diffs = this.computeDiff(filesChanged);
    const summary: SessionSummary = {
      additions: diffs.reduce((sum, d) => sum + d.additions, 0),
      deletions: diffs.reduce((sum, d) => sum + d.deletions, 0),
      files: diffs.length,
      diffs,
      computedAt: new Date().toISOString(),
    };

    this.summaries.set(sessionId, summary);
    this.persist(sessionId, summary);
    return summary;
  }

  /**
   * Get stored summary for a session
   */
  getSummary(sessionId: string): SessionSummary | null {
    // Check in-memory cache first
    const cached = this.summaries.get(sessionId);
    if (cached) return cached;

    // Try to load from disk
    const loaded = this.load(sessionId);
    if (loaded) {
      this.summaries.set(sessionId, loaded);
      return loaded;
    }

    return null;
  }

  /**
   * Get diff for a session
   */
  getDiff(sessionId: string): FileDiff[] {
    const summary = this.getSummary(sessionId);
    return summary?.diffs ?? [];
  }

  /**
   * Persist summary to disk
   */
  private persist(sessionId: string, summary: SessionSummary): void {
    try {
      const filePath = getSummaryPath(sessionId);
      fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[SessionSummary] Failed to persist summary for ${sessionId}:`, err);
    }
  }

  /**
   * Load summary from disk
   */
  private load(sessionId: string): SessionSummary | null {
    try {
      const filePath = getSummaryPath(sessionId);
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as SessionSummary;
    } catch {
      return null;
    }
  }

  /**
   * Clear summary for a session
   */
  clear(sessionId: string): void {
    this.summaries.delete(sessionId);
    try {
      const filePath = getSummaryPath(sessionId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

export const sessionSummaryService = new SessionSummaryService();

export * as SessionSummary from './sessionSummary.js';
