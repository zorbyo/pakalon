/**
 * /init command — Normal Mode bootstrap.
 *
 * Creates .pakalon/ directory and fills plan.md, task.md,
 * user-stories.md, context-management.md, agents/skills.md.
 * Runs a lighter Q&A loop (10 questions) in HIL mode.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// Types
// ============================================================================

interface QAQuestion {
	id: string;
	question: string;
	options: string[];
}

interface QAAnswers {
	[key: string]: string;
}

// ============================================================================
// Normal Mode file structure
// ============================================================================

const NORMAL_MODE_FILES = {
	agentsDir: "agents",
	skillsFile: "agents/skills.md",
	planFile: "plan.md",
	taskFile: "task.md",
	userStoriesFile: "user-stories.md",
	contextFile: "context-management.md",
};

// ============================================================================
// Q&A Questions (10 questions for Normal Mode)
// ============================================================================

function buildQuestions(prompt: string): QAQuestion[] {
	const isDetailed = prompt.length > 100;
	const baseQuestions: QAQuestion[] = [
		{
			id: "purpose",
			question: "What is the primary purpose of this application?",
			options: [
				"SaaS / Web Application",
				"Mobile App (React Native / Flutter)",
				"Desktop Application (Electron)",
				"API / Microservice",
				"Static Site / Portfolio",
				"Custom (type your answer)",
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
				"Electron + Vite",
				"Custom (type your answer)",
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
				"Custom (type your answer)",
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
				"Custom (type your answer)",
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
				"Custom (type your answer)",
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
				"Custom (type your answer)",
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
				"Not sure yet",
				"Custom (type your answer)",
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
				"Custom (type your answer)",
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
				"Custom (type your answer)",
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
				"Custom (type your answer)",
			],
		},
	];

	// If the user gave a detailed prompt, add fewer follow-up questions
	if (isDetailed) {
		return baseQuestions.slice(0, 5);
	}

	return baseQuestions;
}

// ============================================================================
// File generators
// ============================================================================

function generatePlanMd(prompt: string, answers: QAAnswers): string {
	return `# Project Plan

## Overview

${prompt}

## Tech Stack

- **Frontend**: ${answers.frontend || "React + Next.js + Tailwind CSS + Shadcn UI"}
- **Backend**: ${answers.backend || "Node.js + Express"}
- **Database**: ${answers.database || "PostgreSQL"}
- **Authentication**: ${answers.auth || "OAuth via Clerk"}

## Architecture

This application follows a modern full-stack architecture with clear separation of concerns between frontend and backend.

### Frontend Architecture
- Component-based UI with reusable components
- State management via React hooks / Zustand
- API integration via fetch/axios with proper error handling
- Responsive design with Tailwind CSS

### Backend Architecture
- RESTful API endpoints
- Middleware for auth, validation, error handling
- Database ORM (Prisma/Drizzle) for type-safe queries
- Environment-based configuration

## Milestones

1. **M1**: Project setup and core infrastructure
2. **M2**: Authentication and user management
3. **M3**: Core features implementation
4. **M4**: UI polish and responsive design
5. **M5**: Testing and deployment

## Constraints

- Target audience: ${answers.audience || "General public"}
- Expected scale: ${answers.scale || "Medium (100 - 10K users)"}
- Deployment: ${answers.deployment || "Vercel"}
`;
}

function generateTaskMd(_prompt: string, answers: QAAnswers): string {
	return `# Task Breakdown

## Priority Legend
- **P0**: Critical path, must complete first
- **P1**: High priority, needed for MVP
- **P2**: Medium priority, nice to have
- **P3**: Low priority, future enhancement

---

## Tasks

### Infrastructure & Setup
| # | Task | Priority | Est. Tokens |
|---|------|----------|-------------|
| T-001 | Initialize project with ${answers.frontend || "Next.js"} | P0 | 2000 |
| T-002 | Set up ${answers.backend || "Express"} backend | P0 | 2000 |
| T-003 | Configure ${answers.database || "PostgreSQL"} database | P0 | 1500 |
| T-004 | Set up environment variables and config | P0 | 500 |

### Authentication
| # | Task | Priority | Est. Tokens |
|---|------|----------|-------------|
| T-005 | Implement ${answers.auth || "Clerk OAuth"} authentication | P0 | 3000 |
| T-006 | Create user registration and login flows | P0 | 2000 |
| T-007 | Add session management and protected routes | P1 | 1500 |

### Core Features
| # | Task | Priority | Est. Tokens |
|---|------|----------|-------------|
| T-008 | Build main layout and navigation | P0 | 2000 |
| T-009 | Implement CRUD operations for primary entities | P0 | 4000 |
| T-010 | Create dashboard / main view | P1 | 3000 |
| T-011 | Add real-time features if needed | P2 | 2500 |
| T-012 | Implement file upload if needed | P2 | 2000 |

### UI/UX
| # | Task | Priority | Est. Tokens |
|---|------|----------|-------------|
| T-013 | Apply ${answers.design || "modern minimal"} design system | P1 | 2500 |
| T-014 | Ensure responsive design (mobile + desktop) | P1 | 2000 |
| T-015 | Add loading states and error handling | P1 | 1000 |
| T-016 | Add form validation | P1 | 1500 |

### Testing & Deployment
| # | Task | Priority | Est. Tokens |
|---|------|----------|-------------|
| T-017 | Write unit tests for critical paths | P1 | 3000 |
| T-018 | Set up CI/CD pipeline | P1 | 1500 |
| T-019 | Configure ${answers.deployment || "Vercel"} deployment | P1 | 1000 |
| T-020 | Final testing and bug fixes | P0 | 2000 |

---

**Total estimated tokens**: ~38,000
**Buffer (10%)**: ~3,800
**Grand total**: ~41,800 tokens
`;
}

function generateUserStoriesMd(_prompt: string, answers: QAAnswers): string {
	return `# User Stories

## US-001: User Registration
**As a** new user
**I want to** create an account using ${answers.auth || "GitHub OAuth"}
**So that** I can access the application

### Acceptance Criteria
- [ ] User can click "Sign Up" button
- [ ] User is redirected to ${answers.auth?.includes("Clerk") || answers.auth?.includes("OAuth") ? "Clerk OAuth provider" : "registration form"}
- [ ] After successful auth, user is redirected to dashboard
- [ ] User profile is created in the database

### Test Scenarios
- TC-001: New user completes registration flow
- TC-002: User with existing account can sign in
- TC-003: Registration fails gracefully with network error

---

## US-002: User Login
**As a** registered user
**I want to** log in to my account
**So that** I can access my data and features

### Acceptance Criteria
- [ ] User can enter credentials or click OAuth button
- [ ] Successful login redirects to dashboard
- [ ] Failed login shows appropriate error message
- [ ] Session is persisted across page refreshes

### Test Scenarios
- TC-001: User logs in with valid credentials
- TC-002: User sees error for invalid credentials
- TC-003: Session persists after browser refresh

---

## US-003: Main Dashboard
**As a** logged-in user
**I want to** see a dashboard with my data
**So that** I can get an overview of my application

### Acceptance Criteria
- [ ] Dashboard loads within 2 seconds
- [ ] Displays relevant data/widgets
- [ ] Navigation to all main sections is accessible
- [ ] Responsive on mobile and desktop

### Test Scenarios
- TC-001: Dashboard renders correctly on desktop
- TC-002: Dashboard renders correctly on mobile
- TC-003: Navigation links work correctly

---

## US-004: Core CRUD Operations
**As a** user
**I want to** create, read, update, and delete items
**So that** I can manage my data

### Acceptance Criteria
- [ ] User can create new items via a form
- [ ] User can view a list of items
- [ ] User can edit existing items
- [ ] User can delete items with confirmation
- [ ] All operations show appropriate feedback

### Test Scenarios
- TC-001: Create item with valid data
- TC-002: Create item with invalid data shows errors
- TC-003: Edit item preserves existing data
- TC-004: Delete item asks for confirmation
- TC-005: List view shows all items

---

## US-005: Responsive Design
**As a** user on any device
**I want to** use the application on mobile, tablet, and desktop
**So that** I can access it anywhere

### Acceptance Criteria
- [ ] Layout adapts to screen size
- [ ] Touch targets are appropriately sized on mobile
- [ ] Text is readable without horizontal scrolling
- [ ] Navigation works on all screen sizes

### Test Scenarios
- TC-001: Desktop layout (1920x1080)
- TC-002: Tablet layout (768x1024)
- TC-003: Mobile layout (375x812)

---

*Additional user stories will be generated based on the specific features identified during planning.*
`;
}

function generateContextManagementMd(): string {
	return `# Context Management Plan

## Token Budget Allocation

Based on the model context window, tokens are allocated per phase with a 10% buffer.

### Default Allocation (New Project)

| Phase | Allocation | Description |
|-------|-----------|-------------|
| Phase 1 | 18% | Planning & Requirements |
| Phase 2 | 12% | Wireframes & Design |
| Phase 3 | 40% | Development (shared across 5 sub-agents) |
| Phase 4 | 15% | Testing & QA |
| Phase 5 | 8% | Deployment & CI/CD |
| Phase 6 | 7% | Documentation |
| **Buffer** | **10%** | Reserved for unexpected needs |

### Phase 3 Sub-Agent Allocation

Phase 3 receives 40% of the total budget, split across 5 sub-agents:

| Sub-Agent | Share | Description |
|-----------|-------|-------------|
| SA1 Frontend | 8% | UI component development |
| SA2 Backend | 8% | API and database |
| SA3 Integration | 8% | Frontend-backend wiring |
| SA4 Debug & Test | 8% | Bug fixing and testing |
| SA5 Review | 8% | Code review and optimization |

### Per-Task Budget

Each task within a phase receives a proportional share of that phase's budget.
Tasks are prioritized (P0-P3) and P0 tasks receive proportionally more tokens.

## Token Tracking

- Tokens are tracked per phase and per sub-agent
- Warnings are issued at 80% and 90% of allocation
- Exceeding allocation requires explicit approval (HIL) or is auto-managed (YOLO)

## Context Window Strategy

1. **Compact early**: Summarize long outputs before they consume too much context
2. **Reference, don't duplicate**: Use file paths instead of pasting entire file contents
3. **Progressive disclosure**: Start with high-level summaries, drill down only when needed
4. **Cross-phase memory**: Key decisions and facts are stored in Mem0 for recall
`;
}

function generateSkillsMd(answers: QAAnswers): string {
	const frontendStack = answers.frontend || "React + Next.js + Tailwind CSS + Shadcn UI";
	const designStyle = answers.design || "Modern minimal";

	return `# Agent Skills

## Design Skills (from Vercel Agent Skills)

Based on the project requirements and design preferences, the following skills have been matched:

### 1. Shadcn UI Components
- **Source**: https://github.com/vercel-labs/agent-skills
- **Relevance**: Modern UI component library for ${frontendStack}
- **Rationale**: Provides accessible, customizable components that match the ${designStyle} design style

### 2. Tailwind CSS Optimization
- **Source**: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- **Relevance**: Utility-first CSS framework for rapid UI development
- **Rationale**: Enables consistent styling across all components with minimal custom CSS

### 3. React Performance Patterns
- **Source**: https://skills.sh/vercel-labs/agent-skills
- **Relevance**: React best practices for optimal rendering
- **Rationale**: Ensures smooth user experience with proper memoization and lazy loading

### 4. Responsive Design System
- **Source**: https://github.com/vercel-labs/agent-skills
- **Relevance**: Mobile-first responsive design patterns
- **Rationale**: Ensures the application works well on all screen sizes

### 5. Accessibility (a11y) Best Practices
- **Source**: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- **Relevance**: WCAG compliance and screen reader support
- **Rationale**: Makes the application usable by everyone

## Skills Summary

| Skill | Source | Priority |
|-------|--------|----------|
| Shadcn UI | agent-skills | High |
| Tailwind CSS | ui-ux-pro-max | High |
| React Performance | agent-skills | Medium |
| Responsive Design | agent-skills | Medium |
| Accessibility | ui-ux-pro-max | Medium |

## Usage Notes

These skills are referenced during development to ensure:
- Consistent UI/UX patterns
- Performance optimization
- Accessibility compliance
- Modern design system implementation
`;
}

// ============================================================================
// InitCommand
// ============================================================================

export class InitCommand implements CustomCommand {
	name = "init";
	description = "Initialize .pakalon/ directory for Normal Mode with planning files";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const projectPath = this.api.cwd;
		const pakalonDir = path.join(projectPath, ".pakalon");
		const agentsDir = path.join(pakalonDir, NORMAL_MODE_FILES.agentsDir);

		// Check if already initialized
		try {
			await fs.access(pakalonDir);
			const overwrite = await ctx.ui.confirm(
				"Already Initialized",
				".pakalon/ directory already exists. Overwrite contents?",
			);
			if (!overwrite) {
				ctx.ui.notify("Initialization cancelled. Using existing .pakalon/ contents.", "info");
				return undefined;
			}
		} catch {
			// Not initialized, proceed
		}

		// Create directory structure
		await fs.mkdir(agentsDir, { recursive: true });

		// Get the user prompt from args
		const prompt = args.join(" ").trim();
		let answers: QAAnswers = {};

		if (prompt) {
			// If prompt provided, generate files directly (YOLO-style)
			answers = {
				purpose: "Web Application",
				frontend: "React + Next.js + Tailwind CSS + Shadcn UI",
				backend: "Node.js + Express",
				database: "PostgreSQL",
				auth: "OAuth via Clerk",
				design: "Modern minimal",
				deployment: "Vercel",
				features: "CRUD operations",
				audience: "General public",
				scale: "Medium (100 - 10K users)",
			};
			ctx.ui.notify("Generating planning files from your prompt...", "info");
		} else {
			// Interactive Q&A (HIL mode)
			ctx.ui.notify("Starting planning Q&A. Answer the following questions...", "info");

			const questions = buildQuestions("");
			for (const q of questions) {
				const answer = await ctx.ui.input(q.question, `Options: ${q.options.join(" | ")}`);
				answers[q.id] = answer || q.options[0];
			}
		}

		// Generate all files
		const files = [
			{ name: NORMAL_MODE_FILES.planFile, content: generatePlanMd(prompt || "Application", answers) },
			{ name: NORMAL_MODE_FILES.taskFile, content: generateTaskMd(prompt || "Application", answers) },
			{ name: NORMAL_MODE_FILES.userStoriesFile, content: generateUserStoriesMd(prompt || "Application", answers) },
			{ name: NORMAL_MODE_FILES.contextFile, content: generateContextManagementMd() },
			{ name: NORMAL_MODE_FILES.skillsFile, content: generateSkillsMd(answers) },
		];

		for (const file of files) {
			const filePath = path.join(pakalonDir, file.name);
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await Bun.write(filePath, file.content);
		}

		ctx.ui.notify(`.pakalon/ initialized with ${files.length} files.`, "info");
		ctx.ui.notify(
			"Files created: plan.md, task.md, user-stories.md, context-management.md, agents/skills.md",
			"info",
		);

		// Return a prompt to start coding
		return `Pakalon Normal Mode initialized. Project plan and tasks have been created in .pakalon/. Review the plan.md and task.md files, then start building with /build.`;
	}
}

export default function initFactory(api: CustomCommandAPI): InitCommand {
	return new InitCommand(api);
}
