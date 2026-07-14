/**
 * Phase 1 Q&A — Interactive question answering.
 *
 * Handles the Q&A loop for gathering requirements in HIL mode,
 * and auto-fills defaults in YOLO mode.
 */
import { logger } from "@oh-my-pi/pi-utils";

// ============================================================================
// Types
// ============================================================================

export interface QaQuestion {
	id: string;
	question: string;
	options: string[];
	default?: string;
}

export interface QaAnswer {
	questionId: string;
	answer: string;
	timestamp: string;
}

export interface QaResult {
	answers: QaAnswer[];
	completed: boolean;
}

// ============================================================================
// Questions
// ============================================================================

const BASE_QUESTIONS: QaQuestion[] = [
	{
		id: "purpose",
		question: "What is the primary purpose of this application?",
		options: [
			"SaaS / Web Application",
			"Mobile App (React Native / Flutter)",
			"Desktop Application (Electron)",
			"API / Microservice",
			"Static Site / Portfolio",
		],
	},
	{
		id: "frontend",
		question: "Which frontend tech stack do you prefer?",
		options: [
			"React + Next.js + Tailwind CSS + Shadcn UI",
			"React + Vite + Tailwind CSS",
			"Vue.js + Nuxt + Tailwind CSS",
			"Svelte + SvelteKit",
			"HTML + CSS + JavaScript (vanilla)",
		],
	},
	{
		id: "backend",
		question: "Which backend tech stack do you prefer?",
		options: [
			"Node.js + Express",
			"Node.js + Fastify",
			"Python + FastAPI",
			"Python + Django",
			"Go + Gin",
			"No backend needed",
		],
	},
	{
		id: "database",
		question: "Which database do you prefer?",
		options: [
			"PostgreSQL",
			"MySQL",
			"MongoDB",
			"SQLite",
			"Supabase (PostgreSQL + realtime)",
			"Firebase Firestore",
			"No database needed",
		],
	},
	{
		id: "auth",
		question: "What authentication method do you need?",
		options: [
			"Email + Password (with verification)",
			"OAuth (GitHub, Google, etc.) via Clerk",
			"JWT tokens (self-hosted)",
			"Supabase Auth",
			"NextAuth.js",
			"No authentication needed",
		],
	},
	{
		id: "design",
		question: "What design style do you prefer?",
		options: [
			"Modern minimal (clean, whitespace-heavy)",
			"Dashboard / admin panel style",
			"Bold / colorful / playful",
			"Dark mode by default",
			"Material Design",
		],
	},
	{
		id: "deployment",
		question: "Where do you plan to deploy?",
		options: [
			"Vercel (Next.js optimized)",
			"Docker + any cloud provider",
			"AWS (EC2 / ECS / Lambda)",
			"DigitalOcean App Platform",
			"Self-hosted (on-premise)",
		],
	},
	{
		id: "features",
		question: "Which key features do you need? (select the most important)",
		options: [
			"CRUD operations (Create, Read, Update, Delete)",
			"Real-time updates (WebSocket / SSE)",
			"File upload / management",
			"Payment integration (Stripe / Polar)",
			"Email notifications",
			"Admin dashboard / analytics",
		],
	},
	{
		id: "audience",
		question: "Who is the target audience?",
		options: [
			"Internal team / enterprise users",
			"General public / consumers",
			"Developers / technical users",
			"Small business owners",
			"Students / educational",
		],
	},
	{
		id: "scale",
		question: "What is the expected scale?",
		options: [
			"Small (< 100 users)",
			"Medium (100 - 10K users)",
			"Large (10K - 100K users)",
			"Very large (100K+ users)",
			"Just a prototype / MVP",
		],
	},
];

// ============================================================================
// Q&A Engine
// ============================================================================

/**
 * Run the Q&A loop.
 *
 * @param mode - "hil" for interactive, "yolo" for auto-fill
 * @param userPrompt - Optional user prompt to pre-fill answers
 * @param ui - Hook command UI for interactive prompts
 */
export async function runQaLoop(
	mode: "hil" | "yolo",
	_userPrompt: string,
	ui: { input: (title: string, hint: string) => Promise<string> },
): Promise<QaResult> {
	const result: QaResult = {
		answers: [],
		completed: false,
	};

	if (mode === "yolo") {
		// Auto-fill with defaults
		result.answers = BASE_QUESTIONS.map(q => ({
			questionId: q.id,
			answer: q.default || q.options[0],
			timestamp: new Date().toISOString(),
		}));
		result.completed = true;
		return result;
	}

	// HIL mode: ask questions
	logger.info("Starting Q&A loop in HIL mode");

	for (const question of BASE_QUESTIONS) {
		const optionsStr = question.options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
		const answer = await ui.input(question.question, `Options:\n${optionsStr}`);

		result.answers.push({
			questionId: question.id,
			answer: answer || question.options[0],
			timestamp: new Date().toISOString(),
		});
	}

	result.completed = true;
	return result;
}

/**
 * Get default answers for YOLO mode.
 */
export function getDefaultAnswers(): Record<string, string> {
	return {
		purpose: "SaaS / Web Application",
		frontend: "React + Next.js + Tailwind CSS + Shadcn UI",
		backend: "Node.js + Express",
		database: "PostgreSQL",
		auth: "OAuth (GitHub, Google, etc.) via Clerk",
		design: "Modern minimal (clean, whitespace-heavy)",
		deployment: "Vercel (Next.js optimized)",
		features: "CRUD operations (Create, Read, Update, Delete)",
		audience: "General public / consumers",
		scale: "Medium (100 - 10K users)",
	};
}

export { BASE_QUESTIONS };
