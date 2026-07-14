import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { AuditBucket, AuditFinding, AuditReport } from "./types";

export interface AuditorOptions {
	projectDir: string;
	maxIterations?: number;
	mode: "HIL" | "YOLO";
	phase1Dir?: string;
	phase3Dir?: string;
	onIterationComplete?: (report: AuditReport, iteration: number) => void;
	onDispatchAgent?: (agent: string, tasks: string[]) => Promise<void>;
}

const PHASE1_REQUIREMENT_FILES = [
	"plan.md",
	"tasks.md",
	"user-stories.md",
	"design.md",
	"technical-spec.md",
	"API_reference.md",
	"Database_schema.md",
	"prd.md",
	"risk-assessment.md",
	"competitive-analysis.md",
	"constraints-and-tradeoffs.md",
	"agent-skills.md",
];

const CODEBASE_IGNORE_PATTERNS = [
	"node_modules",
	".git",
	"dist",
	"build",
	"target",
	".next",
	"coverage",
	".pakalon-agents",
	".pakalon",
	"__pycache__",
	"*.log",
	".DS_Store",
];

function uid(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isIgnored(filePath: string): boolean {
	const rel = filePath.split(path.sep).join("/");
	return CODEBASE_IGNORE_PATTERNS.some(p => rel.includes(p));
}

function readTextSafe(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

function isLikelyGenerated(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	if (["svg", "penpot", "json", "xml", "png", "jpg"].includes(ext)) return true;
	const base = path.basename(filePath).toLowerCase();
	if (base.includes("wireframe_generated")) return true;
	return false;
}

function extractFeatureDeclarations(text: string): string[] {
	const features: string[] = [];
	const patterns = [
		/authentication/i,
		/auth/i,
		/login/i,
		/register/i,
		/jwt/i,
		/oauth/i,
		/dashboard/i,
		/payment/i,
		/stripe/i,
		/polar/i,
		/database/i,
		/postgres/i,
		/mongodb/i,
		/sqlite/i,
		/api/i,
		/rest/i,
		/graphql/i,
		/real.?time/i,
		/websocket/i,
		/upload/i,
		/image/i,
		/video/i,
		/search/i,
		/filter/i,
		/pagination/i,
		/crud/i,
		/file.?upload/i,
		/email/i,
		/notification/i,
		/role/i,
		/permission/i,
		/admin/i,
		/settings/i,
		/profile/i,
		/theme/i,
		/dark.?mode/i,
		/responsive/i,
		/mobile/i,
		/pwa/i,
	];
	for (const p of patterns) {
		if (p.test(text)) features.push(p.source.replace(/\/i/, ""));
	}
	return features;
}

function scanCodebase(projectDir: string): {
	filesScanned: string[];
	sourceFiles: string[];
	totalLines: number;
	featuresDetected: string[];
	hasFrontend: boolean;
	hasBackend: boolean;
	hasTests: boolean;
	hasAuth: boolean;
	hasDatabase: boolean;
	hasAPI: boolean;
	hasDocs: boolean;
	hasCI: boolean;
} {
	const filesScanned: string[] = [];
	const sourceFiles: string[] = [];
	let totalLines = 0;
	const allTexts: string[] = [];
	let hasFrontend = false;
	let hasBackend = false;
	let hasTests = false;
	let hasAuth = false;
	let hasDatabase = false;
	let hasAPI = false;
	let hasDocs = false;
	let hasCI = false;

	function walk(dir: string): void {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (isIgnored(fullPath)) continue;
			if (entry.isDirectory()) {
				walk(fullPath);
			} else if (entry.isFile()) {
				filesScanned.push(fullPath);
				const ext = path.extname(entry.name).toLowerCase();
				const srcExts = [
					".ts",
					".tsx",
					".js",
					".jsx",
					".py",
					".go",
					".rs",
					".sql",
					".yaml",
					".yml",
					".json",
					".toml",
				];
				const base = entry.name.toLowerCase();
				const rel = fullPath.toLowerCase();
				if (srcExts.includes(ext) && !isLikelyGenerated(fullPath)) {
					sourceFiles.push(fullPath);
					const text = readTextSafe(fullPath);
					if (text) {
						totalLines += text.split("\n").length;
						allTexts.push(text);
					}
					if (
						rel.includes("/frontend/") ||
						base.includes("page.tsx") ||
						base.includes("app.tsx") ||
						rel.includes("/components/") ||
						rel.includes("tailwind") ||
						rel.includes("next.config") ||
						base.includes(".css") ||
						base.includes(".scss")
					) {
						hasFrontend = true;
					}
					if (
						rel.includes("/backend/") ||
						base.includes("server.") ||
						base.includes("routes/") ||
						rel.includes("/api/") ||
						base.includes("express") ||
						base.includes("elysia") ||
						base.includes("fastapi")
					) {
						hasBackend = true;
					}
					if (
						base.includes("test.") ||
						base.includes("spec.") ||
						rel.includes("/tests/") ||
						rel.includes("/__tests__/") ||
						base.includes(".test.ts") ||
						base.includes(".spec.ts")
					) {
						hasTests = true;
					}
					if (
						/jwt|oauth|passport|clerk|nextauth|auth\.js|supabase.*auth/i.test(text) ||
						(base.includes("auth") && !base.includes("author"))
					) {
						hasAuth = true;
					}
					if (
						/schema|migration|prisma|drizzle|knex|sequelize|createTable|CREATE TABLE/i.test(text) ||
						(base.includes("schema") && ext === ".ts") ||
						base.endsWith(".sql")
					) {
						hasDatabase = true;
					}
					if (
						/apropos|router\.|app\.get|app\.post|app\.put|app\.delete|@Controller|@Get|@Post|endpoint/i.test(text)
					) {
						hasAPI = true;
					}
				}
				if (base === "readme.md" || rel.includes("/docs/")) {
					hasDocs = true;
				}
				if (rel.includes(".github/workflows/") || base.includes("ci") || base.includes("workflow")) {
					hasCI = true;
				}
			}
		}
	}

	walk(projectDir);
	const combinedText = allTexts.join("\n");
	const featuresDetected = extractFeatureDeclarations(combinedText);

	return {
		filesScanned,
		sourceFiles,
		totalLines,
		featuresDetected: [...new Set(featuresDetected)],
		hasFrontend,
		hasBackend,
		hasTests,
		hasAuth,
		hasDatabase,
		hasAPI,
		hasDocs,
		hasCI,
	};
}

function scanPhase1Artifacts(phase1Dir: string): {
	present: string[];
	missing: string[];
	contents: Record<string, string>;
} {
	const present: string[] = [];
	const missing: string[] = [];
	const contents: Record<string, string> = {};

	for (const file of PHASE1_REQUIREMENT_FILES) {
		const filePath = path.join(phase1Dir, file);
		if (fs.existsSync(filePath)) {
			present.push(file);
			contents[file] = readTextSafe(filePath);
		} else {
			missing.push(file);
		}
	}

	return { present, missing, contents };
}

function compareRequirementsToCodebase(
	phase1Artifacts: { present: string[]; missing: string[]; contents: Record<string, string> },
	codebase: ReturnType<typeof scanCodebase>,
): AuditBucket[] {
	const buckets: AuditBucket[] = [];
	const findings: AuditFinding[] = [];

	const allPhase1Text = Object.values(phase1Artifacts.contents).join("\n").toLowerCase();
	const reqFeatures = extractFeatureDeclarations(allPhase1Text);

	function assessFeature(feature: string): "complete" | "partial" | "missing" {
		const keyword = feature.toLowerCase();
		const hasCode = codebase.sourceFiles.some(f => {
			const text = readTextSafe(f).toLowerCase();
			return keyword.length > 3 ? text.includes(keyword) : false;
		});
		const hasConfig = codebase.filesScanned.some(f => {
			const base = path.basename(f).toLowerCase();
			return base.includes(keyword) || readTextSafe(f).toLowerCase().includes(keyword);
		});
		if (hasCode && hasConfig) return "complete";
		if (hasCode || hasConfig) return "partial";
		const mentionedInDocs = phase1Artifacts.contents["user-stories.md"]?.toLowerCase().includes(keyword) ?? false;
		if (mentionedInDocs && !hasCode) return "missing";
		return "missing";
	}

	for (const feature of reqFeatures) {
		const status = assessFeature(feature);
		if (status === "missing") {
			findings.push({
				id: uid(),
				rule: "missing-feature",
				severity: "high",
				message: `Required feature '${feature}' not found in codebase`,
				recommendation: `Implement ${feature} feature per phase-1 requirements`,
			});
		} else if (status === "partial") {
			findings.push({
				id: uid(),
				rule: "partial-feature",
				severity: "medium",
				message: `Feature '${feature}' partially implemented`,
				recommendation: `Complete implementation of ${feature}`,
			});
		}
	}

	buckets.push({
		name: "Phase 1 Artifacts",
		status: phase1Artifacts.missing.length === 0 ? "complete" : "partial",
		findings: phase1Artifacts.missing.map(
			f =>
				({
					id: uid(),
					rule: "missing-phase1-artifact",
					severity: "high",
					message: `Phase 1 artifact missing: ${f}`,
					recommendation: `Run /phase-1 to generate ${f}`,
				}) as AuditFinding,
		),
	});

	if (codebase.sourceFiles.length === 0) {
		buckets.push({
			name: "Application Code",
			status: "missing",
			findings: [
				{
					id: uid(),
					rule: "no-source-code",
					severity: "critical",
					message: "No application source code found in project directory",
					recommendation: "Run /phase-3 to generate the application code",
				},
			],
		});
	} else {
		const completeFeatures = reqFeatures.filter(f => assessFeature(f) === "complete").length;
		const totalReqFeatures = reqFeatures.length || 1;
		const coverage = completeFeatures / totalReqFeatures;

		buckets.push({
			name: "Application Code",
			status: coverage >= 0.9 ? "complete" : coverage >= 0.5 ? "partial" : "missing",
			findings: findings,
		});
	}

	buckets.push({
		name: "Frontend",
		status: codebase.hasFrontend ? "complete" : "missing",
		findings: codebase.hasFrontend
			? []
			: [
					{
						id: uid(),
						rule: "missing-frontend",
						severity: "high",
						message: "No frontend code found",
						recommendation: "Implement frontend per design.md wireframes using Tailwind CSS + Shadcn UI",
					} as AuditFinding,
				],
	});

	buckets.push({
		name: "Backend",
		status: codebase.hasBackend ? "complete" : "missing",
		findings: codebase.hasBackend
			? []
			: [
					{
						id: uid(),
						rule: "missing-backend",
						severity: "high",
						message: "No backend code found",
						recommendation: "Implement backend API per API_reference.md and Database_schema.md",
					} as AuditFinding,
				],
	});

	buckets.push({
		name: "Tests",
		status: codebase.hasTests ? "complete" : "partial",
		findings: codebase.hasTests
			? []
			: [
					{
						id: uid(),
						rule: "missing-tests",
						severity: "medium",
						message: "No test files detected",
						recommendation: "Run /phase-4 to generate unit/integration/E2E tests",
					} as AuditFinding,
				],
	});

	buckets.push({
		name: "CI/CD",
		status: codebase.hasCI ? "complete" : "partial",
		findings: codebase.hasCI
			? []
			: [
					{
						id: uid(),
						rule: "missing-cicd",
						severity: "low",
						message: "No CI/CD pipeline detected",
						recommendation: "Run /phase-5 to generate GitHub Actions CI/CD pipeline",
					} as AuditFinding,
				],
	});

	return buckets;
}

export class Auditor {
	private findings: AuditFinding[] = [];
	private maxIterations = 10;

	async runAudit(projectDir: string, options: AuditorOptions): Promise<AuditReport> {
		const mode = options.mode ?? "YOLO";
		const maxIterations = mode === "YOLO" ? 10 : (options.maxIterations ?? 3);
		const phase1Dir = options.phase1Dir ?? path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-1");
		const phase3Dir = options.phase3Dir ?? path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-3");
		const onIterationComplete = options.onIterationComplete;
		const onDispatchAgent = options.onDispatchAgent;

		this.maxIterations = maxIterations;
		this.findings = [];

		const phase1Artifacts = scanPhase1Artifacts(phase1Dir);
		let iteration = 0;
		let report: AuditReport;

		do {
			this.findings = [];
			const codebase = scanCodebase(projectDir);
			const buckets = compareRequirementsToCodebase(phase1Artifacts, codebase);
			this.findings = buckets.flatMap(b => b.findings);

			const complete = buckets.filter(b => b.status === "complete").length;
			const partial = buckets.filter(b => b.status === "partial").length;
			const missing = buckets.filter(b => b.status === "missing").length;
			const passRate = buckets.length > 0 ? Math.round((complete / buckets.length) * 100) : 0;

			report = {
				generatedAt: new Date().toISOString(),
				status: missing > 0 ? "failed" : partial > 0 ? "failed" : "passed",
				findings: [...this.findings],
				complete,
				partial,
				missing,
				buckets,
				recommendedNext: missing > 0 ? "implement-all" : partial > 0 ? "implement-core" : "do-nothing",
			};

			const auditorMdPath = path.join(phase3Dir, "auditor.md");
			const version = iteration + 1;
			const reportContent = formatAuditorMd(report, version, passRate);
			fs.mkdirSync(phase3Dir, { recursive: true });
			fs.writeFileSync(auditorMdPath, reportContent);

			logger.info("Auditor iteration completed", {
				iteration: version,
				passRate,
				missing,
				partial,
				complete,
			});

			if (passRate >= 100 || (missing === 0 && partial === 0)) {
				logger.info("Auditor: 100% pass rate reached, stopping iterations");
				break;
			}

			if (mode === "YOLO") {
				if (missing > 0 && onDispatchAgent) {
					const missingFeatures = report.findings
						.filter(f => f.rule === "missing-feature" || f.severity === "critical")
						.map(f => f.recommendation ?? f.message);
					await onDispatchAgent("implementer", missingFeatures);
				}
				if (partial > 0 && onDispatchAgent) {
					const partialFeatures = report.findings
						.filter(f => f.rule === "partial-feature")
						.map(f => f.recommendation ?? f.message);
					await onDispatchAgent("implementer", partialFeatures);
				}
			}

			if (onIterationComplete) {
				onIterationComplete(report, iteration);
			}

			iteration++;
		} while (iteration < this.maxIterations && report.status !== "passed");

		logger.info("Audit completed", {
			iterations: iteration,
			passRate: Math.round((report.complete / (report.complete + report.partial + report.missing || 1)) * 100),
			status: report.status,
		});

		return report;
	}

	getMaxIterations(): number {
		return this.maxIterations;
	}
}

function formatAuditorMd(report: AuditReport, version: number, passRate: number): string {
	const missingItems = report.findings.filter(
		f => f.severity === "critical" || f.severity === "high" || f.rule === "missing-feature",
	);
	const partialItems = report.findings.filter(f => f.rule === "partial-feature" || f.severity === "medium");
	const completeItems = report.buckets.filter(b => b.status === "complete").map(b => b.name);

	return `# Auditor Report v${version}

> Generated: ${report.generatedAt}
> Mode: ${report.status === "passed" ? "PASSED" : "FAILED"}
> Pass Rate: ${passRate}%
> Iteration: ${version}

## Summary

| Metric   | Count |
|----------|-------|
| Complete | ${report.complete} |
| Partial  | ${report.partial} |
| Missing  | ${report.missing} |

## Recommended Next Action

**${report.recommendedNext === "implement-all" ? "Implement all missing features" : report.recommendedNext === "implement-core" ? "Implement core missing features" : "No action needed"}**

${
	missingItems.length > 0
		? `## Missing Features (${missingItems.length})

${missingItems
	.map(
		f => `### ${f.rule}: ${f.message}
- **File:** ${f.file ?? "N/A"}
- **Recommendation:** ${f.recommendation ?? "N/A"}
`,
	)
	.join("\n")}`
		: "## Missing Features\n\nNone detected.\n"
}

${
	partialItems.length > 0
		? `## Partially Implemented (${partialItems.length})

${partialItems
	.map(
		f => `### ${f.rule}: ${f.message}
- **File:** ${f.file ?? "N/A"}
- **Recommendation:** ${f.recommendation ?? "Complete the implementation"}
`,
	)
	.join("\n")}`
		: "## Partially Implemented\n\nNone detected.\n"
}

## Fully Implemented

${completeItems.length > 0 ? completeItems.map(c => `- ${c}`).join("\n") : "None detected yet."}

## Bucket Status

| Bucket | Status |
|--------|--------|
${report.buckets.map(b => `| ${b.name} | ${b.status.toUpperCase()} |`).join("\n")}

## Phase 1 Artifact Status

| Artifact | Status |
|----------|--------|
${
	report.buckets
		.find(b => b.name === "Phase 1 Artifacts")
		?.findings.map(f => `| ${f.message.replace("Phase 1 artifact missing: ", "")} | ❌ MISSING |`)
		.join("\n") ?? "| — | — |"
}

---
*Generated by Pakalon Auditor Agent v2*
`;
}
