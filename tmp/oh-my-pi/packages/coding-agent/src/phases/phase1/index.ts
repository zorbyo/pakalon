/**
 * Phase 1: Planning & Requirements for Pakalon.
 * LLM-driven. Either runs the Q&A session (HIL) or auto-answers (YOLO),
 * then generates the 13 markdown artifacts (plan, tasks, user-stories,
 * design, prd, risks, etc.) via individual LLM calls. Falls back to
 * template generators if no LLM is reachable.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { analyzeExistingProject } from "../../pakalon/init";
import { invokePhaseLLM } from "../../pakalon/llm/invoker";
import { rememberArtifact, rememberQA } from "../../pakalon/mem0";
import {
	type AskQuestionFn,
	autoAnswer,
	classifyPromptComplexity,
	generateQuestions,
	type QASession,
	runInteractiveQA,
} from "../../pakalon/qa/qa-runner";
import agentSkillsSystemPrompt from "../../prompts/phase-1/agent-skills.md" with { type: "text" };
import plannerSystemPrompt from "../../prompts/phase-1/planner.md" with { type: "text" };

export interface Phase1Input {
	prompt: string;
	mode: "HIL" | "YOLO";
	techStack?: string;
	existingProject?: boolean;
	languages?: string[];
	frameworks?: string[];
	/** Optional budget override (0-100). In HIL mode the TUI prompts for this; in YOLO it's 90. */
	contextBudgetPct?: number;
	/**
	 * Optional callback for interactive Q&A in HIL mode.
	 * When provided, the phase runner uses this to present questions to the user
	 * one-by-one instead of auto-answering. If omitted in HIL mode, Q&A is skipped.
	 */
	askQuestion?: AskQuestionFn;
}

export interface Phase1Output {
	plan: string;
	tasks: string;
	userStories: string;
	design: string;
	contextManagement: string;
	apiReference: string;
	databaseSchema: string;
	phase1Doc: string;
	prd: string;
	riskAssessment: string;
	technicalSpec: string;
	competitiveAnalysis: string;
	constraints: string;
	agentSkills: string;
}

const PHASE1_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1");

/**
 * Run Phase 1: Planning & Requirements.
 * Generates all required documentation based on the user's prompt.
 */
