/**
 * Deepsec Core Utilities
 * Path management, config loading, and helper functions
 */

import * as path from "path";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import type {
  DeepsecConfig,
  RunMeta,
  FileRecord,
  Finding,
  DeepsecPlugin,
  MatcherPlugin,
} from "./types.js";

// Default deepsec data directory
const DEFAULT_DATA_DIR = ".deepsec";

// Get the deepsec data directory for a project
export function getDataDir(projectId: string, rootDir: string = process.cwd()): string {
  const dataDir = path.join(rootDir, DEFAULT_DATA_DIR, "data", projectId);
  return dataDir;
}

// Get the runs directory
export function getRunsDir(projectId: string, rootDir: string = process.cwd()): string {
  return path.join(getDataDir(projectId, rootDir), "runs");
}

// Get the files directory
export function getFilesDir(projectId: string, rootDir: string = process.cwd()): string {
  return path.join(getDataDir(projectId, rootDir), "files");
}

// Get the reports directory
export function getReportsDir(projectId: string, rootDir: string = process.cwd()): string {
  return path.join(getDataDir(projectId, rootDir), "reports");
}

// Get path for a file record
export function getFileRecordPath(
  projectId: string,
  filePath: string,
  rootDir: string = process.cwd()
): string {
  const safePath = filePath.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(getFilesDir(projectId, rootDir), `${safePath}.json`);
}

// Get path for a run meta file
export function getRunMetaPath(
  projectId: string,
  runId: string,
  rootDir: string = process.cwd()
): string {
  return path.join(getRunsDir(projectId, rootDir), `${runId}.json`);
}

// Generate a run ID
export function generateRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Compute file hash
export function computeFileHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// Get file extension
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

// Detect language from file extension
export function detectLanguage(filePath: string): string {
  const ext = getFileExtension(filePath);
  const languageMap: Record<string, string> = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".php": "php",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".swift": "swift",
    ".scala": "scala",
    ".clj": "clojure",
    ".erl": "erlang",
    ".ex": "elixir",
    ".hs": "haskell",
    ".lua": "lua",
    ".r": "r",
    ".m": "objective-c",
    ".mm": "objective-c",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".less": "less",
    ".json": "json",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".fish": "shell",
    ".ps1": "powershell",
    ".dockerfile": "dockerfile",
    ".tf": "terraform",
    ".hcl": "hcl",
    ".sql": "sql",
  };

  return languageMap[ext] || "unknown";
}

