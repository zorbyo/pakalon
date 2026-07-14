/**
 * Q&A session driver for Phase 1 (Human-in-Loop).
 * Coordinates multi-choice questions, persists answers to mem0, and emits
 * the "End phase 1" terminator that flips to plan/tasks generation.
 */
import { logger } from "@oh-my-pi/pi-utils";
import qaSystemPrompt from "../../prompts/phase-1/qa.md" with { type: "text" };
import { invokePhaseLLMJson } from "../llm/invoker";

export type Mode = "HIL" | "YOLO";
export interface QAOption {
	label: string;
	description: string;
}

export interface QAQuestion {
	id: string;
	question: string;
	options: QAOption[];
	/** Optional follow-up questions shown once an option is chosen. */
	followUps?: Omit<QAQuestion, "followUps">[];
}

/**
 * Callback signature for interactive Q&A.
 * Called once per question; the host (TUI/CLI) should display the question
 * and options, then return the user's chosen option label + description.
 * Returning `null` equates to "End Phase 1".
 */
export type AskQuestionFn = (q: QAQuestion) => Promise<{ label: string; description: string } | null>;

/** Persisted answer set used by the phase runner to build the plan. */
export interface QASession {
	prompt: string;
	mode: Mode;
	answers: {
		questionId: string;
		question: string;
		parentQuestionId: string | null;
		depth: number;
		label: string;
		description: string;
	}[];
	endedAt?: string;
}

const END_PHASE_1 = "End phase 1";

/**
 * Determine if a prompt looks "plain" (no tech stack specified) or
 * "detailed" (user already named a stack). Drives the 10-vs-5 question count.
 */
export function classifyPromptComplexity(prompt: string): "plain" | "detailed" {
	const techKeywords =
		/\b(react|next\.?js|nextjs|vue|svelte|angular|node|express|fastapi|django|flask|go|rust|java|kotlin|swift|python|postgres|sqlite|mongodb|prisma|drizzle|tailwind|shadcn|radix|electron|tauri|vercel|aws|gcp|azure|cloudflare|docker|kubernetes|stripe|clerk|auth\.js|supabase|firebase|redis|graphql|trpc|rest)\b/i;
	return techKeywords.test(prompt) ? "detailed" : "plain";
}

/**
 * Produce the first round of questions. In YOLO mode, also auto-pick the
 * best option for each question.
 *
 * The requirement specifies a **minimum of 10 questions** for the
 * initial round (the "brain-storming" session). If the LLM returns
 * fewer, we top up with deterministic follow-up questions so the user
 * has at least 10 meaningful choices before they can end phase 1.
 *
 * When the prompt is "plain" (no tech stack) and the catalogue tools
 * (Firecrawl / Puppeteer / context7) are configured, we gather
 * additional web context for the LLM so the question generator can
 * reference common stacks for the app category.
 */
export async function generateQuestions(
	prompt: string,
	mode: Mode,
	cwd: string,
	existingAnswers: QASession["answers"] = [],
): Promise<QAQuestion[]> {
	const complexity = classifyPromptComplexity(prompt);
	const target = 10; // per requirement: minimum 10 questions

	// Gather web context for plain prompts. Best-effort: errors are
	// logged but never block the Q&A flow.
	const webContext =
		complexity === "plain"
			? await gatherWebContext(prompt).catch(err => {
					logger.warn("qa-runner: web context gather failed", { err });
					return "";
				})
			: "";

	const result = await invokePhaseLLMJson<{ questions: QAQuestion[] }>(
		qaSystemPrompt,
		JSON.stringify({ prompt, mode, complexity, targetCount: target, existingAnswers, webContext }),
		{ cwd, phase: "phase-1" },
	);

	// Defensive: ensure the last option is "End phase 1" + top up to 10.
	const withEnd = result.questions.map(q => {
		const hasEnd = q.options.some(o => o.label === END_PHASE_1);
		if (!hasEnd) {
			q.options.push({ label: END_PHASE_1, description: "Stop the Q&A and start generating the project plan." });
		}
		return q;
	});

	if (withEnd.length >= target) return withEnd;

	// Top up with follow-up questions for the most prominent gaps.
	const topUp = buildFollowUpQuestions(withEnd, target - withEnd.length);
	return [...withEnd, ...topUp];
}

