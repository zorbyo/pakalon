/**
 * Auto-Continue Compaction
 * 
 * Provides automatic compaction triggers based on:
 * - Threshold maintenance: Auto-compact when context exceeds threshold
 * - Idle maintenance: Compact while session is idle
 * - Auto-continue: Schedule continuation after threshold compaction
 * 
 * Features:
 * - Configurable threshold (percentage or token count)
 * - Auto-continue after compaction
 * - Idle detection and maintenance
 * - Compaction hooks for extensions
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompactionStrategy = 'context-full' | 'handoff' | 'off';

export interface CompactionConfig {
  enabled: boolean;
  strategy: CompactionStrategy;
  reserveTokens: number;
  keepRecentTokens: number;
  autoContinue: boolean;
  idleEnabled: boolean;
  thresholdPercent: number; // -1 = auto
  thresholdTokens: number; // -1 = auto
}

export interface CompactionState {
  isCompacting: boolean;
  lastCompactionTime?: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  thresholdCheckTimer?: ReturnType<typeof setInterval>;
}

export interface CompactionTrigger {
  type: 'overflow' | 'threshold' | 'idle' | 'manual';
  timestamp: number;
  tokensBefore: number;
  tokensAfter?: number;
}

export interface CompactionHook {
  id: string;
  callback: (trigger: CompactionTrigger) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  strategy: 'context-full',
  reserveTokens: 16384,
  keepRecentTokens: 20000,
  autoContinue: true,
  idleEnabled: true,
  thresholdPercent: -1, // Auto
  thresholdTokens: -1, // Auto
};

// ---------------------------------------------------------------------------
// Compaction Manager
// ---------------------------------------------------------------------------

export class CompactionManager {
  private config: CompactionConfig;
  private state: CompactionState;
  private hooks: Map<string, CompactionHook> = new Map();
  private contextWindow: number;
  private currentTokens: number = 0;

  constructor(
    contextWindow: number = 200000,
    config: Partial<CompactionConfig> = {}
  ) {
    this.contextWindow = contextWindow;
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
    this.state = {
      isCompacting: false,
    };
  }

  /**
   * Calculate the threshold for automatic compaction
   */
  calculateThreshold(): number {
    if (this.config.thresholdTokens > 0) {
      return this.config.thresholdTokens;
    }

    if (this.config.thresholdPercent > 0) {
      return Math.floor(this.contextWindow * (this.config.thresholdPercent / 100));
    }

    // Auto: contextWindow - max(15% of contextWindow, reserveTokens)
    const fifteenPercent = Math.floor(this.contextWindow * 0.15);
    const threshold = this.contextWindow - Math.max(fifteenPercent, this.config.reserveTokens);
    return threshold;
  }

  /**
   * Check if compaction is needed based on current token count
   */
  shouldCompact(): boolean {
    if (!this.config.enabled) return false;
    if (this.state.isCompacting) return false;

    const threshold = this.calculateThreshold();
    return this.currentTokens > threshold;
  }

  /**
   * Update current token count
   */
  updateTokens(count: number): void {
    this.currentTokens = count;

    // Check if we need to compact
    if (this.shouldCompact()) {
      this.triggerCompaction('threshold');
    }
  }

  /**
   * Trigger compaction
   */
  async triggerCompaction(type: CompactionTrigger['type']): Promise<void> {
    if (this.state.isCompacting) return;
    if (!this.config.enabled) return;

    this.state.isCompacting = true;
    this.state.lastCompactionTime = Date.now();

    const trigger: CompactionTrigger = {
      type,
      timestamp: Date.now(),
      tokensBefore: this.currentTokens,
    };

    // Fire hooks
    for (const hook of this.hooks.values()) {
      try {
        await hook.callback(trigger);
      } catch (error) {
        console.error(`Compaction hook ${hook.id} failed:`, error);
      }
    }

    // Note: Actual compaction logic would be implemented here
    // This manager provides the trigger mechanism

    this.state.isCompacting = false;
  }

  /**
   * Register a compaction hook
   */
  registerHook(hook: CompactionHook): void {
    this.hooks.set(hook.id, hook);
  }

  /**
   * Unregister a compaction hook
   */
  unregisterHook(id: string): void {
    this.hooks.delete(id);
  }

  /**
   * Start idle maintenance
   */
  startIdleMaintenance(callback: () => Promise<void>, idleTimeoutMs = 300000): void {
    if (!this.config.idleEnabled) return;

    // Clear existing timer
    if (this.state.idleTimer) {
      clearTimeout(this.state.idleTimer);
    }

    // Set new idle timer
    this.state.idleTimer = setTimeout(async () => {
      if (this.shouldCompact()) {
        await this.triggerCompaction('idle');
        await callback();
      }
    }, idleTimeoutMs);
  }

  /**
   * Stop idle maintenance
   */
  stopIdleMaintenance(): void {
    if (this.state.idleTimer) {
      clearTimeout(this.state.idleTimer);
      this.state.idleTimer = undefined;
    }
  }

  /**
   * Start threshold checking
   */
  startThresholdChecking(callback: () => Promise<void>, intervalMs = 30000): void {
    if (this.state.thresholdCheckTimer) {
      clearInterval(this.state.thresholdCheckTimer);
    }

    this.state.thresholdCheckTimer = setInterval(async () => {
      if (this.shouldCompact()) {
        await this.triggerCompaction('threshold');
        await callback();
      }
    }, intervalMs);
  }

  /**
   * Stop threshold checking
   */
  stopThresholdChecking(): void {
    if (this.state.thresholdCheckTimer) {
      clearInterval(this.state.thresholdCheckTimer);
      this.state.thresholdCheckTimer = undefined;
    }
  }

  /**
   * Get compaction stats
   */
  getStats(): {
    config: CompactionConfig;
    state: CompactionState;
    threshold: number;
    currentTokens: number;
    wouldCompact: boolean;
  } {
    return {
      config: this.config,
      state: this.state,
      threshold: this.calculateThreshold(),
      currentTokens: this.currentTokens,
      wouldCompact: this.shouldCompact(),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopIdleMaintenance();
    this.stopThresholdChecking();
    this.hooks.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton Instance
// ---------------------------------------------------------------------------

let defaultManager: CompactionManager | null = null;

export function getCompactionManager(
  contextWindow?: number,
  config?: Partial<CompactionConfig>
): CompactionManager {
  if (!defaultManager) {
    defaultManager = new CompactionManager(contextWindow, config);
  }
  return defaultManager;
}

export function resetCompactionManager(): void {
  if (defaultManager) {
    defaultManager.cleanup();
    defaultManager = null;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  CompactionManager,
  getCompactionManager,
  resetCompactionManager,
  DEFAULT_COMPACTION_CONFIG,
};
