/**
 * Phase 1 Agent Skills — Vercel Agent Skills matching.
 *
 * Matches project requirements to available skills from the
 * Vercel Agent Skills repository.
 */
import { logger } from "@oh-my-pi/pi-utils";

// ============================================================================
// Types
// ============================================================================

export interface AgentSkill {
	name: string;
	description: string;
	source: string;
	relevance: number;
	rationale: string;
	tags: string[];
}

export interface SkillMatchResult {
	skills: AgentSkill[];
	totalMatches: number;
}

// ============================================================================
// Skill Matching
// ============================================================================

/**
 * Match project requirements to agent skills.
 */
export async function matchAgentSkills(answers: Record<string, string>): Promise<SkillMatchResult> {
	logger.info("Matching agent skills based on project requirements");

	const skills: AgentSkill[] = [];

	// Frontend skills
	if (answers.frontend?.includes("React")) {
		skills.push({
			name: "React Performance Patterns",
			description: "React best practices for optimal rendering and performance",
			source: "https://github.com/vercel-labs/agent-skills",
			relevance: 0.9,
			rationale: "Ensures smooth user experience with proper memoization and lazy loading",
			tags: ["react", "performance", "frontend"],
		});
	}

	if (answers.frontend?.includes("Next.js")) {
		skills.push({
			name: "Next.js App Router Patterns",
			description: "Best practices for Next.js App Router and server components",
			source: "https://github.com/vercel-labs/agent-skills",
			relevance: 0.95,
			rationale: "Modern Next.js patterns for optimal performance and developer experience",
			tags: ["nextjs", "react", "frontend"],
		});
	}

	// UI/UX skills
	if (answers.frontend?.includes("Tailwind")) {
		skills.push({
			name: "Tailwind CSS Optimization",
			description: "Utility-first CSS framework for rapid UI development",
			source: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
			relevance: 0.85,
			rationale: "Enables consistent styling across all components with minimal custom CSS",
			tags: ["css", "tailwind", "styling"],
		});
	}

	if (answers.frontend?.includes("Shadcn")) {
		skills.push({
			name: "Shadcn UI Components",
			description: "Modern UI component library for React applications",
			source: "https://github.com/vercel-labs/agent-skills",
			relevance: 0.9,
			rationale: "Provides accessible, customizable components that match modern design styles",
			tags: ["ui", "components", "react"],
		});
	}

	// Design skills
	skills.push({
		name: "Responsive Design System",
		description: "Mobile-first responsive design patterns",
		source: "https://github.com/vercel-labs/agent-skills",
		relevance: 0.8,
		rationale: "Ensures the application works well on all screen sizes",
		tags: ["design", "responsive", "mobile"],
	});

	skills.push({
		name: "Accessibility (a11y) Best Practices",
		description: "WCAG compliance and screen reader support",
		source: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
		relevance: 0.75,
		rationale: "Makes the application usable by everyone",
		tags: ["accessibility", "a11y", "inclusive"],
	});

	// Backend skills
	if (answers.backend?.includes("Node.js") || answers.backend?.includes("Express")) {
		skills.push({
			name: "Node.js API Patterns",
			description: "Best practices for building Node.js APIs",
			source: "https://github.com/vercel-labs/agent-skills",
			relevance: 0.8,
			rationale: "Standard patterns for building robust Node.js APIs",
			tags: ["nodejs", "api", "backend"],
		});
	}

	if (answers.backend?.includes("Python") || answers.backend?.includes("FastAPI")) {
		skills.push({
			name: "Python FastAPI Patterns",
			description: "Best practices for building FastAPI applications",
			source: "https://github.com/vercel-labs/agent-skills",
			relevance: 0.85,
			rationale: "Modern Python API patterns with type safety",
			tags: ["python", "fastapi", "backend"],
		});
	}

	// Database skills
	if (answers.database?.includes("PostgreSQL") || answers.database?.includes("Supabase")) {
		skills.push({
			name: "PostgreSQL Best Practices",
			description: "Database design and query optimization for PostgreSQL",
			source: "https://github.com/vercel-labs/agent-skills",
			relevance: 0.8,
			rationale: "Ensures efficient database operations and data integrity",
			tags: ["database", "postgresql", "sql"],
		});
	}

	// Authentication skills
	if (answers.auth?.includes("Clerk")) {
		skills.push({
			name: "Clerk Authentication Integration",
			description: "Best practices for integrating Clerk authentication",
			source: "https://github.com/vercel-labs/agent-skills",
			relevance: 0.9,
			rationale: "Secure authentication flows with Clerk",
			tags: ["auth", "clerk", "security"],
		});
	}

	// Sort by relevance
	skills.sort((a, b) => b.relevance - a.relevance);

	logger.info("Agent skills matched", { count: skills.length });

	return {
		skills,
		totalMatches: skills.length,
	};
}

/**
 * Generate a skills report for display.
 */
export function generateSkillsReport(matchResult: SkillMatchResult): string {
	const lines: string[] = [
		"## Matched Agent Skills",
		"",
		"| Skill | Relevance | Source |",
		"|-------|-----------|--------|",
	];

	for (const skill of matchResult.skills) {
		lines.push(`| ${skill.name} | ${(skill.relevance * 100).toFixed(0)}% | ${skill.source} |`);
	}

	lines.push("");
	lines.push(`**Total matches**: ${matchResult.totalMatches}`);

	return lines.join("\n");
}

export { matchAgentSkills as matchSkills };