export async function runPhase1(cwd: string, input: Phase1Input): Promise<Phase1Output> {
	logger.info("Phase 1: Planning & Requirements started", { cwd, mode: input.mode });

	const dir = PHASE1_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });

	// 1) Detect existing project and (for YOLO) build a Q&A session up-front.
	const existing = analyzeExistingProject(cwd);
	const hasExisting = existing.hasCode;
	const qaSession: QASession = {
		prompt: input.prompt,
		mode: input.mode,
		answers: [],
	};

	if (input.mode === "YOLO") {
		try {
			const questions = await generateQuestions(input.prompt, input.mode, cwd);
			qaSession.answers = await autoAnswer(input.prompt, questions, cwd);
		} catch (err) {
			logger.warn("Phase 1: Q&A auto-answer failed, falling back to template", { err });
		}
	} else if (input.askQuestion) {
		// HIL mode with interactive Q&A callback
		try {
			const interactive = await runInteractiveQA(input.prompt, input.mode, cwd, input.askQuestion);
			qaSession.answers = interactive.answers;
			qaSession.endedAt = interactive.endedAt;
		} catch (err) {
			logger.warn("Phase 1: interactive Q&A failed, proceeding with empty session", { err });
		}
	} else {
		logger.info("Phase 1: HIL mode without askQuestion callback — skipping Q&A");
	}

	// 2) Generate each artifact via a dedicated LLM call. If the LLM
	//    fails for any artifact we fall back to a minimal template so
	//    that the pipeline can still progress.
	//
	//    Generation order (per code.md §3 / CLI-req.md §Phase-1):
	//      1. plan.md + tasks.md first (the "spine" of phase 1).
	//      2. The remaining 11 artifacts use plan + tasks as context.
	//      3. phase-1.md is synthesised last as the roll-up summary.
	const generateOne = (
		label: string,
		kind:
			| "plan"
			| "tasks"
			| "user-stories"
			| "design"
			| "api"
			| "db"
			| "summary"
			| "prd"
			| "risks"
			| "technical-spec"
			| "competition"
			| "constraints"
			| "skills",
		extra?: Record<string, unknown>,
	) =>
		safeGenerate(label, input, qaSession, existing, () =>
			generateDoc(
				kind,
				kind === "design" || kind === "skills" ? agentSkillsSystemPrompt : plannerSystemPrompt,
				input,
				qaSession,
				existing,
				extra,
			),
		);

	// Spine: plan.md, then tasks.md (sequential because tasks reads plan).
	const plan = await generateOne("plan", "plan");
	const tasks = await generateOne("tasks", "tasks", { plan });

	// Write the spine to disk before generating dependent artifacts so
	// any read-mid-flight gets a consistent view of the project.
	fs.writeFileSync(path.join(dir, "plan.md"), plan);
	fs.writeFileSync(path.join(dir, "tasks.md"), tasks);

	// Dependent artifacts now see the spine as extra LLM context so they
	// can reference plan + tasks sections when generating their own
	// content. They run in parallel (no inter-dependencies).
	const spineContext = { plan, tasks };
	const dependent = (
		labels: Array<
			| "user-stories"
			| "design"
			| "api"
			| "db"
			| "prd"
			| "risks"
			| "technical-spec"
			| "competition"
			| "constraints"
			| "skills"
		>,
	) =>
		Promise.all(
			labels.map(label =>
				safeGenerate(label, input, qaSession, existing, () =>
					generateDoc(
						label,
						label === "design" || label === "skills" ? agentSkillsSystemPrompt : plannerSystemPrompt,
						input,
						qaSession,
						existing,
						spineContext,
					),
				),
			),
		);

	const [
		userStories,
		design,
		apiReference,
		databaseSchema,
		prd,
		riskAssessment,
		technicalSpec,
		competitiveAnalysis,
		constraints,
		agentSkills,
	] = await dependent([
		"user-stories",
		"design",
		"api",
		"db",
		"prd",
		"risks",
		"technical-spec",
		"competition",
		"constraints",
		"skills",
	]);

	// Roll-up summary last, with the full spine + 10 dependent artifacts
	// in context so phase-1.md accurately reflects what was produced.
	const rollupContext = {
		plan,
		tasks,
		userStories,
		design,
		apiReference,
		databaseSchema,
		prd,
		riskAssessment,
		technicalSpec,
		competitiveAnalysis,
		constraints,
		agentSkills,
	};
	const phase1Doc = await safeGenerate("summary", input, qaSession, existing, () =>
		generateDoc("summary", plannerSystemPrompt, input, qaSession, existing, rollupContext),
	);

	// Context management is deterministic (no LLM) but lives alongside the
	// spine so it ships at the right point in the layout.
	const contextManagement = generateContextManagement(input);

	const output: Phase1Output = {
		plan,
		tasks,
		userStories,
		design,
		contextManagement,
		apiReference,
		databaseSchema,
		phase1Doc,
		prd,
		riskAssessment,
		technicalSpec,
		competitiveAnalysis,
		constraints,
		agentSkills,
	};

	// 3) Write all files
	fs.writeFileSync(path.join(dir, "plan.md"), output.plan);
	fs.writeFileSync(path.join(dir, "tasks.md"), output.tasks);
	fs.writeFileSync(path.join(dir, "user-stories.md"), output.userStories);
	fs.writeFileSync(path.join(dir, "design.md"), output.design);
	fs.writeFileSync(path.join(dir, "context_management.md"), output.contextManagement);
	fs.writeFileSync(path.join(dir, "API_reference.md"), output.apiReference);
	fs.writeFileSync(path.join(dir, "Database_schema.md"), output.databaseSchema);
	fs.writeFileSync(path.join(dir, "phase-1.md"), output.phase1Doc);
	fs.writeFileSync(path.join(dir, "prd.md"), output.prd);
	fs.writeFileSync(path.join(dir, "risk-assessment.md"), output.riskAssessment);
	fs.writeFileSync(path.join(dir, "technical-spec.md"), output.technicalSpec);
	fs.writeFileSync(path.join(dir, "competitive-analysis.md"), output.competitiveAnalysis);
	fs.writeFileSync(path.join(dir, "constraints-and-tradeoffs.md"), output.constraints);
	fs.writeFileSync(path.join(dir, "agent-skills.md"), output.agentSkills);

	// 4) Mem0 cloud sync (per CLI-req.md §619). Each Q&A answer and each
	//    artifact is also persisted to Mem0 when MEM0_API_KEY is set.
	//    Failures are logged but never block the pipeline.
	void persistPhase1ToMem0(cwd, qaSession, output).catch(err => logger.warn("phase-1: mem0 sync failed", { err }));

	logger.info("Phase 1 completed", { filesGenerated: 14, mode: input.mode, qaAnswers: qaSession.answers.length });
	return output;
}

/**
 * Mirror phase-1 outputs (Q&A answers + 14 artifacts) to Mem0 cloud.
 * Best-effort: missing API key, network errors, or schema drift
 * never fail the phase.
 */
