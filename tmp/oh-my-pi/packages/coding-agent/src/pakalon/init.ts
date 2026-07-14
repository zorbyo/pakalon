/**
 * Pakalon initialization and directory setup.
 * Handles /pakalon and /init command logic with complete markdown generation.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

const PAKALON_DIR = ".pakalon";
const PAKALON_AGENTS_DIR = ".pakalon-agents";

export interface InitOptions {
	force: boolean;
	mode: "agents" | "normal";
}

/**
 * Initialize .pakalon for normal mode.
 * Creates directory structure with all required markdown files.
 */
export function initNormalMode(cwd: string, options: InitOptions): string {
	const dir = path.join(cwd, PAKALON_DIR);
	if (fs.existsSync(dir) && !options.force) {
		return `Already initialized: ${dir}\nUse /pakalon --force to overwrite.`;
	}

	// Create directory structure
	fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
	fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
	fs.mkdirSync(path.join(dir, "automations"), { recursive: true });
	fs.mkdirSync(path.join(dir, "workflows"), { recursive: true });

	// Create agents/skills.md
	fs.writeFileSync(path.join(dir, "agents", "skills.md"), generateSkillsTemplate());

	// Create plan.md
	fs.writeFileSync(path.join(dir, "plan.md"), generatePlanTemplate());

	// Create task.md
	fs.writeFileSync(path.join(dir, "task.md"), generateTaskTemplate());

	// Create user-stories.md
	fs.writeFileSync(path.join(dir, "user-stories.md"), generateUserStoriesTemplate());

	// Create context-management.md
	fs.writeFileSync(path.join(dir, "context-management.md"), generateContextManagementTemplate());

	// Create settings.local.json
	fs.writeFileSync(
		path.join(dir, "settings.local.json"),
		JSON.stringify(
			{
				allowedPermissions: {},
				autoAcceptTools: [],
				deniedTools: [],
			},
			null,
			2,
		),
	);

	logger.info("Normal mode initialized", { dir });
	return `Initialized normal mode: ${dir}\n\nCreated:\n  .pakalon/agents/skills.md\n  .pakalon/plan.md\n  .pakalon/task.md\n  .pakalon/user-stories.md\n  .pakalon/context-management.md\n  .pakalon/settings.local.json`;
}

/**
 * Initialize .pakalon-agents for full SDLC mode.
 * Creates complete directory structure with all phase markdown files.
 */
