/**
 * Bridge poll interval configuration.
 *
 * Provides GrowthBook-backed live tuning of poll rates for both
 * standalone bridge and REPL bridge.
 */

import type { PollIntervalConfig } from "./types.js";
import { DEFAULT_POLL_CONFIG } from "./types.js";

/**
 * Fetch the bridge poll interval config.
 * In production, this would be backed by GrowthBook.
 * For now, returns defaults.
 */
export function getPollIntervalConfig(): PollIntervalConfig {
  // In a full implementation, this would call:
  // getFeatureValue_CACHED_WITH_REFRESH('tengu_bridge_poll_interval_config', DEFAULT_POLL_CONFIG, 5 * 60 * 1000)
  return DEFAULT_POLL_CONFIG;
}

/**
 * Validate poll config values.
 * Ensures at-capacity liveness mechanisms are enabled.
 */
export function validatePollConfig(
  cfg: PollIntervalConfig
): { valid: boolean; error?: string } {
  if (
    cfg.non_exclusive_heartbeat_interval_ms > 0 ||
    cfg.poll_interval_ms_at_capacity > 0
  ) {
    return { valid: true };
  }

  if (
    cfg.non_exclusive_heartbeat_interval_ms <= 0 &&
    cfg.multisession_poll_interval_ms_at_capacity <= 0
  ) {
    return {
      valid: false,
      error:
        "at-capacity liveness requires non_exclusive_heartbeat_interval_ms > 0 or poll_interval_ms_at_capacity > 0",
    };
  }

  return { valid: true };
}

export type { PollIntervalConfig };