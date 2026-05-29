/**
 * Agent Summarization System
 *
 * Provides progress tracking and summarization for background agents.
 * Similar to Claude's AgentSummary system.
 *
 * Features:
 * - Progress tracking with percentage completion
 * - Activity descriptions for current operations
 * - Token usage tracking
 * - Time estimation
 * - Status updates for UI display
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export interface AgentProgress {
  /** Unique agent ID */
  agentId: string;
  /** Agent name/description */
  name: string;
  /** Current status */
  status: AgentStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Current activity description */
  activity: string;
  /** Total steps in the activity */
  totalSteps?: number;
  /** Current step */
  currentStep?: number;
  /** Start time */
  startTime: number;
  /** Last update time */
  lastUpdateTime: number;
  /** End time (if completed) */
  endTime?: number;
  /** Token usage */
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  /** Error message (if failed) */
  error?: string;
  /** Parent agent ID (for sub-agents) */
  parentId?: string;
  /** Child agent IDs */
  childIds: string[];
  /** Metadata */
  metadata: Record<string, unknown>;
}

export interface AgentSummary {
  /** Agent ID */
  agentId: string;
  /** Agent name */
  name: string;
  /** Final status */
  status: AgentStatus;
  /** Progress at completion */
  progress: number;
  /** Total duration in ms */
  duration: number;
  /** Final activity description */
  finalActivity: string;
  /** Total tokens used */
  totalTokens: number;
  /** Summary text */
  summary: string;
  /** Whether the agent completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// Agent Summary Manager
// ---------------------------------------------------------------------------

class AgentSummaryManager {
  private agents: Map<string, AgentProgress> = new Map();
  private summaries: Map<string, AgentSummary> = new Map();
  private listeners: Set<(progress: AgentProgress) => void> = new Set();

  /**
   * Register a new agent for tracking
   */
  registerAgent(
    agentId: string,
    name: string,
    parentId?: string
  ): AgentProgress {
    const progress: AgentProgress = {
      agentId,
      name,
      status: "pending",
      progress: 0,
      activity: "Initializing...",
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      childIds: [],
      metadata: {},
    };

    this.agents.set(agentId, progress);

    // Register as child of parent agent
    if (parentId) {
      const parent = this.agents.get(parentId);
      if (parent) {
        parent.childIds.push(agentId);
        progress.parentId = parentId;
      }
    }

    logger.debug(`[AgentSummary] Registered agent: ${name} (${agentId})`);
    this.notifyListeners(progress);

    return progress;
  }

  /**
   * Update agent progress
   */
  updateProgress(
    agentId: string,
    updates: Partial<Omit<AgentProgress, "agentId">>
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      logger.warn(`[AgentSummary] Agent not found: ${agentId}`);
      return;
    }

    // Apply updates
    if (updates.status !== undefined) agent.status = updates.status;
    if (updates.progress !== undefined) agent.progress = Math.min(100, Math.max(0, updates.progress));
    if (updates.activity !== undefined) agent.activity = updates.activity;
    if (updates.totalSteps !== undefined) agent.totalSteps = updates.totalSteps;
    if (updates.currentStep !== undefined) agent.currentStep = updates.currentStep;
    if (updates.tokens !== undefined) agent.tokens = updates.tokens;
    if (updates.error !== undefined) agent.error = updates.error;
    if (updates.metadata !== undefined) {
      Object.assign(agent.metadata, updates.metadata);
    }

    agent.lastUpdateTime = Date.now();

    // Handle completion
    if (updates.status === "completed" || updates.status === "failed") {
      agent.endTime = Date.now();
      this.createSummary(agent);
    }

