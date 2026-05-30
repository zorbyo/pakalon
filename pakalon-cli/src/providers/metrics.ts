/**
 * Metrics Collection for Pakalon CLI
 *
 * Tracks usage metrics for monitoring and analytics.
 */

import logger from "@/utils/logger.js";
import { isFeatureEnabled } from "@/config/features.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Metric {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: Date;
}

export interface MetricConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

export interface ProviderMetric {
  providerId: string;
  latencyMs: number;
  success: boolean;
  tokens?: number;
  model?: string;
}

export interface TokenMetric {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}

// ---------------------------------------------------------------------------
// Default Configurations
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: MetricConfig = {
  enabled: false,
  batchSize: 10,
  flushIntervalMs: 30000,
};

// ---------------------------------------------------------------------------
// Metrics Collector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  private metrics: Metric[] = [];
  private config: MetricConfig;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<MetricConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Check if analytics feature is enabled
    if (isFeatureEnabled("analytics")) {
      this.config.enabled = true;
    }

    if (this.config.enabled && this.config.flushIntervalMs) {
      this.startAutoFlush();
    }
  }

  /**
   * Record a metric
   */
  recordMetric(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.config.enabled) {
      return;
    }

    const metric: Metric = {
      name,
      value,
      labels,
      timestamp: new Date(),
    };

    this.metrics.push(metric);

    if (this.metrics.length >= (this.config.batchSize || 10)) {
      this.flush();
    }
  }

  /**
   * Record provider latency
   */
  recordProviderLatency(providerId: string, latencyMs: number, success: boolean): void {
    this.recordMetric("provider_latency_ms", latencyMs, {
      provider: providerId,
      success: success.toString(),
    });
  }

  /**
   * Record token usage
   */
  recordTokenUsage(providerId: string, modelId: string, inputTokens: number, outputTokens: number): void {
    this.recordMetric("token_usage", inputTokens + outputTokens, {
      provider: providerId,
      model: modelId,
      type: "total",
    });

    this.recordMetric("token_usage", inputTokens, {
      provider: providerId,
      model: modelId,
      type: "input",
    });

    this.recordMetric("token_usage", outputTokens, {
      provider: providerId,
      model: modelId,
      type: "output",
    });
  }

  /**
   * Record provider health
   */
  recordProviderHealth(providerId: string, healthy: boolean, latencyMs: number): void {
    this.recordMetric("provider_health", healthy ? 1 : 0, {
      provider: providerId,
    });

    this.recordMetric("provider_latency_ms", latencyMs, {
      provider: providerId,
    });
  }

  /**
   * Record error
   */
  recordError(providerId: string, errorType: string, errorMessage: string): void {
    this.recordMetric("error_count", 1, {
      provider: providerId,
      error_type: errorType,
      error_message: errorMessage,
    });
  }

  /**
   * Record feature usage
   */
  recordFeatureUsage(feature: string, usage: number = 1): void {
    this.recordMetric("feature_usage", usage, {
      feature,
    });
  }

  /**
   * Start auto-flush timer
   */
  private startAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.metrics.length > 0) {
        this.flush();
      }
    }, this.config.flushIntervalMs);
  }

  /**
   * Stop auto-flush timer
   */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Flush metrics to endpoint
   */
  async flush(): Promise<void> {
    if (this.metrics.length === 0) {
      return;
    }

    const metricsToSend = [...this.metrics];
    this.metrics = [];

    if (!this.config.endpoint) {
      // Log metrics instead of sending
      logger.debug(`[Metrics] Flushing ${metricsToSend.length} metrics`);
      for (const metric of metricsToSend) {
        logger.debug(`[Metrics] ${metric.name}: ${metric.value}`, metric.labels);
      }
      return;
    }

    try {
      await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({ metrics: metricsToSend }),
      });
    } catch (error) {
      logger.error(`[Metrics] Failed to flush metrics: ${error}`);
      // Re-add failed metrics
      this.metrics.unshift(...metricsToSend);
    }
  }

  /**
   * Get metrics count
   */
  getMetricsCount(): number {
    return this.metrics.length;
  }

  /**
   * Clear metrics
   */
  clear(): void {
    this.metrics = [];
  }
}

// Global instance
export const metricsCollector = new MetricsCollector();

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Record a metric
 */
export function recordMetric(name: string, value: number, labels: Record<string, string> = {}): void {
  metricsCollector.recordMetric(name, value, labels);
}

/**
 * Record provider latency
 */
export function recordProviderLatency(providerId: string, latencyMs: number, success: boolean): void {
  metricsCollector.recordProviderLatency(providerId, latencyMs, success);
}

/**
 * Record token usage
 */
export function recordTokenUsage(
  providerId: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): void {
  metricsCollector.recordTokenUsage(providerId, modelId, inputTokens, outputTokens);
}

/**
 * Record provider health
 */
export function recordProviderHealth(providerId: string, healthy: boolean, latencyMs: number): void {
  metricsCollector.recordProviderHealth(providerId, healthy, latencyMs);
}

/**
 * Record error
 */
export function recordError(providerId: string, errorType: string, errorMessage: string): void {
  metricsCollector.recordError(providerId, errorType, errorMessage);
}

/**
 * Record feature usage
 */
export function recordFeatureUsage(feature: string, usage: number = 1): void {
  metricsCollector.recordFeatureUsage(feature, usage);
}

/**
 * Flush metrics
 */
export async function flushMetrics(): Promise<void> {
  return metricsCollector.flush();
}
