/**
 * Conflict Resolution
 * 
 * Handles merge conflicts via conflict:// scheme.
 * Based on OMP's conflict resolution feature.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface MergeConflict {
  index: number;
  filePath: string;
  baseContent: string;
  oursContent: string;
  theirsContent: string;
  startLine: number;
  endLine: number;
}

export interface ConflictResolution {
  conflictIndex: number;
  resolution: 'ours' | 'theirs' | 'base' | 'manual';
  manualContent?: string;
  timestamp: number;
}

// ============================================================================
// Conflict Resolver
// ============================================================================

export class ConflictResolver {
  private conflicts: Map<string, MergeConflict[]> = new Map();
  private resolutions: Map<string, ConflictResolution[]> = new Map();

  /**
   * Parse merge conflicts from file content
   */
  parseConflicts(filePath: string, content: string): MergeConflict[] {
    const conflicts: MergeConflict[] = [];
    const lines = content.split('\n');
    
    let currentConflict: Partial<MergeConflict> | null = null;
    let conflictIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('<<<<<<<')) {
        currentConflict = {
          index: conflictIndex++,
          filePath,
          startLine: i,
          baseContent: '',
          oursContent: '',
          theirsContent: '',
        };
      } else if (line.startsWith('=======') && currentConflict) {
        // Switch from ours to theirs
        currentConflict.oursContent = currentConflict.oursContent || '';
      } else if (line.startsWith('>>>>>>>') && currentConflict) {
        currentConflict.endLine = i;
        currentConflict.theirsContent = currentConflict.theirsContent || '';
        
        conflicts.push(currentConflict as MergeConflict);
        currentConflict = null;
      } else if (currentConflict) {
        if (!currentConflict.oursContent) {
          currentConflict.oursContent += line + '\n';
        } else {
          currentConflict.theirsContent += line + '\n';
        }
      }
    }

    this.conflicts.set(filePath, conflicts);
    
    logger.debug('[conflict-resolver] Parsed conflicts', {
      filePath,
      conflictCount: conflicts.length,
    });

    return conflicts;
  }

  /**
   * Get conflicts for a file
   */
  getConflicts(filePath: string): MergeConflict[] {
    return this.conflicts.get(filePath) || [];
  }

  /**
   * Get all conflicts
   */
  getAllConflicts(): MergeConflict[] {
    const allConflicts: MergeConflict[] = [];
    for (const conflicts of this.conflicts.values()) {
      allConflicts.push(...conflicts);
    }
    return allConflicts;
  }

  /**
   * Resolve a conflict
   */
  resolve(
    filePath: string,
    conflictIndex: number,
    resolution: 'ours' | 'theirs' | 'base' | 'manual',
    manualContent?: string
  ): ConflictResolution {
    const resolution: ConflictResolution = {
      conflictIndex,
      resolution,
      manualContent,
      timestamp: Date.now(),
    };

    const fileResolutions = this.resolutions.get(filePath) || [];
    fileResolutions.push(resolution);
    this.resolutions.set(filePath, fileResolutions);

    logger.debug('[conflict-resolver] Resolved conflict', {
      filePath,
      conflictIndex,
      resolution,
    });

    return resolution;
  }

  /**
   * Resolve all conflicts in a file
   */
  resolveAll(
    filePath: string,
    resolution: 'ours' | 'theirs' | 'base' | 'manual',
    manualContent?: string
  ): ConflictResolution[] {
    const conflicts = this.getConflicts(filePath);
    const resolutions: ConflictResolution[] = [];

    for (const conflict of conflicts) {
      resolutions.push(this.resolve(filePath, conflict.index, resolution, manualContent));
    }

    return resolutions;
  }

  /**
   * Apply resolutions to file content
   */
  applyResolutions(filePath: string, content: string): string {
    const conflicts = this.getConflicts(filePath);
    const resolutions = this.resolutions.get(filePath) || [];

    let result = content;
    const lines = result.split('\n');

    // Sort resolutions by conflict index (descending) to apply from bottom to top
    const sortedResolutions = [...resolutions].sort((a, b) => b.conflictIndex - a.conflictIndex);

    for (const resolution of sortedResolutions) {
      const conflict = conflicts.find(c => c.index === resolution.conflictIndex);
      if (!conflict) continue;

      let replacement: string;
      switch (resolution.resolution) {
        case 'ours':
          replacement = conflict.oursContent;
          break;
        case 'theirs':
          replacement = conflict.theirsContent;
          break;
        case 'base':
          replacement = conflict.baseContent;
          break;
        case 'manual':
          replacement = resolution.manualContent || '';
          break;
      }

      // Replace conflict markers with resolved content
      lines.splice(
        conflict.startLine,
        conflict.endLine - conflict.startLine + 1,
        replacement.trimEnd()
      );
    }

    return lines.join('\n');
  }

  /**
   * Write resolved file
   */
  async writeResolvedFile(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const resolved = this.applyResolutions(filePath, content);
      await fs.writeFile(filePath, resolved, 'utf-8');

      logger.debug('[conflict-resolver] Wrote resolved file', { filePath });

      return true;
    } catch (error) {
      logger.error('[conflict-resolver] Failed to write resolved file', {
        filePath,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Get resolution status for a file
   */
  getResolutionStatus(filePath: string): {
    total: number;
    resolved: number;
    unresolved: number;
  } {
    const conflicts = this.getConflicts(filePath);
    const resolutions = this.resolutions.get(filePath) || [];
    const resolvedIndices = new Set(resolutions.map(r => r.conflictIndex));

    return {
      total: conflicts.length,
      resolved: resolvedIndices.size,
      unresolved: conflicts.length - resolvedIndices.size,
    };
  }

  /**
   * Clear conflicts for a file
   */
  clearFile(filePath: string): void {
    this.conflicts.delete(filePath);
    this.resolutions.delete(filePath);
  }

  /**
   * Clear all conflicts
   */
  clear(): void {
    this.conflicts.clear();
    this.resolutions.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let resolverInstance: ConflictResolver | null = null;

export function getConflictResolver(): ConflictResolver {
  if (!resolverInstance) {
    resolverInstance = new ConflictResolver();
  }
  return resolverInstance;
}

export function resetConflictResolver(): void {
  resolverInstance = null;
}
