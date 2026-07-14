import { createAgentFiles } from "./file-structure";
import type { PhaseResult, PipelineMode, PipelineState } from "./types";

// ============================================================================
// Pipeline State
// ============================================================================

let state: PipelineState = {
	mode: "idle",
	projectName: "",
	currentPhase: 0,
	maxPhases: 6,
	iterationCount: 0,
	maxIterations: 10,
	startTime: 0,
	initialized: false,
	projectPath: "",
	agentDir: "",
};

export function getPipelineState(): PipelineState {
	return { ...state };
}

export function resetPipeline(): void {
	state = {
		mode: "idle",
		projectName: "",
		currentPhase: 0,
		maxPhases: 6,
		iterationCount: 0,
		maxIterations: 10,
		startTime: 0,
		initialized: false,
		projectPath: "",
		agentDir: "",
	};
}

// ============================================================================
// Pipeline Initialization
// ============================================================================

export async function initializePipeline(
	projectPath: string,
	projectName: string,
	_mode: PipelineMode,
	maxIterations: number,
): Promise<{ success: boolean; error?: string; agentFiles?: Awaited<ReturnType<typeof createAgentFiles>> }> {
	const agentFiles = await createAgentFiles(projectPath, projectName);

	state = {
		mode: "idle",
		projectName,
		currentPhase: 0,
		maxPhases: 6,
		iterationCount: 0,
		maxIterations,
		startTime: Date.now(),
		initialized: true,
		projectPath,
		agentDir: agentFiles.agentDir,
	};

	return { success: true, agentFiles };
}

// ============================================================================
// Phase Names
// ============================================================================

const PHASE_NAMES: Record<number, string> = {
	1: "Planning & Requirements",
	2: "Wireframes",
	3: "Development",
	4: "Testing & QA",
	5: "Deployment",
	6: "Documentation",
};

// ============================================================================
// Phase Execution
// ============================================================================

export async function executePhase(
	phase: number,
	prompt?: string,
): Promise<{ result: PhaseResult; promptText: string }> {
	if (!state.initialized) {
		return {
			result: {
				phase,
				name: PHASE_NAMES[phase] ?? `Phase ${phase}`,
				status: "failed",
				files: [],
				duration: 0,
				errors: ["Pipeline not initialized. Run /pakalon first."],
			},
			promptText: "",
		};
	}

	state.currentPhase = phase;
	const phasePrompt = buildPhasePrompt(phase, prompt);

	return {
		result: {
			phase,
			name: PHASE_NAMES[phase] ?? `Phase ${phase}`,
			status: "completed",
			files: [],
			duration: 0,
			errors: [],
		},
		promptText: phasePrompt,
	};
}

// ============================================================================
// Phase Prompts
// ============================================================================

