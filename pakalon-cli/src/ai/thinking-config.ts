/**
 * Thinking Control — Token budget management for agent reasoning.
 *
 * Controls how much the agent "thinks" before responding:
 * - thinkingBudget: Max tokens allocated for internal reasoning
 * - outputBudget: Max tokens for the final response
 * - mode: "auto" | "balanced" | "concise" | "extended" — preset configurations
 *
 * This is the token allocation layer that integrates with the Vercel AI SDK's
 * maxTokens parameter and extended thinking features.
 *
 * Usage:
 *   const controller = new ThinkingController();
 *   controller.setMode("extended");
 *   const modelOptions = controller.applyToModelOptions({});
 *   // Pass modelOptions to streamText() or generateText()
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ThinkingMode = "auto" | "balanced" | "concise" | "extended";

export interface ThinkingConfig {
  /** Preset mode identifier */
  mode: ThinkingMode;
  /** Max tokens for internal reasoning/thinking (0 = no thinking) */
  thinkingBudget: number;
  /** Max tokens for final output */
  outputBudget: number;
  /** Whether to show thinking tokens in output (if supported by model) */
  showThinking: boolean;
  /** Whether to enable extended thinking mode */
  extendedThinking: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────────────────────────

export const THINKING_PRESETS: Record<ThinkingMode, Omit<ThinkingConfig, "mode">> = {
  auto: {
    thinkingBudget: 0,
    outputBudget: 4096,
    showThinking: false,
    extendedThinking: false,
  },
  balanced: {
    thinkingBudget: 2048,
    outputBudget: 4096,
    showThinking: true,
    extendedThinking: false,
  },
  concise: {
    thinkingBudget: 512,
    outputBudget: 2048,
    showThinking: false,
    extendedThinking: false,
  },
  extended: {
    thinkingBudget: 8192,
    outputBudget: 8192,
    showThinking: true,
    extendedThinking: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Thinking Controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages thinking and token budgets for agent responses.
 *
 * Provides preset configurations and the ability to fine-tune individual
 * parameters. Integrates with the Vercel AI SDK model options.
 */
export class ThinkingController {
  private config: ThinkingConfig;
  private onBudgetChange?: (config: ThinkingConfig) => void;

  constructor(initial?: Partial<ThinkingConfig>) {
    this.config = {
      ...THINKING_PRESETS.auto,
      mode: "auto",
      ...initial,
    };
  }

  /**
   * Get the current thinking configuration.
   */
  getConfig(): ThinkingConfig {
    return { ...this.config };
  }

  /**
   * Set the thinking mode from presets.
   * This overwrites thinkingBudget, outputBudget, showThinking, and extendedThinking.
   */
  setMode(mode: ThinkingMode): void {
    const preset = THINKING_PRESETS[mode];
    this.config.mode = mode;
    this.config.thinkingBudget = preset.thinkingBudget;
    this.config.outputBudget = preset.outputBudget;
    this.config.showThinking = preset.showThinking;
    this.config.extendedThinking = preset.extendedThinking;
    this.notifyChange();
    logger.debug("[Thinking] Mode set", { mode });
  }

  /**
   * Set the thinking budget (tokens allocated for internal reasoning).
   * Set to 0 to disable thinking.
   */
  setThinkingBudget(tokens: number): void {
    this.config.thinkingBudget = Math.max(0, Math.min(tokens, 65536));
    this.config.mode = "auto"; // Reset to custom mode
    this.notifyChange();
    logger.debug("[Thinking] Budget set", { tokens });
  }

  /**
   * Set the maximum output tokens.
   */
  setOutputBudget(tokens: number): void {
    this.config.outputBudget = Math.max(256, Math.min(tokens, 65536));
    this.notifyChange();
    logger.debug("[Thinking] Output budget set", { tokens });
  }

  /**
   * Toggle whether thinking tokens are shown in the output.
   */
  setShowThinking(show: boolean): void {
    this.config.showThinking = show;
    this.notifyChange();
    logger.debug("[Thinking] Show thinking", { show });
  }

  /**
   * Toggle extended thinking mode (for complex reasoning tasks).
   */
  setExtendedThinking(enabled: boolean): void {
    this.config.extendedThinking = enabled;
    if (enabled && this.config.thinkingBudget < 4096) {
      this.config.thinkingBudget = 4096;
    }
    this.notifyChange();
    logger.debug("[Thinking] Extended thinking", { enabled });
  }

  /**
   * Apply the current thinking configuration to Vercel AI SDK model options.
   *
   * Sets maxTokens (thinkingBudget + outputBudget) and any model-specific
   * extended thinking parameters.
   */
  applyToModelOptions(options: Record<string, unknown>): Record<string, unknown> {
    const effectiveMaxTokens = this.getEffectiveMaxTokens();

    return {
      ...options,
      maxTokens: effectiveMaxTokens,
      ...(this.config.extendedThinking
        ? { thinking: { type: "extended", budget: this.config.thinkingBudget } }
        : {}),
    };
  }

  /**
   * Get the effective max tokens (thinking + output budget combined).
   */
  getEffectiveMaxTokens(): number {
    return this.config.thinkingBudget + this.config.outputBudget;
  }

  /**
   * Reset to the default (auto) configuration.
   */
  reset(): void {
    this.setMode("auto");
    logger.debug("[Thinking] Reset to default");
  }

  /**
   * Register a callback for configuration changes.
   */
  onChange(cb: (config: ThinkingConfig) => void): void {
    this.onBudgetChange = cb;
  }

  /**
   * Create a preset configuration without instantiating a controller.
   */
  static createPreset(mode: ThinkingMode): ThinkingConfig {
    return {
      mode,
      ...THINKING_PRESETS[mode],
    };
  }

  /**
   * Estimate the needed thinking mode based on task description.
   *
   * Uses simple heuristics:
   * - "extended" for complex reasoning (architect, design, refactor)
   * - "concise" for simple answers (status, help, version)
   * - "balanced" for moderate tasks
   * - "auto" as fallback
   */
  static estimateNeededMode(taskDescription: string): ThinkingMode {
    const lower = taskDescription.toLowerCase();

    // Simple/trivial tasks
    if (
      lower.length < 30 ||
      /\b(version|help|status|list|ls|pwd|whoami|date|time|yes|no|ok)\b/.test(lower)
    ) {
      return "concise";
    }

    // Complex reasoning tasks
    if (
      /\b(architect|design|plan|refactor|optimize|migrate|strategy|complex|analysis)\b/.test(lower) ||
      lower.length > 500
    ) {
      return "extended";
    }

    // Moderate tasks
    if (
      /\b(implement|build|create|write|debug|fix|test|deploy|configure)\b/.test(lower)
    ) {
      return "balanced";
    }

    return "auto";
  }

  /**
   * Serialize the configuration to a plain object.
   */
  serialize(): ThinkingConfig {
    return { ...this.config };
  }

  /**
   * Create a controller from a serialized config.
   */
  static deserialize(data: ThinkingConfig): ThinkingController {
    return new ThinkingController(data);
  }

  /**
   * Notify listeners of configuration changes.
   */
  private notifyChange(): void {
    try {
      this.onBudgetChange?.(this.config);
    } catch {
      // Swallow listener errors
    }
  }
}
