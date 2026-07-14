/**
 * Pakalon Phase Orchestrator
 * 
 * Manages the 6-phase agentic development pipeline:
 * Phase 1: Planning & Requirements
 * Phase 2: Wireframe Generation
 * Phase 3: Development & Implementation (SA1-SA5)
 * Phase 4: Testing & Quality Assurance
 * Phase 5: Deployment & Integration
 * Phase 6: Documentation & Maintenance
 */

import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "./index"
import { PakalonState as PersistedState } from "./state"
import { generateWithAI } from "./ai-generator"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "pakalon:orchestrator" })

// Keep PhaseState interface for backward compatibility
export interface PhaseState {
  currentPhase: Pakalon.PhaseNumber
  mode: "hil" | "yolo"
  projectPath: string
  phase1Complete: boolean
  phase2Complete: boolean
  phase3Complete: boolean
  phase4Complete: boolean
  phase5Complete: boolean
  phase6Complete: boolean
  auditorIterations: number
  maxAuditorIterations: number
}

export interface Phase1Artifacts {
  planMd: string
  tasksMd: string
  designMd: string
  prdMd: string
  userStoriesMd: string
  technicalSpecMd: string
  riskAssessmentMd: string
  contextManagementMd: string
  apiReferenceMd: string
  databaseSchemaMd: string
  agentSkillsMd: string
  competitiveAnalysisMd: string
  constraintsAndTradeoffsMd: string
  phase1Md: string
}

export interface Phase2Artifacts {
  phase2Md: string
  wireframeSvg: string
  wireframePenpot: string
}

export interface Phase3SubagentResult {
  subagentNumber: 1 | 2 | 3 | 4 | 5
  name: string
  markdownPath: string
  success: boolean
  output: string
}

export interface AIGenerationHookInput {
  fileName: string
  title: string
  instruction: string
  context: string
}

// Convert persisted state to PhaseState
function toPhaseState(state: Awaited<ReturnType<typeof PersistedState.load>>): PhaseState | undefined {
  if (!state) return undefined
  return {
    currentPhase: state.currentPhase,
    mode: state.mode,
    projectPath: state.metadata.projectPath,
    phase1Complete: state.phaseStatus[1] === "completed",
    phase2Complete: state.phaseStatus[2] === "completed",
    phase3Complete: state.phaseStatus[3] === "completed",
    phase4Complete: state.phaseStatus[4] === "completed",
    phase5Complete: state.phaseStatus[5] === "completed",
    phase6Complete: state.phaseStatus[6] === "completed",
    auditorIterations: 0,
    maxAuditorIterations: state.mode === "yolo" ? 10 : 5,
  }
}

export namespace PhaseOrchestrator {
  // In-memory cache for performance
  const memoryCache = new Map<string, PhaseState>()

  export async function getState(projectPath: string): Promise<PhaseState | undefined> {
    // Check memory cache first
    const cached = memoryCache.get(projectPath)
    if (cached) return cached

    // Load from disk
    const persisted = await PersistedState.load(projectPath)
    const state = toPhaseState(persisted)
    if (state) memoryCache.set(projectPath, state)
    return state
  }

  export async function initState(projectPath: string, mode: "hil" | "yolo"): Promise<PhaseState> {
    // Initialize persisted state
    const persisted = await PersistedState.init(projectPath, mode)
    
    // Convert to PhaseState
    const state = toPhaseState(persisted)!
    memoryCache.set(projectPath, state)
    
    log.info("State initialized", { projectPath, mode })
    return state
  }

  export async function ensureDirectoryStructure(projectPath: string): Promise<void> {
    const agentsDir = Pakalon.agentsDir(projectPath)
    const wireframesDir = path.join(projectPath, Pakalon.DIR_AGENTS, Pakalon.DIR_WIREFRAMES)
    const mcpDir = path.join(projectPath, Pakalon.DIR_AGENTS, Pakalon.DIR_MCP)

    // Create phase directories
    for (let i = 1; i <= 6; i++) {
      const phaseDir = path.join(agentsDir, `phase-${i}`)
      await fs.mkdir(phaseDir, { recursive: true })
    }

    // Create additional directories
    await fs.mkdir(wireframesDir, { recursive: true })
    await fs.mkdir(mcpDir, { recursive: true })

    // Create phase 2 subdirectories
    const phase2Dir = path.join(agentsDir, "phase-2")
    await fs.mkdir(path.join(phase2Dir, "tdd-screenshots"), { recursive: true })

    // Create phase 3 subdirectories
    const phase3Dir = path.join(agentsDir, "phase-3")
    await fs.mkdir(path.join(phase3Dir, "test-evidence"), { recursive: true })

    log.info("Directory structure created", { projectPath })
  }

