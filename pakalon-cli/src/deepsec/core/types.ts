/**
 * Deepsec Core Types and Schemas
 * Core data models for the vulnerability scanning system
 */

// Severity levels for findings
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

// Status for file records
export type FileRecordStatus = "pending" | "processing" | "analyzed" | "error";

// Noise tier for matcher classification
export type NoiseTier = "low" | "normal" | "high";

// Severity mapping
export type SeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

// Triage priority
export type TriagePriority = "P0" | "P1" | "P2" | "skip";

// Status for findings
export type FindingStatus = "new" | "triaged" | "revalidated" | "fixed";

// Revalidation verdict
export type RevalidationVerdict = "true-positive" | "false-positive" | "fixed" | "uncertain";

// Technology detection result
export type DetectedTech = {
  tags: string[];
  frameworks: string[];
  languages: string[];
  confidence: number;
};

// Candidate match from scanner
export interface CandidateMatch {
  slug: string;
  description?: string;
  noiseTier?: NoiseTier;
  matches: MatchDetail[];
}

// Match detail
export interface MatchDetail {
  line: number;
  column: number;
  text: string;
  label: string;
}

// File record for a scanned file
export interface FileRecord {
  filePath: string;
  projectId: string;
  candidates: CandidateMatch[];
  lastScannedAt: string;
  lastScannedRunId: string;
  fileHash: string;
  findings: Finding[];
  analysisHistory: AnalysisEntry[];
  gitInfo?: GitInfo;
  status: FileRecordStatus;
  lockedByRunId?: string;
  lockedAt?: string;
}

// Finding from AI investigation
export interface Finding {
  id: string;
  slug: string;
  title: string;
  description: string;
  severity: Severity;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string;
  recommendation: string;
  references: string[];
  status: FindingStatus;
  triage?: Triage;
  revalidation?: Revalidation;
  createdAt: string;
}

// Triage result
export interface Triage {
  priority: TriagePriority;
  reason: string;
  triagedAt: string;
}

// Revalidation result
export interface Revalidation {
  verdict: RevalidationVerdict;
  confidence: number;
  reason: string;
  revalidatedAt: string;
}

// Analysis entry for processing history
export interface AnalysisEntry {
  runId: string;
  timestamp: string;
  model: string;
  cost: number;
  tokens: number;
  findingCount: number;
  status: "success" | "error";
  error?: string;
}

// Git information
export interface GitInfo {
  recentCommitters: CommitterInfo[];
  enrichedAt: string;
  ownership?: OwnershipData;
}

// Committer info
export interface CommitterInfo {
  name: string;
  email: string;
  commits: number;
  lastCommitDate: string;
}

// Ownership data
export interface OwnershipData {
  owner?: string;
  team?: string;
  approvers?: string[];
  slackChannel?: string;
}

// Run metadata
export interface RunMeta {
  runId: string;
  projectId: string;
  phase: "scan" | "process" | "triage" | "revalidate" | "enrich" | "report";
  status: "running" | "done" | "error";
  startedAt: string;
  completedAt?: string;
  stats: RunStats;
  config: RunConfig;
}

// Run statistics
export interface RunStats {
  filesScanned: number;
  candidateCount: number;
  findingCount: number;
  errorCount: number;
  duration: number;
}

// Run configuration
export interface RunConfig {
  model?: string;
  concurrency?: number;
  batchSize?: number;
  filter?: string;
  matchSlugs?: string[];
  skipSlugs?: string[];
}

// Plugin contract for matchers
export interface MatcherPlugin {
  slug: string;
  description: string;
  noiseTier: NoiseTier;
  filePatterns: string[];
  examples?: string[];
  requires?: string[]; // Tech tags required for this matcher to activate
  match: (content: string, filePath: string) => CandidateMatch[];
}

// Plugin contract for notifiers
export interface NotifierPlugin {
  name: string;
  notify: (finding: Finding, projectId: string) => Promise<void>;
}

// Plugin contract for ownership providers
export interface OwnershipProvider {
  name: string;
  getOwnership: (filePath: string, projectId: string) => Promise<OwnershipData | null>;
}

// Plugin contract for people providers
export interface PeopleProvider {
  name: string;
  getPeople: (email: string) => Promise<{ name: string; slackHandle?: string } | null>;
}

