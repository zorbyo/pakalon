/**
 * Command Indicators
 *
 * Provides visual indicators (blinking) for running commands in the TUI.
 * Shows when commands are executing and stops when complete.
 *
 * Features:
 * - Spinning indicator animation
 * - Command status tracking
 * - Multiple concurrent indicators
 * - Customizable spinner characters
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface CommandIndicator {
  /** Unique command ID */
  commandId: string;
  /** Command name/description */
  name: string;
  /** Current status */
  status: CommandStatus;
  /** Start time */
  startTime: number;
  /** End time (if completed) */
  endTime?: number;
  /** Progress message */
  message?: string;
  /** Spinner frame index */
  spinnerFrame: number;
}

export interface IndicatorConfig {
  /** Spinner characters */
  spinnerChars?: string[];
  /** Animation interval in ms */
  intervalMs?: number;
  /** Enable colors */
  useColors?: boolean;
}

// ---------------------------------------------------------------------------
// Spinner Animation
// ---------------------------------------------------------------------------

const DEFAULT_SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const SPINNER_COLORS = {
  running: "\x1b[36m", // Cyan
  completed: "\x1b[32m", // Green
  failed: "\x1b[31m", // Red
  cancelled: "\x1b[33m", // Yellow
  reset: "\x1b[0m", // Reset
};

// ---------------------------------------------------------------------------
// Indicator Manager
// ---------------------------------------------------------------------------

class CommandIndicatorManager {
  private indicators: Map<string, CommandIndicator> = new Map();
  private config: IndicatorConfig;
  private animationIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private renderCallback?: (indicator: CommandIndicator) => void;

  constructor(config?: IndicatorConfig) {
    this.config = {
      spinnerChars: DEFAULT_SPINNER_CHARS,
      intervalMs: 80,
      useColors: true,
      ...config,
    };
  }

  /**
   * Register a new command indicator
   */
  register(commandId: string, name: string): CommandIndicator {
    const indicator: CommandIndicator = {
      commandId,
      name,
      status: "pending",
      startTime: Date.now(),
      spinnerFrame: 0,
    };

    this.indicators.set(commandId, indicator);
    logger.debug(`[Indicator] Registered: ${name} (${commandId})`);

    return indicator;
  }

  /**
   * Start animation for a command
   */
  start(commandId: string, message?: string): void {
    const indicator = this.indicators.get(commandId);
    if (!indicator) return;

    indicator.status = "running";
    indicator.startTime = Date.now();
    indicator.message = message;

    // Start spinner animation
    const interval = setInterval(() => {
      indicator.spinnerFrame =
        (indicator.spinnerFrame + 1) % (this.config.spinnerChars?.length || 10);
      this.renderIndicator(indicator);
    }, this.config.intervalMs);

    this.animationIntervals.set(commandId, interval);
    this.renderIndicator(indicator);
  }

  /**
   * Update indicator message
   */
  updateMessage(commandId: string, message: string): void {
    const indicator = this.indicators.get(commandId);
    if (!indicator) return;

    indicator.message = message;
    this.renderIndicator(indicator);
  }

  /**
   * Complete a command indicator
   */
  complete(commandId: string, success: boolean = true): void {
    const indicator = this.indicators.get(commandId);
    if (!indicator) return;

    // Stop animation
    const interval = this.animationIntervals.get(commandId);
    if (interval) {
      clearInterval(interval);
      this.animationIntervals.delete(commandId);
    }

    indicator.status = success ? "completed" : "failed";
    indicator.endTime = Date.now();
    indicator.spinnerFrame = 0;

    this.renderIndicator(indicator);

    // Auto-remove after delay
    setTimeout(() => {
      this.remove(commandId);
    }, 2000);
  }

  /**
   * Cancel a command indicator
   */
  cancel(commandId: string): void {
    const indicator = this.indicators.get(commandId);
    if (!indicator) return;

    // Stop animation
    const interval = this.animationIntervals.get(commandId);
    if (interval) {
      clearInterval(interval);
      this.animationIntervals.delete(commandId);
    }

    indicator.status = "cancelled";
    indicator.endTime = Date.now();
    indicator.spinnerFrame = 0;

    this.renderIndicator(indicator);

    // Auto-remove after delay
    setTimeout(() => {
      this.remove(commandId);
    }, 1000);
  }

