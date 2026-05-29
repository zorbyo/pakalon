/**
 * File Structure Template for Pakalon Agents
 * 
 * This module provides the complete .pakalon-agents/ folder structure
 * as defined in the requirements.
 * 
 * Structure:
 * {project-name}/
 * ├── .pakalon-agents/
 * │   ├── ai-agents/
 * │   │   ├── phase-1/
 * │   │   │   ├── context_management.md
 * │   │   │   ├── plan.md
 * │   │   │   ├── tasks.md
 * │   │   │   ├── design.md
 * │   │   │   ├── phase-1.md
 * │   │   │   ├── agent-skills.md
 * │   │   │   ├── prd.md
 * │   │   │   ├── Database_schema.md
 * │   │   │   ├── API_reference.md
 * │   │   │   ├── risk-assessment.md
 * │   │   │   ├── user-stories.md
 * │   │   │   ├── technical-spec.md
 * │   │   │   ├── competitive-analysis.md
 * │   │   │   └── constraints-and-tradeoffs.md
 * │   │   ├── phase-2/
 * │   │   │   ├── phase-2.md
 * │   │   │   ├── Wireframe_generated.svg
 * │   │   │   ├── Wireframe_generated.penpot
 * │   │   │   └── tdd-screenshots/
 * │   │   ├── phase-3/
 * │   │   │   ├── subagent-1.md
 * │   │   │   ├── subagent-2.md
 * │   │   │   ├── subagent-3.md
 * │   │   │   ├── subagent-4.md
 * │   │   │   ├── subagent-5.md
 * │   │   │   ├── execution_log.md
 * │   │   │   └── test-evidence/
 * │   │   ├── phase-4/
 * │   │   │   ├── subagent-1.md
 * │   │   │   ├── subagent-2.md
 * │   │   │   ├── subagent-3.md
 * │   │   │   ├── subagent-4.md
 * │   │   │   ├── subagent-5.md
 * │   │   │   ├── blackbox_testing.xml
 * │   │   │   └── whitebox_testing.xml
 * │   │   ├── phase-5/
 * │   │   │   └── phase-5.md
 * │   │   └── phase-6/
 * │   │       └── phase-6.md
 * │   ├── mcp-servers/
 * │   ├── wireframes/
 * │   └── pakalon.db
 * └── (visible project files - code, README, etc.)
 */

import fs from "fs";
import path from "path";

export interface PakalonAgentsConfig {
  projectDir: string;
  projectName: string;
}

/**
 * Get the complete folder structure as an array of paths
 */
export function getAgentsFolderStructure(config: PakalonAgentsConfig): string[] {
  const { projectDir, projectName } = config;
  const base = path.join(projectDir, ".pakalon-agents");
  
  return [
    // Main directories
    path.join(base, "ai-agents", "phase-1"),
    path.join(base, "ai-agents", "phase-2"),
    path.join(base, "ai-agents", "phase-3"),
    path.join(base, "ai-agents", "phase-4"),
    path.join(base, "ai-agents", "phase-5"),
    path.join(base, "ai-agents", "phase-6"),
    path.join(base, "mcp-servers"),
    path.join(base, "wireframes"),
    
    // Phase 2 subdirectories
    path.join(base, "ai-agents", "phase-2", "tdd-screenshots"),
    
    // Phase 3 subdirectories
    path.join(base, "ai-agents", "phase-3", "test-evidence"),
  ];
}

/**
 * Get all files with their initial content
 */
