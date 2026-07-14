/**
 * /pakalon command - Initialize .pakalon-agents folder structure
 * /init command - Initialize .pakalon mode
 */

import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import fs from "fs";
import path from "path";

const PAKALON_AGENTS_DIR = ".pakalon-agents";
const PAKALON_DIR = ".pakalon";

/**
 * Create the .pakalon-agents folder structure for full SDLC mode
 */
export function createPakalonAgentsScaffold(projectDir: string): string[] {
	const createdFiles: string[] = [];
	const baseDir = path.join(projectDir, PAKALON_AGENTS_DIR);

	// Create main directories
	const directories = [
		path.join(baseDir, "ai-agents"),
		path.join(baseDir, "ai-agents", "phase-1"),
		path.join(baseDir, "ai-agents", "phase-2"),
		path.join(baseDir, "ai-agents", "phase-3"),
		path.join(baseDir, "ai-agents", "phase-3", "test-evidence"),
		path.join(baseDir, "ai-agents", "phase-4"),
		path.join(baseDir, "ai-agents", "phase-5"),
		path.join(baseDir, "ai-agents", "phase-6"),
		path.join(baseDir, "ai-agents", "phase-2", "tdd-screenshots"),
		path.join(baseDir, "mcp-servers"),
		path.join(baseDir, "wireframes"),
	];

	for (const dir of directories) {
		fs.mkdirSync(dir, { recursive: true });
	}

	// Phase 1 files
	const phase1Files = [
		"context_management.md",
		"plan.md",
		"tasks.md",
		"design.md",
		"phase-1.md",
		"agent-skills.md",
		"prd.md",
		"Database_schema.md",
		"API_reference.md",
		"risk-assessment.md",
		"user-stories.md",
		"technical-spec.md",
		"competitive-analysis.md",
		"constraints-and-tradeoffs.md",
	];

	for (const file of phase1Files) {
		const filePath = path.join(baseDir, "ai-agents", "phase-1", file);
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, `# ${file}\n\n*This file will be populated during Phase 1.*\n`);
			createdFiles.push(filePath);
		}
	}

	// Phase 2 files
	const phase2Files = ["phase-2.md"];
	for (const file of phase2Files) {
		const filePath = path.join(baseDir, "ai-agents", "phase-2", file);
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, `# ${file}\n\n*This file will be populated during Phase 2.*\n`);
			createdFiles.push(filePath);
		}
	}

	// Phase 3 files
	const phase3Files = [
		"auditor.md",
		"subagent-1.md",
		"subagent-2.md",
		"subagent-3.md",
		"subagent-4.md",
		"subagent-5.md",
		"execution_log.md",
	];
	for (const file of phase3Files) {
		const filePath = path.join(baseDir, "ai-agents", "phase-3", file);
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, `# ${file}\n\n*This file will be populated during Phase 3.*\n`);
			createdFiles.push(filePath);
		}
	}

	// Phase 4 files
	const phase4Files = [
		"subagent-1.md",
		"subagent-2.md",
		"subagent-3.md",
		"subagent-4.md",
		"subagent-5.md",
		"blackbox_testing.xml",
		"whitebox_testing.xml",
	];
	for (const file of phase4Files) {
		const filePath = path.join(baseDir, "ai-agents", "phase-4", file);
		if (!fs.existsSync(filePath)) {
			if (file.endsWith(".xml")) {
				fs.writeFileSync(
					filePath,
					`<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${file}">\n\t<testcase name="placeholder" />\n</testsuite>\n`,
				);
			} else {
				fs.writeFileSync(filePath, `# ${file}\n\n*This file will be populated during Phase 4.*\n`);
			}
			createdFiles.push(filePath);
		}
	}

	// Phase 5 file
	const phase5File = path.join(baseDir, "ai-agents", "phase-5", "phase-5.md");
	if (!fs.existsSync(phase5File)) {
		fs.writeFileSync(phase5File, "# Phase 5: Deployment\n\n*This file will be populated during Phase 5.*\n");
		createdFiles.push(phase5File);
	}

	// Phase 6 file
	const phase6File = path.join(baseDir, "ai-agents", "phase-6", "phase-6.md");
	if (!fs.existsSync(phase6File)) {
		fs.writeFileSync(phase6File, "# Phase 6: Documentation\n\n*This file will be populated during Phase 6.*\n");
		createdFiles.push(phase6File);
	}

	// Create sync.js for Penpot integration
	const syncJsPath = path.join(baseDir, "ai-agents", "sync.js");
	if (!fs.existsSync(syncJsPath)) {
		const syncJsContent = `#!/usr/bin/env node
/**
 * Penpot Sync Bridge
 * Syncs changes between Penpot designer and the generated wireframes
 */
import fs from "fs";
import path from "path";

const WATCH_INTERVAL = 5000; // 5 seconds
const COOLDOWN_PERIOD = 10000; // 10 seconds cooldown

let lastSync = 0;
let isRunning = false;

function syncChanges() {
	const now = Date.now();
	if (now - lastSync < COOLDOWN_PERIOD) {
		return;
	}

	try {
		// Implement Penpot sync logic here
		// Watch for file changes, sync with Penpot API
		console.log("Penpot sync: checking for changes...");
		lastSync = now;
	} catch (err) {
		console.error("Penpot sync error:", err);
	}
}

export function startSync(projectDir: string) {
	if (isRunning) return;
	isRunning = true;

	console.log("Penpot sync: started");
	const interval = setInterval(() => syncChanges(), WATCH_INTERVAL);

	return () => {
		clearInterval(interval);
		isRunning = false;
		console.log("Penpot sync: stopped");
	};
}

if (import.meta.main) {
	const projectDir = process.cwd();
	const stop = startSync(projectDir);

	process.on("SIGINT", () => {
		stop();
		process.exit(0);
	});
}
`;
		fs.writeFileSync(syncJsPath, syncJsContent);
		createdFiles.push(syncJsPath);
	}

	// Create pakalon.db placeholder (SQLite database)
	const dbPath = path.join(baseDir, "pakalon.db");
	if (!fs.existsSync(dbPath)) {
		fs.writeFileSync(dbPath, ""); // Will be created by better-sqlite3 or similar
		createdFiles.push(dbPath);
	}

	return createdFiles;
}

