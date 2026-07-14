/**
 * Phase 1 Planner — Main planning logic.
 *
 * Orchestrates the planning phase: research, Q&A, file generation,
 * and context management setup.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ============================================================================
// Types
// ============================================================================

export interface PlanningContext {
	projectPath: string;
	pakalonDir: string;
	userPrompt: string;
	mode: "hil" | "yolo";
	maxIterations: number;
}

export interface PlanningResult {
	success: boolean;
	filesGenerated: string[];
	errors: string[];
}

// ============================================================================
// Phase 1 Planner
// ============================================================================

/**
 * Run the Phase 1 planning process.
 *
 * Steps:
 * 1. Scan the project context
 * 2. Run interactive Q&A (HIL) or auto-fill (YOLO)
 * 3. Generate all planning documents
 * 4. Set up context management
 */
export async function runPhase1Planner(context: PlanningContext): Promise<PlanningResult> {
	logger.info("Phase 1: Starting planning process", { projectPath: context.projectPath });

	const result: PlanningResult = {
		success: true,
		filesGenerated: [],
		errors: [],
	};

	try {
		// Step 1: Scan project context
		const projectInfo = await scanProjectContext(context.projectPath);
		logger.info("Phase 1: Project context scanned", { info: projectInfo });

		// Step 2: Run Q&A (if HIL mode) or use defaults (YOLO mode)
		const answers = await runPlanningQa(context, projectInfo);

		// Step 3: Generate planning files
		const files = await generatePlanningFiles(context, answers, projectInfo);
		result.filesGenerated = files;

		// Step 4: Setup context management
		await setupContextManagement(context);

		logger.info("Phase 1: Planning complete", { files: files.length });
	} catch (error) {
		result.success = false;
		result.errors.push(error instanceof Error ? error.message : String(error));
		logger.error("Phase 1: Planning failed", { error });
	}

	return result;
}

// ============================================================================
// Project Scanning
// ============================================================================

interface ProjectInfo {
	hasPackageJson: boolean;
	hasTsConfig: boolean;
	hasSrcDir: boolean;
	framework: string;
	existingFiles: string[];
}

async function scanProjectContext(projectPath: string): Promise<ProjectInfo> {
	const info: ProjectInfo = {
		hasPackageJson: false,
		hasTsConfig: false,
		hasSrcDir: false,
		framework: "unknown",
		existingFiles: [],
	};

	try {
		// Check for package.json
		await fs.access(path.join(projectPath, "package.json"));
		info.hasPackageJson = true;

		// Read package.json to detect framework
		const pkgContent = await Bun.file(path.join(projectPath, "package.json")).text();
		const pkg = JSON.parse(pkgContent);

		if (pkg.dependencies?.next || pkg.devDependencies?.next) {
			info.framework = "nextjs";
		} else if (pkg.dependencies?.react || pkg.devDependencies?.react) {
			info.framework = "react";
		} else if (pkg.dependencies?.vue || pkg.devDependencies?.vue) {
			info.framework = "vue";
		} else if (pkg.dependencies?.svelte || pkg.devDependencies?.svelte) {
			info.framework = "svelte";
		}
	} catch {}

	try {
		await fs.access(path.join(projectPath, "tsconfig.json"));
		info.hasTsConfig = true;
	} catch {}

	try {
		await fs.access(path.join(projectPath, "src"));
		info.hasSrcDir = true;
	} catch {}

	// List existing files
	try {
		const entries = await fs.readdir(projectPath, { withFileTypes: true });
		info.existingFiles = entries
			.filter(e => e.isFile() || e.isDirectory())
			.map(e => e.name)
			.filter(name => !name.startsWith(".") && name !== "node_modules");
	} catch {}

	return info;
}

// ============================================================================
// Q&A
// ============================================================================

interface PlanningAnswers {
	purpose: string;
	frontend: string;
	backend: string;
	database: string;
	auth: string;
	design: string;
	deployment: string;
	features: string[];
	audience: string;
	scale: string;
}

