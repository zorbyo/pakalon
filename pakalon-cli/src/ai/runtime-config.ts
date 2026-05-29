/**
 * Runtime Configuration — Model switching, thinking level, tool execution mode.
 *
 * Provides runtime configuration management:
 * - Model switching (setModel)
 * - Thinking level control (ThinkingLevel enum)
 * - Tool execution mode (parallel/sequential)
 * - System prompt callback
 * - OAuth token rotation
 *
 * Port from Pi's AgentHarness configuration.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ToolExecutionMode = "parallel" | "sequential";

export interface ModelConfig {
  /** Model ID */
  id: string;
  /** Model name */
  name: string;
  /** Provider */
  provider: string;
  /** Max tokens */
  maxTokens: number;
  /** Supports streaming */
  supportsStreaming: boolean;
  /** Supports thinking */
  supportsThinking: boolean;
  /** Cost per 1K input tokens */
  costPer1kInput?: number;
  /** Cost per 1K output tokens */
  costPer1kOutput?: number;
}

export interface RuntimeConfigState {
  /** Current model */
  currentModel: ModelConfig;
  /** Thinking level */
  thinkingLevel: ThinkingLevel;
  /** Tool execution mode */
  toolExecutionMode: ToolExecutionMode;
  /** System prompt */
  systemPrompt: string;
  /** Session ID */
  sessionId: string;
  /** Working directory */
  cwd: string;
}

export interface RuntimeConfigChangeEvent {
  /** What changed */
  property: keyof RuntimeConfigState;
  /** Previous value */
  previousValue: unknown;
  /** New value */
  newValue: unknown;
  /** Timestamp */
  timestamp: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Models
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: "anthropic/claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    maxTokens: 8192,
    supportsStreaming: true,
    supportsThinking: true,
  },
  {
    id: "anthropic/claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    maxTokens: 8192,
    supportsStreaming: true,
    supportsThinking: true,
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    maxTokens: 4096,
    supportsStreaming: true,
    supportsThinking: false,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    maxTokens: 4096,
    supportsStreaming: true,
    supportsThinking: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Configuration Manager
// ─────────────────────────────────────────────────────────────────────────────

export class RuntimeConfigManager {
  private state: RuntimeConfigState;
  private changeListeners: Array<(event: RuntimeConfigChangeEvent) => void> = [];

  constructor(sessionId: string, cwd: string) {
    this.state = {
      currentModel: DEFAULT_MODELS[0] ?? {
        id: "default",
        name: "Default",
        provider: "default",
        maxTokens: 4096,
        supportsStreaming: true,
        supportsThinking: false,
      },
      thinkingLevel: "off",
      toolExecutionMode: "parallel",
      systemPrompt: "",
      sessionId,
      cwd,
    };
  }

  /**
   * Subscribe to configuration changes.
   */
  onChange(listener: (event: RuntimeConfigChangeEvent) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      const index = this.changeListeners.indexOf(listener);
      if (index !== -1) {
        this.changeListeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit a configuration change event.
   */
  private emitChange(event: RuntimeConfigChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error("[RuntimeConfig] Change listener error", { error: String(error) });
      }
    }
  }

  /**
   * Get current model.
   */
  getModel(): ModelConfig {
    return { ...this.state.currentModel };
  }

  /**
   * Set model by ID.
   */
  setModel(modelId: string): boolean {
    const model = DEFAULT_MODELS.find((m) => m.id === modelId);
    if (!model) {
      logger.warn("[RuntimeConfig] Model not found", { modelId });
      return false;
    }

    const previous = this.state.currentModel;
    this.state.currentModel = model;

    this.emitChange({
      property: "currentModel",
      previousValue: previous,
      newValue: model,
      timestamp: new Date(),
    });

    logger.debug("[RuntimeConfig] Model set", { modelId });
    return true;
  }

  /**
   * Get available models.
   */
  getAvailableModels(): ModelConfig[] {
    return [...DEFAULT_MODELS];
  }

  /**
   * Get thinking level.
   */
  getThinkingLevel(): ThinkingLevel {
    return this.state.thinkingLevel;
  }

  /**
   * Set thinking level.
   */
  setThinkingLevel(level: ThinkingLevel): void {
    const previous = this.state.thinkingLevel;
    this.state.thinkingLevel = level;

    this.emitChange({
      property: "thinkingLevel",
      previousValue: previous,
      newValue: level,
      timestamp: new Date(),
    });

    logger.debug("[RuntimeConfig] Thinking level set", { level });
  }

  /**
   * Get tool execution mode.
   */
  getToolExecutionMode(): ToolExecutionMode {
    return this.state.toolExecutionMode;
  }

  /**
   * Set tool execution mode.
   */
  setToolExecutionMode(mode: ToolExecutionMode): void {
    const previous = this.state.toolExecutionMode;
    this.state.toolExecutionMode = mode;

    this.emitChange({
      property: "toolExecutionMode",
      previousValue: previous,
      newValue: mode,
      timestamp: new Date(),
    });

    logger.debug("[RuntimeConfig] Tool execution mode set", { mode });
  }

  /**
   * Get system prompt.
   */
  getSystemPrompt(): string {
    return this.state.systemPrompt;
  }

  /**
   * Set system prompt.
   */
  setSystemPrompt(prompt: string): void {
    const previous = this.state.systemPrompt;
    this.state.systemPrompt = prompt;

    this.emitChange({
      property: "systemPrompt",
      previousValue: previous,
      newValue: prompt,
      timestamp: new Date(),
    });

    logger.debug("[RuntimeConfig] System prompt set", {
      length: prompt.length,
    });
  }

  /**
   * Get full state.
   */
  getState(): RuntimeConfigState {
    return { ...this.state };
  }

  /**
   * Update multiple config values at once.
   */
  update(updates: Partial<RuntimeConfigState>): void {
    for (const [key, value] of Object.entries(updates)) {
      const k = key as keyof RuntimeConfigState;
      if (k === "currentModel") {
        this.setModel((value as ModelConfig).id);
      } else if (k === "thinkingLevel") {
        this.setThinkingLevel(value as ThinkingLevel);
      } else if (k === "toolExecutionMode") {
        this.setToolExecutionMode(value as ToolExecutionMode);
      } else if (k === "systemPrompt") {
        this.setSystemPrompt(value as string);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let managerInstance: RuntimeConfigManager | null = null;

/**
 * Get or create the singleton runtime config manager.
 */
export function getRuntimeConfigManager(
  sessionId?: string,
  cwd?: string
): RuntimeConfigManager {
  if (!managerInstance) {
    managerInstance = new RuntimeConfigManager(
      sessionId ?? "default",
      cwd ?? process.cwd()
    );
  }
  return managerInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetRuntimeConfigManager(): void {
  managerInstance = null;
}