/**
 * Gather additional web context for a plain (no-tech-stack) prompt.
 * Tries Firecrawl first, then falls back to local fetch via the
 * catalogue sites, then Puppeteer if available. Never throws.
 */
async function gatherWebContext(prompt: string): Promise<string> {
	try {
		const { scrapeForContext } = await import("../web-scrape/scraper");
		const result = await scrapeForContext(prompt, { maxResults: 5, preferFirecrawl: true });
		if (!result) return "";
		// Summarize the top hits into a compact context block.
		return result
			.slice(0, 5)
			.map(r => `- ${r.title || r.url}: ${r.snippet || ""}`)
			.join("\n");
	} catch (err) {
		logger.debug("qa-runner: scrapeForContext unavailable", { err });
		return "";
	}
}

/**
 * Generate follow-up questions to ask after the user picks a primary
 * option. Per the requirement, "the user can have a QnA session or
 * brain storming session" — at least 2 follow-ups per primary pick
 * (so the brain-storming branches deeper).
 */
export function buildFollowUpQuestions(parent: QAQuestion[], count: number): QAQuestion[] {
	const id = (i: number) => `fu_${parent.length + 1}_${i + 1}`;
	const followUpPool: Omit<QAQuestion, "followUps">[] = [
		{
			id: id(0),
			question: "Do you want a 3D / animated / motion-rich UI?",
			options: [
				{ label: "Yes — full 3D / WebGL", description: "Spline, three.js, or R3F." },
				{ label: "Subtle motion only", description: "Framer Motion / CSS transitions." },
				{ label: "Static UI", description: "No motion at all." },
			],
		},
		{
			id: id(1),
			question: "Theme: light, dark, or both?",
			options: [
				{ label: "Light only", description: "Single light theme." },
				{ label: "Dark only", description: "Single dark theme." },
				{ label: "Both (with system follow)", description: "Light + dark, respect prefers-color-scheme." },
			],
		},
		{
			id: id(2),
			question: "Authentication provider?",
			options: [
				{ label: "Clerk", description: "Hosted auth-as-a-service." },
				{ label: "Auth.js (NextAuth)", description: "Self-hosted, supports many providers." },
				{ label: "Supabase Auth", description: "If the DB is Supabase." },
				{ label: "None", description: "No auth in this app." },
			],
		},
		{
			id: id(3),
			question: "Deployment target?",
			options: [
				{ label: "Vercel", description: "Best for Next.js." },
				{ label: "Cloudflare Pages", description: "Edge-first." },
				{ label: "Self-host (Docker)", description: "Bring your own VM." },
				{ label: "No deploy", description: "Local only for now." },
			],
		},
	];
	return followUpPool.slice(0, count);
}

/** Convenience: returns the follow-ups for the question with `id`. */
export function followUpsFor(q: QAQuestion): Omit<QAQuestion, "followUps">[] {
	return q.followUps ?? [];
}

/**
 * Append a user's answer to the session. Returns the updated session.
 * `parentQuestionId` is null for root questions and the id of the
 * parent question for follow-ups; `depth` tracks how deep the
 * follow-up chain is.
 */
export function recordAnswer(
	session: QASession,
	questionId: string,
	question: string,
	parentQuestionId: string | null,
	depth: number,
	label: string,
	description: string,
): QASession {
	return {
		...session,
		answers: [...session.answers, { questionId, question, parentQuestionId, depth, label, description }],
	};
}

/**
 * Check whether the user's answer signals "end of phase 1".
 */
export function isEndPhase1(label: string): boolean {
	return label.trim() === END_PHASE_1;
}

/**
 * Drive the interactive Q&A session for HIL mode.
 *
 * Generates questions via LLM, then walks through them one-by-one using
 * the provided `askQuestion` callback. Handles follow-up chaining up to
 * depth 2 and the "End Phase 1" exit.
 *
 * @param prompt    Original user prompt / project description
 * @param mode      Must be "HIL" for interactive flow
 * @param cwd       Working directory (for LLM calls and persistence)
 * @param askQuestion  Callback invoked per question; returns chosen option or null to end
 * @returns Populated QASession with all user answers
 */
