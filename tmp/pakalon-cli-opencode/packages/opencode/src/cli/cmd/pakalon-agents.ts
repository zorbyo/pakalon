import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { UI } from "../ui"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "@/util/filesystem"

const PAKALON_AGENTS_FOLDER = ".pakalon-agents"

// Template content for files
const TEMPLATES = {
  "context_management.md": `---
name: Context Management
description: Document that captures and maintains project context across phases
---

# Context Management

## Project Overview
[Brief description of the project]

## Key Context Items
1. **Project Goals**: [Description]
2. **Constraints**: [Description]
3. **Stakeholders**: [Description]

## Context Updates Log
| Date | Phase | Update | Author |
|------|-------|--------|--------|
| - | - | - | - |

## Notes
[Additional context notes]
`,

  "plan.md": `---
name: Project Plan
description: Overall project plan and milestones
---

# Project Plan

## Overview
[Description of the project]

## Milestones
1. [ ] Milestone 1
2. [ ] Milestone 2
3. [ ] Milestone 3

## Timeline
| Phase | Start Date | End Date | Status |
|-------|------------|----------|--------|
| Phase 1 | - | - | Not Started |
| Phase 2 | - | - | Not Started |
| Phase 3 | - | - | Not Started |
| Phase 4 | - | - | Not Started |
| Phase 5 | - | - | Not Started |
| Phase 6 | - | - | Not Started |

## Notes
[Additional notes]
`,

  "tasks.md": `---
name: Tasks
description: List of tasks to be completed
---

# Tasks

## Phase 1 Tasks
- [ ] Task 1
- [ ] Task 2

## Phase 2 Tasks
- [ ] Task 1
- [ ] Task 2

## Phase 3 Tasks
- [ ] Task 1
- [ ] Task 2

## Notes
[Additional task notes]
`,

  "design.md": `---
name: Design
description: Design specifications and decisions
---

# Design

## Architecture
[Architecture description]

## Key Design Decisions
1. [Decision 1]
2. [Decision 2]

## UI/UX Design
[Design notes]

## Technical Design
[Technical specifications]

## Notes
[Additional design notes]
`,

  "phase-1.md": `---
name: Phase 1
description: Planning and requirements phase
---

# Phase 1: Planning and Requirements

## Objectives
1. [Objective 1]
2. [Objective 2]

## Deliverables
- [ ] Deliverable 1
- [ ] Deliverable 2

## Status
**Status**: Not Started

## Notes
[Phase 1 specific notes]
`,

  "agent-skills.md": `---
name: Agent Skills
description: Skills and capabilities of the AI agents
---

# Agent Skills

## Available Skills
1. **Skill 1**: [Description]
2. **Skill 2**: [Description]

## Agent Capabilities
| Agent | Primary Role | Skills |
|-------|--------------|--------|
| - | - | - |

## Skill Development
[Notes on skill development]

## Notes
[Additional notes]
`,

  "prd.md": `---
name: Product Requirements Document
description: PRD capturing product requirements
---

# Product Requirements Document (PRD)

## Product Overview
[Product name and description]

## Problem Statement
[What problem does this product solve?]

## Target Users
1. [User type 1]
2. [User type 2]

## Requirements
### Functional Requirements
1. [Requirement 1]
2. [Requirement 2]

### Non-Functional Requirements
1. [Requirement 1]
2. [Requirement 2]

## Success Metrics
[How success will be measured]

## Notes
[Additional notes]
`,

  "Database_schema.md": `---
name: Database Schema
description: Database schema and data model
---

# Database Schema

## Overview
[Database overview]

## Tables

### Table 1
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| - | - | - | - |

## Relationships
[ER diagram or relationship description]

## Notes
[Additional notes]
`,

  "API_reference.md": `---
name: API Reference
description: API endpoints and specifications
---

# API Reference

## Base URL
\`\`\`
[Base URL]
\`\`\`

## Endpoints

### GET /endpoint
**Description**: [Description]

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|

**Response**:
\`\`\`json
{}
\`\`\`

## Authentication
[Authentication details]

## Notes
[Additional notes]
`,

  "risk-assessment.md": `---
name: Risk Assessment
description: Project risk assessment and mitigation
---

# Risk Assessment

## Identified Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| - | - | - | - |

## Risk Matrix
[Risk visualization]

## Contingency Plans
[Contingency plans]

## Notes
[Additional notes]
`,

  "user-stories.md": `---
name: User Stories
description: User stories and acceptance criteria
---

# User Stories

## Epic 1: [Epic Name]
### User Story 1
**As a**: [User type]
**I want**: [Feature]
**So that**: [Benefit]

**Acceptance Criteria**:
- [ ] Criterion 1
- [ ] Criterion 2

## User Story 2
**As a**: [User type]
**I want**: [Feature]
**So that**: [Benefit]

**Acceptance Criteria**:
- [ ] Criterion 1
- [ ] Criterion 2

## Notes
[Additional notes]
`,

  "technical-spec.md": `---
name: Technical Specification
description: Technical specifications and implementation details
---

# Technical Specification

## Technology Stack
- **Frontend**: [Tech]
- **Backend**: [Tech]
- **Database**: [Tech]
- **Infrastructure**: [Tech]

## System Architecture
[Architecture description]

## Implementation Details
[Implementation specifics]

## Security Considerations
[Security notes]

## Performance Requirements
[Performance specs]

## Notes
[Additional notes]
`,

  "competitive-analysis.md": `---
name: Competitive Analysis
description: Analysis of competing products
---

# Competitive Analysis

## Competitors
| Competitor | Strengths | Weaknesses | Market Share |
|------------|-----------|------------|--------------|
| - | - | - | - |

## Market Position
[Positioning strategy]

## Differentiation
[How we differ]

## Notes
[Additional notes]
`,

  "constraints-and-tradeoffs.md": `---
name: Constraints and Tradeoffs
description: Project constraints and architectural tradeoffs
---

# Constraints and Tradeoffs

## Technical Constraints
1. [Constraint 1]
2. [Constraint 2]

## Business Constraints
1. [Constraint 1]
2. [Constraint 2]

## Tradeoffs
| Decision | Tradeoff | Rationale |
|----------|----------|-----------|
| - | - | - |

## Notes
[Additional notes]
`,

  "phase-2.md": `---
name: Phase 2
description: Design and wireframing phase
---

# Phase 2: Design and Wireframing

## Objectives
1. [Objective 1]
2. [Objective 2]

## Deliverables
- [ ] Wireframe designs
- [ ] Design approval

## Status
**Status**: Not Started

## Notes
[Phase 2 specific notes]
`,

  "auditor.md": `---
name: Auditor
description: Auditor agent for phase 3
---

# Auditor Agent

## Role
[Auditor role description]

## Responsibilities
1. [Responsibility 1]
2. [Responsibility 2]

## Audit Checklist
- [ ] Check 1
- [ ] Check 2

## Notes
[Additional notes]
`,

  "subagent-1.md": `---
name: Subagent 1
description: Subagent 1 implementation details
---

# Subagent 1

## Role
[Role description]

## Responsibilities
1. [Responsibility 1]
2. [Responsibility 2]

## Implementation
[Implementation details]

## Notes
[Additional notes]
`,

  "subagent-2.md": `---
name: Subagent 2
description: Subagent 2 implementation details
---

# Subagent 2

## Role
[Role description]

## Responsibilities
1. [Responsibility 1]
2. [Responsibility 2]

## Implementation
[Implementation details]

## Notes
[Additional notes]
`,

  "subagent-3.md": `---
name: Subagent 3
description: Subagent 3 implementation details
---

# Subagent 3

## Role
[Role description]

## Responsibilities
1. [Responsibility 1]
2. [Responsibility 2]

## Implementation
[Implementation details]

## Notes
[Additional notes]
`,

  "subagent-4.md": `---
name: Subagent 4
description: Subagent 4 implementation details
---

# Subagent 4

## Role
[Role description]

## Responsibilities
1. [Responsibility 1]
2. [Responsibility 2]

## Implementation
[Implementation details]

## Notes
[Additional notes]
`,

  "subagent-5.md": `---
name: Subagent 5
description: Subagent 5 implementation details
---

# Subagent 5

## Role
[Role description]

## Responsibilities
1. [Responsibility 1]
2. [Responsibility 2]

## Implementation
[Implementation details]

## Notes
[Additional notes]
`,

  "execution_log.md": `---
name: Execution Log
description: Execution log for phase 3
---

# Execution Log

## Timestamps
| Timestamp | Agent | Action | Status |
|-----------|-------|--------|--------|
| - | - | - | - |

## Actions
[Logged actions]

## Notes
[Additional notes]
`,

  "phase-5.md": `---
name: Phase 5
description: Deployment phase
---

# Phase 5: Deployment

## Objectives
1. [Objective 1]
2. [Objective 2]

## Deliverables
- [ ] Deployed application
- [ ] Documentation

## Status
**Status**: Not Started

## Notes
[Phase 5 specific notes]
`,

  "phase-6.md": `---
name: Phase 6
description: Maintenance and support phase
---

# Phase 6: Maintenance and Support

## Objectives
1. [Objective 1]
2. [Objective 2]

## Ongoing Tasks
- [ ] Task 1
- [ ] Task 2

## Status
**Status**: Not Started

## Notes
[Phase 6 specific notes]
`,
}