async function runPlanningQa(
	_context: { api: { cwd: string }; mode: string },
	_projectInfo: ProjectInfo,
): Promise<PlanningAnswers> {
	// Default answers for YOLO mode
	const defaults: PlanningAnswers = {
		purpose: "Web Application",
		frontend: "React + Next.js + Tailwind CSS + Shadcn UI",
		backend: "Node.js + Express",
		database: "PostgreSQL",
		auth: "OAuth via Clerk",
		design: "Modern minimal",
		deployment: "Vercel",
		features: ["CRUD operations", "Real-time updates"],
		audience: "General public",
		scale: "Medium (100 - 10K users)",
	};

	// In HIL mode, we'd ask questions here
	// For now, return defaults
	return defaults;
}

// ============================================================================
// File Generation
// ============================================================================

async function generatePlanningFiles(
	context: { api: { cwd: string } },
	answers: PlanningAnswers,
	_projectInfo: ProjectInfo,
): Promise<string[]> {
	const pakalonDir = path.join(context.api.cwd, ".pakalon-agents", "ai-agents", "phase-1");
	await fs.mkdir(pakalonDir, { recursive: true });

	const files: string[] = [];

	// Generate plan.md
	const planContent = generatePlanMd(answers);
	await Bun.write(path.join(pakalonDir, "plan.md"), planContent);
	files.push("plan.md");

	// Generate tasks.md
	const tasksContent = generateTasksMd(answers);
	await Bun.write(path.join(pakalonDir, "tasks.md"), tasksContent);
	files.push("tasks.md");

	// Generate user-stories.md
	const userStoriesContent = generateUserStoriesMd(answers);
	await Bun.write(path.join(pakalonDir, "user-stories.md"), userStoriesContent);
	files.push("user-stories.md");

	// Generate design.md
	const designContent = generateDesignMd(answers);
	await Bun.write(path.join(pakalonDir, "design.md"), designContent);
	files.push("design.md");

	// Generate agent-skills.md
	const skillsContent = generateAgentSkillsMd(answers);
	await Bun.write(path.join(pakalonDir, "agent-skills.md"), skillsContent);
	files.push("agent-skills.md");

	// Generate context_management.md
	const contextContent = generateContextManagementMd();
	await Bun.write(path.join(pakalonDir, "context_management.md"), contextContent);
	files.push("context_management.md");

	// Generate phase-1.md (summary)
	const summaryContent = generatePhase1Summary(answers);
	await Bun.write(path.join(pakalonDir, "phase-1.md"), summaryContent);
	files.push("phase-1.md");

	return files;
}

function generatePlanMd(answers: PlanningAnswers): string {
	return `# Project Plan

## Overview

This project aims to build a ${answers.purpose} with the following tech stack:

- **Frontend**: ${answers.frontend}
- **Backend**: ${answers.backend}
- **Database**: ${answers.database}
- **Authentication**: ${answers.auth}
- **Design**: ${answers.design}
- **Deployment**: ${answers.deployment}

## Target Audience

${answers.audience}

## Expected Scale

${answers.scale}

## Key Features

${answers.features.map(f => `- ${f}`).join("\n")}

## Architecture

### Frontend
- Component-based UI with reusable components
- State management via React hooks / Zustand
- API integration via fetch/axios with proper error handling
- Responsive design with Tailwind CSS

### Backend
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
`;
}

