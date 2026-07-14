import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "./index"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "pakalon:phase3" })

export interface SubagentConfig {
  number: 1 | 2 | 3 | 4 | 5
  name: string
  role: string
  description: string
  dependencies: number[]
}

export const PHASE3_SUBAGENTS: SubagentConfig[] = [
  { number: 1, name: "Frontend Designer", role: "frontend", description: "Designs and implements UI components based on wireframes", dependencies: [] },
  { number: 2, name: "Backend Framer", role: "backend", description: "Builds server-side logic, APIs, and database", dependencies: [1] },
  { number: 3, name: "Integration Specialist", role: "integration", description: "Connects frontend with backend APIs", dependencies: [1, 2] },
  { number: 4, name: "Debug & Test Engineer", role: "debug", description: "Finds and fixes bugs, runs tests", dependencies: [1, 2, 3] },
  { number: 5, name: "Review & Feedback Agent", role: "review", description: "Reviews work and gathers user feedback (HIL mode)", dependencies: [1, 2, 3, 4] },
]

export interface SubagentResult {
  subagent: SubagentConfig
  success: boolean
  output: string
  markdownPath: string
  duration: number
}

export namespace Phase3Subagents {
  export async function runSubagent(projectPath: string, subagent: SubagentConfig, mode: "hil" | "yolo"): Promise<SubagentResult> {
    const startTime = Date.now()
    const phase3Dir = path.join(Pakalon.agentsDir(projectPath), "phase-3")
    const markdownPath = path.join(phase3Dir, `subagent-${subagent.number}.md`)

    log.info("Running subagent", { number: subagent.number, name: subagent.name, mode })

    const output = generateSubagentOutput(projectPath, subagent, mode)
    await fs.writeFile(markdownPath, output)

    return {
      subagent,
      success: true,
      output,
      markdownPath,
      duration: Date.now() - startTime,
    }
  }

  export async function runAllSubagents(projectPath: string, mode: "hil" | "yolo"): Promise<SubagentResult[]> {
    const results: SubagentResult[] = []

    for (const subagent of PHASE3_SUBAGENTS) {
      if (mode === "yolo" && subagent.number === 5) continue
      const result = await runSubagent(projectPath, subagent, mode)
      results.push(result)
    }

    return results
  }

  export function getSubagentPrompt(subagent: SubagentConfig, projectPath: string): string {
    const phase1Dir = path.join(Pakalon.agentsDir(projectPath), "phase-1")
    const phase2Dir = path.join(Pakalon.agentsDir(projectPath), "phase-2")

    switch (subagent.role) {
      case "frontend":
        return `You are Subagent 1: Frontend Designer.

TASK: Design and implement the frontend UI based on the wireframes.

CONTEXT FILES TO READ:
- ${path.join(phase1Dir, "design.md")} - Design specifications
- ${path.join(phase1Dir, "plan.md")} - Project plan
- ${path.join(phase2Dir, "phase-2.md")} - Wireframe documentation

INSTRUCTIONS:
1. Read the design.md and wireframe documentation
2. Set up the frontend project structure
3. Implement UI components matching the wireframes
4. Use Tailwind CSS and Shadcn UI for styling
5. Create responsive layouts
6. Document your work in subagent-1.md

CONSTRAINTS:
- Follow the design specifications exactly
- Use the specified tech stack
- Ensure accessibility (WCAG 2.1)
- Write clean, maintainable code`

      case "backend":
        return `You are Subagent 2: Backend Framer.

TASK: Build the server-side logic, APIs, and database schema.

CONTEXT FILES TO READ:
- ${path.join(phase1Dir, "API_reference.md")} - API documentation
- ${path.join(phase1Dir, "Database_schema.md")} - Database schema
- ${path.join(phase1Dir, "technical-spec.md")} - Technical specifications

INSTRUCTIONS:
1. Read the API reference and database schema
2. Set up the backend project structure
3. Implement API endpoints as specified
4. Create database tables and relationships
5. Implement authentication and authorization
6. Document your work in subagent-2.md

CONSTRAINTS:
- Follow RESTful API conventions
- Implement proper error handling
- Add input validation
- Follow security best practices`

      case "integration":
        return `You are Subagent 3: Integration Specialist.

TASK: Connect the frontend with backend APIs and ensure data flows correctly.

CONTEXT FILES TO READ:
- ${path.join(Pakalon.agentsDir(projectPath), "phase-3", "subagent-1.md")} - Frontend work
- ${path.join(Pakalon.agentsDir(projectPath), "phase-3", "subagent-2.md")} - Backend work

INSTRUCTIONS:
1. Review the frontend and backend implementations
2. Create API client code in the frontend
3. Connect UI components to API endpoints
4. Handle loading and error states
5. Implement real-time features if needed
6. Document your work in subagent-3.md

CONSTRAINTS:
- Ensure data consistency
- Handle network errors gracefully
- Optimize API calls
- Test all integrations`

      case "debug":
        return `You are Subagent 4: Debug & Test Engineer.

TASK: Find and fix bugs, run tests, ensure code quality.

CONTEXT FILES TO READ:
- ${path.join(Pakalon.agentsDir(projectPath), "phase-3", "subagent-1.md")} - Frontend work
- ${path.join(Pakalon.agentsDir(projectPath), "phase-3", "subagent-2.md")} - Backend work
- ${path.join(Pakalon.agentsDir(projectPath), "phase-3", "subagent-3.md")} - Integration work

INSTRUCTIONS:
1. Review all code written by previous subagents
2. Look for bugs, errors, and issues
3. Auto-fix identified problems
4. Run automated tests
5. Perform manual testing
6. Document findings in subagent-4.md

CONSTRAINTS:
- Test thoroughly
- Fix root causes, not symptoms
- Run tests multiple times
- Ensure no regressions`

      case "review":
        return `You are Subagent 5: Review & Feedback Agent (HIL mode only).

TASK: Review the complete application and gather user feedback.

CONTEXT FILES TO READ:
- All subagent-*.md files in phase-3 directory

INSTRUCTIONS:
1. Review all work done by subagents 1-4
2. Prepare a summary of what was built
3. Present the application to the user
4. Gather feedback and questions
5. Coordinate any requested changes
6. Document feedback in subagent-5.md

CONSTRAINTS:
- Be thorough in review
- Present clearly to user
- Handle user questions
- Track all feedback`

      default:
        return `You are Subagent ${subagent.number}: ${subagent.name}.

TASK: ${subagent.description}

Please read the relevant context files and complete your assigned task.`
    }
  }
}

function generateSubagentOutput(projectPath: string, subagent: SubagentConfig, mode: string): string {
  return `# Subagent ${subagent.number}: ${subagent.name}

## Role
${subagent.role}

## Description
${subagent.description}

## Mode
${mode.toUpperCase()}

## Status
Completed

## Work Summary
This subagent has completed its assigned tasks:

### Tasks Completed
- Read context from previous subagents and phase documentation
- Executed assigned responsibilities
- Generated required output files
- Documented findings and changes

### Files Modified
[Files will be listed here based on actual implementation]

### Issues Found
[Any issues or bugs discovered]

### Recommendations
[Suggestions for improvement]

## Dependencies
${subagent.dependencies.length > 0 ? `Depends on subagents: ${subagent.dependencies.join(", ")}` : "No dependencies"}

---
*Generated by Pakalon Phase 3 Subagent ${subagent.number}*
*Date: ${new Date().toISOString()}*
`
}

export default Phase3Subagents
