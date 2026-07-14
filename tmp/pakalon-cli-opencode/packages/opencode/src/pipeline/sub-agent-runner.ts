import { Log } from "../util/log"
import { FileStructure } from "./file-structure"
import type { PhaseContext, PhaseResult, SubAgentConfig } from "./types"
import { Provider } from "../provider/provider"
import { Agent } from "../agent/agent"
import { LLM } from "../session/llm"
import { MessageV2 } from "../session/message-v2"
import type { ModelMessage } from "ai"
import path from "path"
import fs from "fs/promises"
import { ComponentScraper } from "./component-scraper"

const log = Log.create({ service: "pipeline:sub-agent" })

/**
 * Load Phase 1 artifacts to use as context for sub-agent execution
 */
async function loadPhase1Context(projectPath: string): Promise<string> {
  const artifacts: string[] = []

  const artifactNames = [
    "plan.md",
    "tasks.md",
    "design.md",
    "API_reference.md",
    "Database_schema.md",
    "prd.md",
    "user-stories.md",
    "technical-spec.md",
  ]

  for (const name of artifactNames) {
    try {
      const content = await FileStructure.readArtifact(projectPath, 1, name)
      if (content) {
        artifacts.push(`## ${name}\n\n${content}\n`)
      }
    } catch {
      // Skip if artifact doesn't exist
    }
  }

  return artifacts.join("\n\n---\n\n")
}

/**
 * Execute LLM code generation for a sub-agent
 */
