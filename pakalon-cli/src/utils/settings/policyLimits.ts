/**
 * Policy Limits — enterprise usage limits enforced by admin policies.
 * Matches Claude's policyLimits system for controlling resource usage.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

export interface PolicyLimit {
  key: string;
  value: number;
  unit: string;
  description: string;
  enforced: boolean;
  softLimit?: number;
  hardLimit: number;
}

export interface PolicyLimitsConfig {
  limits: Map<string, PolicyLimit>;
  usageCounters: Map<string, number>;
  resetAt?: string;
  lastCheckedAt?: string;
}

const LIMITS_PATH = path.join(os.homedir(), ".config", "pakalon", "policy-limits.json");

const DEFAULT_LIMITS: PolicyLimit[] = [
  {
    key: "max_tokens_per_request",
    value: 200000,
    unit: "tokens",
    description: "Maximum tokens per AI request",
    enforced: true,
    softLimit: 150000,
    hardLimit: 200000,
  },
  {
    key: "max_requests_per_hour",
    value: 100,
    unit: "requests",
    description: "Maximum AI requests per hour",
    enforced: true,
    softLimit: 80,
    hardLimit: 100,
  },
  {
    key: "max_requests_per_day",
    value: 1000,
    unit: "requests",
    description: "Maximum AI requests per day",
    enforced: true,
    softLimit: 800,
    hardLimit: 1000,
  },
  {
    key: "max_file_size_mb",
    value: 50,
    unit: "MB",
    description: "Maximum file size for analysis",
    enforced: true,
    softLimit: 40,
    hardLimit: 50,
  },
  {
    key: "max_concurrent_tools",
    value: 10,
    unit: "tools",
    description: "Maximum concurrent tool executions",
    enforced: true,
    hardLimit: 10,
  },
  {
    key: "max_session_duration_hours",
    value: 24,
    unit: "hours",
    description: "Maximum session duration",
    enforced: false,
    softLimit: 12,
    hardLimit: 24,
  },
  {
    key: "max_context_window_tokens",
    value: 128000,
    unit: "tokens",
    description: "Maximum context window size",
    enforced: true,
    hardLimit: 128000,
  },
  {
    key: "max_budget_usd",
    value: 100,
    unit: "USD",
    description: "Maximum monthly spend",
    enforced: true,
    softLimit: 80,
    hardLimit: 100,
  },
];

let config: PolicyLimitsConfig = {
  limits: new Map(),
  usageCounters: new Map(),
};

function loadConfig(): void {
  try {
    if (fs.existsSync(LIMITS_PATH)) {
      const raw = fs.readFileSync(LIMITS_PATH, "utf-8");
      const data = JSON.parse(raw) as {
        limits: [string, PolicyLimit][];
        usageCounters: [string, number][];
        resetAt?: string;
        lastCheckedAt?: string;
      };
      config = {
        limits: new Map(data.limits),
        usageCounters: new Map(data.usageCounters),
        resetAt: data.resetAt,
        lastCheckedAt: data.lastCheckedAt,
      };
    } else {
      for (const limit of DEFAULT_LIMITS) {
        config.limits.set(limit.key, limit);
        config.usageCounters.set(limit.key, 0);
      }
    }
  } catch (err) {
    logger.warn("[policy-limits] Failed to load", { error: String(err) });
    for (const limit of DEFAULT_LIMITS) {
      config.limits.set(limit.key, limit);
      config.usageCounters.set(limit.key, 0);
    }
  }
}

function saveConfig(): void {
  try {
    const dir = path.dirname(LIMITS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      limits: Array.from(config.limits.entries()),
      usageCounters: Array.from(config.usageCounters.entries()),
      resetAt: config.resetAt,
      lastCheckedAt: config.lastCheckedAt,
    };
    fs.writeFileSync(LIMITS_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    logger.warn("[policy-limits] Failed to save", { error: String(err) });
  }
}

loadConfig();

export function getLimit(key: string): PolicyLimit | undefined {
  return config.limits.get(key);
}

export function getUsage(key: string): number {
  return config.usageCounters.get(key) ?? 0;
}

export function getRemaining(key: string): number {
  const limit = config.limits.get(key);
  if (!limit) return Infinity;
  const usage = config.usageCounters.get(key) ?? 0;
  return Math.max(0, limit.value - usage);
}

export function incrementUsage(key: string, amount = 1): void {
  const current = config.usageCounters.get(key) ?? 0;
  config.usageCounters.set(key, current + amount);
  config.lastCheckedAt = new Date().toISOString();
  saveConfig();
}

export function checkLimit(key: string, amount = 1): { allowed: boolean; remaining: number; limit: number; usage: number } {
  const limit = config.limits.get(key);
  if (!limit) return { allowed: true, remaining: Infinity, limit: Infinity, usage: 0 };

  const usage = config.usageCounters.get(key) ?? 0;
  const remaining = Math.max(0, limit.value - usage);
  const allowed = usage + amount <= limit.hardLimit;

  return {
    allowed,
    remaining,
    limit: limit.value,
    usage,
  };
}

export function isNearLimit(key: string): boolean {
  const limit = config.limits.get(key);
  if (!limit?.softLimit) return false;
  const usage = config.usageCounters.get(key) ?? 0;
  return usage >= limit.softLimit;
}

export function isAtLimit(key: string): boolean {
  const limit = config.limits.get(key);
  if (!limit) return false;
  const usage = config.usageCounters.get(key) ?? 0;
  return usage >= limit.hardLimit;
}

export function setLimit(key: string, value: number, options?: { unit?: string; description?: string; enforced?: boolean; softLimit?: number; hardLimit?: number }): void {
  const existing = config.limits.get(key);
  const limit: PolicyLimit = {
    key,
    value,
    unit: options?.unit ?? existing?.unit ?? "units",
    description: options?.description ?? existing?.description ?? "",
    enforced: options?.enforced ?? existing?.enforced ?? true,
    softLimit: options?.softLimit ?? existing?.softLimit,
    hardLimit: options?.hardLimit ?? value,
  };
  config.limits.set(key, limit);
  saveConfig();
  logger.debug("[policy-limits] Set limit", { key, value });
}

export function resetUsage(key?: string): void {
  if (key) {
    config.usageCounters.set(key, 0);
  } else {
    config.usageCounters.clear();
    for (const [key] of config.limits) {
      config.usageCounters.set(key, 0);
    }
  }
  config.resetAt = new Date().toISOString();
  saveConfig();
  logger.info("[policy-limits] Usage reset", { key: key ?? "all" });
}

export function getAllLimits(): PolicyLimit[] {
  return Array.from(config.limits.values());
}

export function getViolatedLimits(): Array<PolicyLimit & { usage: number }> {
  const violated: Array<PolicyLimit & { usage: number }> = [];
  for (const limit of config.limits.values()) {
    if (!limit.enforced) continue;
    const usage = config.usageCounters.get(limit.key) ?? 0;
    if (usage >= limit.hardLimit) {
      violated.push({ ...limit, usage });
    }
  }
  return violated;
}

export function getLimitsSummary(): string {
  const limits = getAllLimits();
  const violated = getViolatedLimits();
  const lines: string[] = [
    "── Policy Limits ──",
    `Total limits: ${limits.length}`,
    `Violated limits: ${violated.length}`,
    `Last reset: ${config.resetAt ?? "Never"}`,
    "",
  ];

  for (const limit of limits) {
    const usage = config.usageCounters.get(limit.key) ?? 0;
    const remaining = Math.max(0, limit.value - usage);
    const pct = limit.value > 0 ? (usage / limit.value) * 100 : 0;
    const icon = pct >= 100 ? "[Red]" : pct >= 80 ? "[Yellow]" : "[Green]";
    lines.push(`  ${icon} ${limit.key}: ${usage}/${limit.value} ${limit.unit} (${pct.toFixed(0)}%)`);
  }

  if (violated.length > 0) {
    lines.push("");
    lines.push("Warning:  Violated limits:");
    for (const v of violated) {
      lines.push(`  - ${v.key}: ${v.usage}/${v.hardLimit} ${v.unit}`);
    }
  }

  return lines.join("\n");
}

export function formatLimitWarning(key: string): string | null {
  if (!isNearLimit(key)) return null;
  const limit = config.limits.get(key);
  if (!limit) return null;
  const usage = config.usageCounters.get(key) ?? 0;
  const remaining = Math.max(0, limit.value - usage);
  const pct = (usage / limit.value) * 100;

  if (usage >= limit.hardLimit) {
    return `[NoEntry] Limit reached: ${key} (${usage}/${limit.value} ${limit.unit}). Further usage blocked.`;
  }
  if (usage >= (limit.softLimit ?? limit.value * 0.8)) {
    return `Warning:  Approaching limit: ${key} (${usage}/${limit.value} ${limit.unit}, ${remaining} remaining, ${pct.toFixed(0)}% used).`;
  }
  return null;
}