// Ensure project directory structure exists
export async function ensureProject(
  projectId: string,
  rootDir: string = process.cwd()
): Promise<void> {
  const dataDir = getDataDir(projectId, rootDir);
  const dirs = [
    dataDir,
    path.join(dataDir, "files"),
    path.join(dataDir, "runs"),
    path.join(dataDir, "reports"),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// Write a file record
export async function writeFileRecord(
  projectId: string,
  record: FileRecord,
  rootDir: string = process.cwd()
): Promise<void> {
  const filePath = getFileRecordPath(projectId, record.filePath, rootDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
}

// Read a file record
export async function readFileRecord(
  projectId: string,
  filePath: string,
  rootDir: string = process.cwd()
): Promise<FileRecord | null> {
  try {
    const recordPath = getFileRecordPath(projectId, filePath, rootDir);
    const content = await fs.readFile(recordPath, "utf8");
    return JSON.parse(content) as FileRecord;
  } catch {
    return null;
  }
}

// Load all file records for a project
export async function loadAllFileRecords(
  projectId: string,
  rootDir: string = process.cwd()
): Promise<FileRecord[]> {
  const filesDir = getFilesDir(projectId, rootDir);
  try {
    const files = await fs.readdir(filesDir, { recursive: true });
    const records: FileRecord[] = [];

    for (const file of files) {
      if (typeof file === "string" && file.endsWith(".json")) {
        try {
          const content = await fs.readFile(path.join(filesDir, file), "utf8");
          records.push(JSON.parse(content) as FileRecord);
        } catch {
          // Skip invalid files
        }
      }
    }

    return records;
  } catch {
    return [];
  }
}

// Write run metadata
export async function writeRunMeta(
  projectId: string,
  meta: RunMeta,
  rootDir: string = process.cwd()
): Promise<void> {
  const runPath = getRunMetaPath(projectId, meta.runId, rootDir);
  await fs.mkdir(path.dirname(runPath), { recursive: true });
  await fs.writeFile(runPath, JSON.stringify(meta, null, 2), "utf8");
}

// Read run metadata
export async function readRunMeta(
  projectId: string,
  runId: string,
  rootDir: string = process.cwd()
): Promise<RunMeta | null> {
  try {
    const runPath = getRunMetaPath(projectId, runId, rootDir);
    const content = await fs.readFile(runPath, "utf8");
    return JSON.parse(content) as RunMeta;
  } catch {
    return null;
  }
}

// Create default run metadata
export function createRunMeta(params: {
  projectId: string;
  phase: "scan" | "process" | "triage" | "revalidate" | "enrich" | "report";
  config?: Partial<RunMeta["config"]>;
}): RunMeta {
  return {
    runId: generateRunId(),
    projectId: params.projectId,
    phase: params.phase,
    status: "running",
    startedAt: new Date().toISOString(),
    stats: {
      filesScanned: 0,
      candidateCount: 0,
      findingCount: 0,
      errorCount: 0,
      duration: 0,
    },
    config: {
      model: "anthropic/claude-3-5-sonnet",
      concurrency: 4,
      batchSize: 5,
      ...params.config,
    },
  };
}

// Plugin registry
class PluginRegistry {
  private matchers: Map<string, MatcherPlugin> = new Map();
  private plugins: Map<string, DeepsecPlugin> = new Map();

  registerMatcher(matcher: MatcherPlugin): void {
    this.matchers.set(matcher.slug, matcher);
  }

  registerPlugin(plugin: DeepsecPlugin): void {
    this.plugins.set(plugin.name, plugin);
    if (plugin.matchers) {
      for (const matcher of plugin.matchers) {
        this.registerMatcher(matcher);
      }
    }
  }

  getMatcher(slug: string): MatcherPlugin | undefined {
    return this.matchers.get(slug);
  }

  getAllMatchers(): MatcherPlugin[] {
    return Array.from(this.matchers.values());
  }

  getPlugin(name: string): DeepsecPlugin | undefined {
    return this.plugins.get(name);
  }
}

// Singleton registry instance
let globalRegistry: PluginRegistry | null = null;

export function getRegistry(): PluginRegistry {
  if (!globalRegistry) {
    globalRegistry = new PluginRegistry();
  }
  return globalRegistry;
}

// Reset registry (useful for testing)
export function resetRegistry(): void {
  globalRegistry = null;
}

// Default deepsec config
export function defaultConfig(): DeepsecConfig {
  return {
    projectId: "default",
    root: process.cwd(),
    dataDir: getDataDir("default"),
    model: "anthropic/claude-3-5-sonnet",
    concurrency: 4,
    batchSize: 5,
    plugins: [],
  };
}

// Validate a finding
export function validateFinding(finding: Partial<Finding>): boolean {
  return (
    finding.id !== undefined &&
    finding.slug !== undefined &&
    finding.title !== undefined &&
    finding.severity !== undefined &&
    finding.filePath !== undefined &&
    finding.lineStart !== undefined
  );
}

// Group findings by file
export function groupFindingsByFile(findings: Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const existing = grouped.get(finding.filePath) || [];
    existing.push(finding);
    grouped.set(finding.filePath, existing);
  }
  return grouped;
}

// Group findings by severity
export function groupFindingsBySeverity(findings: Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const severity = finding.severity;
    const existing = grouped.get(severity) || [];
    existing.push(finding);
    grouped.set(severity, existing);
  }
  return grouped;
}

// Sort findings by severity
export function sortFindingsBySeverity(findings: Finding[]): Finding[] {
  const severityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  return [...findings].sort((a, b) => {
    const aIndex = severityOrder.indexOf(a.severity);
    const bIndex = severityOrder.indexOf(b.severity);
    return aIndex - bIndex;
  });
}

// Load deepsec config from file
export async function loadDeepsecConfig(
  projectId: string,
  rootDir: string = process.cwd()
): Promise<DeepsecConfig | null> {
  try {
    const configPath = path.join(getDataDir(projectId, rootDir), "config.json");
    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content) as DeepsecConfig;
  } catch {
    return null;
  }
}

// Save deepsec config to file
export async function saveDeepsecConfig(
  config: DeepsecConfig,
  rootDir: string = process.cwd()
): Promise<void> {
  const configPath = path.join(getDataDir(config.projectId, rootDir), "config.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

// Generate a unique finding ID
export function generateFindingId(): string {
  return `finding-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Normalize severity string
export function normalizeSeverity(severity: string): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" {
  const normalized = severity.toUpperCase();
  if (normalized.includes("CRIT")) return "CRITICAL";
  if (normalized.includes("HIGH") || normalized.includes("ERROR")) return "HIGH";
  if (normalized.includes("MED") || normalized.includes("WARN")) return "MEDIUM";
  if (normalized.includes("LOW")) return "LOW";
  return "INFO";
}

// Check if a file path should be ignored
export function shouldIgnoreFile(filePath: string, ignorePaths: string[] = []): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const defaultIgnores = [
    "node_modules/",
    ".git/",
    "dist/",
    "build/",
    ".next/",
    "coverage/",
    "*.min.js",
    "*.min.css",
  ];
  const allIgnores = [...defaultIgnores, ...ignorePaths];

  return allIgnores.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return regex.test(normalized);
    }
    return normalized.includes(pattern);
  });
}
