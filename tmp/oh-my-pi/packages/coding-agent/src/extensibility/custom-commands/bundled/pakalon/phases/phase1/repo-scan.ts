/**
 * Phase 1 Repo Scan — Project context scanning.
 *
 * Scans the project directory to understand the existing codebase,
 * detect frameworks, and identify patterns.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ============================================================================
// Types
// ============================================================================

export interface RepoScanResult {
	projectPath: string;
	hasPackageJson: boolean;
	hasTsConfig: boolean;
	hasSrcDir: boolean;
	framework: string;
	dependencies: string[];
	devDependencies: string[];
	existingFiles: string[];
	existingDirs: string[];
	hasGit: boolean;
	hasDocker: boolean;
	hasCi: boolean;
	lintConfig: string[];
	testFramework: string | null;
}

// ============================================================================
// Repo Scanner
// ============================================================================

/**
 * Scan the project directory to understand the codebase.
 */
export async function scanRepo(projectPath: string): Promise<RepoScanResult> {
	logger.info("Scanning project directory", { path: projectPath });

	const result: RepoScanResult = {
		projectPath,
		hasPackageJson: false,
		hasTsConfig: false,
		hasSrcDir: false,
		framework: "unknown",
		dependencies: [],
		devDependencies: [],
		existingFiles: [],
		existingDirs: [],
		hasGit: false,
		hasDocker: false,
		hasCi: false,
		lintConfig: [],
		testFramework: null,
	};

	// Check for package.json
	try {
		await fs.access(path.join(projectPath, "package.json"));
		result.hasPackageJson = true;

		const pkgContent = await Bun.file(path.join(projectPath, "package.json")).text();
		const pkg = JSON.parse(pkgContent);

		result.dependencies = Object.keys(pkg.dependencies || {});
		result.devDependencies = Object.keys(pkg.devDependencies || {});

		// Detect framework
		if (pkg.dependencies?.next || pkg.devDependencies?.next) {
			result.framework = "nextjs";
		} else if (pkg.dependencies?.react || pkg.devDependencies?.react) {
			result.framework = "react";
		} else if (pkg.dependencies?.vue || pkg.devDependencies?.vue) {
			result.framework = "vue";
		} else if (pkg.dependencies?.svelte || pkg.devDependencies?.svelte) {
			result.framework = "svelte";
		} else if (pkg.dependencies?.express || pkg.devDependencies?.express) {
			result.framework = "express";
		} else if (pkg.dependencies?.fastify || pkg.devDependencies?.fastify) {
			result.framework = "fastify";
		}

		// Detect test framework
		if (pkg.devDependencies?.jest || pkg.dependencies?.jest) {
			result.testFramework = "jest";
		} else if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) {
			result.testFramework = "vitest";
		} else if (pkg.devDependencies?.mocha || pkg.dependencies?.mocha) {
			result.testFramework = "mocha";
		}
	} catch {}

	// Check for tsconfig.json
	try {
		await fs.access(path.join(projectPath, "tsconfig.json"));
		result.hasTsConfig = true;
	} catch {}

	// Check for src directory
	try {
		await fs.access(path.join(projectPath, "src"));
		result.hasSrcDir = true;
	} catch {}

	// Check for git
	try {
		await fs.access(path.join(projectPath, ".git"));
		result.hasGit = true;
	} catch {}

	// Check for Docker
	try {
		await fs.access(path.join(projectPath, "Dockerfile"));
		result.hasDocker = true;
	} catch {}

	// Check for CI
	try {
		await fs.access(path.join(projectPath, ".github", "workflows"));
		result.hasCi = true;
	} catch {}

	// Check for lint configs
	const lintFiles = [
		".eslintrc.js",
		".eslintrc.json",
		".eslintrc.yml",
		"eslint.config.js",
		"biome.json",
		".prettierrc",
	];
	for (const file of lintFiles) {
		try {
			await fs.access(path.join(projectPath, file));
			result.lintConfig.push(file);
		} catch {}
	}

	// List existing files and directories
	try {
		const entries = await fs.readdir(projectPath, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			if (entry.isFile()) {
				result.existingFiles.push(entry.name);
			} else if (entry.isDirectory()) {
				result.existingDirs.push(entry.name);
			}
		}
	} catch {}

	logger.info("Repo scan complete", {
		framework: result.framework,
		files: result.existingFiles.length,
		dirs: result.existingDirs.length,
	});

	return result;
}

/**
 * Get a summary of the repo scan for display.
 */
export function getRepoScanSummary(scan: RepoScanResult): string {
	const lines: string[] = [
		"## Project Scan Summary",
		"",
		`- **Framework**: ${scan.framework}`,
		`- **Package.json**: ${scan.hasPackageJson ? "Yes" : "No"}`,
		`- **TypeScript**: ${scan.hasTsConfig ? "Yes" : "No"}`,
		`- **Git**: ${scan.hasGit ? "Yes" : "No"}`,
		`- **Docker**: ${scan.hasDocker ? "Yes" : "No"}`,
		`- **CI/CD**: ${scan.hasCi ? "Yes" : "No"}`,
		`- **Test Framework**: ${scan.testFramework || "None detected"}`,
		"",
		"### Dependencies",
		scan.dependencies.length > 0 ? scan.dependencies.map(d => `- ${d}`).join("\n") : "- None",
		"",
		"### Existing Files",
		scan.existingFiles.length > 0
			? scan.existingFiles
					.slice(0, 20)
					.map(f => `- ${f}`)
					.join("\n")
			: "- None",
		"",
		"### Existing Directories",
		scan.existingDirs.length > 0 ? scan.existingDirs.map(d => `- ${d}`).join("\n") : "- None",
	];

	return lines.join("\n");
}