  /**
   * Remove an indicator
   */
  remove(commandId: string): void {
    const interval = this.animationIntervals.get(commandId);
    if (interval) {
      clearInterval(interval);
      this.animationIntervals.delete(commandId);
    }

    this.indicators.delete(commandId);
  }

  /**
   * Get all active indicators
   */
  getActiveIndicators(): CommandIndicator[] {
    return Array.from(this.indicators.values()).filter(
      (i) => i.status === "running" || i.status === "pending"
    );
  }

  /**
   * Get indicator by ID
   */
  getIndicator(commandId: string): CommandIndicator | undefined {
    return this.indicators.get(commandId);
  }

  /**
   * Render indicator to console
   */
  private renderIndicator(indicator: CommandIndicator): void {
    if (this.renderCallback) {
      this.renderCallback(indicator);
      return;
    }

    // Default rendering
    const spinner = this.config.spinnerChars?.[indicator.spinnerFrame] || "●";
    const elapsed = indicator.endTime
      ? indicator.endTime - indicator.startTime
      : Date.now() - indicator.startTime;
    const elapsedStr = `${(elapsed / 1000).toFixed(1)}s`;

    let statusIcon: string;
    let color: string;

    switch (indicator.status) {
      case "running":
        statusIcon = spinner;
        color = this.config.useColors ? SPINNER_COLORS.running : "";
        break;
      case "completed":
        statusIcon = "✓";
        color = this.config.useColors ? SPINNER_COLORS.completed : "";
        break;
      case "failed":
        statusIcon = "✗";
        color = this.config.useColors ? SPINNER_COLORS.failed : "";
        break;
      case "cancelled":
        statusIcon = "⊘";
        color = this.config.useColors ? SPINNER_COLORS.cancelled : "";
        break;
      default:
        statusIcon = "○";
        color = "";
    }

    const reset = this.config.useColors ? SPINNER_COLORS.reset : "";
    const message = indicator.message ? ` - ${indicator.message}` : "";

    // Build line
    const line = `${color}${statusIcon}${reset} ${indicator.name}${message} ${color}(${elapsedStr})${reset}`;

    // Clear line and write
    process.stdout.write(`\r\x1b[K${line}`);

    // Add newline on completion
    if (
      indicator.status === "completed" ||
      indicator.status === "failed" ||
      indicator.status === "cancelled"
    ) {
      process.stdout.write("\n");
    }
  }

  /**
   * Set custom render callback
   */
  onRender(callback: (indicator: CommandIndicator) => void): void {
    this.renderCallback = callback;
  }

  /**
   * Clear all indicators
   */
  clear(): void {
    // Stop all animations
    for (const interval of this.animationIntervals.values()) {
      clearInterval(interval);
    }
    this.animationIntervals.clear();
    this.indicators.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let manager: CommandIndicatorManager | null = null;

/**
 * Initialize command indicator manager
 */
export function initCommandIndicators(config?: IndicatorConfig): CommandIndicatorManager {
  manager = new CommandIndicatorManager(config);
  return manager;
}

/**
 * Get command indicator manager
 */
export function getCommandIndicators(): CommandIndicatorManager {
  if (!manager) {
    manager = new CommandIndicatorManager();
  }
  return manager;
}

/**
 * Create and start a command indicator
 */
export function startCommandIndicator(
  commandId: string,
  name: string,
  message?: string
): CommandIndicator {
  const mgr = getCommandIndicators();
  const indicator = mgr.register(commandId, name);
  mgr.start(commandId, message);
  return indicator;
}

/**
 * Complete a command indicator
 */
export function completeCommandIndicator(
  commandId: string,
  success: boolean = true
): void {
  getCommandIndicators().complete(commandId, success);
}

/**
 * Update command indicator message
 */
export function updateCommandIndicator(
  commandId: string,
  message: string
): void {
  getCommandIndicators().updateMessage(commandId, message);
}

/**
 * Cancel a command indicator
 */
export function cancelCommandIndicator(commandId: string): void {
  getCommandIndicators().cancel(commandId);
}
