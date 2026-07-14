/**
 * Deepsec Scanner Engine — adapted from pakalon-cli for oh-my-pi.
 * Regex-based vulnerability detection engine.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
	CandidateMatch,
	DetectedTech,
	FileRecord,
	MatcherPlugin,
	ScannerDriver,
	ScanProgress,
} from "../core/types";
import { computeFileHash, ensureProject, generateRunId, shouldIgnoreFile, writeFileRecord } from "../core/utils";
import { createDefaultRegistry } from "./builtin-matchers";

// Technology detection
export async function detectTech(rootPath: string): Promise<DetectedTech> {
	const tags: string[] = [];
	const frameworks: string[] = [];
	const languages: string[] = [];

	try {
		const packageJsonPath = path.join(rootPath, "package.json");
		const raw = await Bun.file(packageJsonPath)
			.text()
			.catch(() => null);
		if (raw) {
			const pkg = JSON.parse(raw);
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			if (deps.next) frameworks.push("nextjs");
			if (deps.react) frameworks.push("react");
			if (deps.express) frameworks.push("express");
			if (deps.fastify) frameworks.push("fastify");
			if (deps.nestjs || deps["@nestjs/core"]) frameworks.push("nestjs");
			if (deps.hono) frameworks.push("hono");
			if (deps.vue) frameworks.push("vue");
			if (deps.typescript) languages.push("typescript");
			languages.push("javascript");
		}
	} catch {
		// Not a Node.js project
	}

	const checks: Array<{ file: string; tag: string; type: "language" | "framework" | "tag" }> = [
		{ file: "requirements.txt", tag: "python", type: "language" },
		{ file: "go.mod", tag: "go", type: "language" },
		{ file: "Cargo.toml", tag: "rust", type: "language" },
		{ file: "Gemfile", tag: "ruby", type: "language" },
		{ file: "composer.json", tag: "php", type: "language" },
		{ file: "pom.xml", tag: "java", type: "language" },
		{ file: "Dockerfile", tag: "docker", type: "tag" },
	];

	for (const check of checks) {
		try {
			await fs.access(path.join(rootPath, check.file));
			if (check.type === "language") languages.push(check.tag);
			else tags.push(check.tag);
			frameworks.push(check.tag);
		} catch {
			// not present
		}
	}

	const uniqueTags = [...new Set([...tags, ...frameworks, ...languages])];
	return {
		tags: uniqueTags,
		frameworks: [...new Set(frameworks)],
		languages: [...new Set(languages)],
		confidence: Math.min(uniqueTags.length / 5, 1),
	};
}

// Regex scanner driver
export class RegexScannerDriver implements ScannerDriver {
	name = "regex";

	async scan(params: {
		projectId: string;
		root: string;
		filePaths?: string[];
		matchers: MatcherPlugin[];
		onProgress?: (progress: ScanProgress) => void;
	}): Promise<{ runId: string; candidateCount: number }> {
		const { projectId, root, filePaths, matchers, onProgress } = params;
		const runId = generateRunId();
		let candidateCount = 0;
		let filesScanned = 0;

		await ensureProject(projectId, root);

		// Collect files to scan
		let files: string[] = [];
		if (filePaths && filePaths.length > 0) {
			files = filePaths;
		} else {
			// Walk directory tree
			const patternSet = new Set<string>();
			for (const matcher of matchers) {
				for (const pattern of matcher.filePatterns) {
					patternSet.add(pattern);
				}
			}
			// Simple recursive walk for files matching patterns
			files = await walkDir(root, matchers);
		}

		const uniqueFiles = [...new Set(files)];

		for (const file of uniqueFiles) {
			const absolutePath = path.join(root, file);
			if (shouldIgnoreFile(absolutePath)) continue;

			try {
				const content = await Bun.file(absolutePath).text();
				const fileHash = computeFileHash(content);
				const fileCandidates: CandidateMatch[] = [];

				for (const matcher of matchers) {
					try {
						const matches = matcher.match(content, absolutePath);
						if (matches && matches.length > 0) {
							fileCandidates.push(...matches);
						}
					} catch {
						// Skip matcher errors
					}
				}

				if (fileCandidates.length > 0) {
					const fileRecord: FileRecord = {
						filePath: file,
						projectId,
						candidates: fileCandidates,
						lastScannedAt: new Date().toISOString(),
						lastScannedRunId: runId,
						fileHash,
						findings: [],
						status: "pending",
					};
					await writeFileRecord(projectId, fileRecord, root);
					candidateCount += fileCandidates.length;
				}

				filesScanned++;
				if (onProgress) {
					onProgress({ filesScanned, totalFiles: uniqueFiles.length, currentFile: file, candidateCount });
				}
			} catch {
				// Skip unreadable files
			}
		}

		return { runId, candidateCount };
	}
}

async function walkDir(dir: string, matchers: MatcherPlugin[]): Promise<string[]> {
	const results: string[] = [];
	const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

	let entries: fs.Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return results;
	}

	for (const entry of entries) {
		if (SKIP.has(entry.name)) continue;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			const subResults = await walkDir(fullPath, matchers);
			results.push(...subResults);
		} else {
			const relPath = path.relative(dir, fullPath);
			// Check if any matcher wants this file
			const wants = matchers.some(m =>
				m.filePatterns.some(p => {
					if (p.includes("*")) {
						const exts = p.split("*").filter(Boolean);
						return exts.some(e => relPath.endsWith(e));
					}
					return relPath.includes(p);
				}),
			);
			if (wants) results.push(relPath);
		}
	}
	return results;
}

// Main scan function
export async function scan(params: {
	projectId: string;
	root: string;
	matchers?: MatcherPlugin[];
	filePaths?: string[];
	onProgress?: (progress: ScanProgress) => void;
}): Promise<{
	runId: string;
	candidateCount: number;
	detected: DetectedTech;
	activeMatchers: string[];
}> {
	const { projectId, root, filePaths, onProgress } = params;
	const matchers = params.matchers ?? createDefaultRegistry();

	const detected = await detectTech(root);

	const activeMatchers = matchers.filter(matcher => {
		if (!matcher.requires || matcher.requires.length === 0) return true;
		return matcher.requires.some(
			req => detected.tags.includes(req) || detected.frameworks.includes(req) || detected.languages.includes(req),
		);
	});

	const driver = new RegexScannerDriver();
	const result = await driver.scan({ projectId, root, filePaths, matchers: activeMatchers, onProgress });

	return {
		runId: result.runId,
		candidateCount: result.candidateCount,
		detected,
		activeMatchers: activeMatchers.map(m => m.slug),
	};
}
