/**
 * Diagnostic Tracking Service
 *
 * Collects, aggregates, and reports diagnostic information about
 * skill health, performance, and system state.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import logger from "@/utils/logger.js";

export type DiagnosticSeverity = "info" | "warning" | "error" | "critical";

export type DiagnosticCategory =
  | "skill"
  | "performance"
  | "memory"
  | "filesystem"
  | "network"
  | "config"
  | "security";

export interface DiagnosticEntry {
  id: string;
  timestamp: number;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  resolved: boolean;
  resolvedAt?: number;
}

export interface DiagnosticReport {
  entries: DiagnosticEntry[];
  summary: DiagnosticSummary;
  generatedAt: number;
}

export interface DiagnosticSummary {
  total: number;
  bySeverity: Record<DiagnosticSeverity, number>;
  byCategory: Record<DiagnosticCategory, number>;
  unresolved: number;
  healthScore: number;
}

export interface DiagnosticHealthCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message?: string;
  durationMs?: number;
}

const DIAGNOSTICS_PATH = path.join(
  os.homedir(),
  ".config",
  "pakalon",
  "diagnostics.json",
);

const MAX_ENTRIES = 1000;

let diagnostics: DiagnosticEntry[] = [];
let nextId = 1;

function generateId(): string {
  return `diag_${Date.now()}_${nextId++}`;
}

function loadDiagnostics(): void {
  try {
    if (fs.existsSync(DIAGNOSTICS_PATH)) {
      const raw = fs.readFileSync(DIAGNOSTICS_PATH, "utf-8");
      const data = JSON.parse(raw) as DiagnosticEntry[];
      diagnostics = data.slice(-MAX_ENTRIES);
      const maxId = Math.max(0, ...diagnostics.map((d) => parseInt(d.id.split("_")[2] ?? "0", 10)));
      nextId = maxId + 1;
    }
  } catch {
    diagnostics = [];
  }
}

function saveDiagnostics(): void {
  try {
    const dir = path.dirname(DIAGNOSTICS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const trimmed = diagnostics.slice(-MAX_ENTRIES);
    fs.writeFileSync(DIAGNOSTICS_PATH, JSON.stringify(trimmed, null, 2));
    diagnostics = trimmed;
  } catch {
    // Best effort
  }
}

function computeSummary(entries: DiagnosticEntry[]): DiagnosticSummary {
  const bySeverity: Record<DiagnosticSeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
  };
  const byCategory: Record<DiagnosticCategory, number> = {
    skill: 0,
    performance: 0,
    memory: 0,
    filesystem: 0,
    network: 0,
    config: 0,
    security: 0,
  };
  let unresolved = 0;

  for (const entry of entries) {
    bySeverity[entry.severity]++;
    byCategory[entry.category]++;
    if (!entry.resolved) unresolved++;
  }

  const total = entries.length;
  const weightedScore =
    bySeverity.critical * 10 +
    bySeverity.error * 5 +
    bySeverity.warning * 2 +
    bySeverity.info * 1;

  const healthScore = total > 0
    ? Math.max(0, Math.min(100, 100 - (weightedScore / total) * 20))
    : 100;

  return {
    total,
    bySeverity,
    byCategory,
    unresolved,
    healthScore: Math.round(healthScore),
  };
}

export function addDiagnostic(
  category: DiagnosticCategory,
  severity: DiagnosticSeverity,
  title: string,
  message: string,
  details?: Record<string, unknown>,
): DiagnosticEntry {
  const entry: DiagnosticEntry = {
    id: generateId(),
    timestamp: Date.now(),
    category,
    severity,
    title,
    message,
    details,
    resolved: false,
  };

  diagnostics.push(entry);
  saveDiagnostics();

  logger.info("[diagnostics] added entry", {
    id: entry.id,
    category,
    severity,
    title,
  });

  return entry;
}

export function resolveDiagnostic(id: string): boolean {
  const entry = diagnostics.find((d) => d.id === id);
  if (!entry || entry.resolved) return false;

  entry.resolved = true;
  entry.resolvedAt = Date.now();
  saveDiagnostics();

  logger.info("[diagnostics] resolved entry", { id });
  return true;
}

export function resolveDiagnosticsByCategory(category: DiagnosticCategory): number {
  let count = 0;
  for (const entry of diagnostics) {
    if (entry.category === category && !entry.resolved) {
      entry.resolved = true;
      entry.resolvedAt = Date.now();
      count++;
    }
  }
  if (count > 0) saveDiagnostics();
  return count;
}

export function getDiagnosticReport(
  options?: {
    severity?: DiagnosticSeverity;
    category?: DiagnosticCategory;
    unresolvedOnly?: boolean;
    limit?: number;
  },
): DiagnosticReport {
  let entries = [...diagnostics];

  if (options?.severity) {
    entries = entries.filter((e) => e.severity === options.severity);
  }
  if (options?.category) {
    entries = entries.filter((e) => e.category === options.category);
  }
  if (options?.unresolvedOnly) {
    entries = entries.filter((e) => !e.resolved);
  }

  entries.sort((a, b) => b.timestamp - a.timestamp);

  const limit = options?.limit ?? 100;
  const trimmed = entries.slice(0, limit);

  return {
    entries: trimmed,
    summary: computeSummary(entries),
    generatedAt: Date.now(),
  };
}

export function clearDiagnostics(): void {
  diagnostics = [];
  nextId = 1;
  try {
    if (fs.existsSync(DIAGNOSTICS_PATH)) {
      fs.unlinkSync(DIAGNOSTICS_PATH);
    }
  } catch {
    // Best effort
  }
  logger.info("[diagnostics] cleared all entries");
}

export async function runHealthChecks(): Promise<DiagnosticHealthCheck[]> {
  const checks: DiagnosticHealthCheck[] = [];

  const diskCheckStart = performance.now();
  try {
    const homedir = os.homedir();
    const stat = fs.statSync(homedir);
    checks.push({
      name: "disk-access",
      status: "pass",
      durationMs: Math.round(performance.now() - diskCheckStart),
    });
  } catch {
    checks.push({
      name: "disk-access",
      status: "fail",
      message: "Cannot access home directory",
      durationMs: Math.round(performance.now() - diskCheckStart),
    });
  }

  const configCheckStart = performance.now();
  try {
    const configDir = path.join(os.homedir(), ".config", "pakalon");
    if (fs.existsSync(configDir)) {
      checks.push({
        name: "config-directory",
        status: "pass",
        durationMs: Math.round(performance.now() - configCheckStart),
      });
    } else {
      checks.push({
        name: "config-directory",
        status: "warn",
        message: "Config directory does not exist",
        durationMs: Math.round(performance.now() - configCheckStart),
      });
    }
  } catch {
    checks.push({
      name: "config-directory",
      status: "fail",
      message: "Cannot check config directory",
      durationMs: Math.round(performance.now() - configCheckStart),
    });
  }

  const memoryCheckStart = performance.now();
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  if (heapUsedMB > 500) {
    checks.push({
      name: "memory-usage",
      status: "warn",
      message: `Heap usage: ${Math.round(heapUsedMB)}MB`,
      durationMs: Math.round(performance.now() - memoryCheckStart),
    });
  } else {
    checks.push({
      name: "memory-usage",
      status: "pass",
      durationMs: Math.round(performance.now() - memoryCheckStart),
    });
  }

  const skillCheckStart = performance.now();
  try {
    const { discoverSkillCatalog } = await import("@/skills/catalog.js");
    const skills = discoverSkillCatalog({ includeContent: false });
    checks.push({
      name: "skill-catalog",
      status: skills.length > 0 ? "pass" : "warn",
      message: `${skills.length} skills discovered`,
      durationMs: Math.round(performance.now() - skillCheckStart),
    });
  } catch {
    checks.push({
      name: "skill-catalog",
      status: "fail",
      message: "Failed to load skill catalog",
      durationMs: Math.round(performance.now() - skillCheckStart),
    });
  }

  return checks;
}

loadDiagnostics();
