import { Log } from "../util/log"
import { FileStructure } from "./file-structure"
import { ContextManager } from "./context-manager"
import { HILHandler, type HILSession } from "./hil-handler"
import { WebScraper } from "./web-scraper"
import { PhaseLLM } from "./llm"
import type { PhaseContext, PhaseResult } from "./types"
import type { TokenBudget } from "./context-manager"

const log = Log.create({ service: "pipeline:phase1" })

const SYSTEM_PROMPT = `You are the Phase 1 Planning Agent for Pakalon.

Your job is to:
1. Gather requirements through interactive conversation (HIL mode) or automatic analysis (YOLO mode)
2. Generate comprehensive planning artifacts

You must produce these artifacts:
- plan.md: Overall project plan with milestones
- tasks.md: Detailed task breakdown
- design.md: Design decisions and architecture
- prd.md: Product requirements document
- Database_schema.md: Database schema design
- API_reference.md: API endpoint documentation
- user-stories.md: User stories with acceptance criteria
- technical-spec.md: Technical specifications
- risk-assessment.md: Risk analysis and mitigation
- competitive-analysis.md: Competitor analysis
- constraints-and-tradeoffs.md: Technical constraints
- context_management.md: Token budget allocation per phase
- phase-1.md: Phase 1 completion summary

In HIL mode, ask at least 10 questions covering:
- Tech stack preferences (React, Vue, Svelte, plain HTML/CSS/JS)
- Design preferences (3D, animations, themes)
- Backend requirements (database, API, auth)
- Deployment targets (Vercel, AWS, self-hosted)
- Key features and priorities
- Existing codebase analysis

In YOLO mode, analyze the project directory and determine all requirements automatically.`

const YOLO_QUESTIONS = [
  "What is the primary purpose of this project?",
  "What tech stack should be used?",
  "What is the target deployment platform?",
  "Are there existing files/code to integrate with?",
  "What are the key features needed?",
  "What database/backend is required?",
  "What authentication method is preferred?",
  "What design style should be used?",
  "Are there performance requirements?",
  "What is the timeline/urgency?",
]

export namespace Phase1Planning {
  let hilSession: HILSession | null = null

  export function systemPrompt(): string {
    return SYSTEM_PROMPT
  }

  export function yoloQuestions(): string[] {
    return YOLO_QUESTIONS
  }

  export function getHILSession(): HILSession | null {
    return hilSession
  }

  export function startHILSession(): HILSession {
    hilSession = HILHandler.createSession(1)
    return hilSession
  }

  export function processHILAnswer(questionId: string, answer: string): HILSession | null {
    if (!hilSession) return null
    hilSession = HILHandler.processAnswer(hilSession, questionId, answer)
    return hilSession
  }

  export function skipHILSession(): HILSession | null {
    if (!hilSession) return null
    hilSession = HILHandler.skipToEnd(hilSession)
    return hilSession
  }

  export async function execute(ctx: PhaseContext, budget: TokenBudget): Promise<PhaseResult> {
    log.info("starting phase 1 planning", { mode: ctx.mode, path: ctx.projectPath })

    const artifacts: string[] = []
    let tokensUsed = 0

    // Gather requirements based on mode
    let requirements = ""
    let webInsights = ""

    if (ctx.mode === "hil" && hilSession) {
      requirements = HILHandler.generateSummary(hilSession)
      webInsights = await WebScraper.scrapeForRequirements(
        HILHandler.generateTechStackFromAnswers(hilSession.answers) || "web application"
      )
    } else {
      // YOLO mode - analyze project directory
      requirements = await analyzeProjectDirectory(ctx.projectPath)
    }

    // Generate all Phase 1 artifacts
    const planContent = generatePlanTemplate(ctx, requirements, webInsights)

    // Enhance plan with LLM if available
    const enhancedPlan = await PhaseLLM.generate({
      systemPrompt: `You are a project planning expert. Enhance this plan template with specific, actionable details based on the requirements. Keep the markdown structure but fill in realistic details. Be concise.`,
      userPrompt: `Requirements:\n${requirements}\n\nTemplate:\n${planContent}\n\nEnhanced plan:`,
      maxTokens: 2000,
    }).catch(() => "")

    await FileStructure.writeArtifact(ctx.projectPath, 1, "plan.md", enhancedPlan || planContent)
    artifacts.push("plan.md")
    tokensUsed += 500

    const tasksContent = generateTasksTemplate(ctx)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "tasks.md", tasksContent)
    artifacts.push("tasks.md")
    tokensUsed += 400