/**
 * Create the .pakalon folder structure for normal mode
 */
export function createPakalonScaffold(projectDir: string): string[] {
	const createdFiles: string[] = [];
	const baseDir = path.join(projectDir, PAKALON_DIR);

	// Create directories
	fs.mkdirSync(path.join(baseDir, "agents"), { recursive: true });

	// Create files
	const files = {
		"agents/skills.md": "# Agent Skills\n\n*Skills and capabilities for this project.*\n",
		"plan.md": "# Project Plan\n\n*To be generated based on requirements.*\n",
		"task.md": "# Tasks\n\n*Task breakdown will be created here.*\n",
		"user-stories.md": "# User Stories\n\n*User stories will be defined here.*\n",
		"context-management.md": "# Context Management\n\n*Token allocation strategy will be defined here.*\n",
	};

	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(baseDir, relativePath);
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, content);
			createdFiles.push(filePath);
		}
	}

	return createdFiles;
}

/**
 * Command: /pakalon - Initialize .pakalon-agents mode
 */
export const pakalonAgentsCommand: CommandEntry = {
	name: "pakalon",
	description: "Initialize Pakalon 6-phase SDLC pipeline (.pakalon-agents mode)",
	usage: "/pakalon [project description]",
	async execute(_args: string[]) {
		const projectDir = process.cwd();
		const files = createPakalonAgentsScaffold(projectDir);

		return {
			success: true,
			message:
				`[OK] Initialized .pakalon-agents/ with 6-phase SDLC pipeline\n\n` +
				`Created ${files.length} files\n\n` +
				`Ready to build! Use /phase-1 to start planning.\n\n` +
				`Project structure:\n` +
				`   - phase-1: Planning & Requirements\n` +
				`   - phase-2: Wireframes\n` +
				`   - phase-3: Development\n` +
				`   - phase-4: Testing & QA\n` +
				`   - phase-5: Deployment\n` +
				`   - phase-6: Documentation\n`,
		};
	},
};

/**
 * Command: /init - Initialize .pakalon normal mode
 */
export const pakalonInitCommand: CommandEntry = {
	name: "init",
	description: "Initialize Pakalon normal mode (.pakalon folder)",
	usage: "/init [project description]",
	async execute(_args: string[]) {
		const projectDir = process.cwd();
		const files = createPakalonScaffold(projectDir);

		return {
			success: true,
			message:
				`[OK] Initialized .pakalon/ folder\n\n` +
				`Created ${files.length} files\n\n` +
				`Ready to start! Use /plan to create a project plan.\n`,
		};
	},
};

export default { pakalonAgentsCommand, pakalonInitCommand };