function buildPhasePrompt(phase: number, userPrompt?: string): string {
	const agentDir = state.agentDir;
	const base = [
		`You are Pakalon, an AI-powered autonomous build agent.`,
		`Execute Phase ${phase}: ${PHASE_NAMES[phase]}.`,
		``,
		`Project: ${state.projectName}`,
		`Mode: ${state.mode}`,
		`Phase: ${phase}/${state.maxPhases}`,
		`Agent Directory: ${agentDir}`,
		``,
	].join("\n");

	switch (phase) {
		case 1:
			return `${base}

## Phase 1: Planning & Requirements

Analyze the user's request and generate comprehensive planning documents.

### Tasks:
1. Create a Product Requirements Document (PRD)
2. Define user stories
3. Create a technical specification
4. Design the database schema
5. Create an API reference
6. Perform risk assessment
7. Analyze competitive landscape
8. Document constraints and tradeoffs
9. Create a context management plan
10. Generate task breakdown

### Output Files (create all in ${agentDir}/phase-1/):
- prd.md - Product Requirements Document
- user-stories.md - User stories with acceptance criteria
- technical-spec.md - Technical specification
- Database_schema.md - Database schema design
- API_reference.md - API endpoint reference
- risk-assessment.md - Risk assessment and mitigation
- competitive-analysis.md - Competitive analysis
- constraints-and-tradeoffs.md - Constraints and tradeoffs
- context_management.md - Context management plan
- tasks.md - Task breakdown with priorities
- plan.md - Overall project plan
- design.md - Design system and guidelines
- agent-skills.md - Agent skills and capabilities
- phase-1.md - Phase 1 completion summary

### User Request:
${userPrompt ?? "No specific request provided. Ask the user what they want to build, their tech stack preferences, and any constraints."}

Execute this phase completely. Create all files in the ${agentDir}/phase-1/ directory.
After creating all files, provide a summary of what was created.`;

		case 2:
			return `${base}

## Phase 2: Wireframes

Generate wireframes for the application. Read Phase 1 documents first.

### Tasks:
1. Read prd.md, user-stories.md, and technical-spec.md from Phase 1
2. Create wireframe SVGs for all application pages
3. Generate wireframe JSON structure
4. Create Penpot-compatible export file
5. Document wireframe decisions

### Output Files (create all in ${agentDir}/phase-2/):
- phase-2.md - Phase 2 completion summary
- Wireframe_generated.svg - SVG wireframes
- Wireframe_generated.json - JSON wireframe structure
- Wireframe_generated.penpot - Penpot export

### Instructions:
- Generate wireframes for every page/screen defined in the PRD
- Each wireframe should show layout, navigation, and key UI elements
- Include mobile and desktop variants where appropriate
- Document design decisions and component hierarchy

Execute this phase completely.`;

		case 3:
			return `${base}

## Phase 3: Development

Execute the 5-subagent development pipeline. Read Phase 1 and Phase 2 documents first.

### Subagents (execute in order):

**SA1 - Frontend**: Build all frontend components and pages
- Create React/Next.js components
- Implement UI from wireframes
- Add styling and responsive design

**SA2 - Backend**: Build API endpoints, database, and server logic
- Create API routes
- Set up database connections
- Implement business logic

**SA3 - Integration**: Connect frontend and backend
- Wire up API calls
- Implement data flow
- Add error handling

**SA4 - Debug & Test**: Fix bugs and write tests
- Fix any integration issues
- Write unit and integration tests
- Ensure all features work

**SA5 - Review**: Code review and optimization
- Review all code for quality
- Optimize performance
- Add documentation

### Output Files (create all in ${agentDir}/phase-3/):
- subagent-1.md - SA1 Frontend results
- subagent-2.md - SA2 Backend results
- subagent-3.md - SA3 Integration results
- subagent-4.md - SA4 Debug & Test results
- subagent-5.md - SA5 Review results
- execution_log.md - Execution log with timestamps
- auditor.md - Auditor findings (will be filled by auditor loop)

### Instructions:
- Each subagent should document what it built
- Include file paths of all created/modified files
- Note any issues or decisions made
- After all subagents complete, run the auditor check

Execute all 5 subagents in sequence.`;

		case 4:
			return `${base}

## Phase 4: Testing & QA

Execute the 5-subagent security testing pipeline. Read Phase 3 results first.

### Subagents:

**SA1 - SAST**: Static Application Security Testing
- Run Semgrep, Bandit, ESLint security plugins
- Check for common vulnerabilities
- Generate whitebox_testing.xml

**SA2 - DAST**: Dynamic Application Security Testing
- Run OWASP ZAP, Nikto, sqlmap
- Test running application for vulnerabilities
- Generate blackbox_testing.xml

**SA3 - Code Review**: Security-focused code review
- Review authentication/authorization
- Check input validation
- Review data handling

**SA4 - CI/CD Review**: Deployment pipeline security
- Review GitHub Actions workflows
- Check Docker security
- Verify environment variable handling

**SA5 - Cyber Best Practices**: Security compliance
- Check OWASP Top 10 compliance
- Verify HTTPS/TLS configuration
- Review session management

### Output Files (create all in ${agentDir}/phase-4/):
- subagent-1.md - SAST results
- subagent-2.md - DAST results
- subagent-3.md - Code review results
- subagent-4.md - CI/CD review results
- subagent-5.md - Cyber best practices results
- blackbox_testing.xml - DAST test results in XML
- whitebox_testing.xml - SAST test results in XML

### Instructions:
- Run all security tools via Docker when possible
- Parse tool outputs into structured XML
- Document all findings with severity levels
- Provide specific fix recommendations

Execute this phase completely.`;

		case 5:
			return `${base}

## Phase 5: Deployment

Set up CI/CD and deployment. Read Phase 4 results to ensure security is addressed.

### Tasks:
1. Create Docker configuration
2. Set up GitHub Actions workflow
3. Configure deployment targets
4. Create deployment scripts
5. Set up environment variables
6. Create pull request with all changes

### Output Files (create all in ${agentDir}/phase-5/):
- phase-5.md - Phase 5 completion summary
- Dockerfile - Docker configuration
- docker-compose.yml - Docker Compose configuration
- .github/workflows/ci.yml - GitHub Actions workflow
- .env.example - Environment variable template
- deploy.sh - Deployment script

### Instructions:
- Create production-ready Docker configuration
- Set up CI pipeline with testing and security checks
- Configure for the target deployment platform
- Document deployment process

Execute this phase completely.`;

		case 6:
			return `${base}

## Phase 6: Documentation

Generate comprehensive documentation. Read all previous phase results.

### Tasks:
1. Create/update README.md
2. Generate API documentation
3. Create CHANGELOG.md
4. Write contributing guidelines
5. Create architecture documentation

### Output Files (create all in ${agentDir}/phase-6/):
- phase-6.md - Phase 6 completion summary
- README.md - Project README
- API_DOCUMENTATION.md - API documentation
- CHANGELOG.md - Change log
- CONTRIBUTING.md - Contributing guidelines
- ARCHITECTURE.md - Architecture documentation

### Instructions:
- Document all features and endpoints
- Include setup and usage instructions
- Create comprehensive API docs
- Write clear contributing guidelines

Execute this phase completely.`;

		default:
			return `${base}\n\nUnknown phase: ${phase}. Valid phases are 1-6.`;
	}
}

// ============================================================================
// Phase Status Helpers
// ============================================================================

export function getStatusSummary(): string {
	if (!state.initialized) {
		return "Pipeline not initialized. Use /pakalon to start.";
	}

	const elapsed = Date.now() - state.startTime;
	const elapsedStr = formatDuration(elapsed);

	return [
		`Pipeline Status: ${state.initialized ? "Active" : "Idle"}`,
		`Project: ${state.projectName}`,
		`Mode: ${state.mode.toUpperCase()}`,
		`Current Phase: ${state.currentPhase}/${state.maxPhases} (${PHASE_NAMES[state.currentPhase] ?? "None"})`,
		`Iterations: ${state.iterationCount}/${state.maxIterations}`,
		`Elapsed: ${elapsedStr}`,
		`Agent Directory: ${state.agentDir}`,
	].join("\n");
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}
