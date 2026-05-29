/**
 * Model Switcher — Runtime model switching and configuration.
 *
 * Enables changing the active model during a session without restarting:
 * - setModel() — Switch to a different model
 * - getModel() — Get current model
 * - Model presets for common configurations
 * - Session logging of model changes
 *
 * Usage:
 *   const switcher = new ModelSwitcher("anthropic/claude-sonnet-4-20250514");
 *   await switcher.setModel("openai/gpt-4o");
 *   console.log(switcher.getModel()); // "openai/gpt-4o"
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ModelProvider = "anthropic" | "openai" | "google" | "meta" | "mistral" | "deepseek" | "custom";

export interface ModelConfig {
  /** Full model identifier (e.g., "anthropic/claude-sonnet-4-20250514") */
  id: string;
  /** Provider name */
  provider: ModelProvider;
  /** Human-readable display name */
  displayName: string;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Recommended max output tokens */
  maxOutput: number;
  /** Whether the model supports extended thinking */
  supportsExtendedThinking: boolean;
  /** Cost per 1M input tokens (USD) */
  costPer1MInput?: number;
  /** Cost per 1M output tokens (USD) */
  costPer1MOutput?: number;
}

export interface ModelChangeEvent {
  /** Previous model ID */
  from: string;
  /** New model ID */
  to: string;
  /** When the change happened */
  timestamp: Date;
  /** Reason for the change */
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Presets
// ─────────────────────────────────────────────────────────────────────────────

export const MODEL_PRESETS: Record<string, ModelConfig> = {
  "anthropic/claude-sonnet-4-20250514": {
    id: "anthropic/claude-sonnet-4-20250514",
    provider: "anthropic",
    displayName: "Claude Sonnet 4",
    contextWindow: 200000,
    maxOutput: 8192,
    supportsExtendedThinking: true,
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
  },
  "openai/gpt-4o": {
    id: "openai/gpt-4o",
    provider: "openai",
    displayName: "GPT-4o",
    contextWindow: 128000,
    maxOutput: 4096,
    supportsExtendedThinking: false,
    costPer1MInput: 2.5,
    costPer1MOutput: 10.0,
  },
  "anthropic/claude-3.5-sonnet": {
    id: "anthropic/claude-3.5-sonnet",
    provider: "anthropic",
    displayName: "Claude 3.5 Sonnet",
    contextWindow: 200000,
    maxOutput: 8192,
    supportsExtendedThinking: false,
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
  },
  "google/gemini-2.0-flash-001": {
    id: "google/gemini-2.0-flash-001",
    provider: "google",
    displayName: "Gemini 2.0 Flash",
    contextWindow: 1048576,
    maxOutput: 8192,
    supportsExtendedThinking: true,
    costPer1MInput: 0.10,
    costPer1MOutput: 0.40,
  },
  "deepseek/deepseek-chat": {
    id: "deepseek/deepseek-chat",
    provider: "deepseek",
    displayName: "DeepSeek V3",
    contextWindow: 128000,
    maxOutput: 4096,
    supportsExtendedThinking: false,
    costPer1MInput: 0.27,
    costPer1MOutput: 1.10,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Model Switcher
// ─────────────────────────────────────────────────────────────────────────────

export class ModelSwitcher {
  private currentModel: ModelConfig;
  private changeHistory: ModelChangeEvent[] = [];
  private maxHistorySize = 50;
  private onChangeCallbacks: Array<(event: ModelChangeEvent) => void> = [];

  constructor(initialModelId?: string) {
    const resolved = initialModelId
      ? this.resolveModel(initialModelId)
      : undefined;
    this.currentModel = resolved ?? MODEL_PRESETS["anthropic/claude-sonnet-4-20250514"]!;
  }

  /**
   * Get the current model configuration.
   */
  getModel(): ModelConfig {
    return { ...this.currentModel };
  }

  /**
   * Get the current model ID string.
   */
  getModelId(): string {
    return this.currentModel.id;
  }

  /**
   * Switch to a different model.
   *
   * @param modelId - Model identifier (full ID or shorthand)
   * @param reason - Optional reason for the change (for logging)
   * @returns Whether the switch was successful
   */
  async setModel(modelId: string, reason?: string): Promise<boolean> {
    const resolved = this.resolveModel(modelId);
    if (!resolved) {
      logger.warn("[ModelSwitcher] Unknown model", { modelId });
      return false;
    }

    if (resolved.id === this.currentModel.id) {
      logger.debug("[ModelSwitcher] Already using model", { modelId });
      return true;
    }

    const previous = this.currentModel;
    this.currentModel = resolved;

    const event: ModelChangeEvent = {
      from: previous.id,
      to: resolved.id,
      timestamp: new Date(),
      reason,
    };

    this.changeHistory.push(event);
    if (this.changeHistory.length > this.maxHistorySize) {
      this.changeHistory.shift();
    }

    // Notify callbacks
    for (const cb of this.onChangeCallbacks) {
      try {
        cb(event);
      } catch {
        // Swallow callback errors
      }
    }

    logger.info("[ModelSwitcher] Model changed", {
      from: previous.id,
      to: resolved.id,
      reason,
    });

    return true;
  }

  /**
   * Register a callback for model changes.
   */
  onChange(cb: (event: ModelChangeEvent) => void): () => void {
    this.onChangeCallbacks.push(cb);
    return () => {
      this.onChangeCallbacks = this.onChangeCallbacks.filter((c) => c !== cb);
    };
  }

  /**
   * Get model change history.
   */
  getChangeHistory(): ModelChangeEvent[] {
    return [...this.changeHistory];
  }

  /**
   * Get the number of model changes in this session.
   */
  getChangeCount(): number {
    return this.changeHistory.length;
  }

  /**
   * List available model presets.
   */
  static listModels(): ModelConfig[] {
    return Object.values(MODEL_PRESETS);
  }

  /**
   * Register a custom model preset at runtime.
   */
  static registerModel(config: ModelConfig): void {
    MODEL_PRESETS[config.id] = config;
    logger.debug("[ModelSwitcher] Registered custom model", { id: config.id });
  }

  /**
   * Resolve a model ID to a ModelConfig.
   * Supports full IDs and shorthand lookups.
   */
  private resolveModel(modelId: string): ModelConfig | undefined {
    // Exact match
    if (MODEL_PRESETS[modelId]) return MODEL_PRESETS[modelId];

    // Try matching by partial ID
    const lower = modelId.toLowerCase();
    const match = Object.values(MODEL_PRESETS).find(
      (m) =>
        m.id.toLowerCase().includes(lower) ||
        m.displayName.toLowerCase().includes(lower) ||
        m.provider.toLowerCase() === lower,
    );

    if (match) return match;

    // For unknown models, create a best-effort config
    if (modelId.includes("/")) {
      const parts = modelId.split("/");
      const provider = parts[0] as ModelProvider;
      return {
        id: modelId,
        provider: ["anthropic", "openai", "google", "meta", "mistral", "deepseek"].includes(provider)
          ? provider
          : "custom",
        displayName: parts[1] ?? modelId,
        contextWindow: 128000,
        maxOutput: 4096,
        supportsExtendedThinking: false,
      };
    }

    return undefined;
  }
}