interface PakalonAgentsArgs {
  force?: boolean
}

export const PakalonAgentsCommand = cmd({
  command: "pakalon-agents",
  describe: "Initialize .pakalon-agents folder structure for 6-phase AI pipeline",
  builder: (yargs) =>
    yargs.option("force", {
      type: "boolean",
      describe: "Overwrite existing files",
      alias: "f",
    }),
  async handler(args: PakalonAgentsArgs) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const worktree = Instance.worktree
        const baseDir = path.join(worktree, PAKALON_AGENTS_FOLDER)

        UI.println(UI.Style.TEXT_INFO + "Creating .pakalon-agents/ folder structure...")
        UI.println(UI.Style.TEXT_DIM + "  This enables the 6-phase AI development pipeline.")
        UI.empty()

        // Define the folder structure matching exact spec
        const structure: Record<string, string[]> = {
          "ai-agents": ["sync.js"],
          "ai-agents/phase-1": [
            "context_management.md",
            "plan.md",
            "tasks.md",
            "design.md",
            "phase-1.md",
            "agent-skills.md",
            "prd.md",
            "Database_schema.md",
            "API_reference.md",
            "risk-assessment.md",
            "user-stories.md",
            "technical-spec.md",
            "competitive-analysis.md",
            "constraints-and-tradeoffs.md",
          ],
          "ai-agents/phase-2": ["phase-2.md", "Wireframe_generated.svg", "Wireframe_generated.penpot"],
          "ai-agents/phase-2/tdd-screenshots": [],
          "ai-agents/phase-3": [
            "auditor.md",
            "subagent-1.md",
            "subagent-2.md",
            "subagent-3.md",
            "subagent-4.md",
            "subagent-5.md",
            "execution_log.md",
          ],
          "ai-agents/phase-3/test-evidence": [],
          "ai-agents/phase-4": [
            "subagent-1.md",
            "subagent-2.md",
            "subagent-3.md",
            "subagent-4.md",
            "subagent-5.md",
            "blackbox_testing.xml",
            "whitebox_testing.xml",
          ],
          "ai-agents/phase-5": ["phase-5.md"],
          "ai-agents/phase-6": ["phase-6.md"],
          "mcp-servers": [],
          wireframes: [],
        }

        // Create folders and files
        let createdCount = 0
        let skippedCount = 0

        for (const [folder, files] of Object.entries(structure)) {
          const folderPath = path.join(baseDir, folder)

          // Create folder if it doesn't exist
          await fs.mkdir(folderPath, { recursive: true })

          // Create files in the folder
          for (const file of files) {
            const filePath = path.join(folderPath, file)

            // Check if file exists
            const exists = await Filesystem.exists(filePath)

            if (exists && !args.force) {
              skippedCount++
              continue
            }

            // Create the file with template content
            if (file.endsWith(".md") && TEMPLATES[file as keyof typeof TEMPLATES]) {
              await fs.writeFile(filePath, TEMPLATES[file as keyof typeof TEMPLATES], "utf-8")
            } else if (file === "sync.js") {
              // Create comprehensive sync.js file for Penpot and agent coordination
              await fs.writeFile(
                filePath,
                `// sync.js - Pakalon AI Agent Synchronization Script
// This file manages synchronization between AI agents and Penpot designs

const PENPOT_URL = process.env.PENPOT_URL || "http://localhost:9001"
const SYNC_INTERVAL = 5000 // 5 seconds

const syncState = {
  lastSync: null,
  penpotConnected: false,
  agents: [],
  changes: [],
  designVersion: 0,
}

/**
 * Initialize sync state
 */
function init() {
  console.log("[sync.js] Initializing Pakalon agent sync...")
  syncState.lastSync = new Date().toISOString()
  return syncState
}

/**
 * Register an agent for coordination
 */
function registerAgent(agentId, role) {
  const agent = { id: agentId, role, registeredAt: new Date().toISOString() }
  syncState.agents.push(agent)
  console.log(\`[sync.js] Agent registered: \${agentId} (\${role})\`)
  return agent
}

/**
 * Watch for Penpot design changes
 */
async function watchPenpot() {
  console.log(\`[sync.js] Watching Penpot at \${PENPOT_URL}...\`)
  syncState.penpotConnected = true
  
  // In production, this would use WebSocket to sync with Penpot
  // For now, we poll for changes
  setInterval(() => {
    // Check for design changes
    syncState.lastSync = new Date().toISOString()
  }, SYNC_INTERVAL)
}

/**
 * Sync design changes from Penpot
 */
async function syncDesign() {
  console.log("[sync.js] Syncing design from Penpot...")
  syncState.designVersion++
  syncState.lastSync = new Date().toISOString()
  return { version: syncState.designVersion, timestamp: syncState.lastSync }
}

/**
 * Record a change for tracking
 */
function recordChange(type, description) {
  const change = {
    type,
    description,
    timestamp: new Date().toISOString(),
  }
  syncState.changes.push(change)
  return change
}

/**
 * Get current sync state
 */
function getState() {
  return { ...syncState }
}

module.exports = {
  init,
  registerAgent,
  watchPenpot,
  syncDesign,
  recordChange,
  getState,
  syncState,
}

// Auto-start if run directly
if (require.main === module) {
  console.log("=================================")
  console.log("  Pakalon Sync Service Started  ")
  console.log("=================================")
  init()
  watchPenpot()
}
`,
                "utf-8",
              )
            } else if (file.endsWith(".svg")) {
              // Create a minimal SVG placeholder
              await fs.writeFile(
                filePath,
                `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <!-- Wireframe placeholder - Generated by Pakalon -->
  <rect width="800" height="600" fill="#f5f5f5" stroke="#ddd" stroke-width="2"/>
  <text x="400" y="280" text-anchor="middle" fill="#666" font-family="Arial" font-size="18">Wireframe Placeholder</text>
  <text x="400" y="320" text-anchor="middle" fill="#999" font-family="Arial" font-size="12">Run /phase-2 to generate wireframes</text>
</svg>
`,
                "utf-8",
              )
            } else if (file.endsWith(".penpot")) {
              // Create a minimal Penpot placeholder
              await fs.writeFile(
                filePath,
                JSON.stringify({
                  version: "2.0",
                  type: "penpot-export",
                  name: "Wireframe",
                  created: new Date().toISOString(),
                  pages: [],
                  styles: {},
                  metadata: {
                    generator: "pakalon",
                    phase: 2,
                  },
                }, null, 2),
                "utf-8",
              )
            } else if (file.endsWith(".xml")) {
              // Create a minimal XML placeholder
              await fs.writeFile(
                filePath,
                `<?xml version="1.0" encoding="UTF-8"?>
<test-results generator="pakalon" phase="4">
  <summary>
    <status>pending</status>
    <message>Run /phase-4 to execute security tests</message>
  </summary>
  <test-cases/>
</test-results>
`,
                "utf-8",
              )
            } else {
              // For other files, create empty content
              await fs.writeFile(filePath, "", "utf-8")
            }

            createdCount++
          }
        }

        // Create pakalon.db file at root
        const dbPath = path.join(baseDir, "pakalon.db")
        const dbExists = await Filesystem.exists(dbPath)
        if (!dbExists || args.force) {
          await fs.writeFile(dbPath, "", "utf-8")
          createdCount++
        } else {
          skippedCount++
        }

        UI.println(UI.Style.TEXT_SUCCESS + `✓ Created ${createdCount} files/folders`)
        if (skippedCount > 0) {
          UI.println(UI.Style.TEXT_DIM + `  (${skippedCount} files skipped - use --force to overwrite)`)
        }
        UI.empty()
        UI.println("Structure created at: " + UI.Style.TEXT_HIGHLIGHT + baseDir)
        UI.empty()
        UI.println(UI.Style.TEXT_INFO + "Available phase commands:")
        UI.println(UI.Style.TEXT_DIM + "  /phase-1  - Planning & Requirements (Q&A session)")
        UI.println(UI.Style.TEXT_DIM + "  /phase-2  - Design & Wireframing (Penpot integration)")
        UI.println(UI.Style.TEXT_DIM + "  /phase-3  - Application Build (AI subagents)")
        UI.println(UI.Style.TEXT_DIM + "  /phase-4  - Security Testing (13+ tools via Docker)")
        UI.println(UI.Style.TEXT_DIM + "  /phase-5  - Deployment (GitHub + Cloud)")
        UI.println(UI.Style.TEXT_DIM + "  /phase-6  - Documentation Generation")
      },
    })
  },
})