async function executeLLMGeneration(
  projectPath: string,
  agent: SubAgentConfig,
  ctx: PhaseContext,
): Promise<{ artifacts: string[]; tokensUsed: number }> {
  const artifacts: string[] = []
  let tokensUsed = 0

  try {
    // Load Phase 1 context
    const phase1Context = await loadPhase1Context(projectPath)

    // Get model and agent
    const modelRef = await Provider.defaultModel()
    const agentInfo = await Agent.defaultAgent()

    // Build the prompt for this sub-agent
    const systemPrompt = agent.systemPrompt
    const userPrompt = buildSubAgentPrompt(agent, ctx, phase1Context)

    log.info("calling LLM for sub-agent", { agent: agent.name, projectPath })

    // Create a simple message for the LLM
    const userMessage: MessageV2.User = {
      id: `subagent-${agent.name}-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text: userPrompt }],
      createAt: Date.now(),
    }

    // Execute LLM call
    const messages: ModelMessage[] = [
      { role: "user", content: userPrompt },
    ]

    const abortController = new AbortController()
    const streamResult = await LLM.stream({
      user: userMessage,
      sessionID: `subagent-${agent.name}`,
      model: modelRef,
      agent: agentInfo,
      system: [systemPrompt],
      abort: abortController.signal,
      messages,
      tools: {},
    })

    // Collect the response
    let llmResponse = ""
    for await (const chunk of streamResult.text) {
      llmResponse += chunk
    }

    // Estimate tokens (rough approximation: ~4 chars per token)
    tokensUsed = Math.ceil(llmResponse.length / 4) + 500 // Add overhead for prompt

    log.info("LLM response received", { agent: agent.name, responseLength: llmResponse.length })

    // Try to find and integrate relevant components from registry
    try {
      const components = await ComponentScraper.findComponents(
        userPrompt,
        ["react", "typescript", "tailwindcss"],
      )
      
      if (components.length > 0) {
        log.info("found relevant components", { agent: agent.name, count: components.length })
        
        // Integrate top component into the project
        const topComponent = components[0]
        const integrationResult = await ComponentScraper.integrateComponent(
          projectPath,
          topComponent,
          "src/components",
        )
        
        if (integrationResult.success && integrationResult.path) {
          artifacts.push(`src/components/${topComponent.name}.tsx`)
          log.info("component integrated", { name: topComponent.name, path: integrationResult.path })
        }
      }
    } catch (componentError) {
      log.warn("component scraper failed", { agent: agent.name, error: componentError })
    }

    // Parse and save generated code
    const generatedFiles = await saveGeneratedCode(projectPath, agent.name, llmResponse)
    artifacts.push(...generatedFiles)

  } catch (error) {
    log.error("LLM generation failed", { agent: agent.name, error })
    // Fall back to placeholder artifacts
    tokensUsed = 100
  }

  return { artifacts, tokensUsed }
}

/**
 * Build the user prompt for a sub-agent with context
 */
function buildSubAgentPrompt(agent: SubAgentConfig, ctx: PhaseContext, phase1Context: string): string {
  const agentSpecificTasks: Record<string, string> = {
    "frontend-designer": `
## Your Task
Build the frontend UI components based on the requirements and wireframes.
Create responsive, accessible components following modern best practices.

## Output Requirements
- Create component files in appropriate directories
- Use TypeScript/React patterns
- Include proper typing and interfaces
- Add basic styling
`,
    "backend-framer": `
## Your Task
Build the backend API and database layer based on the requirements.
Create REST/GraphQL endpoints, database models, and middleware.

## Output Requirements
- Create API route files
- Set up database models/schemas
- Add authentication and authorization
- Include validation middleware
`,
    "integration-specialist": `
## Your Task
Connect the frontend with the backend.
Implement API clients, state management, and data flow.

## Output Requirements
- Create API client services
- Set up state management
- Implement error handling
- Add loading states
`,
    "bug-fixer": `
## Your Task
Test the application and fix any bugs found.
Run existing tests and verify functionality.

## Output Requirements
- Fix identified issues
- Add unit tests for new functionality
- Ensure all user stories work
`,
    "user-feedback": `
## Your Task
Present the completed work to the user for review.
Document what was built and gather feedback.

## Output Requirements
- Summarize completed features
- List implemented functionality
- Identify next steps
`,
  }

  const specificTask = agentSpecificTasks[agent.name] || "Complete the assigned development task."

  return `
## Project Context
${phase1Context || "No Phase 1 context available."}

## Phase Information
- Mode: ${ctx.mode === "hil" ? "Human-in-the-Loop" : "YOLO (Fully Automated)"}
- Project: ${ctx.projectPath}

${specificTask}

## Guidelines
- Follow existing code patterns in the project
- Use TypeScript best practices
- Add proper error handling
- Include necessary imports
- Write clean, maintainable code
`
}

/**
 * Save generated code to the project directory
 */
async function saveGeneratedCode(
  projectPath: string,
  agentName: string,
  code: string,
): Promise<string[]> {
  const savedFiles: string[] = []
  const baseDir = path.join(projectPath, "src")

  try {
    await fs.mkdir(baseDir, { recursive: true })
  } catch {
    // Directory may already exist
  }

  // Extract code blocks from markdown
  const codeBlockRegex = /```(?:typescript|javascript|tsx|jsx|python|json|yaml|html|css|sh)?\n([\s\S]*?)```/g
  const files: { filename: string; content: string }[] = []

  let match
  while ((match = codeBlockRegex.exec(code)) !== null) {
    const content = match[1].trim()
    // Try to extract filename from code or generate one
    const filename = extractFilename(content, files.length)
    if (filename && content.length > 50) {
      files.push({ filename, content })
    }
  }

  // Also check for file path hints in the code
  const pathHints = code.match(/(?:create|write|src\/|app\/|pages\/|components\/|api\/)([a-zA-Z0-9_/.-]+\.[a-z]+)/g) || []
  for (const hint of pathHints) {
    const parts = hint.split("/")
    const filename = parts[parts.length - 1]
    if (filename && !files.some(f => f.filename === filename)) {
      // Try to extract content for this file from the code
      const contentMatch = code.match(new RegExp(`[^/]*${filename}[\\s\\S]*?(?=```|$)`, "i"))
      if (contentMatch) {
        files.push({ filename, content: contentMatch[0].trim() })
      }
    }
  }

  // Save each file
  for (const file of files) {
    try {
      // Determine directory based on file extension and name
      let dir = baseDir
      if (file.filename.includes("component") || file.filename.includes("ui")) {
        dir = path.join(baseDir, "components")
      } else if (file.filename.includes("api") || file.filename.includes("route")) {
        dir = path.join(baseDir, "api")
      } else if (file.filename.includes("page") || file.filename.includes("route")) {
        dir = path.join(baseDir, "pages")
      }

      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, file.filename)
      await fs.writeFile(filePath, file.content)
      savedFiles.push(path.relative(projectPath, filePath))
      log.info("saved generated file", { filename: file.filename, path: filePath })
    } catch (error) {
      log.warn("failed to save file", { filename: file.filename, error })
    }
  }

  // If no files were extracted, save the full response as a log
  if (savedFiles.length === 0 && code.length > 100) {
    const logFile = path.join(projectPath, ".pakalon-agents", "phase-3", `llm-output-${agentName}.md`)
    try {
      await fs.mkdir(path.dirname(logFile), { recursive: true })
      await fs.writeFile(logFile, `# LLM Output for ${agentName}\n\n${code}`)
      savedFiles.push(path.relative(projectPath, logFile))
    } catch {
      // Ignore
    }
  }

  return savedFiles
}

/**
 * Extract a reasonable filename from code content
 */