export function initAgentsMode(cwd: string, options: InitOptions, mode: "HIL" | "YOLO" = "HIL"): string {
	const dir = path.join(cwd, PAKALON_AGENTS_DIR);
	if (fs.existsSync(dir) && !options.force) {
		return `Already initialized: ${dir}\nUse /pakalon --force to overwrite.`;
	}

	// Create full directory structure
	const base = path.join(dir, "ai-agents");
	const phases = ["phase-1", "phase-2", "phase-3", "phase-4", "phase-5", "phase-6"];
	for (const phase of phases) {
		fs.mkdirSync(path.join(base, phase), { recursive: true });
	}
	fs.mkdirSync(path.join(dir, "wireframes"), { recursive: true });
	fs.mkdirSync(path.join(dir, "mcp-servers"), { recursive: true });

	// Phase 1 markdown files
	const p1 = path.join(base, "phase-1");
	fs.writeFileSync(path.join(p1, "plan.md"), generatePhase1PlanTemplate());
	fs.writeFileSync(path.join(p1, "tasks.md"), generatePhase1TasksTemplate());
	fs.writeFileSync(path.join(p1, "user-stories.md"), generatePhase1UserStoriesTemplate());
	fs.writeFileSync(path.join(p1, "design.md"), generatePhase1DesignTemplate());
	fs.writeFileSync(path.join(p1, "context_management.md"), generatePhase1ContextManagementTemplate());
	fs.writeFileSync(path.join(p1, "API_reference.md"), generatePhase1APITemplate());
	fs.writeFileSync(path.join(p1, "Database_schema.md"), generatePhase1DatabaseTemplate());
	fs.writeFileSync(path.join(p1, "phase-1.md"), generatePhase1SummaryTemplate());
	fs.writeFileSync(path.join(p1, "agent-skills.md"), generatePhase1AgentSkillsTemplate());
	fs.writeFileSync(path.join(p1, "prd.md"), generatePhase1PRDTemplate());
	fs.writeFileSync(path.join(p1, "risk-assessment.md"), generatePhase1RiskTemplate());
	fs.writeFileSync(path.join(p1, "competitive-analysis.md"), generatePhase1CompetitiveTemplate());
	fs.writeFileSync(path.join(p1, "constraints-and-tradeoffs.md"), generatePhase1ConstraintsTemplate());

	// Phase 2 files
	const p2 = path.join(base, "phase-2");
	fs.writeFileSync(path.join(p2, "phase-2.md"), generatePhase2SummaryTemplate());
	fs.writeFileSync(path.join(p2, "Wireframe_generated.svg"), generatePhase2WireframeSVG());
	fs.writeFileSync(
		path.join(p2, "Wireframe_generated.json"),
		JSON.stringify({ status: "pending", pages: [] }, null, 2),
	);
	fs.mkdirSync(path.join(p2, "tdd-screenshots"), { recursive: true });

	// Phase 3 files
	const p3 = path.join(base, "phase-3");
	fs.writeFileSync(path.join(p3, "auditor.md"), generatePhase3AuditorTemplate());
	fs.writeFileSync(path.join(p3, "subagent-1.md"), generatePhase3SubagentTemplate("Frontend Design"));
	fs.writeFileSync(path.join(p3, "subagent-2.md"), generatePhase3SubagentTemplate("Backend Framing"));
	fs.writeFileSync(path.join(p3, "subagent-3.md"), generatePhase3SubagentTemplate("Integration"));
	fs.writeFileSync(path.join(p3, "subagent-4.md"), generatePhase3SubagentTemplate("Debugging & Testing"));
	fs.writeFileSync(path.join(p3, "subagent-5.md"), generatePhase3SubagentTemplate("User Feedback"));
	fs.writeFileSync(path.join(p3, "execution_log.md"), generatePhase3ExecutionLogTemplate());
	fs.mkdirSync(path.join(p3, "test-evidence"), { recursive: true });

	// Phase 4 files
	const p4 = path.join(base, "phase-4");
	fs.writeFileSync(path.join(p4, "subagent-1.md"), generatePhase4SubagentTemplate("SAST"));
	fs.writeFileSync(path.join(p4, "subagent-2.md"), generatePhase4SubagentTemplate("DAST"));
	fs.writeFileSync(path.join(p4, "subagent-3.md"), generatePhase4SubagentTemplate("Code Review"));
	fs.writeFileSync(path.join(p4, "subagent-4.md"), generatePhase4SubagentTemplate("CI/CD"));
	fs.writeFileSync(path.join(p4, "subagent-5.md"), generatePhase4SubagentTemplate("Cybersecurity"));
	fs.writeFileSync(path.join(p4, "whitebox_testing.xml"), generateWhiteboxTestingXML());
	fs.writeFileSync(path.join(p4, "blackbox_testing.xml"), generateBlackboxTestingXML());

	// Phase 5 files
	const p5 = path.join(base, "phase-5");
	fs.writeFileSync(path.join(p5, "phase-5.md"), generatePhase5Template());

	// Phase 6 files
	const p6 = path.join(base, "phase-6");
	fs.writeFileSync(path.join(p6, "phase-6.md"), generatePhase6Template());

	// Create sync.js for Penpot integration
	fs.writeFileSync(path.join(base, "sync.js"), generateSyncJS());

	// Initialize state
	const state = {
		mode,
		currentPhase: "phase-1",
		initializedAt: new Date().toISOString(),
		contextBudget: 128000,
	};
	fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));

	logger.info("Agents mode initialized", { dir, mode });
	return `Initialized Pakalon Agents mode (${mode}): ${dir}\n\nCreated 13+ markdown files in phase-1 through phase-6`;
}

