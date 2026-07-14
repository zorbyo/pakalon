/**
 * Deepsec Core Types — adapted from pakalon-cli for oh-my-pi.
 * Core data models for the vulnerability scanning system.
 */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type FileRecordStatus = "pending" | "processing" | "analyzed" | "error";

export type NoiseTier = "low" | "normal" | "high";

export type TriagePriority = "P0" | "P1" | "P2" | "skip";

export type FindingStatus = "new" | "triaged" | "revalidated" | "fixed";

export type RevalidationVerdict = "true-positive" | "false-positive" | "fixed" | "uncertain";

export type DetectedTech = {
	tags: string[];
	frameworks: string[];
	languages: string[];
	confidence: number;
};

export interface CandidateMatch {
	slug: string;
	description?: string;
	noiseTier?: NoiseTier;
	matches: MatchDetail[];
}

export interface MatchDetail {
	line: number;
	column: number;
	text: string;
	label: string;
}

export interface FileRecord {
	filePath: string;
	projectId: string;
	candidates: CandidateMatch[];
	lastScannedAt: string;
	lastScannedRunId: string;
	fileHash: string;
	findings: Finding[];
	status: FileRecordStatus;
}

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
	createdAt: string;
}

export interface RunMeta {
	runId: string;
	projectId: string;
	phase: "scan" | "process" | "triage" | "report";
	status: "running" | "done" | "error";
	startedAt: string;
	completedAt?: string;
	stats: RunStats;
	config: RunConfig;
}

export interface RunStats {
	filesScanned: number;
	candidateCount: number;
	findingCount: number;
	errorCount: number;
	duration: number;
}

export interface RunConfig {
	model?: string;
	concurrency?: number;
	batchSize?: number;
	matchSlugs?: string[];
	skipSlugs?: string[];
}

export interface MatcherPlugin {
	slug: string;
	description: string;
	noiseTier: NoiseTier;
	filePatterns: string[];
	requires?: string[];
	match: (content: string, filePath: string) => CandidateMatch[];
}

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

export interface ScanProgress {
	filesScanned: number;
	totalFiles: number;
	currentFile: string;
	candidateCount: number;
}

export interface DeepsecConfig {
	projectId: string;
	root: string;
	dataDir: string;
	model: string;
	concurrency: number;
	batchSize: number;
	matchSlugs?: string[];
	skipSlugs?: string[];
}

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

export interface SecurityScanOptions {
	projectDir: string;
	outputDir: string;
	tools?: string[];
	skipTools?: string[];
	minSeverity?: Severity;
	maxFileSize?: number;
}

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
}
