/**
 * Deepsec Core Utilities — adapted from pakalon-cli for oh-my-pi.
 * Path management, config loading, and helper functions.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DeepsecConfig, FileRecord, Finding } from "./types";

const DEFAULT_DATA_DIR = ".deepsec";

export function getDataDir(projectId: string, rootDir: string): string {
	return path.join(rootDir, DEFAULT_DATA_DIR, "data", projectId);
}

export function getRunsDir(projectId: string, rootDir: string): string {
	return path.join(getDataDir(projectId, rootDir), "runs");
}

export function getFilesDir(projectId: string, rootDir: string): string {
	return path.join(getDataDir(projectId, rootDir), "files");
}

export function getReportsDir(projectId: string, rootDir: string): string {
	return path.join(getDataDir(projectId, rootDir), "reports");
}

export function getFileRecordPath(projectId: string, filePath: string, rootDir: string): string {
	const safePath = filePath.replace(/[^a-zA-Z0-9_.-]/g, "_");
	return path.join(getFilesDir(projectId, rootDir), `${safePath}.json`);
}

export function generateRunId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function computeFileHash(_content: string): string {
	return randomUUID().replace(/-/g, "") + Date.now().toString(36);
}

export function detectLanguage(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
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
		".html": "html",
		".css": "css",
		".json": "json",
		".xml": "xml",
		".yaml": "yaml",
		".yml": "yaml",
		".sh": "shell",
		".tf": "terraform",
		".hcl": "hcl",
		".sql": "sql",
		".dockerfile": "dockerfile",
	};
	return languageMap[ext] ?? "unknown";
}

export async function ensureProject(projectId: string, rootDir: string): Promise<void> {
	const dataDir = getDataDir(projectId, rootDir);
	const dirs = [dataDir, path.join(dataDir, "files"), path.join(dataDir, "runs"), path.join(dataDir, "reports")];
	for (const dir of dirs) {
		await fs.mkdir(dir, { recursive: true });
	}
}

export async function writeFileRecord(projectId: string, record: FileRecord, rootDir: string): Promise<void> {
	const filePath = getFileRecordPath(projectId, record.filePath, rootDir);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await Bun.write(filePath, JSON.stringify(record, null, 2));
}

export function shouldIgnoreFile(filePath: string, ignorePaths: string[] = []): boolean {
	const normalized = filePath.replace(/\\/g, "/");
	const defaultIgnores = ["node_modules/", ".git/", "dist/", "build/", ".next/", "coverage/", "*.min.js", "*.min.css"];
	const allIgnores = [...defaultIgnores, ...ignorePaths];
	return allIgnores.some(pattern => {
		if (pattern.includes("*")) {
			const regex = new RegExp(pattern.replace(/\*/g, ".*"));
			return regex.test(normalized);
		}
		return normalized.includes(pattern);
	});
}

export function generateFindingId(): string {
	return `finding-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function normalizeSeverity(severity: string): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" {
	const normalized = severity.toUpperCase();
	if (normalized.includes("CRIT")) return "CRITICAL";
	if (normalized.includes("HIGH") || normalized.includes("ERROR")) return "HIGH";
	if (normalized.includes("MED") || normalized.includes("WARN")) return "MEDIUM";
	if (normalized.includes("LOW")) return "LOW";
	return "INFO";
}

export function sortFindingsBySeverity(findings: Finding[]): Finding[] {
	const severityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
	return [...findings].sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));
}

export function groupFindingsBySeverity(findings: Finding[]): Map<string, Finding[]> {
	const grouped = new Map<string, Finding[]>();
	for (const f of findings) {
		const existing = grouped.get(f.severity) ?? [];
		existing.push(f);
		grouped.set(f.severity, existing);
	}
	return grouped;
}

export async function loadDeepsecConfig(projectId: string, rootDir: string): Promise<DeepsecConfig | null> {
	try {
		const configPath = path.join(getDataDir(projectId, rootDir), "config.json");
		const content = await Bun.file(configPath).text();
		return JSON.parse(content) as DeepsecConfig;
	} catch {
		return null;
	}
}

export async function saveDeepsecConfig(config: DeepsecConfig): Promise<void> {
	const configPath = path.join(getDataDir(config.projectId, config.root), "config.json");
	await Bun.write(configPath, JSON.stringify(config, null, 2));
}