function generateTasksMd(answers: PlanningAnswers): string {
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
| T-001 | Initialize project with ${answers.frontend} | P0 | 2000 |
| T-002 | Set up ${answers.backend} backend | P0 | 2000 |
| T-003 | Configure ${answers.database} database | P0 | 1500 |
| T-004 | Set up environment variables and config | P0 | 500 |

### Authentication
| # | Task | Priority | Est. Tokens |
|---|------|----------|-------------|
| T-005 | Implement ${answers.auth} authentication | P0 | 3000 |
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
| T-013 | Apply ${answers.design} design system | P1 | 2500 |
| T-014 | Ensure responsive design (mobile + desktop) | P1 | 2000 |
| T-015 | Add loading states and error handling | P1 | 1000 |
| T-016 | Add form validation | P1 | 1500 |

### Testing & Deployment
| # | Task | Priority | Est. Tokens |
|---|------|----------|-------------|
| T-017 | Write unit tests for critical paths | P1 | 3000 |
| T-018 | Set up CI/CD pipeline | P1 | 1500 |
| T-019 | Configure ${answers.deployment} deployment | P1 | 1000 |
| T-020 | Final testing and bug fixes | P0 | 2000 |

---

**Total estimated tokens**: ~38,000
**Buffer (10%)**: ~3,800
**Grand total**: ~41,800 tokens
`;
}

function generateUserStoriesMd(_answers: PlanningAnswers): string {
	return `# User Stories

## US-001: User Registration
**As a** new user
**I want to** create an account
**So that** I can access the application

### Acceptance Criteria
- [ ] User can click "Sign Up" button
- [ ] User is redirected to authentication provider
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

function generateDesignMd(answers: PlanningAnswers): string {
	return `# Design Document

## Design Style

${answers.design}

## Color Palette

### Primary Colors
- Primary: #3B82F6 (Blue)
- Secondary: #10B981 (Emerald)
- Accent: #8B5CF6 (Violet)

### Neutral Colors
- Background: #FFFFFF
- Surface: #F9FAFB
- Text Primary: #111827
- Text Secondary: #6B7280

## Typography

### Headings
- Font: Inter
- Weights: 600 (semibold), 700 (bold)

### Body
- Font: Inter
- Weight: 400 (regular)
- Line height: 1.5

## Components

### Buttons
- Primary: Blue background, white text
- Secondary: White background, blue border
- Ghost: Transparent background, blue text

### Forms
- Input: Gray border, focus ring
- Select: Custom styled dropdown
- Checkbox: Custom styled checkbox

### Cards
- White background
- Subtle shadow
- Rounded corners (8px)

## Responsive Breakpoints

- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px

## Accessibility

- WCAG 2.1 AA compliance
- Focus visible indicators
- Screen reader support
- Color contrast ratios
`;
}

function generateAgentSkillsMd(answers: PlanningAnswers): string {
	return `# Agent Skills

## Design Skills (from Vercel Agent Skills)

Based on the project requirements and design preferences, the following skills have been matched:

### 1. Shadcn UI Components
- **Source**: https://github.com/vercel-labs/agent-skills
- **Relevance**: Modern UI component library for ${answers.frontend}
- **Rationale**: Provides accessible, customizable components that match the ${answers.design} design style

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

function generatePhase1Summary(answers: PlanningAnswers): string {
	return `# Phase 1 Summary

## Completed

- ✅ Project context scanned
- ✅ Tech stack defined: ${answers.frontend} + ${answers.backend}
- ✅ Database: ${answers.database}
- ✅ Authentication: ${answers.auth}
- ✅ Design system: ${answers.design}
- ✅ Deployment target: ${answers.deployment}
- ✅ User stories generated (US-001 to US-005)
- ✅ Task breakdown created (20 tasks)
- ✅ Context management plan established

## Files Generated

- plan.md - Project overview and architecture
- tasks.md - Task breakdown with priorities
- user-stories.md - User stories with acceptance criteria
- design.md - Design system and style guide
- agent-skills.md - Matched skills from Vercel Agent Skills
- context_management.md - Token budget allocation
- phase-1.md - This summary

## Next Steps

Proceed to Phase 2: Wireframes & Design to generate UI wireframes and run TDD verification.
`;
}

// ============================================================================
// Context Management Setup
// ============================================================================

async function setupContextManagement(context: { api: { cwd: string } }): Promise<void> {
	const pakalonDir = path.join(context.api.cwd, ".pakalon-agents", "ai-agents");
	await fs.mkdir(pakalonDir, { recursive: true });

	// Create context management config if it doesn't exist
	const configPath = path.join(pakalonDir, "context-config.json");
	try {
		await fs.access(configPath);
	} catch {
		const config = {
			phases: {
				"1": { allocation: 0.18, name: "Planning" },
				"2": { allocation: 0.12, name: "Wireframes" },
				"3": { allocation: 0.4, name: "Development" },
				"4": { allocation: 0.15, name: "Testing" },
				"5": { allocation: 0.08, name: "Deployment" },
				"6": { allocation: 0.07, name: "Documentation" },
			},
			buffer: 0.1,
			warningThreshold: 0.8,
		};
		await Bun.write(configPath, JSON.stringify(config, null, 2));
	}
}

export { generatePlanningFiles, scanProjectContext, setupContextManagement };