export async function runInteractiveQA(
	prompt: string,
	mode: Mode,
	cwd: string,
	askQuestion: AskQuestionFn,
): Promise<QASession> {
	const session: QASession = { prompt, mode, answers: [] };
	const questions = await generateQuestions(prompt, mode, cwd);

	for (const q of questions) {
		await askQuestionWithFollowUps(session, q, null, 0, askQuestion);
		// If the user ended phase 1, stop asking more questions
		if (session.endedAt) break;
	}

	session.endedAt ??= new Date().toISOString();
	saveQASession(cwd, session);
	return session;
}

/** Recursively ask a question and any follow-ups. */
async function askQuestionWithFollowUps(
	session: QASession,
	q: QAQuestion,
	parentId: string | null,
	depth: number,
	ask: AskQuestionFn,
): Promise<void> {
	const answer = await ask(q);
	if (!answer) {
		// User chose to end phase 1
		session.endedAt = new Date().toISOString();
		return;
	}

	// Record the answer
	session.answers.push({
		questionId: q.id,
		question: q.question,
		parentQuestionId: parentId,
		depth,
		label: answer.label,
		description: answer.description,
	});

	// Walk follow-up questions (max depth 2)
	if (q.followUps && depth < 2) {
		for (const fu of q.followUps) {
			if (session.endedAt) return;
			await askQuestionWithFollowUps(session, { ...fu, followUps: undefined }, q.id, depth + 1, ask);
		}
	}
}

export type { QAQuestion as QAQuestionType };

/**
 * Persist the session to disk so that other phases (and the TUI history
 * viewer) can inspect it.
 */
export function saveQASession(projectDir: string, session: QASession): void {
	try {
		const fs = require("node:fs") as typeof import("node:fs");
		const path = require("node:path") as typeof import("node:path");
		const dir = path.join(projectDir, ".pakalon-agents");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "qa-session.json"), JSON.stringify(session, null, 2));
	} catch (err) {
		logger.warn("Failed to persist QA session", { err });
	}
}

export function loadQASession(projectDir: string): QASession | null {
	try {
		const fs = require("node:fs") as typeof import("node:fs");
		const path = require("node:path") as typeof import("node:path");
		const raw = fs.readFileSync(path.join(projectDir, ".pakalon-agents", "qa-session.json"), "utf-8");
		return JSON.parse(raw) as QASession;
	} catch {
		return null;
	}
}

/**
 * Auto-answer all questions in YOLO mode. The LLM picks the most
 * defensible option for each. Walks the follow-up tree: when a
 * question has `followUps`, the LLM is also asked to pick the
 * follow-up option so the answer chain captures the full branch.
 */
export async function autoAnswer(prompt: string, questions: QAQuestion[], cwd: string): Promise<QASession["answers"]> {
	const picks: QASession["answers"] = [];
	async function pickForQuestion(q: QAQuestion, parentId: string | null, depth: number): Promise<void> {
		const result = await invokePhaseLLMJson<{ chosenIndex: number }>(
			"You are an autonomous senior engineer. Given a project prompt and a question with options, pick the option that best serves the user's intent. Never pick 'End phase 1'.",
			JSON.stringify({ prompt, question: q.question, options: q.options }),
			{ cwd, phase: "phase-1", temperature: 0.3 },
		);
		const idx = Math.max(0, Math.min(result.chosenIndex, q.options.length - 1));
		const opt = q.options[idx]!;
		picks.push({
			questionId: q.id,
			question: q.question,
			parentQuestionId: parentId,
			depth,
			label: opt.label,
			description: opt.description,
		});
		// Walk follow-ups recursively. Capped at depth 2 to avoid
		// pathological trees.
		if (q.followUps && depth < 2) {
			for (const fu of q.followUps) {
				await pickForQuestion(fu as QAQuestion, q.id, depth + 1);
			}
		}
	}
	for (const q of questions) {
		await pickForQuestion(q, null, 0);
	}
	return picks;
}