// Plugin contract for executors
export interface ExecutorProvider {
  name: string;
  execute: (command: string, projectId: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

// Plugin contract for AI agents
export interface AgentPlugin {
  name: string;
  type: "claude" | "codex" | "custom";
  investigate: (params: {
    batch: FileRecord[];
    promptTemplate: string;
    projectRoot: string;
    onProgress?: (progress: AgentProgress) => void;
  }) => Promise<Finding[]>;
  revalidate: (params: {
    findings: Finding[];
    promptTemplate: string;
    projectRoot: string;
  }) => Promise<RevalidationResult[]>;
}

// Agent progress
export interface AgentProgress {
  batchIndex: number;
  totalBatches: number;
  status: "processing" | "completed" | "error";
  message?: string;
}

// Revalidation result
export interface RevalidationResult {
  findingId: string;
  verdict: RevalidationVerdict;
  confidence: number;
  reason: string;
}

// Deepsec plugin (umbrella)
export interface DeepsecPlugin {
  name: string;
  matchers?: MatcherPlugin[];
  notifiers?: NotifierPlugin[];
  ownership?: OwnershipProvider;
  people?: PeopleProvider;
  executor?: ExecutorProvider;
  agent?: AgentPlugin;
}

// Scan result
export interface ScanResult {
  runId: string;
  candidateCount: number;
  detected: DetectedTech;
  activeMatchers: string[];
  skippedMatchers: string[];
  languageStats: LanguageStat[];
}

// Language statistics
export interface LanguageStat {
  language: string;
  files: number;
  candidates: number;
}

// Process result
export interface ProcessResult {
  runId: string;
  analysisCount: number;
  findingCount: number;
  errorBatchCount: number;
  quotaExhausted?: {
    source: string;
    rawMessage: string;
  };
}

// Triage result
export interface TriageResult {
  runId: string;
  triaged: number;
  skipped: number;
}

// Revalidate result
export interface RevalidateResult {
  runId: string;
  revalidated: number;
  truePositives: number;
  falsePositives: number;
  fixed: number;
  uncertain: number;
}

// Report generation options
export interface ReportOptions {
  format: "md" | "json" | "md-dir";
  outDir: string;
  includeTriaged: boolean;
  minSeverity: Severity;
}

// Export options
export interface ExportOptions {
  format: "json" | "md-dir" | "sarif";
  outDir: string;
  includeTriaged: boolean;
  minSeverity: Severity;
}

// Scanner driver interface
export interface ScannerDriver {
  name: string;
  scan: (params: {
    projectId: string;
    root: string;
    filePaths?: string[];
    matchers: MatcherPlugin[];
    onProgress?: (progress: ScanProgress) => void;
  }) => Promise<{ runId: string; candidateCount: number }>;
}

// Scan progress
export interface ScanProgress {
  filesScanned: number;
  totalFiles: number;
  currentFile: string;
  candidateCount: number;
}

// Process progress
export interface ProcessProgress {
  batchesCompleted: number;
  totalBatches: number;
  currentFile: string;
  findingCount: number;
}

// Deepsec configuration
export interface DeepsecConfig {
  projectId: string;
  root: string;
  dataDir: string;
  model: string;
  concurrency: number;
  batchSize: number;
  plugins: DeepsecPlugin[];
  promptAppend?: string;
  ignorePaths?: string[];
}

// Security finding (legacy Phase4 compatibility)
export interface SecurityFinding {
  tool: string;
  severity: Severity;
  file: string;
  line?: number;
  message: string;
  rule?: string;
  id?: string;
  description?: string;
  recommendation?: string;
  references?: string[];
}

// Security scan options
export interface SecurityScanOptions {
  projectDir: string;
  targetUrl?: string;
  outputDir: string;
  tools?: string[];
  skipTools?: string[];
  minSeverity?: Severity;
  maxFileSize?: number;
  includeTests?: boolean;
}

// Security report
export interface SecurityReport {
  scanId: string;
  projectDir: string;
  scannedAt: string;
  totalIssues: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  infoIssues: number;
  findings: SecurityFinding[];
  scanResults: Map<string, { issues: number; error?: string }>;
}
