/**
 * Token budget and context management for Pakalon phases.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface TokenBudget {
	phase1: number;
	phase2: number;
	phase3: number;
	phase4: number;
	phase5: number;
	phase6: number;
	buffer: number;
}

export interface Phase3SubAgentBudget {
	frontend: number;
	backend: number;
	integration: number;
	debug: number;
	verify: number;
}

export interface ContextManagement {
	modelContextWindow: number;
	budget: TokenBudget;
	phase3SubAgents: Phase3SubAgentBudget;
	allocatedPerPhase: Record<string, number>;
	budgetLevel: BudgetLevel;
}

export type BudgetLevel = "conservative" | "standard" | "aggressive";

export interface BudgetCheckResult {
	ok: boolean;
	warning: boolean;
	exceeded: boolean;
	usagePercent: number;
	tokensUsed: number;
	tokensAllocated: number;
}

export interface CompressionResult {
	phase: string;
	originalSize: number;
	compressedSize: number;
	summaryPath: string;
	archivedPaths: string[];
}

const DEFAULT_CONTEXT_WINDOW = 128000;
const COMPRESSION_THRESHOLD = 0.8;
const HALT_THRESHOLD = 1.0;

const BUDGET_MULTIPLIERS: Record<BudgetLevel, number> = {
	conservative: 0.65,
	standard: 0.8,
	aggressive: 0.95,
};

const PHASE_ALLOCATIONS: Record<string, number> = {
	"phase-1": 0.2,
	"phase-2": 0.15,
	"phase-3": 0.3,
	"phase-4": 0.15,
	"phase-5": 0.1,
	"phase-6": 0.1,
};

const PHASE3_SUBAGENT_SPLITS: Phase3SubAgentBudget = {
	frontend: 0.3,
	backend: 0.25,
	integration: 0.2,
	debug: 0.15,
	verify: 0.1,
};

export function allocateTokens(contextWindow: number = DEFAULT_CONTEXT_WINDOW): TokenBudget {
	const buffer = Math.floor(contextWindow * 0.1);
	const available = contextWindow - buffer;
	return {
		phase1: Math.floor(available * 0.2),
		phase2: Math.floor(available * 0.15),
		phase3: Math.floor(available * 0.3),
		phase4: Math.floor(available * 0.15),
		phase5: Math.floor(available * 0.1),
		phase6: Math.floor(available * 0.1),
		buffer,
	};
}

export function getPhaseAllocation(
	phase: string,
	budgetLevel: BudgetLevel = "standard",
	contextWindow: number = DEFAULT_CONTEXT_WINDOW,
): number {
	const base = allocateTokens(contextWindow);
	const multiplier = BUDGET_MULTIPLIERS[budgetLevel];
	const phaseKey = phase as keyof TokenBudget;
	if (!(phaseKey in base)) return 0;
	return Math.floor((base[phaseKey] as number) * multiplier);
}

export function getPhase3SubAgentBudget(totalAllocation: number): Phase3SubAgentBudget {
	return {
		frontend: Math.floor(totalAllocation * PHASE3_SUBAGENT_SPLITS.frontend),
		backend: Math.floor(totalAllocation * PHASE3_SUBAGENT_SPLITS.backend),
		integration: Math.floor(totalAllocation * PHASE3_SUBAGENT_SPLITS.integration),
		debug: Math.floor(totalAllocation * PHASE3_SUBAGENT_SPLITS.debug),
		verify: Math.floor(totalAllocation * PHASE3_SUBAGENT_SPLITS.verify),
	};
}

export function checkBudget(
	phase: string,
	usedTokens: number,
	budgetLevel: BudgetLevel = "standard",
	contextWindow: number = DEFAULT_CONTEXT_WINDOW,
): BudgetCheckResult {
	const allocated = getPhaseAllocation(phase, budgetLevel, contextWindow);
	if (allocated <= 0) {
		return { ok: false, warning: false, exceeded: true, usagePercent: 1, tokensUsed: usedTokens, tokensAllocated: 0 };
	}
	const usagePercent = Math.min(1, usedTokens / allocated);
	return {
		ok: usagePercent < HALT_THRESHOLD,
		warning: usagePercent >= COMPRESSION_THRESHOLD,
		exceeded: usagePercent >= HALT_THRESHOLD,
		usagePercent,
		tokensUsed: usedTokens,
		tokensAllocated: allocated,
	};
}

export function getPhaseOutputGlob(phase: string): string[] {
	const mdFiles: string[] = [];
	switch (phase) {
		case "phase-1":
			mdFiles.push(
				"plan.md",
				"tasks.md",
				"user-stories.md",
				"prd.md",
				"design.md",
				"technical-spec.md",
				"competitive-analysis.md",
				"constraints-and-tradeoffs.md",
				"risk-assessment.md",
				"Database_schema.md",
				"API_reference.md",
				"agent-skills.md",
			);
			break;
		case "phase-2":
			mdFiles.push("phase-2.md", "Wireframe_generated.json");
			break;
		case "phase-3":
			mdFiles.push(
				"subagent-1.md",
				"subagent-2.md",
				"subagent-3.md",
				"subagent-4.md",
				"subagent-5.md",
				"execution_log.md",
			);
			break;
		case "phase-4":
			mdFiles.push("subagent-1.md", "subagent-2.md", "subagent-3.md", "subagent-4.md", "subagent-5.md");
			break;
		case "phase-5":
			mdFiles.push("phase-5.md");
			break;
		case "phase-6":
			mdFiles.push("phase-6.md");
			break;
	}
	return mdFiles;
}

export function compressContext(
	projectDir: string,
	phase: string,
	budgetLevel: BudgetLevel = "standard",
): CompressionResult {
	const phaseDir = path.join(projectDir, ".pakalon-agents", "ai-agents", phase);
	const archiveDir = path.join(phaseDir, ".compressed");
	fs.mkdirSync(archiveDir, { recursive: true });

	const filesToCompress = getPhaseOutputGlob(phase);
	const archivedPaths: string[] = [];
	let totalOriginalSize = 0;
	let totalCompressedSize = 0;
	const summaryParts: string[] = [];

	for (const file of filesToCompress) {
		const filePath = path.join(phaseDir, file);
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			totalOriginalSize += content.length;

			const summary = summarizeContent(content, file);
			summaryParts.push(`## ${file}\n\n${summary}\n`);

			const archivePath = path.join(archiveDir, `${file}.bak`);
			fs.writeFileSync(archivePath, content);
			archivedPaths.push(archivePath);

			fs.writeFileSync(filePath, summary);
			totalCompressedSize += summary.length;
		} catch {
			// File missing or unreadable — skip during compression.
		}
	}

	const summaryContent = `# Compressed Context — ${phase}\n\nLevel: ${budgetLevel}\nArchived: ${new Date().toISOString()}\n\n${summaryParts.join("\n")}`;
	const summaryPath = path.join(phaseDir, "context-summary.md");
	fs.writeFileSync(summaryPath, summaryContent);

	logger.info("context: compressed", { phase, originalSize: totalOriginalSize, compressedSize: totalCompressedSize });

	return {
		phase,
		originalSize: totalOriginalSize,
		compressedSize: totalCompressedSize,
		summaryPath,
		archivedPaths,
	};
}

function summarizeContent(content: string, fileName: string): string {
	const lines = content.split("\n");
	const headingLines = lines.filter(l => /^#{1,3}\s/.test(l));
	const bulletLines = lines.filter(l => /^[-*]\s/.test(l));
	const codeBlockCount = (content.match(/```/g) || []).length / 2;
	const wordCount = content.split(/\s+/).length;

	const parts: string[] = [`File: ${fileName}`, `Original: ~${wordCount} words`];
	if (headingLines.length > 0) {
		parts.push(
			`Sections: ${headingLines
				.slice(0, 10)
				.map(h => h.replace(/^#+\s*/, ""))
				.join(", ")}`,
		);
	}
	if (bulletLines.length > 0) {
		parts.push(`Key points: ${bulletLines.slice(0, 5).join("; ")}`);
	}
	parts.push(`Code blocks: ${codeBlockCount}`);
	return parts.join("\n");
}

export function restoreCompressedContext(projectDir: string, phase: string): boolean {
	const phaseDir = path.join(projectDir, ".pakalon-agents", "ai-agents", phase);
	const archiveDir = path.join(phaseDir, ".compressed");
	if (!fs.existsSync(archiveDir)) return false;

	let restored = false;
	const archives = fs.readdirSync(archiveDir).filter(f => f.endsWith(".bak"));
	for (const archive of archives) {
		const originalName = archive.replace(/\.bak$/, "");
		try {
			const content = fs.readFileSync(path.join(archiveDir, archive), "utf-8");
			fs.writeFileSync(path.join(phaseDir, originalName), content);
			restored = true;
		} catch {
			// Skip corrupted archives.
		}
	}

	if (restored) {
		fs.rmSync(archiveDir, { recursive: true, force: true });
		const summaryPath = path.join(phaseDir, "context-summary.md");
		try {
			fs.unlinkSync(summaryPath);
		} catch {
			/* ok */
		}
	}

	return restored;
}

export function loadContextManagement(projectDir: string): ContextManagement | null {
	try {
		fs.readFileSync(
			path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-1", "context_management.md"),
			"utf-8",
		);
		return {
			modelContextWindow: DEFAULT_CONTEXT_WINDOW,
			budget: allocateTokens(),
			phase3SubAgents: PHASE3_SUBAGENT_SPLITS,
			allocatedPerPhase: {},
			budgetLevel: "standard",
		};
	} catch {
		return null;
	}
}

export function saveContextManagement(projectDir: string, config: ContextManagement): void {
	const dir = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-1");
	fs.mkdirSync(dir, { recursive: true });
	const tokenEntries = [
		`| Phase 1 | ${config.budget.phase1} |`,
		`| Phase 2 | ${config.budget.phase2} |`,
		`| Phase 3 | ${config.budget.phase3} |`,
		`| Phase 4 | ${config.budget.phase4} |`,
		`| Phase 5 | ${config.budget.phase5} |`,
		`| Phase 6 | ${config.budget.phase6} |`,
	].join("\n");

	const subAgentEntries = [
		`| Frontend (SA1) | ${config.phase3SubAgents.frontend} |`,
		`| Backend (SA2) | ${config.phase3SubAgents.backend} |`,
		`| Integration (SA3) | ${config.phase3SubAgents.integration} |`,
		`| Debug (SA4) | ${config.phase3SubAgents.debug} |`,
		`| Verify (SA5) | ${config.phase3SubAgents.verify} |`,
	].join("\n");

	const md = [
		`# Context Management`,
		``,
		`- Model Context Window: ${config.modelContextWindow}`,
		`- Budget Level: ${config.budgetLevel}`,
		`- Buffer (10%): ${config.budget.buffer}`,
		``,
		`## Phase Allocations`,
		``,
		`| Phase | Tokens |`,
		`|-------|--------|`,
		tokenEntries,
		``,
		`## Phase 3 Sub-Agent Budget`,
		``,
		`| Sub-Agent | Tokens |`,
		`|-----------|--------|`,
		subAgentEntries,
		``,
	].join("\n");
	fs.writeFileSync(path.join(dir, "context_management.md"), md);
}