/**
 * Detect which mode the current project is in.
 */
export function detectMode(cwd: string): "agents" | "normal" | "none" {
	if (fs.existsSync(path.join(cwd, PAKALON_AGENTS_DIR))) return "agents";
	if (fs.existsSync(path.join(cwd, PAKALON_DIR))) return "normal";
	return "none";
}

/**
 * Parse command arguments for init.
 */
export function parseInitArgs(args: string): { force: boolean; mode: "agents" | "normal"; yolo: boolean } {
	const force = args.includes("--force") || args.includes("-f");
	const yolo = args.includes("--yolo");
	return { force, mode: "normal" as const, yolo };
}

/**
 * Check if project has existing code and analyze it for phase-1 pre-filling.
 */
export function analyzeExistingProject(cwd: string): { hasCode: boolean; languages: string[]; frameworks: string[] } {
	const languages: string[] = [];
	const frameworks: string[] = [];

	// Check for common files
	const checks = [
		{ file: "package.json", lang: "TypeScript/JavaScript", framework: "Node.js" },
		{ file: "Cargo.toml", lang: "Rust", framework: "" },
		{ file: "go.mod", lang: "Go", framework: "" },
		{ file: "requirements.txt", lang: "Python", framework: "" },
		{ file: "pyproject.toml", lang: "Python", framework: "" },
		{ file: "pom.xml", lang: "Java", framework: "Maven" },
		{ file: "build.gradle", lang: "Java", framework: "Gradle" },
		{ file: "Gemfile", lang: "Ruby", framework: "" },
		{ file: "composer.json", lang: "PHP", framework: "" },
	];

	let hasCode = false;
	for (const check of checks) {
		if (fs.existsSync(path.join(cwd, check.file))) {
			hasCode = true;
			languages.push(check.lang);
			if (check.framework) frameworks.push(check.framework);
		}
	}

	// Check for framework-specific files
	if (fs.existsSync(path.join(cwd, "next.config.js")) || fs.existsSync(path.join(cwd, "next.config.mjs"))) {
		frameworks.push("Next.js");
	}
	if (fs.existsSync(path.join(cwd, "vite.config.ts")) || fs.existsSync(path.join(cwd, "vite.config.js"))) {
		frameworks.push("Vite");
	}
	if (fs.existsSync(path.join(cwd, "docker-compose.yml")) || fs.existsSync(path.join(cwd, "docker-compose.yaml"))) {
		frameworks.push("Docker");
	}

	return { hasCode, languages: [...new Set(languages)], frameworks: [...new Set(frameworks)] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Template generators
// ═══════════════════════════════════════════════════════════════════════════════

function generateSkillsTemplate(): string {
	return `# Agent Skills

Define custom skills for your AI agents here.

## Available Skills

| Skill | Description |
|-------|-------------|
| frontend-design | UI/UX design with Tailwind, Shadcn UI, Radix UI |
| backend-architecture | API design, database schema, auth flows |
| security-audit | SAST/DAST scanning, vulnerability assessment |
| documentation | Auto-generate docs, README, API reference |

## Usage

Add custom skills in markdown format:
\`\`\`markdown
## Skill Name

Description of what this skill enables.

### Capabilities
- Capability 1
- Capability 2
\`\`\`
`;
}

function generatePlanTemplate(): string {
	return `# Project Plan

## Overview
<!-- Describe the project goals and objectives -->

## Architecture
<!-- High-level architecture decisions -->

## Tech Stack
<!-- Selected technologies and frameworks -->

## Milestones
<!-- Key milestones and deadlines -->

## Notes
<!-- Additional planning notes -->
`;
}

function generateTaskTemplate(): string {
	return `# Project Tasks

## Task List

| ID | Task | Status | Priority | Assigned |
|----|------|--------|----------|----------|
| T-001 | <!-- Task description --> | Pending | High | - |

## Completed
<!-- Tasks moved here when done -->

## Blocked
<!-- Tasks that are blocked and why -->
`;
}

function generateUserStoriesTemplate(): string {
	return `# User Stories

## Stories

| ID | Story | Acceptance Criteria | Status |
|----|-------|---------------------|--------|
| US-001 | As a user, I want to... | Given/When/Then | Pending |

## Epic: <!-- Epic name -->
<!-- User stories grouped by epic -->
`;
}

function generateContextManagementTemplate(): string {
	return `# Context Management

## Model Configuration
- Default Model: auto (highest context, lowest cost)
- Context Window: 128,000 tokens
- Buffer: 10% (12,800 tokens)

## Token Allocation

| Phase | Allocated | Used | Remaining |
|-------|-----------|------|-----------|
| Phase 1 | 25,600 | 0 | 25,600 |
| Phase 2 | 19,200 | 0 | 19,200 |
| Phase 3 | 38,400 | 0 | 38,400 |
| Phase 4 | 19,200 | 0 | 19,200 |
| Phase 5 | 6,400 | 0 | 6,400 |
| Phase 6 | 6,400 | 0 | 6,400 |

## Usage Rules
- Each phase must stay within its allocation
- If a phase needs more tokens, request approval in HIL mode
- YOLO mode auto-allocates based on complexity
`;
}

function generatePhase1PlanTemplate(): string {
	return `# Phase 1: Plan

## Project Overview
<!-- Generated from user requirements and Q&A session -->

## Architecture
<!-- Technical architecture decisions -->

## Tech Stack
<!-- Selected technologies with rationale -->

## Implementation Strategy
<!-- How the project will be built -->

## Success Criteria
<!-- What defines completion -->
`;
}

function generatePhase1TasksTemplate(): string {
	return `# Phase 1: Tasks

## Task Breakdown

| ID | Task | Phase | Est. Tokens | Status |
|----|------|-------|-------------|--------|
| T-001 | <!-- Task --> | P3 | 5,000 | Pending |

## Dependencies
<!-- Task dependencies and ordering -->
`;
}

function generatePhase1UserStoriesTemplate(): string {
	return `# Phase 1: User Stories

## Stories

| ID | Story | Acceptance Criteria | Test Scenarios | Status |
|----|-------|---------------------|----------------|--------|
| US-001 | As a user, I want to... | Given/When/Then | Scenario 1, 2 | Pending |

## Epics
<!-- Stories grouped by feature epic -->
`;
}

function generatePhase1DesignTemplate(): string {
	return `# Phase 1: Design

## Design Principles
<!-- UI/UX principles and guidelines -->

## Component Architecture
<!-- Frontend component structure -->

## Styling Guide
<!-- CSS/styling approach (Tailwind, Shadcn UI, etc.) -->

## Reference Designs
<!-- Links to reference websites and designs -->

## Color Palette
<!-- Primary, secondary, accent colors -->

## Typography
<!-- Font choices and hierarchy -->
`;
}

function generatePhase1ContextManagementTemplate(): string {
	return `# Phase 1: Context Management

## Token Budget

| Phase | Allocation | Notes |
|-------|------------|-------|
| Phase 1 | 25,600 | Planning & requirements |
| Phase 2 | 19,200 | Wireframe generation |
| Phase 3 | 38,400 | Development (5 subagents) |
| Phase 4 | 19,200 | Testing & security |
| Phase 5 | 6,400 | Deployment |
| Phase 6 | 6,400 | Documentation |
| Buffer | 12,800 | 10% safety margin |

## Model Settings
- Context Window: 128,000
- Max Output: 16,384
- Temperature: 0.7
`;
}

function generatePhase1APITemplate(): string {
	return `# Phase 1: API Reference

## Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | /api/health | Health check | No |

## Authentication
<!-- Auth flow (JWT, OAuth, etc.) -->

## Request/Response Formats
<!-- API data structures -->

## Error Handling
<!-- Error codes and messages -->
`;
}

function generatePhase1DatabaseTemplate(): string {
	return `# Phase 1: Database Schema

## Tables

### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

## Relationships
<!-- Entity relationships -->

## Indexes
<!-- Performance indexes -->

## Migrations
<!-- Migration strategy -->
`;
}

function generatePhase1SummaryTemplate(): string {
	return `# Phase 1 Summary

## Completed
- [ ] Requirements gathering
- [ ] Tech stack selection
- [ ] Architecture planning
- [ ] User stories creation
- [ ] API design
- [ ] Database schema
- [ ] Context management

## Key Decisions
<!-- Important decisions made during Phase 1 -->

## Artifacts
- plan.md
- tasks.md
- user-stories.md
- design.md
- context_management.md
- API_reference.md
- Database_schema.md
- agent-skills.md
- prd.md
- risk-assessment.md
- competitive-analysis.md
- constraints-and-tradeoffs.md
`;
}

function generatePhase1AgentSkillsTemplate(): string {
	return `# Phase 1: Agent Skills

## Skills Required

| Skill | Phase | Description |
|-------|-------|-------------|
| frontend-design | P3 | UI/UX implementation |
| backend-architecture | P3 | API and database |
| security-audit | P4 | Vulnerability scanning |

## Custom Skills
<!-- Project-specific skills -->
`;
}

function generatePhase1PRDTemplate(): string {
	return `# Product Requirements Document

## Vision
<!-- Product vision statement -->

## Goals
<!-- Key goals and objectives -->

## Target Users
<!-- User personas -->

## Features
<!-- Feature list with priorities -->

## Non-Functional Requirements
<!-- Performance, security, scalability -->
`;
}

function generatePhase1RiskTemplate(): string {
	return `# Risk Assessment

## Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| <!-- Risk --> | High | Low | <!-- Mitigation --> |

## Technical Risks
<!-- Technology-specific risks -->

## Schedule Risks
<!-- Timeline risks -->
`;
}

function generatePhase1CompetitiveTemplate(): string {
	return `# Competitive Analysis

## Competitors

| Competitor | Strengths | Weaknesses | Our Advantage |
|------------|-----------|------------|---------------|

## Market Position
<!-- Where we fit in the market -->

## Differentiation
<!-- What makes us unique -->
`;
}

function generatePhase1ConstraintsTemplate(): string {
	return `# Constraints and Trade-offs

## Technical Constraints
<!-- Technology limitations -->

## Budget Constraints
<!-- Resource limitations -->

## Time Constraints
<!-- Timeline limitations -->

## Trade-offs
<!-- Decisions and their implications -->
`;
}

function generatePhase2SummaryTemplate(): string {
	return `# Phase 2: Wireframe Summary

## Pages Generated
<!-- List of wireframe pages -->

## Design Decisions
<!-- Key design choices -->

## TDD Results
<!-- Screenshot comparison results -->

## User Approval
<!-- Approval status and feedback -->
`;
}

function generatePhase2WireframeSVG(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
  <rect width="1200" height="800" fill="#f5f5f5"/>
  <text x="600" y="400" text-anchor="middle" font-size="24" fill="#333">
    Wireframe Placeholder - Phase 2
  </text>
</svg>`;
}

function generatePhase3AuditorTemplate(): string {
	return `# Phase 3: Auditor Report

## Scan Results

| Category | Status | Details |
|----------|--------|---------|
| Features Complete | 0% | Not yet scanned |
| Features Partial | 0% | Not yet scanned |
| Features Missing | 100% | Not yet scanned |

## Recommendations
<!-- Audit recommendations -->
`;
}

function generatePhase3SubagentTemplate(role: string): string {
	return `# Phase 3: ${role}

## Status
- **Subagent**: ${role}
- **Started**: -
- **Completed**: -
- **Files Modified**: 0

## Work Done
<!-- Description of work completed -->

## Files Changed
<!-- List of files created/modified -->

## Issues Found
<!-- Any issues encountered -->
`;
}

function generatePhase3ExecutionLogTemplate(): string {
	return `# Phase 3: Execution Log

## Log Entries

| Timestamp | Action | Tool | Status | Notes |
|-----------|--------|------|--------|-------|
| - | - | - | - | - |

## Tool Calls
<!-- Detailed tool call history -->

## Errors
<!-- Error log -->
`;
}

function generatePhase4SubagentTemplate(type: string): string {
	return `# Phase 4: ${type} Report

## Scan Type: ${type}

## Results

| Finding | Severity | File | Line | Description |
|---------|----------|------|------|-------------|

## Summary
- High: 0
- Medium: 0
- Low: 0
- Info: 0

## Recommendations
<!-- Security recommendations -->
`;
}

function generateWhiteboxTestingXML(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<whitebox_testing>
  <header>
    <project>Project Name</project>
    <date>${new Date().toISOString().slice(0, 10)}</date>
    <version>1.0</version>
  </header>
  <sections>
    <section name="Unit Tests">
      <test id="WB-001" name="Test function" status="pending"/>
    </section>
    <section name="Integration Tests">
      <test id="WB-002" name="Test integration" status="pending"/>
    </section>
    <section name="Security Tests">
      <test id="WB-003" name="Test security" status="pending"/>
    </section>
  </sections>
</whitebox_testing>`;
}

function generateBlackboxTestingXML(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<blackbox_testing>
  <header>
    <project>Project Name</project>
    <date>${new Date().toISOString().slice(0, 10)}</date>
    <version>1.0</version>
  </header>
  <user_stories>
    <story id="US-001" name="User story" status="pending">
      <scenario id="SC-001" name="Happy path"/>
      <scenario id="SC-002" name="Edge case"/>
    </story>
  </user_stories>
</blackbox_testing>`;
}

function generatePhase5Template(): string {
	return `# Phase 5: Deployment

## Deployment Steps

| Step | Action | Status | Notes |
|------|--------|--------|-------|
| 1 | Initialize git repo | Pending | - |
| 2 | Create initial commit | Pending | - |
| 3 | Push to GitHub | Pending | - |
| 4 | Configure CI/CD | Pending | - |
| 5 | Deploy to cloud | Pending | - |

## Cloud Platform
<!-- Selected platform (AWS, DO, Azure, GCD) -->

## Environment Variables
<!-- Required env vars -->

## Build Commands
<!-- Build and deploy commands -->
`;
}

function generatePhase6Template(): string {
	return `# Phase 6: Documentation

## Documentation Generated

| File | Status | Description |
|------|--------|-------------|
| doc.md | Pending | Complete project documentation |
| API.md | Pending | API documentation |
| CHANGELOG.md | Pending | Version history |

## Project Structure
<!-- Generated project structure -->

## Features
<!-- Documented features -->

## Getting Started
<!-- Quick start guide -->
`;
}

function generateSyncJS(): string {
	return `/**
 * Penpot Sync Bridge for Pakalon
 * Watches for file changes and syncs between Penpot and local files.
 */
const fs = require('fs');
const path = require('path');

const WATCH_DIR = path.join(__dirname, 'wireframes');
const COOLDOWN_MS = 5000; // 5 second cooldown to prevent excessive LLM calls

let lastSync = 0;
let watcher = null;

function startSync() {
  if (watcher) return;
  
  watcher = fs.watch(WATCH_DIR, { recursive: true }, (eventType, filename) => {
    const now = Date.now();
    if (now - lastSync < COOLDOWN_MS) return;
    
    lastSync = now;
    console.log(\`[sync.js] File changed: \${filename}\`);
    // Trigger sync logic here
  });
  
  console.log('[sync.js] Watching for changes...');
}

function stopSync() {
  if (watcher) {
    watcher.close();
    console.log('[sync.js] Stopped watching');
  }
}

// Auto-start when Penpot is opened
startSync();

// Graceful shutdown
process.on('SIGINT', stopSync);
process.on('SIGTERM', stopSync);
`;
}