export function getAgentsFiles(config: PakalonAgentsConfig): Array<{ path: string; content: string }> {
  const { projectName, projectDir } = config;
  const base = path.join(projectDir, ".pakalon-agents");
  
  return [
    // Top-level metadata DB placeholder (created on scaffold init)
    {
      path: path.join(base, "pakalon.db"),
      content: "",
    },

    // Sync.js - Penpot lifecycle-aware sync bridge launcher (project-local stub)
    {
      path: path.join(base, "ai-agents", "sync.js"),
      content: `#!/usr/bin/env node
/**
 * sync.js — Project-local Penpot Design Sync Bridge.
 *
 * Watches phase-2 Penpot exports and mirrors .svg/.json files into
 * .pakalon-agents/wireframes after a cooldown window. This file is
 * dependency-free so generated projects do not rely on Pakalon's source tree
 * or the removed Python bridge.
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const agentsDir = path.resolve(__dirname, '..');
const sourceDir = path.join(agentsDir, 'ai-agents', 'phase-2');
const targetDir = path.join(agentsDir, 'wireframes');
const pollMs = Number(process.env.PAKALON_SYNC_POLL_MS || 2000);
const cooldownMs = Number(process.env.PENPOT_SYNC_COOLDOWN_MS || 30000);
const known = new Map();
let flushTimer = null;
let stopped = false;

const isSyncable = (filePath) => /\\.(svg|json)$/i.test(filePath);

async function listFiles(dir) {
  const out = [];
  async function visit(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && isSyncable(fullPath)) {
        out.push(fullPath);
      }
    }
  }
  await visit(dir);
  return out;
}

async function mirrorFile(sourceFile) {
  const relative = path.relative(sourceDir, sourceFile);
  const targetFile = path.join(targetDir, relative);
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  await fs.copyFile(sourceFile, targetFile);
}

async function removeMirrored(sourceFile) {
  const relative = path.relative(sourceDir, sourceFile);
  await fs.rm(path.join(targetDir, relative), { force: true });
}

async function flush() {
  flushTimer = null;
  const currentFiles = await listFiles(sourceDir);
  const current = new Map();

  for (const file of currentFiles) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) continue;
    current.set(file, stat.mtimeMs);
    if (known.get(file) !== stat.mtimeMs) {
      await mirrorFile(file).catch(() => {});
    }
  }

  for (const file of known.keys()) {
    if (!current.has(file)) {
      await removeMirrored(file).catch(() => {});
    }
  }

  known.clear();
  for (const [file, mtime] of current) known.set(file, mtime);
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), cooldownMs);
}

async function poll() {
  if (stopped) return;
  const before = new Map(known);
  const currentFiles = await listFiles(sourceDir);
  let changed = before.size !== currentFiles.length;

  for (const file of currentFiles) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) continue;
    if (before.get(file) !== stat.mtimeMs) changed = true;
  }

  if (changed) scheduleFlush();
  setTimeout(() => void poll(), pollMs);
}

process.on('SIGINT', () => {
  stopped = true;
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopped = true;
  process.exit(0);
});

fs.mkdir(targetDir, { recursive: true })
  .then(() => flush())
  .then(() => {
    console.log('[sync.js] watching ' + sourceDir + ' -> ' + targetDir);
    void poll();
  })
  .catch((error) => {
    console.error('[sync.js] failed:', error);
    process.exit(1);
  });
`
    },
    // Phase 1 files
    {
      path: path.join(base, "ai-agents", "phase-1", "plan.md"),
      content: `# Plan - ${projectName}

## Overview
_Generated by \`/pakalon\`. Edit this file with your project plan._

## Goals
- [ ] Define primary objective
- [ ] Identify key deliverables

## Architecture
_Describe your tech stack and high-level architecture here._

## Timeline
_Add milestones and deadlines._
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "tasks.md"),
      content: `# Tasks - ${projectName}

## Phase 1: Planning
- [ ] Complete requirements gathering
- [ ] Define tech stack
- [ ] Create initial plan

## Phase 2: Design
- [ ] Generate wireframes
- [ ] Get user approval

## Phase 3: Development
- [ ] Implement frontend
- [ ] Implement backend
- [ ] Integrate components

## Phase 4: Testing
- [ ] Run automated tests
- [ ] Fix bugs

## Phase 5: Deployment
- [ ] Deploy to production

## Phase 6: Documentation
- [ ] Generate README
- [ ] Create API docs
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "design.md"),
      content: `# Design - ${projectName}

## UI/UX Guidelines

### Color Palette
- Primary: #000000
- Secondary: #FFFFFF
- Accent: #3B82F6

### Typography
- Headings: Inter, sans-serif
- Body: Inter, sans-serif

### Layout
- Max width: 1280px
- Sidebar: 256px
- Content: Fluid

## Components

### Navigation
- Fixed header
- Collapsible sidebar

### Cards
- Rounded corners: 8px
- Shadow: subtle

### Buttons
- Primary: Filled
- Secondary: Outlined
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "context_management.md"),
      content: `# Context Management - ${projectName}

## Token Budget
- Total window: 200,000 tokens
- Phase allocation: 70% conversation, 30% tools

## Key Files (priority context loading order)
1. plan.md
2. tasks.md
3. design.md
4. Source files (most recently modified)
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "user-stories.md"),
      content: `# User Stories - ${projectName}

## US-001 — Core User
**As a** user,
**I want to** ...
**So that** I can ...

**Acceptance Criteria:**
- [ ] AC1
- [ ] AC2

## US-002 — Another User
**As a** admin,
**I want to** manage users
**So that** I can control access
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "prd.md"),
      content: `# Product Requirements Document - ${projectName}

## 1. Problem Statement
_Describe the problem this project solves_

## 2. Goals
- Primary goal 1
- Primary goal 2

## 3. User Personas
- Persona 1: Description
- Persona 2: Description

## 4. Functional Requirements
- FR-001: Description
- FR-002: Description

## 5. Non-Functional Requirements
- Performance: < 3s load time
- Security: HTTPS, encryption at rest
- Accessibility: WCAG 2.1 AA
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "risk-assessment.md"),
      content: `# Risk Assessment - ${projectName}

## Identified Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Risk 1 | Medium | High | Mitigation strategy |
| Risk 2 | Low | Medium | Mitigation strategy |

## Technical Risks
- Dependency on external APIs
- Performance at scale

## Mitigation Strategies
1. Strategy 1
2. Strategy 2
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "technical-spec.md"),
      content: `# Technical Specification - ${projectName}