  export function buildQAContext(qaResponses: Record<string, string>): string {
    const entries = Object.entries(qaResponses)
      .map(([key, value]) => `- ${key}: ${value || "(not provided)"}`)
      .join("\n")
    return `Q&A Responses:\n${entries}`
  }

  export async function generateArtifactWithAI(input: AIGenerationHookInput): Promise<string> {
    const markdown = await generateWithAI(input.instruction, input.context)
    const trimmed = markdown.trim()
    if (trimmed.length > 0) return trimmed

    return `# ${input.title}\n\nAI generation returned no content for ${input.fileName}.`
  }

  export async function generatePhase1Artifacts(
    projectPath: string,
    userInput: string,
    qaResponses: Record<string, string>,
  ): Promise<Phase1Artifacts> {
    const phase1Dir = path.join(Pakalon.agentsDir(projectPath), "phase-1")

    const artifacts: Phase1Artifacts = {
      planMd: "",
      tasksMd: "",
      designMd: "",
      prdMd: "",
      userStoriesMd: "",
      technicalSpecMd: "",
      riskAssessmentMd: "",
      contextManagementMd: "",
      apiReferenceMd: "",
      databaseSchemaMd: "",
      agentSkillsMd: "",
      competitiveAnalysisMd: "",
      constraintsAndTradeoffsMd: "",
      phase1Md: "",
    }

    // Generate plan.md
    artifacts.planMd = generatePlanMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "plan.md"), artifacts.planMd)

    // Generate tasks.md
    artifacts.tasksMd = generateTasksMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "tasks.md"), artifacts.tasksMd)

    // Generate design.md
    artifacts.designMd = generateDesignMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "design.md"), artifacts.designMd)

    // Generate prd.md
    artifacts.prdMd = generatePrdMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "prd.md"), artifacts.prdMd)

    // Generate user-stories.md
    artifacts.userStoriesMd = generateUserStoriesMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "user-stories.md"), artifacts.userStoriesMd)

    // Generate technical-spec.md
    artifacts.technicalSpecMd = generateTechnicalSpecMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "technical-spec.md"), artifacts.technicalSpecMd)

    // Generate risk-assessment.md
    artifacts.riskAssessmentMd = generateRiskAssessmentMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "risk-assessment.md"), artifacts.riskAssessmentMd)

    // Generate context-management.md
    artifacts.contextManagementMd = generateContextManagementMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "context-management.md"), artifacts.contextManagementMd)

    // Generate API_reference.md
    artifacts.apiReferenceMd = generateApiReferenceMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "API_reference.md"), artifacts.apiReferenceMd)

    // Generate Database_schema.md
    artifacts.databaseSchemaMd = generateDatabaseSchemaMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "Database_schema.md"), artifacts.databaseSchemaMd)

    // Generate agent-skills.md
    artifacts.agentSkillsMd = generateAgentSkillsMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "agent-skills.md"), artifacts.agentSkillsMd)

    // Generate competitive-analysis.md
    artifacts.competitiveAnalysisMd = generateCompetitiveAnalysisMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "competitive-analysis.md"), artifacts.competitiveAnalysisMd)

    // Generate constraints-and-tradeoffs.md
    artifacts.constraintsAndTradeoffsMd = generateConstraintsAndTradeoffsMd(userInput, qaResponses)
    await fs.writeFile(path.join(phase1Dir, "constraints-and-tradeoffs.md"), artifacts.constraintsAndTradeoffsMd)

    // Generate phase-1.md (summary)
    artifacts.phase1Md = generatePhase1SummaryMd(artifacts)
    await fs.writeFile(path.join(phase1Dir, "phase-1.md"), artifacts.phase1Md)

    log.info("Phase 1 artifacts generated", { projectPath, files: Object.keys(artifacts).length })
    return artifacts
  }

  export async function advancePhase(projectPath: string): Promise<Pakalon.PhaseNumber | null> {
    const s = memoryCache.get(projectPath)
    if (!s) return null

    const currentPhase = s.currentPhase
    let nextPhase: Pakalon.PhaseNumber | null = null

    switch (currentPhase) {
      case 1:
        s.phase1Complete = true
        s.currentPhase = 2
        nextPhase = 2
        break
      case 2:
        s.phase2Complete = true
        s.currentPhase = 3
        nextPhase = 3
        break
      case 3:
        s.phase3Complete = true
        s.currentPhase = 4
        nextPhase = 4
        break
      case 4:
        s.phase4Complete = true
        s.currentPhase = 5
        nextPhase = 5
        break
      case 5:
        s.phase5Complete = true
        s.currentPhase = 6
        nextPhase = 6
        break
      case 6:
        s.phase6Complete = true
        nextPhase = null // Pipeline complete
        break
    }

    // Persist state change
    await PersistedState.updatePhaseStatus(projectPath, currentPhase, "completed")
    if (nextPhase) {
      await PersistedState.updatePhaseStatus(projectPath, nextPhase, "in_progress")
    }

    memoryCache.set(projectPath, s)
    log.info("Advanced to phase", { projectPath, phase: s.currentPhase })
    return s.currentPhase
  }

  export async function canAdvance(projectPath: string): Promise<boolean> {
    const s = await getState(projectPath)
    if (!s) return false
    return s.currentPhase < 6
  }

  export async function isComplete(projectPath: string): Promise<boolean> {
    const s = await getState(projectPath)
    if (!s) return false
    return s.phase6Complete
  }

  // Auditor loop management
  export async function incrementAuditorIteration(projectPath: string): Promise<boolean> {
    const s = memoryCache.get(projectPath)
    if (!s) return false
    s.auditorIterations++
    memoryCache.set(projectPath, s)
    return s.auditorIterations < s.maxAuditorIterations
  }

  export async function resetAuditorIterations(projectPath: string): Promise<void> {
    const s = memoryCache.get(projectPath)
    if (s) {
      s.auditorIterations = 0
      memoryCache.set(projectPath, s)
    }
  }
}

