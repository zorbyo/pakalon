/**
 * Policy Limits Service
 *
 * Enforces rate limits, resource constraints, and policy boundaries
 * for CLI operations. Provides configurable limits with enforcement.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import logger from "@/utils/logger.js";

export type PolicyLimitType =
  | "api-calls"
  | "tokens"
  | "sessions"
  | "skills"
  | "plugins"
  | "storage"
  | "bandwidth"
  | "concurrent-agents"
  | "session-duration"
  | "file-size";

export interface PolicyLimit {
  type: PolicyLimitType;
  limit: number;
  used: number;
  unit: string;
  resetsAt: number | null;
  isEnforced: boolean;
}

export interface PolicyLimitsConfig {
  apiCallsPerMinute?: number;
  apiCallsPerHour?: number;
  tokensPerSession?: number;
  maxSessions?: number;
  maxSkills?: number;
  maxPlugins?: number;
  maxStorageMB?: number;
  maxBandwidthMB?: number;
  maxConcurrentAgents?: number;
  maxSessionDurationMinutes?: number;
  maxFileSizeMB?: number;
  enforceLimits?: boolean;
}

export interface LimitCheckResult {
  allowed: boolean;
  limit: PolicyLimit;
  remaining: number;
  retryAfter?: number;
  message?: string;
}

export interface UsageTracker {
  [key: string]: {
    count: number;
    total: number;
    lastReset: number;
    windowMs: number;
  };
}

const LIMITS_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "pakalon",
  "policy-limits.json",
);

const USAGE_TRACKER_PATH = path.join(
  os.homedir(),
  ".config",
  "pakalon",
  "usage-tracker.json",
);

const DEFAULT_LIMITS: Required<PolicyLimitsConfig> = {
  apiCallsPerMinute: 60,
  apiCallsPerHour: 1000,
  tokensPerSession: 100000,
  maxSessions: 50,
  maxSkills: 100,
  maxPlugins: 20,
  maxStorageMB: 500,
  maxBandwidthMB: 1000,
  maxConcurrentAgents: 5,
  maxSessionDurationMinutes: 480,
  maxFileSizeMB: 50,
  enforceLimits: true,
};

let config: Required<PolicyLimitsConfig>;
let usageTracker: UsageTracker = {};
let activeAgents = 0;
let currentSessionTokens = 0;
let currentSessionDuration = 0;

function loadConfig(): Required<PolicyLimitsConfig> {
  try {
    if (fs.existsSync(LIMITS_CONFIG_PATH)) {
      const raw = fs.readFileSync(LIMITS_CONFIG_PATH, "utf-8");
      const loaded = JSON.parse(raw) as Partial<PolicyLimitsConfig>;
      return { ...DEFAULT_LIMITS, ...loaded };
    }
  } catch {
    // Config corrupted
  }
  return DEFAULT_LIMITS;
}

function saveConfig(): void {
  try {
    const dir = path.dirname(LIMITS_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LIMITS_CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {
    // Best effort
  }
}

function loadUsageTracker(): void {
  try {
    if (fs.existsSync(USAGE_TRACKER_PATH)) {
      const raw = fs.readFileSync(USAGE_TRACKER_PATH, "utf-8");
      usageTracker = JSON.parse(raw) as UsageTracker;
    }
  } catch {
    usageTracker = {};
  }
}

function saveUsageTracker(): void {
  try {
    const dir = path.dirname(USAGE_TRACKER_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(USAGE_TRACKER_PATH, JSON.stringify(usageTracker, null, 2));
  } catch {
    // Best effort
  }
}

function getOrCreateTracker(
  key: string,
  windowMs: number,
): UsageTracker[string] {
  const now = Date.now();
  const existing = usageTracker[key];

  if (!existing || now - existing.lastReset > windowMs) {
    usageTracker[key] = {
      count: 0,
      total: 0,
      lastReset: now,
      windowMs,
    };
  }

  return usageTracker[key]!;
}

function incrementUsage(key: string, windowMs: number, amount = 1): void {
  const tracker = getOrCreateTracker(key, windowMs);
  tracker.count += amount;
  tracker.total += amount;
  saveUsageTracker();
}

function getUsage(key: string, windowMs: number): number {
  const tracker = getOrCreateTracker(key, windowMs);
  return tracker.count;
}

export function initPolicyLimits(overrides?: PolicyLimitsConfig): void {
  config = { ...loadConfig(), ...overrides };
  loadUsageTracker();
  logger.info("[policyLimits] initialized", { enforceLimits: config.enforceLimits });
}

export function checkApiCallLimit(): LimitCheckResult {
  const perMinute = getUsage("api-calls-minute", 60 * 1000);
  const perHour = getUsage("api-calls-hour", 60 * 60 * 1000);

  if (config.enforceLimits && perMinute >= config.apiCallsPerMinute) {
    return {
      allowed: false,
      limit: {
        type: "api-calls",
        limit: config.apiCallsPerMinute,
        used: perMinute,
        unit: "calls/minute",
        resetsAt: Date.now() + 60 * 1000,
        isEnforced: true,
      },
      remaining: 0,
      retryAfter: 60,
      message: `API call limit reached: ${perMinute}/${config.apiCallsPerMinute} per minute`,
    };
  }

  if (config.enforceLimits && perHour >= config.apiCallsPerHour) {
    return {
      allowed: false,
      limit: {
        type: "api-calls",
        limit: config.apiCallsPerHour,
        used: perHour,
        unit: "calls/hour",
        resetsAt: Date.now() + 60 * 60 * 1000,
        isEnforced: true,
      },
      remaining: 0,
      retryAfter: 3600,
      message: `API call limit reached: ${perHour}/${config.apiCallsPerHour} per hour`,
    };
  }

  return {
    allowed: true,
    limit: {
      type: "api-calls",
      limit: config.apiCallsPerMinute,
      used: perMinute,
      unit: "calls/minute",
      resetsAt: Date.now() + 60 * 1000,
      isEnforced: config.enforceLimits,
    },
    remaining: config.apiCallsPerMinute - perMinute,
  };
}

export function recordApiCall(): void {
  incrementUsage("api-calls-minute", 60 * 1000);
  incrementUsage("api-calls-hour", 60 * 60 * 1000);
}

export function checkTokenLimit(tokens: number): LimitCheckResult {
  const remaining = config.tokensPerSession - currentSessionTokens;

  if (config.enforceLimits && tokens > remaining) {
    return {
      allowed: false,
      limit: {
        type: "tokens",
        limit: config.tokensPerSession,
        used: currentSessionTokens,
        unit: "tokens/session",
        resetsAt: null,
        isEnforced: true,
      },
      remaining: Math.max(0, remaining),
      message: `Token limit would be exceeded: ${currentSessionTokens + tokens}/${config.tokensPerSession}`,
    };
  }

  return {
    allowed: true,
    limit: {
      type: "tokens",
      limit: config.tokensPerSession,
      used: currentSessionTokens,
      unit: "tokens/session",
      resetsAt: null,
      isEnforced: config.enforceLimits,
    },
    remaining,
  };
}

export function recordTokenUsage(tokens: number): void {
  currentSessionTokens += tokens;
}

export function checkConcurrentAgentLimit(): LimitCheckResult {
  const remaining = config.maxConcurrentAgents - activeAgents;

  if (config.enforceLimits && activeAgents >= config.maxConcurrentAgents) {
    return {
      allowed: false,
      limit: {
        type: "concurrent-agents",
        limit: config.maxConcurrentAgents,
        used: activeAgents,
        unit: "agents",
        resetsAt: null,
        isEnforced: true,
      },
      remaining: 0,
      message: `Maximum concurrent agents reached: ${activeAgents}/${config.maxConcurrentAgents}`,
    };
  }

  return {
    allowed: true,
    limit: {
      type: "concurrent-agents",
      limit: config.maxConcurrentAgents,
      used: activeAgents,
      unit: "agents",
      resetsAt: null,
      isEnforced: config.enforceLimits,
    },
    remaining,
  };
}

export function startAgent(): boolean {
  const check = checkConcurrentAgentLimit();
  if (!check.allowed) return false;
  activeAgents++;
  return true;
}

export function stopAgent(): void {
  if (activeAgents > 0) {
    activeAgents--;
  }
}

export function checkFileSizeLimit(sizeBytes: number): LimitCheckResult {
  const limitBytes = config.maxFileSizeMB * 1024 * 1024;

  if (config.enforceLimits && sizeBytes > limitBytes) {
    return {
      allowed: false,
      limit: {
        type: "file-size",
        limit: config.maxFileSizeMB,
        used: Math.round(sizeBytes / 1024 / 1024),
        unit: "MB",
        resetsAt: null,
        isEnforced: true,
      },
      remaining: 0,
      message: `File size exceeds limit: ${Math.round(sizeBytes / 1024 / 1024)}MB > ${config.maxFileSizeMB}MB`,
    };
  }

  return {
    allowed: true,
    limit: {
      type: "file-size",
      limit: config.maxFileSizeMB,
      used: Math.round(sizeBytes / 1024 / 1024),
      unit: "MB",
      resetsAt: null,
      isEnforced: config.enforceLimits,
    },
    remaining: Math.max(0, Math.round((limitBytes - sizeBytes) / 1024 / 1024)),
  };
}

export function checkSessionDurationLimit(): LimitCheckResult {
  const remaining = config.maxSessionDurationMinutes - currentSessionDuration;

  if (config.enforceLimits && currentSessionDuration >= config.maxSessionDurationMinutes) {
    return {
      allowed: false,
      limit: {
        type: "session-duration",
        limit: config.maxSessionDurationMinutes,
        used: currentSessionDuration,
        unit: "minutes",
        resetsAt: null,
        isEnforced: true,
      },
      remaining: 0,
      message: `Session duration limit reached: ${currentSessionDuration}/${config.maxSessionDurationMinutes} minutes`,
    };
  }

  return {
    allowed: true,
    limit: {
      type: "session-duration",
      limit: config.maxSessionDurationMinutes,
      used: currentSessionDuration,
      unit: "minutes",
      resetsAt: null,
      isEnforced: config.enforceLimits,
    },
    remaining,
  };
}

export function incrementSessionDuration(minutes = 1): void {
  currentSessionDuration += minutes;
}

export function getAllLimits(): PolicyLimit[] {
  const apiPerMinute = getUsage("api-calls-minute", 60 * 1000);
  const apiPerHour = getUsage("api-calls-hour", 60 * 60 * 1000);

  return [
    {
      type: "api-calls",
      limit: config.apiCallsPerMinute,
      used: apiPerMinute,
      unit: "calls/minute",
      resetsAt: Date.now() + 60 * 1000,
      isEnforced: config.enforceLimits,
    },
    {
      type: "api-calls",
      limit: config.apiCallsPerHour,
      used: apiPerHour,
      unit: "calls/hour",
      resetsAt: Date.now() + 60 * 60 * 1000,
      isEnforced: config.enforceLimits,
    },
    {
      type: "tokens",
      limit: config.tokensPerSession,
      used: currentSessionTokens,
      unit: "tokens/session",
      resetsAt: null,
      isEnforced: config.enforceLimits,
    },
    {
      type: "concurrent-agents",
      limit: config.maxConcurrentAgents,
      used: activeAgents,
      unit: "agents",
      resetsAt: null,
      isEnforced: config.enforceLimits,
    },
    {
      type: "session-duration",
      limit: config.maxSessionDurationMinutes,
      used: currentSessionDuration,
      unit: "minutes",
      resetsAt: null,
      isEnforced: config.enforceLimits,
    },
  ];
}

export function resetUsage(): void {
  usageTracker = {};
  currentSessionTokens = 0;
  currentSessionDuration = 0;
  activeAgents = 0;
  saveUsageTracker();
  logger.info("[policyLimits] usage reset");
}

export function updateLimits(overrides: PolicyLimitsConfig): void {
  config = { ...config, ...overrides };
  saveConfig();
  logger.info("[policyLimits] limits updated");
}

config = loadConfig();
loadUsageTracker();