## Architecture

### Frontend
- Framework: TBD (based on user input)
- Styling: Tailwind CSS

### Backend
- Framework: TBD
- Database: PostgreSQL

### Infrastructure
- Hosting: Vercel
- Database: Neon/Supabase
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "competitive-analysis.md"),
      content: `# Competitive Analysis - ${projectName}

## Competitors

| Competitor | Strengths | Weaknesses |
|------------|-----------|------------|
| Competitor A | Feature 1, Feature 2 | Limitation 1 |
| Competitor B | Feature 3 | Limitation 2 |

## Differentiation
- Key differentiator 1
- Key differentiator 2
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "constraints-and-tradeoffs.md"),
      content: `# Constraints and Trade-offs - ${projectName}

## Technical Constraints
- Budget: Limited
- Timeline: 3 months

## Trade-offs Made
1. Trade-off 1: Decision rationale
2. Trade-off 2: Decision rationale

## Future Considerations
- Scalability
- Maintainability
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "agent-skills.md"),
      content: `# Agent Skills - ${projectName}

## Available Skills

### Frontend Skills
- React development
- Tailwind CSS
- Responsive design

### Backend Skills
- REST API design
- Database design
- Authentication

### DevOps Skills
- Docker
- CI/CD
- Deployment
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "API_reference.md"),
      content: `# API Reference - ${projectName}

> Generated by Pakalon Phase 1

## Overview
_Complete API documentation will be generated based on the plan and tasks._

## Base URL
\`\`\`
Development: http://localhost:8000/api/v1
Production: https://api.example.com/api/v1
\`\`\`
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "Database_schema.md"),
      content: `# Database Schema - ${projectName}

> Generated by Pakalon Phase 1

## Overview
_Database schema will be generated based on the plan and tasks._