// Artifact generation functions
function generatePlanMd(userInput: string, qaResponses: Record<string, string>): string {
  const techStack = qaResponses["tech_stack"] || "To be determined"
  const frontend = qaResponses["frontend"] || "To be determined"
  const backend = qaResponses["backend"] || "To be determined"
  const database = qaResponses["database"] || "To be determined"

  return `# Project Plan

## Overview
${userInput}

## Requirements Summary
Based on the interactive Q&A session, the following requirements have been gathered:

### Technology Stack
- **Frontend**: ${frontend}
- **Backend**: ${backend}
- **Database**: ${database}
- **Full Stack**: ${techStack}

### Key Features
${Object.entries(qaResponses).map(([key, value]) => `- **${key}**: ${value}`).join("\n")}

## Architecture Overview
The application will follow a modern, scalable architecture with clear separation of concerns.

### Frontend Architecture
- Component-based UI framework
- State management solution
- Responsive design patterns
- Modern CSS framework (Tailwind CSS)

### Backend Architecture
- RESTful API design
- Authentication & Authorization
- Database integration
- Error handling & logging

### Integration Points
- API contracts defined in API_reference.md
- Database schemas defined in Database_schema.md
- Design specifications in design.md

## Milestones
1. **Phase 1**: Planning & Requirements ✅
2. **Phase 2**: Wireframe Generation
3. **Phase 3**: Development & Implementation
4. **Phase 4**: Testing & Quality Assurance
5. **Phase 5**: Deployment & Integration
6. **Phase 6**: Documentation & Maintenance

## Success Criteria
- All user stories implemented and tested
- Performance benchmarks met
- Security requirements satisfied
- Documentation complete and accurate

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateTasksMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Task Breakdown

## Phase 1: Planning & Requirements
- [x] Gather user requirements
- [x] Define technology stack
- [x] Create project plan
- [x] Generate user stories
- [x] Define API contracts
- [x] Design database schema

## Phase 2: Wireframe Generation
- [ ] Create wireframes for all pages
- [ ] Design component hierarchy
- [ ] Define responsive breakpoints
- [ ] Generate design assets

## Phase 3: Development & Implementation

### Subagent 1: Frontend Designing
- [ ] Set up frontend project structure
- [ ] Implement UI components
- [ ] Style with Tailwind CSS
- [ ] Integrate with design system

### Subagent 2: Backend Framing
- [ ] Set up backend project structure
- [ ] Implement API endpoints
- [ ] Set up database connections
- [ ] Implement authentication

### Subagent 3: Frontend & Backend Integration
- [ ] Connect frontend to backend APIs
- [ ] Implement real-time features
- [ ] Handle error states
- [ ] Optimize data flow

### Subagent 4: Bug Fixing & Debugging
- [ ] Run automated tests
- [ ] Fix identified bugs
- [ ] Performance optimization
- [ ] Code quality improvements

### Subagent 5: Feedback & Review
- [ ] User acceptance testing
- [ ] Gather feedback
- [ ] Implement requested changes
- [ ] Final validation

## Phase 4: Testing & Quality Assurance
- [ ] Run SAST tools (Semgrep, Bandit, Gitleaks)
- [ ] Run DAST tools (OWASP ZAP, Nikto)
- [ ] Perform code review
- [ ] Security testing
- [ ] Performance testing

## Phase 5: Deployment & Integration
- [ ] Set up CI/CD pipeline
- [ ] Configure deployment environment
- [ ] Deploy application
- [ ] Monitor deployment

## Phase 6: Documentation
- [ ] Generate API documentation
- [ ] Create user guide
- [ ] Write README
- [ ] Document deployment process

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateDesignMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Design Specifications

## Design System

### Color Palette
- **Primary**: #6366f1 (Indigo)
- **Secondary**: #8b5cf6 (Violet)
- **Accent**: #a78bfa (Light Violet)
- **Success**: #10b981 (Emerald)
- **Warning**: #f59e0b (Amber)
- **Error**: #ef4444 (Red)
- **Info**: #3b82f6 (Blue)

### Typography
- **Headings**: Inter, system-ui, sans-serif
- **Body**: Inter, system-ui, sans-serif
- **Monospace**: JetBrains Mono, monospace

### Spacing Scale
- xs: 4px
- sm: 8px
- md: 16px
- lg: 24px
- xl: 32px
- 2xl: 48px

### Border Radius
- sm: 4px
- md: 8px
- lg: 12px
- full: 9999px

## Component Library
Using **Shadcn UI** with **Radix UI** primitives:
- Button variants (primary, secondary, outline, ghost)
- Form inputs (text, select, checkbox, radio)
- Cards and containers
- Navigation components
- Modal and dialog components
- Toast notifications

## Responsive Design
- **Mobile**: < 640px
- **Tablet**: 640px - 1024px
- **Desktop**: > 1024px

## Accessibility
- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader compatibility
- High contrast mode support

## Animation & Transitions
- Smooth transitions (200-300ms)
- Micro-interactions for feedback
- Loading states and skeletons
- Page transitions

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generatePrdMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Product Requirements Document (PRD)

## Product Overview
${userInput}

## Problem Statement
Define the problem this application solves for its target users.

## Target Audience
${qaResponses["target_audience"] || "General users seeking the solution described above"}

## User Personas

### Primary User
- **Goals**: Complete core tasks efficiently
- **Pain Points**: Existing solutions are complex or expensive
- **Technical Level**: ${qaResponses["technical_level"] || "Intermediate"}

### Secondary User
- **Goals**: Administrative and management tasks
- **Pain Points**: Lack of visibility and control
- **Technical Level**: Advanced

## Functional Requirements

### Core Features
1. User authentication and authorization
2. Core business logic implementation
3. Data management and persistence
4. Real-time updates and notifications

### Nice-to-Have Features
1. Advanced analytics and reporting
2. Integration with third-party services
3. Mobile application support
4. Offline functionality

## Non-Functional Requirements

### Performance
- Page load time < 2 seconds
- API response time < 200ms
- Support for 1000+ concurrent users

### Security
- HTTPS everywhere
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- CSRF protection

### Scalability
- Horizontal scaling support
- Database optimization
- Caching strategy
- CDN integration

## Success Metrics
- User engagement rate
- Task completion rate
- Error rate < 1%
- Customer satisfaction score

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateUserStoriesMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# User Stories

## Epic 1: User Management

### US-001: User Registration
**As a** new user  
**I want to** create an account  
**So that** I can access the application features  

**Acceptance Criteria:**
- User can register with email/password
- Email verification is required
- Password meets security requirements
- User receives welcome email

**Test Scenarios:**
- Valid registration flow
- Invalid email format
- Weak password rejection
- Duplicate email handling

### US-002: User Login
**As a** registered user  
**I want to** log into my account  
**So that** I can access my data  

**Acceptance Criteria:**
- User can login with email/password
- Session is maintained securely
- "Remember me" option available
- Password reset available

**Test Scenarios:**
- Valid login flow
- Invalid credentials
- Account lockout after failed attempts
- Password reset flow

## Epic 2: Core Functionality

### US-003: [Core Feature 1]
**As a** user  
**I want to** [action]  
**So that** [benefit]  

**Acceptance Criteria:**
- [Criterion 1]
- [Criterion 2]
- [Criterion 3]

**Test Scenarios:**
- [Scenario 1]
- [Scenario 2]

### US-004: [Core Feature 2]
**As a** user  
**I want to** [action]  
**So that** [benefit]  

**Acceptance Criteria:**
- [Criterion 1]
- [Criterion 2]

**Test Scenarios:**
- [Scenario 1]
- [Scenario 2]

## Epic 3: Data Management

### US-005: View Data
**As a** user  
**I want to** view my data  
**So that** I can make informed decisions  

**Acceptance Criteria:**
- Data is displayed accurately
- Loading states are shown
- Error states are handled
- Data is paginated if large

### US-006: Export Data
**As a** user  
**I want to** export my data  
**So that** I can use it elsewhere  

**Acceptance Criteria:**
- Export to CSV/JSON formats
- All data fields included
- Export completes within 30 seconds

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateTechnicalSpecMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Technical Specification

## System Architecture

### High-Level Architecture
\`\`\`
┌─────────────────────────────────────────────────┐
│                    Frontend                      │
│  ${qaResponses["frontend"] || "React/Next.js"} │
└─────────────────────┬───────────────────────────┘
                      │ HTTPS REST
                      ▼
┌─────────────────────────────────────────────────┐
│                    Backend                       │
│  ${qaResponses["backend"] || "Node.js/Express"} │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│                   Database                       │
│  ${qaResponses["database"] || "PostgreSQL"}      │
└─────────────────────────────────────────────────┘
\`\`\`

## API Design

### RESTful Endpoints
- GET /api/resources - List resources
- POST /api/resources - Create resource
- GET /api/resources/:id - Get resource
- PUT /api/resources/:id - Update resource
- DELETE /api/resources/:id - Delete resource

### Authentication
- JWT-based authentication
- Token refresh mechanism
- Role-based access control (RBAC)

## Database Design
See [Database_schema.md](./Database_schema.md) for detailed schema.

## Technology Stack

### Frontend
- Framework: ${qaResponses["frontend"] || "React with Next.js"}
- Styling: Tailwind CSS + Shadcn UI
- State Management: Zustand / React Query
- Build Tool: Vite / Next.js built-in

### Backend
- Runtime: ${qaResponses["backend"] || "Node.js"}
- Framework: Express / Fastify
- ORM: Prisma / Drizzle
- Validation: Zod

### Infrastructure
- Hosting: Vercel / AWS
- Database: ${qaResponses["database"] || "PostgreSQL"}
- Cache: Redis
- CDN: CloudFront / Cloudflare

## Security Considerations
- Input validation on all endpoints
- SQL injection prevention via ORM
- XSS protection via Content Security Policy
- CORS configuration
- Rate limiting
- HTTPS only

## Performance Requirements
- API response time: < 200ms (p95)
- Page load time: < 2s (FCP)
- Database query time: < 100ms (p95)
- Uptime: 99.9%

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateRiskAssessmentMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Risk Assessment

## Technical Risks

### HIGH: Database Performance
- **Risk**: Database queries may become slow as data grows
- **Impact**: Poor user experience, potential downtime
- **Mitigation**: 
  - Implement database indexing
  - Use connection pooling
  - Implement caching layer
  - Monitor query performance

### MEDIUM: Third-Party Dependencies
- **Risk**: External services may become unavailable
- **Impact**: Feature degradation or outage
- **Mitigation**:
  - Implement fallback mechanisms
  - Use multiple providers where possible
  - Monitor service health
  - Cache critical data

### MEDIUM: Security Vulnerabilities
- **Risk**: Application may have security flaws
- **Impact**: Data breach, reputation damage
- **Mitigation**:
  - Regular security audits
  - Automated vulnerability scanning
  - Input validation
  - Security headers

## Business Risks

### HIGH: Scope Creep
- **Risk**: Requirements may expand beyond initial scope
- **Impact**: Timeline delays, budget overruns
- **Mitigation**:
  - Clear requirement documentation
  - Regular stakeholder reviews
  - Change management process

### LOW: Technology Obsolescence
- **Risk**: Chosen technologies may become outdated
- **Impact**: Maintenance difficulties, recruitment challenges
- **Mitigation**:
  - Choose widely-adopted technologies
  - Regular dependency updates
  - Modular architecture

## Operational Risks

### MEDIUM: Deployment Failures
- **Risk**: Deployment may cause downtime
- **Impact**: Service interruption
- **Mitigation**:
  - Blue-green deployments
  - Automated rollback
  - Staging environment testing
  - Feature flags

### LOW: Data Loss
- **Risk**: Data may be lost due to system failure
- **Impact**: Business continuity issues
- **Mitigation**:
  - Regular backups
  - Geographic redundancy
  - Disaster recovery plan

## Risk Matrix

| Risk | Probability | Impact | Severity |
|------|-------------|--------|----------|
| Database Performance | Medium | High | HIGH |
| Third-Party Dependencies | Medium | Medium | MEDIUM |
| Security Vulnerabilities | Low | High | MEDIUM |
| Scope Creep | High | Medium | HIGH |
| Deployment Failures | Medium | Medium | MEDIUM |

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateContextManagementMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Context Management

## Token Budget Allocation

### Overview
This document defines how context tokens are allocated across phases and agents to ensure efficient use of AI model context windows.

### Total Context Budget
- **Available Context**: Based on selected model
- **Buffer**: 10% reserved for unexpected needs
- **Usable Context**: 90% of total

## Phase-wise Token Allocation

### Phase 1: Planning & Requirements
- **Allocation**: 15% of total context
- **Purpose**: Requirements gathering, Q&A, documentation
- **Key Files**: plan.md, tasks.md, design.md, prd.md

### Phase 2: Wireframe Generation
- **Allocation**: 10% of total context
- **Purpose**: Design analysis, wireframe generation
- **Key Files**: phase-2.md, wireframe files

### Phase 3: Development & Implementation
- **Allocation**: 50% of total context
- **Purpose**: Code generation, integration, debugging
- **Subagent Allocation**:
  - SA1 (Frontend): 12%
  - SA2 (Backend): 12%
  - SA3 (Integration): 10%
  - SA4 (Debug): 8%
  - SA5 (Review): 8%

### Phase 4: Testing & QA
- **Allocation**: 15% of total context
- **Purpose**: Security testing, code review, QA

### Phase 5: Deployment
- **Allocation**: 5% of total context
- **Purpose**: CI/CD setup, deployment configuration

### Phase 6: Documentation
- **Allocation**: 5% of total context
- **Purpose**: Documentation generation

## Context Optimization Strategies

### 1. File Chunking
- Read files in chunks rather than entirely
- Use line ranges for large files
- Summarize when full content not needed

### 2. Selective Context
- Only load relevant files for current task
- Use grep/search to find specific content
- Avoid loading entire codebases

### 3. Context Compression
- Summarize completed work before next phase
- Use structured data over verbose text
- Reference files instead of inlining content

### 4. Parallel Processing
- Use subagents for independent tasks
- Minimize shared context between agents
- Aggregate results at coordination points

## Token Usage Tracking

### Per-Phase Tracking
Each phase should track:
- Tokens consumed
- Files processed
- Actions taken
- Errors encountered

### Reporting
- Daily token usage summary
- Per-session breakdown
- Cost estimation

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateApiReferenceMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# API Reference

## Base URL
\`\`\`
https://api.example.com/v1
\`\`\`

## Authentication

### JWT Token
All authenticated endpoints require a JWT token in the Authorization header:
\`\`\`
Authorization: Bearer <token>
\`\`\`

### Endpoints

#### POST /auth/register
Register a new user account.

**Request Body:**
\`\`\`json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "John Doe"
}
\`\`\`

**Response (201):**
\`\`\`json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "createdAt": "2024-01-01T00:00:00Z"
}
\`\`\`

#### POST /auth/login
Authenticate and receive JWT token.

**Request Body:**
\`\`\`json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
\`\`\`

**Response (200):**
\`\`\`json
{
  "token": "jwt_token_here",
  "refreshToken": "refresh_token_here",
  "expiresIn": 3600
}
\`\`\`

## Resources

### GET /resources
List all resources (paginated).

**Query Parameters:**
- \`page\` (number): Page number (default: 1)
- \`limit\` (number): Items per page (default: 20)
- \`sort\` (string): Sort field (default: createdAt)
- \`order\` (string): Sort order - asc/desc (default: desc)

**Response (200):**
\`\`\`json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5
  }
}
\`\`\`

### POST /resources
Create a new resource.

**Request Body:**
\`\`\`json
{
  "name": "Resource Name",
  "description": "Resource description",
  "metadata": {}
}
\`\`\`

**Response (201):**
\`\`\`json
{
  "id": "uuid",
  "name": "Resource Name",
  "description": "Resource description",
  "metadata": {},
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
\`\`\`

### GET /resources/:id
Get a specific resource.

**Response (200):**
\`\`\`json
{
  "id": "uuid",
  "name": "Resource Name",
  "description": "Resource description",
  "metadata": {},
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
\`\`\`

### PUT /resources/:id
Update a resource.

**Request Body:**
\`\`\`json
{
  "name": "Updated Name",
  "description": "Updated description"
}
\`\`\`

### DELETE /resources/:id
Delete a resource.

**Response (204):** No content

## Error Responses

### 400 Bad Request
\`\`\`json
{
  "error": "Validation Error",
  "message": "Invalid request body",
  "details": [...]
}
\`\`\`

### 401 Unauthorized
\`\`\`json
{
  "error": "Unauthorized",
  "message": "Invalid or expired token"
}
\`\`\`

### 404 Not Found
\`\`\`json
{
  "error": "Not Found",
  "message": "Resource not found"
}
\`\`\`

### 500 Internal Server Error
\`\`\`json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred"
}
\`\`\`

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateDatabaseSchemaMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Database Schema

## Overview
Database: ${qaResponses["database"] || "PostgreSQL 16"}
ORM: Prisma / Drizzle ORM

## Tables

### users
Stores user account information.

\`\`\`sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created_at ON users(created_at);
\`\`\`

### sessions
Stores user sessions for authentication.

\`\`\`sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
\`\`\`

### resources
Stores main application resources.

\`\`\`sql
CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_resources_user_id ON resources(user_id);
CREATE INDEX idx_resources_status ON resources(status);
CREATE INDEX idx_resources_created_at ON resources(created_at);
\`\`\`

### audit_logs
Tracks all significant actions for audit purposes.

\`\`\`sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100),
  resource_id UUID,
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
\`\`\`

## Relationships

\`\`\`
users 1──N sessions
users 1──N resources
users 1──N audit_logs
\`\`\`

## Migrations
Migrations are managed using Prisma Migrate or Drizzle Kit.

### Running Migrations
\`\`\`bash
# Prisma
npx prisma migrate dev

# Drizzle
npx drizzle-kit push
\`\`\`

## Indexing Strategy
- Primary keys: UUID with auto-generation
- Foreign keys: Indexed for join performance
- Search fields: Indexed for query performance
- Timestamps: Indexed for sorting and filtering

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateAgentSkillsMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Agent Skills

## Overview
This document defines the skills and capabilities required for AI agents working on this project.

## Core Skills

### 1. Frontend Development
- React/Next.js component development
- Tailwind CSS styling
- State management (Zustand, React Query)
- Responsive design implementation
- Accessibility (WCAG 2.1)

### 2. Backend Development
- RESTful API design
- Database schema design
- Authentication implementation
- Error handling and logging
- Performance optimization

### 3. Full-Stack Integration
- API client implementation
- Real-time data synchronization
- Error state handling
- Loading state management
- Optimistic updates

### 4. Testing
- Unit testing (Jest, Vitest)
- Integration testing
- End-to-end testing (Playwright)
- Security testing
- Performance testing

### 5. DevOps
- CI/CD pipeline configuration
- Docker containerization
- Cloud deployment (Vercel, AWS)
- Monitoring and logging
- Database migrations

## Recommended Agent Skills

Based on the project requirements, the following agent skills from vercel-labs/agent-skills are recommended:

### UI/UX Skills
- \`ui-ux-pro-max-skill\`: Advanced UI/UX design patterns
- Component library integration
- Design system implementation

### Development Skills
- Full-stack development patterns
- API integration patterns
- Database optimization

## Skill Loading
Skills should be loaded based on the current phase:
- Phase 1: Planning and requirements skills
- Phase 2: Design and wireframe skills
- Phase 3: Development skills (per subagent)
- Phase 4: Testing and security skills
- Phase 5: DevOps and deployment skills
- Phase 6: Documentation skills

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateCompetitiveAnalysisMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Competitive Analysis

## Market Overview
Analysis of existing solutions in the market for ${userInput.slice(0, 100)}...

## Competitor Analysis

### Competitor 1: [Name]
- **Strengths**: Feature-rich, established brand
- **Weaknesses**: Complex UI, expensive pricing
- **Market Share**: High
- **Key Features**: [List features]

### Competitor 2: [Name]
- **Strengths**: Simple, affordable
- **Weaknesses**: Limited features, poor support
- **Market Share**: Medium
- **Key Features**: [List features]

### Competitor 3: [Name]
- **Strengths**: Modern tech stack, good UX
- **Weaknesses**: New entrant, limited integrations
- **Market Share**: Low (growing)
- **Key Features**: [List features]

## Feature Comparison

| Feature | Competitor 1 | Competitor 2 | Competitor 3 | Our Solution |
|---------|--------------|--------------|--------------|--------------|
| Feature A | ✅ | ❌ | ✅ | ✅ |
| Feature B | ✅ | ✅ | ❌ | ✅ |
| Feature C | ❌ | ❌ | ✅ | ✅ |
| Pricing | $$$$ | $$ | $$$ | $$ |

## Differentiation Strategy
Our solution differentiates through:
1. **Better UX**: Modern, intuitive interface
2. **Competitive Pricing**: Value for money
3. **Performance**: Faster and more reliable
4. **Integration**: Better third-party integrations
5. **Support**: Superior customer support

## Market Opportunity
- Total Addressable Market (TAM): $X billion
- Serviceable Addressable Market (SAM): $Y million
- Serviceable Obtainable Market (SOM): $Z thousand

## Go-to-Market Strategy
1. Launch with core features
2. Target early adopters
3. Gather feedback and iterate
4. Expand feature set
5. Scale marketing efforts

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generateConstraintsAndTradeoffsMd(userInput: string, qaResponses: Record<string, string>): string {
  return `# Constraints and Tradeoffs

## Technical Constraints

### 1. Technology Stack
- **Constraint**: Must use ${qaResponses["frontend"] || "React"} for frontend
- **Tradeoff**: Limits component library options but ensures consistency
- **Decision**: Accepted for team expertise and ecosystem

### 2. Database
- **Constraint**: Must use ${qaResponses["database"] || "PostgreSQL"}
- **Tradeoff**: Less flexibility than NoSQL for unstructured data
- **Decision**: Chosen for ACID compliance and relational data model

### 3. Hosting
- **Constraint**: Budget limitations on hosting costs
- **Tradeoff**: May limit scalability initially
- **Decision**: Start with cost-effective solution, scale as needed

## Resource Constraints

### 1. Timeline
- **Constraint**: Limited development timeline
- **Tradeoff**: May need to defer nice-to-have features
- **Decision**: Focus on MVP, iterate post-launch

### 2. Team Size
- **Constraint**: Small development team
- **Tradeoff**: Slower feature development
- **Decision**: Use AI agents to accelerate development

### 3. Budget
- **Constraint**: Limited budget for third-party services
- **Tradeoff**: May need to build vs. buy some features
- **Decision**: Prioritize based on core value

## Design Tradeoffs

### 1. Simplicity vs. Features
- **Tradeoff**: More features increase complexity
- **Decision**: Start simple, add features based on user feedback

### 2. Performance vs. Functionality
- **Tradeoff**: More functionality can impact performance
- **Decision**: Optimize critical paths, lazy-load non-critical features

### 3. Security vs. Usability
- **Tradeoff**: Strict security can reduce usability
- **Decision**: Balance security measures with user experience

## Accepted Tradeoffs

1. **MVP Focus**: Launch with core features, expand later
2. **Monolith First**: Start with monolith, microservices later if needed
3. **Manual Processes**: Some processes manual initially, automate over time
4. **Limited Analytics**: Basic analytics initially, advanced later

## Future Considerations

### Phase 2 Enhancements
- Advanced analytics dashboard
- Real-time collaboration features
- Mobile application
- API for third-party integrations

### Scalability Path
1. Optimize database queries
2. Implement caching layer
3. Add read replicas
4. Consider microservices architecture

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

function generatePhase1SummaryMd(artifacts: Phase1Artifacts): string {
  return `# Phase 1 Summary: Planning & Requirements

## Completion Status
All Phase 1 artifacts have been generated successfully.

## Generated Documents

### Core Documents
1. **plan.md** - Overall project plan and architecture
2. **tasks.md** - Task breakdown across all phases
3. **design.md** - Design specifications and system

### Technical Documents
4. **prd.md** - Product Requirements Document
5. **technical-spec.md** - Technical specification
6. **API_reference.md** - API endpoint documentation
7. **Database_schema.md** - Database schema definitions

### Analysis Documents
8. **user-stories.md** - User stories with acceptance criteria
9. **risk-assessment.md** - Risk analysis and mitigation
10. **competitive-analysis.md** - Market and competitor analysis
11. **constraints-and-tradeoffs.md** - Project constraints

### Agent Documents
12. **agent-skills.md** - Required agent capabilities
13. **context-management.md** - Token budget allocation

## Next Steps
1. Review all generated documents
2. Make any necessary adjustments
3. Approve to proceed to Phase 2 (Wireframe Generation)

## Phase 2 Preview
Phase 2 will focus on:
- Creating wireframes based on design.md specifications
- Generating SVG and Penpot design files
- TDD screenshots for validation
- User approval before proceeding to development

---
*Generated by Pakalon Phase 1 Agent*
*Date: ${new Date().toISOString()}*
`
}

export default PhaseOrchestrator