    this.notifyListeners(agent);
  }

  /**
   * Set agent activity description
   */
  setActivity(agentId: string, activity: string): void {
    this.updateProgress(agentId, { activity });
  }

  /**
   * Set agent progress percentage
   */
  setProgress(agentId: string, progress: number): void {
    this.updateProgress(agentId, { progress });
  }

  /**
   * Mark agent as running
   */
  startAgent(agentId: string, activity?: string): void {
    this.updateProgress(agentId, {
      status: "running",
      activity: activity || "Processing...",
    });
  }

  /**
   * Mark agent as completed
   */
  completeAgent(agentId: string, summary?: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.updateProgress(agentId, {
      status: "completed",
      progress: 100,
      activity: summary || "Completed",
    });
  }

  /**
   * Mark agent as failed
   */
  failAgent(agentId: string, error: string): void {
    this.updateProgress(agentId, {
      status: "failed",
      error,
      activity: `Failed: ${error}`,
    });
  }

  /**
   * Cancel agent
   */
  cancelAgent(agentId: string): void {
    this.updateProgress(agentId, {
      status: "cancelled",
      activity: "Cancelled by user",
    });
  }

  /**
   * Update token usage
   */
  updateTokens(
    agentId: string,
    tokens: { input: number; output: number }
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const existing = agent.tokens || { input: 0, output: 0, total: 0 };
    this.updateProgress(agentId, {
      tokens: {
        input: existing.input + tokens.input,
        output: existing.output + tokens.output,
        total: existing.total + tokens.input + tokens.output,
      },
    });
  }

  /**
   * Get agent progress
   */
  getAgent(agentId: string): AgentProgress | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentProgress[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent summary (after completion)
   */
  getSummary(agentId: string): AgentSummary | undefined {
    return this.summaries.get(agentId);
  }

  /**
   * Get all summaries
   */
  getAllSummaries(): AgentSummary[] {
    return Array.from(this.summaries.values());
  }

  /**
   * Subscribe to progress updates
   */
  onProgress(listener: (progress: AgentProgress) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Create summary for completed/failed agent
   */
  private createSummary(agent: AgentProgress): void {
    const duration = (agent.endTime || Date.now()) - agent.startTime;
    const totalTokens = agent.tokens?.total || 0;

    const summary: AgentSummary = {
      agentId: agent.agentId,
      name: agent.name,
      status: agent.status,
      progress: agent.progress,
      duration,
      finalActivity: agent.activity,
      totalTokens,
      summary: this.generateSummaryText(agent, duration),
      success: agent.status === "completed",
      error: agent.error,
    };

    this.summaries.set(agent.agentId, summary);
    logger.info(
      `[AgentSummary] ${agent.name}: ${agent.status} in ${(duration / 1000).toFixed(1)}s (${totalTokens} tokens)`
    );
  }

  /**
   * Generate summary text
   */
  private generateSummaryText(agent: AgentProgress, duration: number): string {
    const durationStr = duration < 1000
      ? `${duration}ms`
      : `${(duration / 1000).toFixed(1)}s`;

    const tokenStr = agent.tokens
      ? `${agent.tokens.total.toLocaleString()} tokens`
      : "N/A";

    let text = `${agent.name} ${agent.status} in ${durationStr}`;
    if (agent.tokens) {
      text += ` (${tokenStr})`;
    }
    if (agent.error) {
      text += `\nError: ${agent.error}`;
    }

    return text;
  }

  /**
   * Notify all listeners of progress update
   */
  private notifyListeners(progress: AgentProgress): void {
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch (error) {
        logger.warn(`[AgentSummary] Listener error: ${error}`);
      }
    }
  }

  /**
   * Cleanup completed agents older than maxAge
   */
  cleanup(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, agent] of this.agents) {
      if (
        agent.endTime &&
        now - agent.endTime > maxAgeMs
      ) {
        this.agents.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Reset all tracking
   */
  reset(): void {
    this.agents.clear();
    this.summaries.clear();
    logger.debug("[AgentSummary] Reset all tracking");
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let manager: AgentSummaryManager | null = null;

export function getAgentSummaryManager(): AgentSummaryManager {
  if (!manager) {
    manager = new AgentSummaryManager();
  }
  return manager;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register and track an agent
 */
export function registerAgent(
  agentId: string,
  name: string,
  parentId?: string
): AgentProgress {
  return getAgentSummaryManager().registerAgent(agentId, name, parentId);
}

/**
 * Update agent progress
 */
export function updateAgentProgress(
  agentId: string,
  updates: Partial<Omit<AgentProgress, "agentId">>
): void {
  getAgentSummaryManager().updateProgress(agentId, updates);
}

/**
 * Set agent activity
 */
export function setAgentActivity(agentId: string, activity: string): void {
  getAgentSummaryManager().setActivity(agentId, activity);
}

/**
 * Start an agent
 */
export function startAgent(agentId: string, activity?: string): void {
  getAgentSummaryManager().startAgent(agentId, activity);
}

/**
 * Complete an agent
 */
export function completeAgent(agentId: string, summary?: string): void {
  getAgentSummaryManager().completeAgent(agentId, summary);
}

/**
 * Fail an agent
 */
export function failAgent(agentId: string, error: string): void {
  getAgentSummaryManager().failAgent(agentId, error);
}

/**
 * Get agent progress
 */
export function getAgentProgress(agentId: string): AgentProgress | undefined {
  return getAgentSummaryManager().getAgent(agentId);
}

/**
 * Get all agent progress
 */
export function getAllAgentProgress(): AgentProgress[] {
  return getAgentSummaryManager().getAllAgents();
}

/**
 * Get agent summary
 */
export function getAgentSummary(agentId: string): AgentSummary | undefined {
  return getAgentSummaryManager().getSummary(agentId);
}

/**
 * Subscribe to progress updates
 */
export function onAgentProgress(
  listener: (progress: AgentProgress) => void
): () => void {
  return getAgentSummaryManager().onProgress(listener);
}

/**
 * Cleanup old agent data
 */
export function cleanupAgentData(maxAgeMs?: number): number {
  return getAgentSummaryManager().cleanup(maxAgeMs);
}