async function persistPhase1ToMem0(cwd: string, qa: QASession, out: Phase1Output): Promise<void> {
	const userId = process.env.PAKALON_USER_ID ?? process.env.USER ?? "anonymous";
	const projectRoot = cwd;

	for (const ans of qa.answers) {
		await rememberQA({
			userId,
			question: ans.question,
			answer: `${ans.label} — ${ans.description}`,
			sessionId: `${projectRoot}:phase-1`,
		});
	}

	const artifacts: Array<{ name: string; content: string }> = [
		{ name: "plan", content: out.plan },
		{ name: "tasks", content: out.tasks },
		{ name: "user-stories", content: out.userStories },
		{ name: "design", content: out.design },
		{ name: "context-management", content: out.contextManagement },
		{ name: "api-reference", content: out.apiReference },
		{ name: "database-schema", content: out.databaseSchema },
		{ name: "phase-1", content: out.phase1Doc },
		{ name: "prd", content: out.prd },
		{ name: "risk-assessment", content: out.riskAssessment },
		{ name: "technical-spec", content: out.technicalSpec },
		{ name: "competitive-analysis", content: out.competitiveAnalysis },
		{ name: "constraints-and-tradeoffs", content: out.constraints },
		{ name: "agent-skills", content: out.agentSkills },
	];
	for (const a of artifacts) {
		await rememberArtifact({
			userId,
			phase: "phase-1",
			name: a.name,
			content: a.content,
			projectRoot,
		});
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generation helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function safeGenerate(
	label: string,
	input: Phase1Input,
	qa: QASession,
	existing: ReturnType<typeof analyzeExistingProject>,
	produce: () => Promise<string>,
): Promise<string> {
	try {
		return await produce();
	} catch (err) {
		logger.warn(`Phase 1: ${label} generation failed, falling back to template`, { err });
		return generateTemplate(label, input, qa, existing);
	}
}

async function generateDoc(
	kind:
		| "plan"
		| "tasks"
		| "user-stories"
		| "design"
		| "api"
		| "db"
		| "summary"
		| "prd"
		| "risks"
		| "technical-spec"
		| "competition"
		| "constraints"
		| "skills",
	systemPrompt: string,
	input: Phase1Input,
	qa: QASession,
	existing: ReturnType<typeof analyzeExistingProject>,
	extraContext?: Record<string, unknown>,
): Promise<string> {
	const userPrompt = JSON.stringify({
		kind,
		userPrompt: input.prompt,
		mode: input.mode,
		qaAnswers: qa.answers,
		existingProject: existing.hasCode,
		languages: existing.languages,
		frameworks: existing.frameworks,
		complexity: classifyPromptComplexity(input.prompt),
		...(extraContext ?? {}),
	});
	const result = await invokePhaseLLM(systemPrompt, userPrompt, { cwd: process.cwd(), phase: "phase-1" });
	return result.text;
}

function generateContextManagement(input: Phase1Input): string {
	const pct = input.contextBudgetPct ?? (input.mode === "YOLO" ? 90 : input.existingProject ? 35 : 65);
	return `# Context Management

## Model Settings
- Default Model: \`auto\` (largest context window, lowest output cost)
- Context Window: 128,000 tokens
- Max Output: 16,384 tokens
- Temperature: 0.7
- Mode: ${input.mode}

## Token Allocation (per phase, with 10% buffer)

| Phase | Allocated | Notes |
|-------|-----------|-------|
| Phase 1 | 25,600 | Planning & requirements |
| Phase 2 | 19,200 | Wireframe generation |
| Phase 3 | 102,400 | Development (5 sub-agents) |
| Phase 4 | 51,200 | Testing & security |
| Phase 5 | 12,800 | Deployment |
| Phase 6 | 12,800 | Documentation |
| **Buffer** | **12,800** | **10% safety margin** |

## Usage
- Allocated budget: **${pct}% of available context** (${input.mode === "YOLO" ? "auto" : "user-specified"}).
- Minimum recommended: 65% for new projects, 35% for existing projects.
- YOLO auto-allocates 90% with 10% buffer.

## Rules
- Each phase must stay within its allocation.
- ${input.mode === "HIL" ? "HIL: ask the user before exceeding the budget." : "YOLO: auto-allocate up to the buffer."}
- The \`auto\` model is the largest-context, lowest-cost option.
`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Offline fallbacks
// ═══════════════════════════════════════════════════════════════════════════════

function generateTemplate(
	kind: string,
	input: Phase1Input,
	_qa: QASession,
	existing: ReturnType<typeof analyzeExistingProject>,
): string {
	const existingBlock = existing.hasCode
		? `\n## Existing Project\n- Languages: ${existing.languages.join(", ") || "unknown"}\n- Frameworks: ${existing.frameworks.join(", ") || "unknown"}\n`
		: "";
	return `# ${kind}\n\n## Project: ${input.prompt}\n## Mode: ${input.mode}${existingBlock}\n<!-- Generated by Pakalon (offline template) -->\n`;
}
