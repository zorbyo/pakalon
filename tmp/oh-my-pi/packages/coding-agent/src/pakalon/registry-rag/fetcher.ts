/**
 * Vercel Agent Skills Registry RAG fetcher.
 *
 * Fetches skills from agent-skills.io and other registries to embed
 * into phase artifacts (design.md, agent-skills.md).
 */
import { logger } from "@oh-my-pi/pi-utils";

const REGISTRIES = {
	agentSkills: "https://agentskills.io/skills",
	vercelAgentSkills: "https://github.com/vercel-labs/agent-skills",
	uiUxProMax: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
} as const;

export interface RegistryEntry {
	id: string;
	name: string;
	description: string;
	semantic: string;
	category: string;
	url: string;
	content?: string;
}

export interface RegistryQueryResult {
	entry: RegistryEntry;
	score: number;
}

/**
 * Query the registry for skills matching a semantic query.
 * Falls back gracefully if the registry is unreachable.
 */
export async function queryRegistry(query: { query: string; limit?: number }): Promise<RegistryQueryResult[]> {
	const limit = query.limit ?? 5;

	try {
		// In a full implementation, this would:
		// 1. Fetch the registry index from agent-skills.io
		// 2. Perform semantic/BM25 search
		// 3. Fetch individual skill content
		// 4. Cache results in Mem0

		// For now, return curated skills based on query keywords
		return matchLocalSkills(query.query, limit);
	} catch (err) {
		logger.warn("registry-rag: fetch failed, using local fallback", { err });
		return matchLocalSkills(query.query, limit);
	}
}

/**
 * Fetch a specific skill by ID from the registry.
 */
export async function fetchSkill(skillId: string): Promise<RegistryEntry | null> {
	try {
		// In full implementation:
		// const url = `${REGISTRIES.agentSkills}/${skillId}`;
		// const res = await fetch(url);
		// return await res.json();

		const local = LOCAL_SKILLS.find(s => s.id === skillId);
		return local ?? null;
	} catch (err) {
		logger.warn("registry-rag: fetchSkill failed", { err });
		return null;
	}
}

// ─── Local fallback skills (curated subset) ──────────────────────────

const LOCAL_SKILLS: RegistryEntry[] = [
	{
		id: "frontend-patterns",
		name: "Frontend Patterns",
		description: "Modern React/Next.js/Solid.js UI patterns with Tailwind CSS and Shadcn UI",
		semantic: "frontend design react tailwind shadcn components ui ux patterns",
		category: "Frontend",
		url: REGISTRIES.vercelAgentSkills,
	},
	{
		id: "backend-patterns",
		name: "Backend Patterns",
		description: "API design, database patterns, caching strategies, authentication",
		semantic: "backend api database postgres redis authentication authorization",
		category: "Backend",
		url: REGISTRIES.vercelAgentSkills,
	},
	{
		id: "tdd-workflow",
		name: "TDD Workflow",
		description: "Test-driven development patterns with Vitest, Playwright, and testing best practices",
		semantic: "testing tdd vitest playwright unit integration e2e test automation",
		category: "Testing",
		url: REGISTRIES.vercelAgentSkills,
	},
	{
		id: "deployment-patterns",
		name: "Deployment Patterns",
		description: "CI/CD pipelines, Docker, Kubernetes, Vercel, AWS deployment strategies",
		semantic: "deployment cicd docker kubernetes vercel aws devops infrastructure",
		category: "DevOps",
		url: REGISTRIES.vercelAgentSkills,
	},
	{
		id: "agentic-engineering",
		name: "Agentic Engineering",
		description: "AI agent construction, tool calling, orchestration, prompt engineering",
		semantic: "ai agent llm prompt orchestration tool calling automation intelligent",
		category: "AI & Agents",
		url: REGISTRIES.vercelAgentSkills,
	},
	{
		id: "security-review",
		name: "Security Review",
		description: "Security scanning, vulnerability assessment, SAST/DAST, OWASP compliance",
		semantic: "security scanning sast dast owasp vulnerability penetration testing",
		category: "Security",
		url: REGISTRIES.vercelAgentSkills,
	},
	{
		id: "database-patterns",
		name: "Database Patterns",
		description: "PostgreSQL, Prisma, Drizzle ORM, database migrations, schema design",
		semantic: "database postgresql prisma drizzle orm migrations schema sql",
		category: "Backend",
		url: REGISTRIES.vercelAgentSkills,
	},
	{
		id: "api-design",
		name: "API Design",
		description: "REST API design, GraphQL, OpenAPI, tRPC, API versioning",
		semantic: "api rest graphql openapi trpc endpoints routes design",
		category: "Backend",
		url: REGISTRIES.vercelAgentSkills,
	},
	{
		id: "e2e-testing",
		name: "E2E Testing",
		description: "End-to-end testing with Playwright, Cypress, browser automation",
		semantic: "e2e testing playwright cypress browser automation selenium",
		category: "Testing",
		url: REGISTRIES.vercelAgentSkills,
	},
	{
		id: "docker-patterns",
		name: "Docker Patterns",
		description: "Dockerfile best practices, multi-stage builds, containerization, compose",
		semantic: "docker container dockerfile compose multi-stage build image",
		category: "DevOps",
		url: REGISTRIES.vercelAgentSkills,
	},
];

function matchLocalSkills(query: string, limit: number): RegistryQueryResult[] {
	const q = query.toLowerCase();
	const scored = LOCAL_SKILLS.map(skill => {
		const queryTerms = q.split(/\s+/);
		const skillTerms = `${skill.name} ${skill.description} ${skill.semantic}`.toLowerCase();
		let score = 0;
		for (const term of queryTerms) {
			if (skillTerms.includes(term)) score += 1;
		}
		return { entry: skill, score };
	});

	return scored
		.filter(r => r.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}

/**
 * Refresh skills from the registry (called periodically or on demand).
 */
export async function refreshRegistry(): Promise<void> {
	try {
		// In full implementation:
		// 1. Fetch latest skill index from registries
		// 2. Parse SKILL.md files
		// 3. Store in local cache
		// 4. Update Mem0 with new skills

		logger.info("registry-rag: refresh triggered");
	} catch (err) {
		logger.warn("registry-rag: refresh failed", { err });
	}
}