## Tables
- users
- sessions
- (more to be added based on requirements)
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-1", "phase-1.md"),
      content: `# Phase 1: Planning & Requirements

## Summary
This phase covers all planning and requirements gathering.

## Files Generated
- plan.md
- tasks.md
- design.md
- context_management.md
- user-stories.md
- prd.md
- risk-assessment.md
- technical-spec.md
- competitive-analysis.md
- constraints-and-tradeoffs.md
- agent-skills.md
- API_reference.md
- Database_schema.md

## Status: COMPLETED
`,
    },
    
    // Phase 2 files
    {
      path: path.join(base, "ai-agents", "phase-2", "phase-2.md"),
      content: `# Phase 2: Wireframe Generation

## Summary
This phase generates wireframes based on the design.md from Phase 1.

## Files Generated
- Wireframe_generated.svg
- Wireframe_generated.penpot
- tdd-screenshots/

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-2", "Wireframe_generated.svg"),
      content: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="Pakalon Wireframe Placeholder">
  <rect width="1280" height="720" fill="#F8FAFC" />
  <rect x="0" y="0" width="1280" height="64" fill="#0F172A" />
  <text x="32" y="42" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="24">PAKALON</text>
  <rect x="48" y="112" width="1184" height="560" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2" rx="12" />
  <text x="80" y="168" fill="#334155" font-family="Arial, sans-serif" font-size="24">Wireframe Generated Placeholder</text>
</svg>
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-2", "Wireframe_generated.penpot"),
      content: `# Penpot Placeholder

This placeholder file marks the expected phase-2 Penpot output.
Replace this file with the exported .penpot design artifact.
`,
    },
    
    // Phase 3 files
    {
      path: path.join(base, "ai-agents", "phase-3", "auditor.md"),
      content: `# Phase 3 - Auditor

## Summary
Audit lane for validating implementation readiness across all sub-agents.

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-3", "subagent-1.md"),
      content: `# Phase 3 - Subagent 1: Frontend Development

## Summary
Frontend implementation based on wireframes from Phase 2.

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-3", "subagent-2.md"),
      content: `# Phase 3 - Subagent 2: Backend Development

## Summary
Backend implementation using API_reference.md and Database_schema.md.

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-3", "subagent-3.md"),
      content: `# Phase 3 - Subagent 3: Integration

## Summary
Frontend and backend integration.

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-3", "subagent-4.md"),
      content: `# Phase 3 - Subagent 4: Testing & Debugging

## Summary
Testing and bug fixing.

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-3", "subagent-5.md"),
      content: `# Phase 3 - Subagent 5: User Feedback

## Summary
User feedback collection and documentation.

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-3", "execution_log.md"),
      content: `# Phase 3 Execution Log

## Activities
_Log of all activities performed in Phase 3_
`,
    },
    
    // Phase 4 files
    {
      path: path.join(base, "ai-agents", "phase-4", "subagent-1.md"),
      content: `# Phase 4 - SAST Static Analysis

**Role:** Scans source code for OWASP Top 10, injection flaws, XSS, and insecure patterns.

## Findings

| # | Severity | File | Rule | Message |
|---|----------|------|------|---------|
|   |          |      |      | _Findings populated during Phase 4 execution_ |

## Summary
- **Total:** 0
- **Critical:** 0
- **High:** 0
- **Medium:** 0
- **Low:** 0

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-4", "subagent-2.md"),
      content: `# Phase 4 - Dependency & Secret Scan

**Role:** Scans for vulnerable dependencies (npm/pip/gomod) and hardcoded secrets/credentials.

## Findings

| # | Type | Package / File | Severity | CVE / Key |
|---|------|----------------|----------|-----------|
|   |      |                |          | _Findings populated during Phase 4 execution_ |

## Summary
- **Dependencies scanned:** 0
- **Vulnerabilities:** 0
- **Secrets detected:** 0

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-4", "subagent-3.md"),
      content: `# Phase 4 - DAST / Dynamic Analysis

**Role:** Runs dynamic security tests against running application (ZAP, Nikto, headers).

## Findings

| # | Endpoint | Vulnerability | Severity | Evidence |
|---|----------|--------------|----------|----------|
|   |          |              |          | _Findings populated during Phase 4 execution_ |

## Summary
- **Endpoints tested:** 0
- **Vulnerabilities:** 0
- **Security headers missing:** —

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-4", "subagent-4.md"),
      content: `# Phase 4 - Code Review & Hardening

**Role:** Manual-style code review for security anti-patterns, auth flaws, and hardening gaps.

## Findings

| # | Area | Issue | Severity | Recommendation |
|---|------|-------|----------|----------------|
|   |      |       |          | _Findings populated during Phase 4 execution_ |

## Summary
- **Files reviewed:** 0
- **Issues found:** 0
- **Auto-fixable:** 0

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-4", "subagent-5.md"),
      content: `# Phase 4 - Compliance & Best Practices

**Role:** Checks against security best practices (CIS benchmarks, SBOM, compliance frameworks).

## Findings

| # | Standard | Requirement | Status | Notes |
|---|----------|-------------|--------|-------|
|   |          |             |        | _Findings populated during Phase 4 execution_ |

## Summary
- **Checks run:** 0
- **Passed:** 0
- **Failed:** 0
- **SBOM generated:** No

## Status: PENDING
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-4", "blackbox_testing.xml"),
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!-- Pakalon Phase-4 Black-Box Testing
     Tests validate the application from the user's perspective (user stories).
     Sub-agent 1 (SAST) populates this during Phase-4 execution. -->
<blackbox-tests>
  <!-- <test-suite name="Authentication">
    <test id="BT-001" user-story="US-001">
      <description>User can register with valid credentials</description>
      <steps>
        <step>Navigate to /register</step>
        <step>Fill in email and password</step>
        <step>Submit form</step>
      </steps>
      <expected-result>User is redirected to dashboard</expected-result>
    </test>
  </test-suite> -->
</blackbox-tests>
`,
    },
    {
      path: path.join(base, "ai-agents", "phase-4", "whitebox_testing.xml"),
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!-- Pakalon Phase-4 White-Box Testing
     Tests examine internal structure, code paths, and architecture.
     Sub-agent 3 (Code Review) populates this during Phase-4 execution. -->
<whitebox-tests>
  <!-- <test-suite name="Unit Tests">
    <test id="WT-001" component="AuthService" method="registerUser">
      <description>registerUser hashes password before saving</description>
      <assertions>
        <assertion>bcrypt.hash is called with raw password</assertion>
        <assertion>DB insert uses hashed password, not plain text</assertion>
      </assertions>
    </test>
  </test-suite>
  <test-suite name="Integration Tests">
    <test id="WT-010" component="AuthController → AuthService → DB">
      <description>POST /api/auth/register creates user in DB</description>
    </test>
  </test-suite> -->
</whitebox-tests>
`,
    },
    
    // Phase 5 files
    {
      path: path.join(base, "ai-agents", "phase-5", "phase-5.md"),
      content: `# Phase 5: Deployment

## Summary
Deployment to production environment.

## Status: PENDING
`,
    },
    
    // Phase 6 files
    {
      path: path.join(base, "ai-agents", "phase-6", "phase-6.md"),
      content: `# Phase 6: Documentation

## Summary
Final documentation and handover.

## Status: PENDING
`,
    },
  ];
}

/**
 * Create the complete .pakalon-agents folder structure
 */
export function createAgentsFolderStructure(config: PakalonAgentsConfig): void {
  const folders = getAgentsFolderStructure(config);
  for (const folder of folders) {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
  }

  const files = getAgentsFiles(config);
  
  for (const file of files) {
    const dir = path.dirname(file.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(file.path)) {
      fs.writeFileSync(file.path, file.content);
    }
  }
  
  // Keep scaffold creation quiet in the Ink TUI; the command handler reports
  // the result through chat so direct stdout does not destabilize the screen.
}

export default {
  getAgentsFolderStructure,
  getAgentsFiles,
  createAgentsFolderStructure,
};