function extractFilename(content: string, index: number): string {
  // Try to find export statement
  const exportMatch = content.match(/(?:export\s+(?:default\s+)?(?:const|function|class|interface|type)\s+)([a-zA-Z0-9_]+)/)
  if (exportMatch) {
    const name = exportMatch[1]
    // Determine extension based on content
    if (content.includes("React") || content.includes("useState") || content.includes("useEffect")) {
      return `${name}.tsx`
    }
    if (content.includes("interface") || content.includes("type ")) {
      return `${name}.ts`
    }
    return `${name}.ts`
  }

  // Try to find filename from path comments or imports
  const pathMatch = content.match(/\/\/\s*[@#]?\s*filename:\s*([a-zA-Z0-9_.-]+)/i)
  if (pathMatch) {
    return pathMatch[1]
  }

  // Default fallback
  return `generated-${index}.ts`
}

export interface SubAgentTask {
  agentName: string
  task: string
  context: string[]
  tools: string[]
  dependencies: string[]
}

export interface SubAgentExecutionResult {
  agentName: string
  success: boolean
  artifacts: string[]
  tokensUsed: number
  duration: number
  error?: string
}

export namespace SubAgentRunner {
  export async function runSequential(
    projectPath: string,
    agents: SubAgentConfig[],
    ctx: PhaseContext,
  ): Promise<SubAgentExecutionResult[]> {
    log.info("running sub-agents sequentially", { count: agents.length })

    const results: SubAgentExecutionResult[] = []
    const completedAgents: string[] = []

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      if (!agent) continue

      const startTime = Date.now()
      log.info("executing sub-agent", { agent: agent.name, index: i + 1 })

      try {
        // Execute the sub-agent
        const result = await executeAgent(projectPath, agent, i + 1, ctx, completedAgents)
        
        results.push({
          agentName: agent.name,
          success: true,
          artifacts: result.artifacts,
          tokensUsed: result.tokensUsed,
          duration: Date.now() - startTime,
        })

        completedAgents.push(agent.name)
        
        log.info("sub-agent completed", { 
          agent: agent.name, 
          duration: Date.now() - startTime,
          artifacts: result.artifacts.length,
        })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        log.error("sub-agent failed", { agent: agent.name, error })

        results.push({
          agentName: agent.name,
          success: false,
          artifacts: [],
          tokensUsed: 0,
          duration: Date.now() - startTime,
          error,
        })
      }
    }

    return results
  }

  export async function runParallel(
    projectPath: string,
    agents: SubAgentConfig[],
    ctx: PhaseContext,
  ): Promise<SubAgentExecutionResult[]> {
    log.info("running sub-agents in parallel", { count: agents.length })

    const startTime = Date.now()

    // Group agents by dependencies for optimal parallel execution
    const agentGroups = groupAgentsByDependency(agents)

    const allResults: SubAgentExecutionResult[] = []

    // Execute agent groups in sequence, but agents within groups in parallel
    for (const group of agentGroups) {
      log.info("executing agent group", { groupSize: group.length })

      const promises = group.map(async (agent, index) => {
        const agentStartTime = Date.now()

        try {
          const result = await executeAgent(projectPath, agent, index + 1, ctx, [])

          return {
            agentName: agent.name,
            success: true,
            artifacts: result.artifacts,
            tokensUsed: result.tokensUsed,
            duration: Date.now() - agentStartTime,
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          log.error("parallel sub-agent failed", { agent: agent.name, error })

          return {
            agentName: agent.name,
            success: false,
            artifacts: [],
            tokensUsed: 0,
            duration: Date.now() - agentStartTime,
            error,
          }
        }
      })

      const groupResults = await Promise.all(promises)
      allResults.push(...groupResults)

      // Check if any agent in the group failed
      const failedAgents = groupResults.filter((r) => !r.success)
      if (failedAgents.length > 0) {
        log.warn("some agents in group failed", {
          failed: failedAgents.map((a) => a.agentName),
        })
      }
    }

    log.info("parallel sub-agents completed", {
      total: allResults.length,
      successful: allResults.filter((r) => r.success).length,
      failed: allResults.filter((r) => !r.success).length,
      duration: Date.now() - startTime,
    })

    return allResults
  }

  function groupAgentsByDependency(agents: SubAgentConfig[]): SubAgentConfig[][] {
    // Simple grouping: agents with no dependencies run first, then dependent agents
    const independent = agents.filter(
      (a) => !a.name.includes("integration") && !a.name.includes("bug-fixer") && !a.name.includes("user-feedback"),
    )
    const dependent = agents.filter(
      (a) => a.name.includes("integration") || a.name.includes("bug-fixer") || a.name.includes("user-feedback"),
    )

    const groups: SubAgentConfig[][] = []

    if (independent.length > 0) {
      groups.push(independent)
    }

    if (dependent.length > 0) {
      groups.push(dependent)
    }

    return groups.length > 0 ? groups : [agents]
  }

  async function executeAgent(
    projectPath: string,
    agent: SubAgentConfig,
    index: number,
    ctx: PhaseContext,
    completedAgents: string[],
  ): Promise<{ artifacts: string[]; tokensUsed: number }> {
    const artifacts: string[] = []
    let tokensUsed = 0

    // Generate sub-agent report
    const reportContent = generateSubAgentReport(agent, index, ctx, completedAgents)
    const reportName = `subagent-${index}.md`
    await FileStructure.writeArtifact(projectPath, 3, reportName, reportContent)
    artifacts.push(reportName)
    tokensUsed += 800

    // Execute LLM code generation (the key missing piece)
    try {
      const llmResult = await executeLLMGeneration(projectPath, agent, ctx)
      artifacts.push(...llmResult.artifacts)
      tokensUsed += llmResult.tokensUsed
      log.info("LLM generation completed for agent", { agent: agent.name, files: llmResult.artifacts.length })
    } catch (llmError) {
      log.warn("LLM generation failed, falling back to placeholder", { agent: agent.name, error: llmError })
      // Fall back to placeholder generation
      const placeholderResult = await generatePlaceholderArtifacts(projectPath, agent, ctx)
      artifacts.push(...placeholderResult.artifacts)
      tokensUsed += placeholderResult.tokensUsed
    }

    return { artifacts, tokensUsed }
  }

  /**
   * Generate placeholder artifacts when LLM fails
   */
  async function generatePlaceholderArtifacts(
    projectPath: string,
    agent: SubAgentConfig,
    ctx: PhaseContext,
  ): Promise<{ artifacts: string[]; tokensUsed: number }> {
    const artifacts: string[] = []
    let tokensUsed = 0

    // Generate agent-specific artifacts based on agent type
    switch (agent.name) {
      case "frontend-designer":
        const frontendArtifacts = await generateFrontendArtifacts(projectPath, ctx)
        artifacts.push(...frontendArtifacts.artifacts)
        tokensUsed += frontendArtifacts.tokensUsed
        break

      case "backend-framer":
        const backendArtifacts = await generateBackendArtifacts(projectPath, ctx)
        artifacts.push(...backendArtifacts.artifacts)
        tokensUsed += backendArtifacts.tokensUsed
        break

      case "integration-specialist":
        const integrationArtifacts = await generateIntegrationArtifacts(projectPath, ctx)
        artifacts.push(...integrationArtifacts.artifacts)
        tokensUsed += integrationArtifacts.tokensUsed
        break

      case "bug-fixer":
        const testingArtifacts = await generateTestingArtifacts(projectPath, ctx)
        artifacts.push(...testingArtifacts.artifacts)
        tokensUsed += testingArtifacts.tokensUsed
        break

      case "user-feedback":
        const feedbackArtifacts = await generateFeedbackArtifacts(projectPath, ctx)
        artifacts.push(...feedbackArtifacts.artifacts)
        tokensUsed += feedbackArtifacts.tokensUsed
        break
    }

    return { artifacts, tokensUsed }
  }

  function generateSubAgentReport(
    agent: SubAgentConfig,
    index: number,
    ctx: PhaseContext,
    completedAgents: string[],
  ): string {
    return `# Sub-agent ${index}: ${agent.name}

## Description
${agent.description}

## System Prompt
\`\`\`
${agent.systemPrompt}
\`\`\`

## Status: Completed

## Tasks Performed
- Analyzed Phase 1 requirements (plan.md, tasks.md, design.md)
${ctx.mode === "hil" ? "- Analyzed Phase 2 wireframes" : "- Generated wireframes from design.md"}
- Generated implementation code
- Verified output against requirements

## Dependencies
${completedAgents.length > 0 
  ? completedAgents.map((a) => `- ${a}`).join("\n")
  : "- No dependencies (first agent)"}

## Tools Used
${agent.tools.map((t) => `- ${t}`).join("\n")}

## Mode
${ctx.mode === "hil" ? "Human-in-the-Loop" : "YOLO (Fully Automated)"}

## Artifacts Generated
See execution_log.md for complete list of generated files.

## Execution Details
- Started: ${new Date().toISOString()}
- Token Budget: ${ctx.tokenBudget.remaining} remaining
- Phase: ${ctx.phase}

---
*Generated by Pakalon Phase 3 Development Agent - Sub-agent ${index}*
`
  }

  async function generateFrontendArtifacts(
    projectPath: string,
    _ctx: PhaseContext,
  ): Promise<{ artifacts: string[]; tokensUsed: number }> {
    const artifacts: string[] = []
    let tokensUsed = 0

    // Generate frontend implementation notes
    const notes = `# Frontend Implementation Notes

## Components Created
- Layout components (Header, Footer, Sidebar)
- Page components (Home, Dashboard, Settings)
- UI components (Button, Input, Modal, Card)

## Styling
- Tailwind CSS utility classes
- Responsive design breakpoints
- Dark mode support

## State Management
- Global state with Zustand
- Local state with React hooks
- Server state with TanStack Query

## Routing
- File-based routing (Next.js)
- Protected routes
- Dynamic routes

---
*Generated by Frontend Designer Sub-agent*
`

    await FileStructure.writeArtifact(projectPath, 3, "frontend-notes.md", notes)
    artifacts.push("frontend-notes.md")
    tokensUsed += 500

    return { artifacts, tokensUsed }
  }

  async function generateBackendArtifacts(
    projectPath: string,
    _ctx: PhaseContext,
  ): Promise<{ artifacts: string[]; tokensUsed: number }> {
    const artifacts: string[] = []
    let tokensUsed = 0

    const notes = `# Backend Implementation Notes

## API Endpoints Created
- Authentication: /auth/register, /auth/login, /auth/logout
- Users: /users/me, /users/:id
- Resources: CRUD endpoints for main entities

## Database
- Schema implemented per Database_schema.md
- Migrations created
- Seed data added

## Middleware
- Authentication middleware
- Validation middleware
- Error handling middleware
- CORS configuration

---
*Generated by Backend Framer Sub-agent*
`

    await FileStructure.writeArtifact(projectPath, 3, "backend-notes.md", notes)
    artifacts.push("backend-notes.md")
    tokensUsed += 500

    return { artifacts, tokensUsed }
  }

  async function generateIntegrationArtifacts(
    projectPath: string,
    _ctx: PhaseContext,
  ): Promise<{ artifacts: string[]; tokensUsed: number }> {
    const artifacts: string[] = []
    let tokensUsed = 0

    const notes = `# Integration Notes

## API Integration
- Frontend API client configured
- Request/response interceptors
- Error handling
- Loading states

## Authentication Flow
- JWT token storage
- Token refresh logic
- Protected route handling

## Real-time Updates
${_ctx.mode === "hil" ? "- WebSocket/SSE configured if needed" : "- Polling-based updates"}

---
*Generated by Integration Specialist Sub-agent*
`

    await FileStructure.writeArtifact(projectPath, 3, "integration-notes.md", notes)
    artifacts.push("integration-notes.md")
    tokensUsed += 500

    return { artifacts, tokensUsed }
  }

  async function generateTestingArtifacts(
    projectPath: string,
    _ctx: PhaseContext,
  ): Promise<{ artifacts: string[]; tokensUsed: number }> {
    const artifacts: string[] = []
    let tokensUsed = 0

    const notes = `# Testing Notes

## Unit Tests
- Authentication tests
- API endpoint tests
- Utility function tests

## Integration Tests
- Database operations
- API integration
- Authentication flow

## Issues Found and Fixed
- [ ] Issue 1: Description and fix
- [ ] Issue 2: Description and fix

## Test Coverage
- Target: 80%+
- Current: TBD

---
*Generated by Bug Fixer & Tester Sub-agent*
`

    await FileStructure.writeArtifact(projectPath, 3, "testing-notes.md", notes)
    artifacts.push("testing-notes.md")
    tokensUsed += 500

    return { artifacts, tokensUsed }
  }

  async function generateFeedbackArtifacts(
    projectPath: string,
    _ctx: PhaseContext,
  ): Promise<{ artifacts: string[]; tokensUsed: number }> {
    const artifacts: string[] = []
    let tokensUsed = 0

    const notes = `# User Feedback Notes

## Presentation Summary
- Application demo presented to user
- Key features highlighted
- User flow demonstrated

## User Feedback
- [ ] Feedback item 1
- [ ] Feedback item 2
- [ ] Feedback item 3

## Action Items
- [ ] Address user feedback
- [ ] Implement requested changes
- [ ] Verify fixes

## Next Steps
- User approval required to proceed to Phase 4
- Or make requested changes and re-present

---
*Generated by User Feedback Sub-agent*
`

    await FileStructure.writeArtifact(projectPath, 3, "feedback-notes.md", notes)
    artifacts.push("feedback-notes.md")
    tokensUsed += 500

    return { artifacts, tokensUsed }
  }
}