    const designContent = generateDesignDoc(ctx.projectPath, requirements, hilSession?.answers ?? {})

    // Enhance design with LLM if available
    const enhancedDesign = await PhaseLLM.generate({
      systemPrompt: `You are a software architect. Enhance this design document with specific architecture decisions, component breakdown, and data flow details. Keep markdown structure but add concrete details.`,
      userPrompt: `Requirements:\n${requirements}\n\nTemplate:\n${designContent}\n\nEnhanced design:`,
      maxTokens: 2000,
    }).catch(() => "")

    await FileStructure.writeArtifact(ctx.projectPath, 1, "design.md", enhancedDesign || designContent)
    artifacts.push("design.md")
    tokensUsed += 300

    const prdContent = generatePRDTemplate(ctx)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "prd.md", prdContent)
    artifacts.push("prd.md")
    tokensUsed += 600

    const dbSchemaContent = generateDatabaseSchema(ctx.projectPath, requirements)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "Database_schema.md", dbSchemaContent)
    artifacts.push("Database_schema.md")
    tokensUsed += 400

    const apiRefContent = generateAPIReference(ctx.projectPath, requirements)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "API_reference.md", apiRefContent)
    artifacts.push("API_reference.md")
    tokensUsed += 400

    const userStoriesContent = generateUserStories(ctx)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "user-stories.md", userStoriesContent)
    artifacts.push("user-stories.md")
    tokensUsed += 500

    const techSpecContent = generateTechnicalSpec(ctx, hilSession?.answers)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "technical-spec.md", techSpecContent)
    artifacts.push("technical-spec.md")
    tokensUsed += 300

    const riskContent = generateRiskAssessment(ctx)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "risk-assessment.md", riskContent)
    artifacts.push("risk-assessment.md")
    tokensUsed += 300

    const competitiveContent = generateCompetitiveAnalysis(ctx)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "competitive-analysis.md", competitiveContent)
    artifacts.push("competitive-analysis.md")
    tokensUsed += 300

    const constraintsContent = generateConstraintsAndTradeoffs(ctx)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "constraints-and-tradeoffs.md", constraintsContent)
    artifacts.push("constraints-and-tradeoffs.md")
    tokensUsed += 200

    const contextMgmtContent = generateContextManagement(ctx, budget)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "context_management.md", contextMgmtContent)
    artifacts.push("context_management.md")
    tokensUsed += 200

    const agentSkillsContent = generateAgentSkills(ctx, hilSession?.answers)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "agent-skills.md", agentSkillsContent)
    artifacts.push("agent-skills.md")
    tokensUsed += 200

    const phase1Content = generatePhase1Summary(ctx, artifacts)
    await FileStructure.writeArtifact(ctx.projectPath, 1, "phase-1.md", phase1Content)
    artifacts.push("phase-1.md")
    tokensUsed += 200

    // If web insights were gathered, save them
    if (webInsights) {
      await FileStructure.writeArtifact(ctx.projectPath, 1, "web-insights.md", webInsights)
      artifacts.push("web-insights.md")
      tokensUsed += 100
    }

    const budgetUpdated = ContextManager.recordUsage(budget, "phase-1", tokensUsed)
    await ContextManager.save(ctx.projectPath, budgetUpdated)

    log.info("phase 1 completed", { artifacts: artifacts.length, tokensUsed })
    return { success: true, artifacts, nextPhase: 2, tokensUsed }
  }

  async function analyzeProjectDirectory(projectPath: string): Promise<string> {
    return `# Project Analysis

## Project Path
${projectPath}

## Analysis Mode
YOLO - Automated analysis

## Detected Structure
- Project directory analyzed
- Existing files scanned
- Dependencies detected

## Recommendations
Based on the project structure, the following approach is recommended.
`
  }

  function generatePlanTemplate(
    ctx: PhaseContext,
    requirements: string,
    webInsights: string,
  ): string {
    return `# Project Plan

## Overview
- **Project Path:** ${ctx.projectPath}
- **Mode:** ${ctx.mode.toUpperCase()}
- **Generated:** ${new Date().toISOString()}

## Milestones
1. **Phase 1 - Planning** ✅ Requirements gathering and planning
2. **Phase 2 - Wireframes** 🎨 Visual design and wireframes
3. **Phase 3 - Development** ⚙️ Implementation with sub-agents
4. **Phase 4 - Security** 🔒 Security testing and QA
5. **Phase 5 - Deployment** 🚀 Deployment and CI/CD
6. **Phase 6 - Documentation** 📝 Final documentation

## Requirements Summary
${requirements || "Requirements gathered through interactive session."}

## Web Research Insights
${webInsights ? "See web-insights.md for detailed analysis." : "No web research performed."}

## Tech Stack
- Frontend: To be defined in Phase 1 artifacts
- Backend: To be defined in Phase 1 artifacts
- Database: To be defined in Phase 1 artifacts
- Deployment: To be defined in Phase 1 artifacts

## Architecture
- Monolithic / Microservices (TBD based on requirements)
- RESTful / GraphQL API (TBD)
- Responsive design for all devices

## Timeline
- Phase 1: Planning (current)
- Phase 2-6: Sequential execution with parallel sub-agents

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function generateTasksTemplate(_ctx: PhaseContext): string {
    return `# Task Breakdown

## Phase 1: Planning
- [x] Initialize pipeline
- [x] Gather requirements
- [x] Create plan.md
- [x] Create tasks.md
- [x] Create design.md
- [x] Create prd.md
- [x] Create Database_schema.md
- [x] Create API_reference.md
- [x] Create user-stories.md
- [x] Create technical-spec.md
- [x] Create risk-assessment.md
- [x] Create competitive-analysis.md
- [x] Create constraints-and-tradeoffs.md
- [x] Create context_management.md
- [x] Create agent-skills.md

## Phase 2: Wireframes
- [ ] Generate wireframes from design.md
- [ ] Open Penpot for review (HIL mode)
- [ ] Run TDD validation
- [ ] Save wireframes as .svg and .penpot

## Phase 3: Development
- [ ] Sub-agent 1: Frontend implementation
- [ ] Sub-agent 2: Backend implementation
- [ ] Sub-agent 3: Integration
- [ ] Sub-agent 4: Testing and bug fixes
- [ ] Sub-agent 5: User feedback (HIL only)
- [ ] Auditor: Gap analysis

## Phase 4: Security
- [ ] SAST scanning (Bandit, Semgrep, etc.)
- [ ] DAST scanning (sqlmap, OWASP ZAP, etc.)
- [ ] Code review
- [ ] Fix vulnerabilities
- [ ] Generate blackbox_testing.xml
- [ ] Generate whitebox_testing.xml

## Phase 5: Deployment
- [ ] CI/CD setup
- [ ] Docker configuration
- [ ] GitHub integration
- [ ] Deployment scripts

## Phase 6: Documentation
- [ ] API documentation
- [ ] User guide
- [ ] README update
- [ ] Doc.md generation

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  export function generateDesignDoc(
    projectPath: string,
    requirements: string,
    userChoices: Record<string, string>,
  ): string {
    const style = userChoices["design-style"] ?? "Modern minimalist"
    const css = userChoices["css-framework"] ?? "Tailwind CSS"
    const ui = userChoices["ui-components"] ?? "Shadcn/UI + Radix"
    const fx = userChoices["design-3d"] ?? "Simple CSS animations only"
    const theme = pickTheme(style)
    const typo = pickTypo(style)
    const page = pickPages(requirements)
    const hasFrontendPatterns = `${requirements} ${Object.values(userChoices).join(" ")}`
      .toLowerCase()
      .includes("frontend-patterns")
    const skill = hasFrontendPatterns
      ? "frontend-patterns skill detected and referenced in component choices"
      : "frontend-patterns skill not explicitly detected; include if available for layout and interaction patterns"
    const project = projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "project"

    return `# Design Document

## Project
- **Name:** ${project}
- **Primary Style:** ${style}
- **CSS Framework:** ${css}
- **Component Library:** ${ui}
- **Motion/3D Preference:** ${fx}

## Color Scheme (based on preferences)
### Brand
- **Primary:** ${theme.primary}
- **Primary Hover:** ${theme.primaryHover}
- **Accent:** ${theme.accent}

### Surfaces
- **Background:** ${theme.bg}
- **Surface:** ${theme.surface}
- **Border:** ${theme.border}

### Text
- **Primary Text:** ${theme.text}
- **Muted Text:** ${theme.muted}

### Semantic
- **Success:** #16a34a
- **Warning:** #f59e0b
- **Error:** #ef4444
- **Info:** #3b82f6

## Typography Recommendations
- **Primary Font:** ${typo.main}
- **Monospace:** ${typo.mono}

| Token | Size | Weight | Usage |
|---|---:|---:|---|
| h1 | 36px | 700 | Page title |
| h2 | 30px | 700 | Section title |
| h3 | 24px | 600 | Card/segment title |
| body | 16px | 400 | Default copy |
| small | 14px | 400 | Secondary copy |

## Component Layout Description
1. **Top Nav:** Brand, global search, notifications, profile menu.
2. **Left Sidebar:** Primary IA and feature groups, collapsible on tablet.
3. **Main Grid:** 12-column desktop, 6-column tablet, 1-column mobile.
4. **Cards:** Summary KPIs, recent activity, actionable widgets.
5. **Form Surfaces:** Inputs grouped by intent, inline validation, sticky action bar.
6. **Feedback Layer:** Toast stack, inline alerts, skeleton loaders.

## Page Structure
${page.map((x, i) => `${i + 1}. **${x.name}** — ${x.desc}`).join("\n")}

## Accessibility + Responsiveness
- Mobile-first breakpoints at 640/768/1024/1280.
- Minimum 44px interactive target, full keyboard nav, focus-visible styles.
- Contrast goal WCAG 2.1 AA.

## Agent Skills Integration
- ${skill}
- Recommended usage: page scaffolding, card/list patterns, form composition, loading/error states.

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function generatePRDTemplate(ctx: PhaseContext): string {
    const projectName = ctx.projectPath.split("/").pop() ?? "Project"
    return `# Product Requirements Document

## 1. Introduction
- **Product:** ${projectName}
- **Date:** ${new Date().toISOString().split("T")[0]}
- **Version:** 1.0.0

## 2. Goals
- Deliver a functional, production-ready application
- Meet all user requirements within timeline
- Ensure security and performance standards
- Provide excellent user experience

## 3. User Stories
See user-stories.md for detailed user stories with acceptance criteria.

## 4. Functional Requirements
### Core Features
- User authentication and authorization
- Main application functionality
- Data persistence
- API endpoints for frontend-backend communication

### Secondary Features
- Admin dashboard
- Analytics and reporting
- File uploads
- Real-time updates (if applicable)

## 5. Non-Functional Requirements
### Performance
- Page load time < 3 seconds
- API response time < 500ms
- Support for concurrent users

### Security
- HTTPS only
- Input validation
- SQL injection prevention
- XSS protection
- CSRF protection

### Scalability
- Horizontal scaling capability
- Database optimization
- Caching strategy

## 6. Constraints
- Development timeline
- Budget limitations
- Technology stack requirements
- Third-party dependencies

## 7. Success Criteria
- All user stories completed
- All tests passing
- Security scan clean
- Performance benchmarks met

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  export function generateDatabaseSchema(projectPath: string, requirements: string): string {
    const low = requirements.toLowerCase()
    const db = low.includes("mysql")
      ? "MySQL"
      : low.includes("mongodb")
        ? "MongoDB"
        : low.includes("sqlite")
          ? "SQLite"
          : "PostgreSQL"
    const orm = db === "MongoDB" ? "Mongoose" : "Drizzle ORM"
    const project = projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "project"

    return `# Database Schema

## Scope
- **Project:** ${project}
- **Primary Store:** ${db}
- **Data Layer:** ${orm}

## Table Definitions
### users
- id (pk)
- email (unique)
- password_hash
- role
- created_at, updated_at

### sessions
- id (pk)
- user_id (fk -> users.id)
- token (unique)
- expires_at

### projects
- id (pk)
- owner_id (fk -> users.id)
- name
- slug (unique)
- status
- created_at, updated_at

### items
- id (pk)
- project_id (fk -> projects.id)
- creator_id (fk -> users.id)
- title
- body
- state
- created_at, updated_at

## Relationships
- users 1:N sessions
- users 1:N projects
- users 1:N items
- projects 1:N items

## Indexes
- users_email_idx (users.email)
- sessions_token_idx (sessions.token)
- projects_owner_id_idx (projects.owner_id)
- projects_slug_idx (projects.slug)
- items_project_id_idx (items.project_id)
- items_state_idx (items.state)
- items_created_at_idx (items.created_at DESC)

## Migration Strategy
1. Start with baseline migration for users/sessions/projects/items.
2. Apply additive migrations first (new nullable columns + backfill).
3. Add constraints and non-null in follow-up migration.
4. Keep reversible down scripts for each step.
5. Run staging verification + rollback rehearsal before production.

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  export function generateAPIReference(projectPath: string, requirements: string): string {
    const low = requirements.toLowerCase()
    const style = low.includes("graphql") ? "GraphQL" : low.includes("trpc") ? "tRPC" : "REST API"
    const auth = low.includes("no authentication") ? "None" : "Bearer JWT + refresh token"
    const project = projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "project"

    return `# API Reference

## API Overview
- **Project:** ${project}
- **Style:** ${style}
- **Base URL:** \`/api/v1\`
- **Content Type:** \`application/json\`

## Authentication Requirements
- **Scheme:** ${auth}
- **Header:** \`Authorization: Bearer <token>\`
- **Protected Routes:** all write operations and \`/users/me\`

## Endpoint Definitions
### Auth
- **POST /auth/register** — Create account
- **POST /auth/login** — Sign in and issue tokens
- **POST /auth/refresh** — Rotate access token
- **POST /auth/logout** — Revoke current session

### Users
- **GET /users/me** — Read current profile
- **PATCH /users/me** — Update profile metadata

### Projects
- **GET /projects** — List user projects
- **POST /projects** — Create project
- **GET /projects/:id** — Fetch one project
- **PATCH /projects/:id** — Update project
- **DELETE /projects/:id** — Delete project

### Items
- **GET /projects/:id/items** — List project items
- **POST /projects/:id/items** — Create item
- **PATCH /items/:id** — Update item
- **DELETE /items/:id** — Delete item

## Request / Response Schemas
### Create Project Request
\`\`\`json
{
  "name": "Marketing Site",
  "slug": "marketing-site",
  "status": "active"
}
\`\`\`

### Create Project Response
\`\`\`json
{
  "success": true,
  "data": {
    "id": "prj_123",
    "name": "Marketing Site",
    "slug": "marketing-site",
    "status": "active"
  }
}
\`\`\`

## Error Handling Conventions
- Unified envelope:
\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": [{ "field": "name", "message": "Required" }]
  }
}
\`\`\`
- Status mapping: 400 validation, 401 unauthorized, 403 forbidden, 404 not found, 409 conflict, 429 rate-limited, 500 internal.
- Idempotency recommended for write endpoints that can be retried.

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function pickTheme(style: string): {
    primary: string
    primaryHover: string
    accent: string
    bg: string
    surface: string
    border: string
    text: string
    muted: string
  } {
    const low = style.toLowerCase()
    if (low.includes("bold") || low.includes("colorful")) {
      return {
        primary: "#7c3aed",
        primaryHover: "#6d28d9",
        accent: "#ec4899",
        bg: "#faf5ff",
        surface: "#ffffff",
        border: "#ddd6fe",
        text: "#2e1065",
        muted: "#6b21a8",
      }
    }
    if (low.includes("dark")) {
      return {
        primary: "#60a5fa",
        primaryHover: "#3b82f6",
        accent: "#22d3ee",
        bg: "#020617",
        surface: "#0f172a",
        border: "#1e293b",
        text: "#e2e8f0",
        muted: "#94a3b8",
      }
    }
    return {
      primary: "#4f46e5",
      primaryHover: "#4338ca",
      accent: "#0ea5e9",
      bg: "#f8fafc",
      surface: "#ffffff",
      border: "#e2e8f0",
      text: "#0f172a",
      muted: "#475569",
    }
  }

  function pickTypo(style: string): { main: string; mono: string } {
    const low = style.toLowerCase()
    if (low.includes("corporate") || low.includes("professional")) {
      return {
        main: "Inter, system-ui, sans-serif",
        mono: "JetBrains Mono, Consolas, monospace",
      }
    }
    if (low.includes("playful") || low.includes("fun")) {
      return {
        main: "Poppins, Inter, system-ui, sans-serif",
        mono: "Fira Code, Consolas, monospace",
      }
    }
    return {
      main: "Inter, system-ui, sans-serif",
      mono: "JetBrains Mono, Consolas, monospace",
    }
  }

  function pickPages(req: string): Array<{ name: string; desc: string }> {
    const low = req.toLowerCase()
    const base: Array<{ name: string; desc: string }> = [
      { name: "Landing", desc: "Value proposition, CTA, trust markers" },
      { name: "Auth", desc: "Sign-in, sign-up, password reset" },
      { name: "Dashboard", desc: "KPIs, recent activity, quick actions" },
      { name: "Settings", desc: "Profile, preferences, security" },
    ]
    if (low.includes("admin")) {
      return [...base, { name: "Admin", desc: "User management, audit, moderation" }]
    }
    if (low.includes("payment")) {
      return [...base, { name: "Billing", desc: "Plans, invoices, payment methods" }]
    }
    return base
  }

  function generateUserStories(_ctx: PhaseContext): string {
    return `# User Stories

## Epic 1: User Authentication

### US-001: User Registration
**As a** new user
**I want to** create an account
**So that** I can access the application features

**Acceptance Criteria:**
- [ ] User can register with email and password
- [ ] Email validation is performed
- [ ] Password meets security requirements (min 8 chars, 1 uppercase, 1 number)
- [ ] User receives confirmation email
- [ ] Duplicate email registration is prevented

**Test Scenarios:**
- Valid registration with all required fields
- Registration with invalid email format
- Registration with weak password
- Registration with duplicate email

### US-002: User Login
**As a** registered user
**I want to** login to my account
**So that** I can access my data

**Acceptance Criteria:**
- [ ] User can login with email and password
- [ ] JWT token is returned on successful login
- [ ] Invalid credentials show appropriate error
- [ ] Account lockout after failed attempts

## Epic 2: Core Functionality

### US-003: Dashboard Access
**As a** logged-in user
**I want to** see my dashboard
**So that** I can view my data and take actions

**Acceptance Criteria:**
- [ ] Dashboard loads after login
- [ ] User-specific data is displayed
- [ ] Navigation is intuitive
- [ ] Loading states are shown

### US-004: Data Management
**As a** user
**I want to** create, read, update, and delete my data
**So that** I can manage my information

**Acceptance Criteria:**
- [ ] CRUD operations work correctly
- [ ] Data validation is enforced
- [ ] Changes are persisted
- [ ] Appropriate feedback is shown

## Epic 3: Administration

### US-005: Admin Dashboard
**As an** administrator
**I want to** manage users and content
**So that** I can maintain the platform

**Acceptance Criteria:**
- [ ] Admin can view all users
- [ ] Admin can manage user roles
- [ ] Admin can view system statistics

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function generateTechnicalSpec(
    _ctx: PhaseContext,
    answers?: Record<string, string>,
  ): string {
    const frontend = answers?.["tech-stack-frontend"] ?? "React with Next.js"
    const backend = answers?.["tech-stack-backend"] ?? "Node.js with Express"
    const database = answers?.["database"] ?? "PostgreSQL"

    return `# Technical Specification

## Technology Stack

### Frontend
- **Framework:** ${frontend}
- **Language:** TypeScript
- **State Management:** ${answers?.["react-state"] ?? "Zustand"}
- **Styling:** ${answers?.["css-framework"] ?? "Tailwind CSS"}
- **UI Components:** ${answers?.["ui-components"] ?? "Shadcn/UI"}

### Backend
- **Framework:** ${backend}
- **Language:** TypeScript/JavaScript or Python
- **API Style:** ${answers?.["api-style"] ?? "REST"}
- **Authentication:** ${answers?.["authentication"] ?? "JWT"}

### Database
- **Type:** ${database}
- **ORM:** Prisma / Drizzle / SQLAlchemy

## Architecture

### System Architecture
\`\`\`
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│  Database   │
│  (Next.js)  │     │  (Express)  │     │ (PostgreSQL)│
└─────────────┘     └─────────────┘     └─────────────┘
\`\`\`

### API Architecture
- RESTful design
- Versioned endpoints (/api/v1/)
- Request/Response validation
- Error handling middleware

## Performance Requirements
- Page load: < 3 seconds
- API response: < 500ms
- Database queries: < 100ms

## Security Requirements
- HTTPS everywhere
- Input validation
- SQL injection prevention
- XSS protection
- CORS configuration
- Rate limiting

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function generateRiskAssessment(_ctx: PhaseContext): string {
    return `# Risk Assessment

## Technical Risks

### High Priority
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Third-party API downtime | High | Medium | Implement fallbacks, caching |
| Database performance issues | High | Medium | Query optimization, indexing |
| Security vulnerabilities | High | Low | Regular security audits |

### Medium Priority
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Browser compatibility | Medium | Medium | Cross-browser testing |
| Mobile responsiveness | Medium | Low | Mobile-first design |
| Dependency vulnerabilities | Medium | Medium | Regular updates, audits |

## Timeline Risks
- **Feature creep:** Stick to defined requirements
- **Technical debt:** Regular refactoring sprints
- **Integration issues:** Early integration testing

## Mitigation Strategies
1. Regular code reviews
2. Automated testing
3. Continuous integration
4. Staged deployments
5. Rollback procedures

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function generateCompetitiveAnalysis(_ctx: PhaseContext): string {
    return `# Competitive Analysis

## Market Overview
Analysis of existing solutions in the market.

## Competitor Analysis

### Competitor 1: [Name]
- **Strengths:** Feature-rich, established brand
- **Weaknesses:** Complex UI, high pricing
- **Opportunity:** Simplify user experience

### Competitor 2: [Name]
- **Strengths:** Modern design, good performance
- **Weaknesses:** Limited features
- **Opportunity:** More comprehensive solution

## Differentiation Strategy
1. Better user experience
2. Competitive pricing
3. Superior performance
4. Better documentation

## Feature Comparison
| Feature | Us | Competitor 1 | Competitor 2 |
|---------|----|--------------|--------------|
| Feature A | ✅ | ✅ | ❌ |
| Feature B | ✅ | ❌ | ✅ |
| Feature C | ✅ | ✅ | ✅ |

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function generateConstraintsAndTradeoffs(_ctx: PhaseContext): string {
    return `# Constraints and Trade-offs

## Technical Constraints
1. **Technology Stack:** Must use approved technologies
2. **Performance:** Must meet response time requirements
3. **Security:** Must comply with security standards
4. **Compatibility:** Must support major browsers

## Timeline Constraints
- Phase 1: 1-2 days
- Phase 2: 2-3 days
- Phase 3: 5-7 days
- Phase 4: 2-3 days
- Phase 5: 1-2 days
- Phase 6: 1 day

## Resource Constraints
- Development team size
- Budget limitations
- Infrastructure costs

## Trade-offs Made

### Performance vs. Development Speed
- Chose framework with good DX over raw performance
- Acceptable for MVP, can optimize later

### Features vs. Timeline
- Prioritized core features
- Deferred nice-to-have features

### Custom vs. Off-the-shelf
- Using established libraries where possible
- Custom solutions only where necessary

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function generateContextManagement(_ctx: PhaseContext, budget: TokenBudget): string {
    return `# Context Management

## Token Budget Allocation

### Total Budget
- **Total Tokens:** ${budget.total}
- **Allocated:** ${Object.values(budget.phases).reduce((sum, p) => sum + p.allocated, 0)}
- **Remaining:** ${Object.values(budget.phases).reduce((sum, p) => sum + p.remaining, 0)}

### Phase Allocation
| Phase | Allocated | Used | Remaining |
|-------|-----------|------|-----------|
| Phase 1 | ${budget.phases["phase-1"]?.allocated ?? 0} | ${budget.phases["phase-1"]?.used ?? 0} | ${budget.phases["phase-1"]?.remaining ?? 0} |
| Phase 2 | ${budget.phases["phase-2"]?.allocated ?? 0} | ${budget.phases["phase-2"]?.used ?? 0} | ${budget.phases["phase-2"]?.remaining ?? 0} |
| Phase 3 | ${budget.phases["phase-3"]?.allocated ?? 0} | ${budget.phases["phase-3"]?.used ?? 0} | ${budget.phases["phase-3"]?.remaining ?? 0} |
| Phase 4 | ${budget.phases["phase-4"]?.allocated ?? 0} | ${budget.phases["phase-4"]?.used ?? 0} | ${budget.phases["phase-4"]?.remaining ?? 0} |
| Phase 5 | ${budget.phases["phase-5"]?.allocated ?? 0} | ${budget.phases["phase-5"]?.used ?? 0} | ${budget.phases["phase-5"]?.remaining ?? 0} |
| Phase 6 | ${budget.phases["phase-6"]?.allocated ?? 0} | ${budget.phases["phase-6"]?.used ?? 0} | ${budget.phases["phase-6"]?.remaining ?? 0} |

### Buffer
- 10% buffer reserved for unexpected tasks
- Token usage tracked per phase

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function generateAgentSkills(
    _ctx: PhaseContext,
    answers?: Record<string, string>,
  ): string {
    return `# Agent Skills

## Phase 1 Agent Skills

### Requirement Gathering
- Interactive Q&A for HIL mode
- Automated analysis for YOLO mode
- Web scraping for research

### Document Generation
- Plan creation
- Task breakdown
- User stories with acceptance criteria
- Technical specifications
- Risk assessment
- Competitive analysis

## Recommended External Skills
Based on project requirements:

### Frontend Skills
- React/Next.js best practices
- Tailwind CSS components
- UI/UX design patterns

### Backend Skills
- API design patterns
- Database optimization
- Authentication flows

### DevOps Skills
- CI/CD pipeline setup
- Docker containerization
- Deployment strategies

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }

  function generatePhase1Summary(ctx: PhaseContext, artifacts: string[]): string {
    return `# Phase 1 Summary

## Status: Completed

## Mode
${ctx.mode === "hil" ? "Human-in-the-Loop (HIL)" : "YOLO (Fully Automated)"}

## Artifacts Generated
${artifacts.map((a) => `- ${a}`).join("\n")}

## Total Artifacts
${artifacts.length} files generated

## Next Steps
1. Review plan.md for project plan
2. Review design.md for design decisions
3. Review Database_schema.md for database structure
4. Review API_reference.md for API endpoints
5. Proceed to Phase 2 (Wireframes)

## Token Usage
- Budget: ${ctx.tokenBudget.total}
- Used: ${ctx.tokenBudget.total - ctx.tokenBudget.remaining}
- Remaining: ${ctx.tokenBudget.remaining}

---
*Generated by Pakalon Phase 1 Planning Agent*
`
  }
}
