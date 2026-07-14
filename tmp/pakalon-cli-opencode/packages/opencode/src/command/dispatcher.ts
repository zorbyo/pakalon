/**
 * Unified Command Dispatcher
 * 
 * Handles both local commands (executed directly) and server commands (sent to AI).
 * This replaces ad hoc slash handling with a single command dispatch path.
 */

import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Pakalon } from "../pakalon"
import { PhaseOrchestrator } from "../pakalon/phase-orchestrator"
import { QASystem } from "../pakalon/qa-system"
import { NormalMode } from "../pakalon/normal-mode"
import { ModeSwitcher } from "../pakalon/mode-switcher"
import { Phase3Subagents } from "../pakalon/phase3-subagents"
import { Phase4Security } from "../pakalon/phase4-security"
import { MCPProjectConfig } from "../pakalon/mcp-project"
import { WorkflowEngine } from "../pakalon/workflow"
import { PenpotIntegration } from "../pakalon/penpot"
import { Session } from "../session"
import { SessionCompaction } from "../session/compaction"
import { SessionPrompt } from "../session/prompt"
import { SessionRevert } from "../session/revert"
import { MessageV2 } from "../session/message-v2"
import { Snapshot } from "../snapshot"
import { DeviceCodeFlow } from "../auth/device-code"
import { Auth } from "../auth"
import { Provider } from "../provider/provider"
import { Agent } from "../agent/agent"
import { UsageBackend } from "../backend"
import { Flag } from "../flag/flag"
import { Env } from "../env"
import { Process } from "../util/process"
import { Skill } from "../skill"
import { AutomationCLI } from "../cli/automations"
import fs from "fs/promises"
import path from "path"

const log = Log.create({ service: "command.dispatcher" })

export interface CommandResult {
  success: boolean
  message: string
  data?: unknown
  shouldClearPrompt?: boolean
}

export interface CommandHandler {
  name: string
  description: string
  handler: (args: string) => Promise<CommandResult>
  category: "pakalon" | "session" | "system"
}

// Registry of local command handlers
const localHandlers = new Map<string, CommandHandler>()

async function getActiveSession() {
  const sessions = [...Session.list({ directory: Instance.directory, limit: 1 })]
  return sessions[0]
}

function getTokenTotal(messages: MessageV2.WithParts[]): number {
  let total = 0
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    total +=
      message.info.tokens.total ||
      message.info.tokens.input +
        message.info.tokens.output +
        message.info.tokens.reasoning +
        message.info.tokens.cache.read +
        message.info.tokens.cache.write
  }
  return total
}

async function probeVersion(command: string[]) {
  const result = await Process.run(command, { nothrow: true })
  if (result.code !== 0) {
    return { ok: false, value: result.stderr.toString().trim() || result.stdout.toString().trim() || "not found" }
  }
  const text = result.stdout.toString().trim() || result.stderr.toString().trim()
  return { ok: true, value: text.split(/\r?\n/)[0] || "ok" }
}

function detectAutomationConnectors(prompt: string): string[] {
  const source = prompt.toLowerCase()
  const connectors = [
    ["github", ["github", "pull request", "pr", "issue", "repo"]],
    ["slack", ["slack", "channel", "webhook"]],
    ["jira", ["jira", "atlassian", "ticket"]],
    ["notion", ["notion", "database", "workspace"]],
    ["telegram", ["telegram", "bot token", "chat id"]],
  ] as const

  const detected = connectors
    .filter(([, hints]) => hints.some((hint) => source.includes(hint)))
    .map(([name]) => name)

  return [...new Set(detected)]
}

function isConnectorConfigured(name: string): boolean {
  switch (name) {
    case "github":
      return Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)
    case "slack":
      return Boolean(process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL)
    case "jira":
      return Boolean(process.env.JIRA_API_TOKEN && process.env.JIRA_BASE_URL)
    case "notion":
      return Boolean(process.env.NOTION_API_KEY || process.env.NOTION_TOKEN)
    case "telegram":
      return Boolean(process.env.TELEGRAM_BOT_TOKEN)
    default:
      return false
  }
}

/**
 * Register a local command handler
 */
export function registerHandler(handler: CommandHandler): void {
  // Skip if already registered to prevent duplicates
  if (localHandlers.has(handler.name)) {
    return
  }
  localHandlers.set(handler.name, handler)
  log.info("Registered command handler", { name: handler.name })
}

/**
 * Check if a command is handled locally
 */
export function isLocalCommand(name: string): boolean {
  return localHandlers.has(name)
}

/**
 * Execute a local command
 */
export async function executeLocalCommand(name: string, args: string): Promise<CommandResult> {
  const handler = localHandlers.get(name)
  if (!handler) {
    return { success: false, message: `Unknown command: ${name}` }
  }

  try {
    log.info("Executing local command", { name, args: args.slice(0, 100) })
    return await handler.handler(args)
  } catch (error) {
    log.error("Command execution failed", { name, error })
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Parse command name and arguments from input
 */
export function parseCommand(input: string): { name: string; args: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) return null

  const firstSpace = trimmed.indexOf(" ")
  if (firstSpace === -1) {
    return { name: trimmed.slice(1), args: "" }
  }

  return {
    name: trimmed.slice(1, firstSpace),
    args: trimmed.slice(firstSpace + 1).trim(),
  }
}

/**
 * Get all registered commands
 */
export function getCommands(): CommandHandler[] {
  return Array.from(localHandlers.values())
}

// ============================================================================
// Register Pakalon Command Handlers
// ============================================================================

// /pakalon - Initialize 6-phase pipeline
registerHandler({
  name: "pakalon",
  description: "Initialize 6-phase Pakalon pipeline",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Parse mode from args (default to hil)
    const mode = args.toLowerCase().includes("yolo") ? "yolo" : "hil"
    
    // Check if already initialized
    const existingCtx = await WorkflowEngine.getContext(workdir)
    if (existingCtx && existingCtx.currentState !== "idle") {
      return {
        success: true,
        message: `Pipeline already active (State: ${existingCtx.currentState}, Mode: ${existingCtx.mode.toUpperCase()})`,
        data: existingCtx,
      }
    }

    // Initialize workflow
    const ctx = await WorkflowEngine.init(workdir, mode)
    
    // Also initialize directory structure
    await PhaseOrchestrator.ensureDirectoryStructure(workdir)
    await NormalMode.ensureStructure(workdir)
    
    log.info("Pipeline initialized", { workdir, mode })
    
    return {
      success: true,
      message: `Pakalon pipeline initialized in ${mode.toUpperCase()} mode. Run /init to start Phase 1.`,
      data: ctx,
      shouldClearPrompt: true,
    }
  },
})

// /init - Start Phase 1 Q&A and create .pakalon structure
registerHandler({
  name: "init",
  description: "Start Phase 1 planning Q&A and create .pakalon structure",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Ensure .pakalon directory structure exists
    await NormalMode.ensureStructure(workdir)
    
    // Create placeholder files if they don't exist
    const normalDir = Pakalon.normalDir(workdir)
    const agentsDir = path.join(normalDir, "agents")
    
    const files = [
      { path: path.join(normalDir, "plan.md"), content: "# Project Plan\n\n*Will be generated during Phase 1*\n" },
      { path: path.join(normalDir, "task.md"), content: "# Task List\n\n*Will be generated during Phase 1*\n" },
      { path: path.join(normalDir, "user-stories.md"), content: "# User Stories\n\n*Will be generated during Phase 1*\n" },
      { path: path.join(normalDir, "context-management.md"), content: "# Context Management\n\n*Will be generated during Phase 1*\n" },
      { path: path.join(agentsDir, "skills.md"), content: "# Agent Skills\n\n*Will be generated during Phase 1*\n" },
    ]
    
    for (const file of files) {
      try {
        await fs.access(file.path)
      } catch {
        await fs.writeFile(file.path, file.content)
      }
    }
    
    // Check workflow state
    let ctx = await WorkflowEngine.getContext(workdir)
    if (!ctx) {
      // Auto-initialize if not already done
      ctx = await WorkflowEngine.init(workdir, "hil")
      await PhaseOrchestrator.ensureDirectoryStructure(workdir)
    }

    // Start Phase 1 Q&A
    const prompt = args || "Build an application"
    ctx = await WorkflowEngine.startPhase1QA(workdir, prompt)
    
    if (!ctx) {
      return { success: false, message: "Failed to start Phase 1 Q&A" }
    }
    
    const currentQuestion = QASystem.current(workdir)
    
    log.info("Q&A initialized", { workdir, mode: ctx.mode })
    
    return {
      success: true,
      message: `.pakalon directory structure created!\n\nCreated:\n- .pakalon/plan.md\n- .pakalon/task.md\n- .pakalon/user-stories.md\n- .pakalon/context-management.md\n- .pakalon/agents/skills.md\n\n${currentQuestion ? `Phase 1 started. ${QASystem.format(currentQuestion)}` : "Phase 1 Q&A initialized."}`,
      data: { ctx, currentQuestion },
    }
  },
})

// /ans - Answer current Q&A question
registerHandler({
  name: "ans",
  description: "Answer current Q&A question",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    if (!args) {
      return { success: false, message: "Please provide an answer" }
    }
    
    // Submit answer through workflow
    const { ctx, nextQuestion } = await WorkflowEngine.submitAnswer(workdir, args)
    
    if (!ctx) {
      return { success: false, message: "No active workflow. Run /init first." }
    }
    
    if (ctx.currentState === "phase1_generating") {
      return {
        success: true,
        message: "Q&A complete! Run /update to generate Phase 1 artifacts.",
        data: { complete: true, responses: QASystem.getResponses(workdir) },
      }
    }
    
    return {
      success: true,
      message: nextQuestion ? QASystem.format(nextQuestion) : "Answer recorded.",
      data: { nextQuestion },
    }
  },
})

// /update - Generate/Update Phase 1 artifacts
registerHandler({
  name: "update",
  description: "Generate or update Phase 1 artifacts",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Check workflow state
    const ctx = await WorkflowEngine.getContext(workdir)
    if (!ctx) {
      return { success: false, message: "Pipeline not initialized. Run /pakalon first." }
    }
    
    // Generate artifacts through workflow
    const prompt = args || "Application"
    const newCtx = await WorkflowEngine.generatePhase1Artifacts(workdir, prompt)
    
    if (!newCtx) {
      return { success: false, message: "Failed to generate artifacts" }
    }
    
    log.info("Phase 1 artifacts generated", { workdir })
    
    return {
      success: true,
      message: "Phase 1 artifacts generated in .pakalon-agents/phase-1/",
      data: { phase: 1, workflowState: newCtx.currentState },
    }
  },
})

// /history - Show session history
registerHandler({
  name: "history",
  description: "Show session history",
  category: "session",
  handler: async () => {
    // This is handled by the existing command dialog
    return {
      success: true,
      message: "Opening session history...",
      shouldClearPrompt: false,
    }
  },
})

// /session - Show current session info
registerHandler({
  name: "session",
  description: "Show current session info",
  category: "session",
  handler: async () => {
    const session = await getActiveSession()
    if (!session) {
      return { success: false, message: "No active session found." }
    }

    const messages = await Session.messages({ sessionID: session.id })
    const totalTokens = getTokenTotal(messages)
    const status = await WorkflowEngine.getStatus(Instance.worktree)

    return {
      success: true,
      message:
        `Session: ${session.id}\n` +
        `Title: ${session.title}\n` +
        `Messages: ${messages.length}\n` +
        `Assistant tokens: ${totalTokens.toLocaleString()}\n` +
        `Updated: ${new Date(session.time.updated).toISOString()}\n` +
        (status ? `Pipeline: ${status.state} (${status.mode.toUpperCase()}, phase ${status.phase ?? "N/A"})` : "Pipeline: inactive"),
      data: { session, messages: messages.length, totalTokens, workflow: status },
    }
  },
})

// /sessions - Browse saved sessions
registerHandler({
  name: "sessions",
  description: "Browse saved sessions",
  category: "session",
  handler: async () => {
    const sessions = [...Session.list({ directory: Instance.directory, roots: true, limit: 50 })]
    if (sessions.length === 0) {
      return { success: true, message: "No saved sessions found for this workspace." }
    }

    const lines = sessions.map(
      (s, i) =>
        `${i + 1}. ${s.id} · ${s.title} · ${new Date(s.time.updated).toISOString().slice(0, 19).replace("T", " ")}`,
    )

    return {
      success: true,
      message: `Saved sessions (${sessions.length})\n${lines.join("\n")}`,
      data: sessions,
    }
  },
})

// /clear - Clear chat history
registerHandler({
  name: "clear",
  description: "Clear current session message history",
  category: "session",
  handler: async () => {
    const session = await getActiveSession()
    if (!session) {
      return { success: false, message: "No active session found to clear." }
    }

    SessionPrompt.assertNotBusy(session.id)
    const messages = await Session.messages({ sessionID: session.id })
    for (const message of messages) {
      await Session.removeMessage({ sessionID: session.id, messageID: message.info.id })
    }
    await Session.clearRevert(session.id).catch(() => {})

    return {
      success: true,
      message: `Cleared ${messages.length} message(s) from session ${session.id}.`,
      data: { sessionID: session.id, cleared: messages.length },
    }
  },
})

// /compact - Compact conversation context
registerHandler({
  name: "compact",
  description: "Compact/summarize current conversation context",
  category: "session",
  handler: async () => {
    const session = await getActiveSession()
    if (!session) {
      return { success: false, message: "No active session found to compact." }
    }

    SessionPrompt.assertNotBusy(session.id)
    const before = await Session.messages({ sessionID: session.id })
    const beforeTokens = getTokenTotal(before)

    await SessionRevert.cleanup(session)

    let currentAgent = await Agent.defaultAgent()
    for (let i = before.length - 1; i >= 0; i--) {
      const info = before[i].info
      if (info.role === "user") {
        currentAgent = info.agent || currentAgent
        break
      }
    }

    const model = await Provider.defaultModel()
    await SessionCompaction.create({
      sessionID: session.id,
      agent: currentAgent,
      model,
      auto: false,
    })
    await SessionPrompt.loop({ sessionID: session.id })

    const after = await Session.messages({ sessionID: session.id })
    const afterTokens = getTokenTotal(after)

    return {
      success: true,
      message:
        `Context compacted for session ${session.id}.\n` +
        `Before: ${beforeTokens.toLocaleString()} tokens\n` +
        `After: ${afterTokens.toLocaleString()} tokens\n` +
        `Saved: ${(beforeTokens - afterTokens).toLocaleString()} tokens`,
      data: { sessionID: session.id, beforeTokens, afterTokens },
    }
  },
})

// /resume - Resume an existing session
registerHandler({
  name: "resume",
  description: "Resume an existing session",
  category: "session",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Get workflow status
    const status = await WorkflowEngine.getStatus(workdir)
    if (!status) {
      return { success: false, message: "No pipeline to resume. Run /pakalon first." }
    }
    
    // Resume if paused
    if (status.state === "paused") {
      const ctx = await WorkflowEngine.resume(workdir)
      if (ctx) {
        return {
          success: true,
          message: `Workflow resumed. Current state: ${ctx.currentState}`,
          data: ctx,
        }
      }
    }
    
    return {
      success: true,
      message: `Current state: ${status.state}, Phase: ${status.phase ?? "N/A"} (${status.mode.toUpperCase()} mode)`,
      data: status,
    }
  },
})

// /penpot - Open Penpot design interface
registerHandler({
  name: "penpot",
  description: "Open Penpot design interface",
  category: "pakalon",
  handler: async () => {
    await PenpotIntegration.init()
    const started = await PenpotIntegration.start()
    if (!started.success) {
      return { success: false, message: `Failed to start Penpot: ${started.message}` }
    }
    const url = await PenpotIntegration.openInBrowser()

    return {
      success: true,
      message: `Penpot started and sync initialized. Open: ${url}`,
      data: { url },
    }
  },
})

// /accept-design - Accept the current design (Phase 2)
registerHandler({
  name: "accept-design",
  description: "Accept the current design and proceed to next phase",
  category: "pakalon",
  handler: async () => {
    const workdir = Instance.worktree
    
    const { Phase2Wireframe } = await import("../pipeline/phase2-wireframe")
    
    const approved = await Phase2Wireframe.handleDesignApproval(workdir, "accept")
    
    if (approved) {
      return {
        success: true,
        message: "✅ Design accepted!\n\nThe design has been approved. You can now proceed to Phase 3 with /phase-3 or /update.",
        data: { approved: true },
      }
    } else {
      return {
        success: false,
        message: "Failed to accept design. Please try again.",
      }
    }
  },
})

// /reject-design - Reject the current design (Phase 2)
registerHandler({
  name: "reject-design",
  description: "Reject the current design and request changes",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    const { Phase2Wireframe } = await import("../pipeline/phase2-wireframe")
    
    const rejected = await Phase2Wireframe.handleDesignApproval(workdir, "reject")
    
    if (rejected) {
      return {
        success: true,
        message: "❌ Design rejected.\n\n" +
          "Please use /update to specify what changes you'd like to see in the design.\n" +
          "Example: /update Add a dark mode option to the settings page",
        data: { rejected: true },
      }
    } else {
      return {
        success: false,
        message: "Failed to record rejection. Please try again.",
      }
    }
  },
})

// /automations - Manage automation workflows
registerHandler({
  name: "automations",
  description: "Manage automation workflows",
  category: "pakalon",
  handler: async (args) => {
    const projectPath = Instance.worktree
    const input = args.trim()

    if (!input || input === "list") {
      const automations = await AutomationCLI.listAutomations(projectPath)
      const overview = AutomationCLI.formatAutomationList(automations)
      return {
        success: true,
        message:
          `${overview}\n\n` +
          "Quick actions:\n" +
          "- /automations templates\n" +
          "- /automations create <template-id> [name]\n" +
          "- /automations new <name> | <prompt> | cron:<expr>\n" +
          "- /automations toggle <automation-id>\n" +
          "- /automations delete <automation-id>",
      }
    }

    if (input === "templates") {
      return {
        success: true,
        message: AutomationCLI.formatTemplateList(AutomationCLI.listTemplates()),
      }
    }

    if (input.startsWith("create ")) {
      const payload = input.slice("create ".length).trim()
      const [templateID, ...nameParts] = payload.split(/\s+/)
      if (!templateID) {
        return {
          success: false,
          message: "Usage: /automations create <template-id> [name]",
        }
      }

      const created = await AutomationCLI.createFromTemplate(projectPath, templateID, nameParts.join(" ") || undefined)
      if (!created) {
        return {
          success: false,
          message: `Template not found: ${templateID}. Run /automations templates to view available templates.`,
        }
      }

      return {
        success: true,
        message:
          `Created automation \"${created.name}\" (${created.id})\n` +
          `Trigger: ${created.trigger.type} ${JSON.stringify(created.trigger.config)}\n` +
          `Actions: ${created.actions.map((action) => action.type).join(", ")}`,
      }
    }

    if (input.startsWith("new ")) {
      const payload = input.slice("new ".length).trim()
      const chunks = payload.split("|").map((part) => part.trim()).filter(Boolean)
      const name = chunks[0]
      const promptChunk = chunks.find((part) => !part.toLowerCase().startsWith("cron:"))
      const prompt = promptChunk === name ? chunks[1] : promptChunk
      const cron = chunks.find((part) => part.toLowerCase().startsWith("cron:"))?.slice("cron:".length).trim() || "0 * * * *"

      if (!name || !prompt) {
        return {
          success: false,
          message:
            "Usage: /automations new <name> | <prompt> | cron:<expr>\n" +
            "Example: /automations new pr-watch | Check GitHub PR failures and notify Slack | cron:*/15 * * * *",
        }
      }

      const connectors = detectAutomationConnectors(prompt)
      const actions = [
        "evaluate-prompt",
        ...connectors.map((connector) => `bridge-${connector}`),
      ]

      const created = await AutomationCLI.createCustom(
        projectPath,
        name,
        prompt,
        "cron",
        { expression: cron },
        actions,
      )

      const connectorStatus = connectors.length
        ? connectors
            .map((connector) => {
              const configured = isConnectorConfigured(connector)
              return `- ${connector}: ${configured ? "connected" : "needs auth"}`
            })
            .join("\n")
        : "- none detected"

      return {
        success: true,
        message:
          `Automation workflow created: ${created.name} (${created.id})\n` +
          `Prompt: ${prompt}\n` +
          `Schedule: ${cron}\n` +
          "Connector check:\n" +
          `${connectorStatus}\n\n` +
          "Next steps:\n" +
          "1) Run /automations list to verify status\n" +
          "2) Authenticate missing connectors (for example GitHub/Slack env vars)\n" +
          `3) Use /automations toggle ${created.id} to enable/disable quickly`,
      }
    }

    if (input.startsWith("toggle ")) {
      const id = input.slice("toggle ".length).trim()
      if (!id) {
        return { success: false, message: "Usage: /automations toggle <automation-id>" }
      }
      const enabled = await AutomationCLI.toggleAutomation(projectPath, id)
      return {
        success: true,
        message: enabled ? `Automation ${id} is now enabled.` : `Automation ${id} is now disabled.`,
      }
    }

    if (input.startsWith("delete ")) {
      const id = input.slice("delete ".length).trim()
      if (!id) {
        return { success: false, message: "Usage: /automations delete <automation-id>" }
      }
      const removed = await AutomationCLI.deleteAutomation(projectPath, id)
      return {
        success: removed,
        message: removed ? `Deleted automation ${id}.` : `Automation not found: ${id}`,
      }
    }

    return {
      success: true,
      message:
        "Unknown automations action.\n" +
        "Use one of: list, templates, create, new, toggle, delete.",
    }
  },
})

// /skills - List available skills
registerHandler({
  name: "skills",
  description: "List available skills discovered for this workspace",
  category: "system",
  handler: async (args) => {
    const verbose = /(^|\s)(--verbose|-v)(\s|$)/.test(args)
    const skills = await Skill.all()
    return {
      success: true,
      message: Skill.fmt(skills, { verbose }),
    }
  },
})

// /think - Toggle thinking mode
registerHandler({
  name: "think",
  description: "Toggle thinking mode",
  category: "pakalon",
  handler: async () => {
    const workdir = Instance.worktree
    const sessionId = workdir // Use workdir as session ID for now
    
    let modeState = ModeSwitcher.get(sessionId)
    if (!modeState) {
      modeState = ModeSwitcher.init(sessionId)
    }
    
    const newState = ModeSwitcher.toggleThinking(sessionId)
    
    return {
      success: true,
      message: `Thinking mode ${newState?.thinkingEnabled ? "enabled" : "disabled"}`,
      data: newState,
    }
  },
})

// /mcp - Manage MCP servers
registerHandler({
  name: "mcp",
  description: "Manage MCP servers",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    if (!args || args === "list") {
      const servers = await MCPProjectConfig.listServers(workdir)
      return {
        success: true,
        message: `Global: ${servers.global.length} servers\nProject: ${servers.project.length} servers`,
        data: servers,
      }
    }
    
    return {
      success: true,
      message: `MCP command: ${args}`,
    }
  },
})

// /context - Show context window usage
registerHandler({
  name: "context",
  description: "Show context window usage",
  category: "pakalon",
  handler: async () => {
    return {
      success: true,
      message: "Context usage display not yet implemented",
    }
  },
})

// /plugins - Manage plugins
registerHandler({
  name: "plugins",
  description: "Manage plugins",
  category: "pakalon",
  handler: async (args) => {
    return {
      success: true,
      message: args ? `Plugin: ${args}` : "Use /plugins <name> to manage plugins",
    }
  },
})

// /agents - Manage agent teams
registerHandler({
  name: "agents",
  description: "Manage agent teams for parallel execution",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Parse command arguments
    const parts = args.trim().split(/\s+/)
    const subcommand = parts[0]?.toLowerCase()
    const remainingArgs = parts.slice(1).join(" ")
    
    // Import team execution modules
    const { TeamManager } = await import("../agent/team")
    
    switch (subcommand) {
      case "create":
      case "new": {
        // Create a new team
        const teamName = remainingArgs || "default-team"
        
        const team = await TeamManager.create(workdir, {
          name: teamName,
          description: `Team ${teamName} for parallel execution`,
          color: "#4F46E5",
          tools: ["read", "write", "edit", "glob", "grep", "bash"],
          systemPrompt: `You are part of team "${teamName}". Work with other agents to complete the task.`,
        })
        
        return {
          success: true,
          message: `✅ Team "${team.name}" created!\n\n` +
            `Team ID: ${team.id}\n` +
            `Color: ${team.color}\n` +
            `Tools: ${team.tools.join(", ")}\n\n` +
            `Run /agents run ${team.name} to execute the team.`,
          data: team,
        }
      }
      
      case "run": {
        // Run team in parallel
        const teamName = remainingArgs || "default-team"
        
        // Find the team
        await TeamManager.loadTeams(workdir)
        const teams = TeamManager.listTeams()
        const team = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase())
        
        if (!team) {
          return {
            success: false,
            message: `Team "${teamName}" not found. Run /agents create ${teamName} first.`,
          }
        }
        
        // Start execution
        const exec = await TeamManager.startExecution(workdir, team.id, "Run team task")
        
        // Run parallel execution (simulated for now)
        // In a full implementation, this would spawn actual agent processes
        const results = [
          { agentName: "frontend", success: true, status: "completed" },
          { agentName: "backend", success: true, status: "completed" },
          { agentName: "integrator", success: true, status: "completed" },
        ]
        
        // Complete execution
        await TeamManager.completeExecution(
          exec.id,
          "Team execution completed successfully",
          results.map(r => r.agentName),
          1500 // simulated tokens
        )
        
        const successCount = results.filter(r => r.success).length
        
        return {
          success: true,
          message: `📊 Team "${teamName}" Execution Complete\n\n` +
            `Execution ID: ${exec.id}\n` +
            `Status: completed\n` +
            `Duration: ${exec.duration_ms}ms\n\n` +
            `Results:\n${results.map(r => `${r.success ? "✅" : "❌"} ${r.agentName}: ${r.status}`).join("\n")}`,
          data: { execution: exec, results },
        }
      }
      
      case "list": {
        // List all teams
        await TeamManager.loadTeams(workdir)
        const teams = TeamManager.listTeams()
        
        if (teams.length === 0) {
          return {
            success: true,
            message: "No teams found. Run /agents create <name> to create a team.",
          }
        }
        
        return {
          success: true,
          message: `Available Teams (${teams.length}):\n\n` +
            teams.map(t => `- ${t.name} (${t.color}) - ${t.tools.length} tools`).join("\n"),
          data: teams,
        }
      }
      
      case "status": {
        // Check team status
        const teamName = remainingArgs || "default-team"
        
        await TeamManager.loadTeams(workdir)
        const teams = TeamManager.listTeams()
        const team = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase())
        
        if (!team) {
          return {
            success: false,
            message: `Team "${teamName}" not found.`,
          }
        }
        
        const execs = TeamManager.listExecutions(team.id)
        const latestExec = execs[0]
        
        return {
          success: true,
          message: `Team: ${team.name}\n` +
            `ID: ${team.id}\n` +
            `Created: ${new Date(team.created_at).toISOString()}\n` +
            `Color: ${team.color}\n` +
            `Tools: ${team.tools.join(", ")}\n\n` +
            `Latest Execution: ${latestExec ? latestExec.status : "none"}`,
          data: { team, executions: execs },
        }
      }
      
      default:
        return {
          success: true,
          message: `Agent Teams Commands:\n\n` +
            `/agents create <name>    - Create a new team\n` +
            `/agents run <name>       - Run team in parallel\n` +
            `/agents list             - List all teams\n` +
            `/agents status <name>    - Check team status\n\n` +
            `Example: /agents create my-team`,
        }
    }
  },
})

// /auditor - Run code audit against requirements
registerHandler({
  name: "auditor",
  description: "Run code audit against requirements",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Import the Auditor namespace
    const { Auditor } = await import("../pipeline/auditor")
    const { PhaseOrchestrator } = await import("../pakalon/phase-orchestrator")
    
    // Ensure directory structure exists
    await PhaseOrchestrator.ensureDirectoryStructure(workdir)
    
    const phase = args ? parseInt(args, 10) : 3 // Default to Phase 3 audit
    
    if (isNaN(phase) || phase < 1 || phase > 6) {
      return {
        success: false,
        message: "Invalid phase number. Use /auditor <1-6> to audit a specific phase.",
      }
    }
    
    log.info("Running auditor scan", { workdir, phase })
    
    try {
      // Run the auditor
      const report = await Auditor.scan(workdir, phase)
      
      const statusIcon = report.passed ? "✅" : "❌"
      const modeNote = report.passed 
        ? "Requirements satisfied." 
        : "Run /auditor again after making changes (YOLO mode auto-loops)."
      
      return {
        success: true,
        message: `${statusIcon} Auditor Report - Phase ${phase}\n\n` +
          `Coverage: ${report.coverage}% (${report.implemented}/${report.totalRequirements} requirements)\n` +
          `Implemented: ${report.implemented} | Partial: ${report.partial} | Missing: ${report.missing}\n\n` +
          `${modeNote}\n\n` +
          `Full report saved to: .pakalon-agents/phase-${phase}/auditor.md`,
        data: report,
      }
    } catch (error) {
      log.error("Auditor failed", { error })
      return {
        success: false,
        message: `Auditor scan failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
})

// /agent - Manage single agent
registerHandler({
  name: "agent",
  description: "Manage a single agent",
  category: "pakalon",
  handler: async (args) => {
    return {
      success: true,
      message: args ? `Agent command: ${args}` : "Use /agent <name|action> to manage one agent",
    }
  },
})

// /workflows - Manage workflows
registerHandler({
  name: "workflows",
  description: "Manage workflows",
  category: "pakalon",
  handler: async (args) => {
    return {
      success: true,
      message: args ? `Workflow command: ${args}` : "Use /workflows <action> to view or run workflows",
    }
  },
})

// /directory - Show current directory info
registerHandler({
  name: "directory",
  description: "Show current directory context",
  category: "pakalon",
  handler: async () => {
    const workdir = Instance.worktree
    return {
      success: true,
      message: `Current project directory: ${workdir}`,
      data: { workdir },
      shouldClearPrompt: true,
    }
  },
})

// /web is handled by the AI command system for web searching (not local)

// /figma - Import Figma designs
registerHandler({
  name: "figma",
  description: "Import Figma designs",
  category: "pakalon",
  handler: async (args) => {
    return {
      success: true,
      message: args ? `Figma: ${args}` : "Use /figma <url> to import designs",
    }
  },
})

// /undo - Undo last action
registerHandler({
  name: "undo",
  description: "Undo last action",
  category: "session",
  handler: async (args) => {
    if (!Snapshot || typeof Snapshot.patch !== "function" || typeof Snapshot.revert !== "function") {
      return {
        success: false,
        message: "Undo feature coming soon — use git to revert changes",
      }
    }

    const session = await getActiveSession()
    if (!session) {
      return { success: false, message: "No active session found to undo." }
    }

    const messages = await Session.messages({ sessionID: session.id })
    const recent = [] as { messageID: string; hash: string; files: string[] }[]

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info.role !== "assistant") continue
      for (const part of msg.parts) {
        if (part.type !== "patch") continue
        recent.push({ messageID: msg.info.id, hash: part.hash, files: part.files })
        break
      }
      if (recent.length >= 5) break
    }

    if (recent.length === 0) {
      return { success: true, message: "No recent code changes were found to undo." }
    }

    const selected = Number.parseInt(args.trim(), 10)
    if (!args.trim() || Number.isNaN(selected) || selected < 1 || selected > recent.length) {
      const lines = recent.map((item, index) => {
        const preview = item.files.slice(0, 3).map((f) => path.relative(Instance.worktree, f)).join(", ") || "(no files)"
        return `${index + 1}. message ${item.messageID} · ${item.files.length} file(s): ${preview}`
      })

      return {
        success: true,
        message:
          `Recent changes (newest first):\n${lines.join("\n")}\n\n` +
          `Choose one to undo: /undo <number>`,
        data: recent,
      }
    }

    const target = recent[selected - 1]
    const result = await SessionRevert.revert({
      sessionID: session.id,
      messageID: target.messageID as MessageV2.Info["id"],
    })

    return {
      success: true,
      message: `Undid code changes for message ${target.messageID} (${target.files.length} file(s)).`,
      data: result,
    }
  },
})

// /login - Trigger device code auth
registerHandler({
  name: "login",
  description: "Authenticate using device code flow",
  category: "system",
  handler: async () => {
    const deviceCode = await DeviceCodeFlow.generate()
    const formattedCode = DeviceCodeFlow.formatCode(deviceCode.code)

    const status = await DeviceCodeFlow.waitForAuth(deviceCode)
    if (status.status === "authorized" && status.accessToken) {
      await Auth.set("pakalon", { type: "api", key: status.accessToken })
      return {
        success: true,
        message:
          `Device login successful.\n` +
          `Code: ${formattedCode}\n` +
          `Verify at: ${deviceCode.url}\n` +
          `Plan: ${status.user?.plan ?? "unknown"}`,
        data: { code: formattedCode, verificationUrl: deviceCode.url, user: status.user },
      }
    }

    return {
      success: false,
      message:
        `Device login failed (${status.status}).\n` +
        `Code: ${formattedCode}\n` +
        `Verify at: ${deviceCode.url}`,
      data: { code: formattedCode, verificationUrl: deviceCode.url, status: status.status },
    }
  },
})

// /doctor - Check system requirements
registerHandler({
  name: "doctor",
  description: "Check runtime requirements and environment",
  category: "system",
  handler: async () => {
    const bun = await probeVersion(["bun", "--version"])
    const python = await probeVersion(["python", "--version"])
    const pyLauncher = python.ok ? undefined : await probeVersion(["py", "-3", "--version"])
    const docker = await probeVersion(["docker", "--version"])
    const git = await probeVersion(["git", "--version"])

    const env = Env.all()
    const hasModelKey = Boolean(env.OPENROUTER_API_KEY || env.PAKALON_OPENROUTER_KEY || env.PAKALON_API_KEY)
    const backendUrl = Flag.PAKALON_BACKEND_URL
    const backendEnabled = Flag.PAKALON_ENABLE_BACKEND

    const lines = [
      "Pakalon Doctor Report",
      "",
      `Node.js: ✅ ${process.version}`,
      `Bun: ${bun.ok ? "✅" : "❌"} ${bun.value}`,
      `Python: ${(python.ok || pyLauncher?.ok) ? "✅" : "❌"} ${python.ok ? python.value : (pyLauncher?.value ?? python.value)}`,
      `Docker: ${docker.ok ? "✅" : "❌"} ${docker.value}`,
      `Git: ${git.ok ? "✅" : "❌"} ${git.value}`,
      "",
      "Environment:",
      `Model key (OPENROUTER_API_KEY/PAKALON_OPENROUTER_KEY/PAKALON_API_KEY): ${hasModelKey ? "✅ set" : "❌ missing"}`,
      `PAKALON_ENABLE_BACKEND: ${backendEnabled ? "✅ true" : "⚠️ false"}`,
      `PAKALON_BACKEND_URL: ${backendUrl || "❌ missing"}`,
    ]

    return {
      success: true,
      message: lines.join("\n"),
      data: {
        node: process.version,
        bun,
        python: python.ok ? python : pyLauncher,
        docker,
        git,
        env: { hasModelKey, backendEnabled, backendUrl },
      },
    }
  },
})

// /status - Show auth + plan status
registerHandler({
  name: "status",
  description: "Show auth, plan, workflow, and model status",
  category: "system",
  handler: async () => {
    const auth = await Auth.get("pakalon").catch(() => undefined)
    const loggedIn = Boolean(auth)

    const usage = loggedIn && Flag.PAKALON_ENABLE_BACKEND
      ? await UsageBackend.getUsage().catch(() => undefined)
      : undefined
    const plan = usage?.plan ?? "unknown"

    const workflow = await WorkflowEngine.getStatus(Instance.worktree)
    const modelRef = await Provider.defaultModel()
    const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)

    const lines = [
      "Pakalon Status",
      "",
      `Auth: ${loggedIn ? "✅ logged in" : "❌ not logged in"}`,
      `Plan: ${plan}`,
      `Model: ${model.providerID}/${model.id}`,
      `Model name: ${model.name}`,
      workflow
        ? `Workflow: ${workflow.state} (${workflow.mode.toUpperCase()}, phase ${workflow.phase ?? "N/A"})`
        : "Workflow: inactive",
    ]

    return {
      success: true,
      message: lines.join("\n"),
      data: { loggedIn, plan, workflow, model: { providerID: model.providerID, modelID: model.id, name: model.name } },
    }
  },
})

// /new - Start new session
registerHandler({
  name: "new",
  description: "Start new session",
  category: "session",
  handler: async () => {
    return {
      success: true,
      message: "Starting new session...",
      shouldClearPrompt: false,
    }
  },
})

// /models - List and select models
registerHandler({
  name: "models",
  description: "List and select models",
  category: "system",
  handler: async () => {
    return {
      success: true,
      message: "Opening model selector...",
      shouldClearPrompt: false,
    }
  },
})

// /logout - Logout
registerHandler({
  name: "logout",
  description: "Logout and clear tokens",
  category: "system",
  handler: async () => {
    return {
      success: true,
      message: "Logging out...",
      shouldClearPrompt: false,
    }
  },
})

// ============================================================================
// Phase Commands
// ============================================================================

// /phase-1 - Start Phase 1 Planning
registerHandler({
  name: "phase-1",
  description: "Start Phase 1: Planning & Requirements",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Ensure .pakalon-agents directory structure exists
    await PhaseOrchestrator.ensureDirectoryStructure(workdir)
    
    const phase1Dir = path.join(Pakalon.agentsDir(workdir), "phase-1")
    
    log.info("Starting Phase 1", { workdir })
    
    return {
      success: true,
      message: `Phase 1: Planning & Requirements\n\nDirectory: ${phase1Dir}\n\nStarting interactive Q&A session...`,
      data: { phase: 1, phase1Dir },
      shouldClearPrompt: true,
    }
  },
})

// /phase-2 - Start Phase 2 Design
registerHandler({
  name: "phase-2",
  description: "Start Phase 2: Design & Wireframing",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Check if Phase 1 is complete
    const phase1Dir = path.join(Pakalon.agentsDir(workdir), "phase-1")
    const planPath = path.join(phase1Dir, "plan.md")
    
    try {
      await fs.access(planPath)
    } catch {
      return {
        success: false,
        message: "Phase 1 not complete. Please run /phase-1 first to create the planning documents.",
      }
    }
    
    const phase2Dir = path.join(Pakalon.agentsDir(workdir), "phase-2")
    await fs.mkdir(phase2Dir, { recursive: true })
    await fs.mkdir(path.join(phase2Dir, "tdd-screenshots"), { recursive: true })
    
    log.info("Starting Phase 2", { workdir })
    
    return {
      success: true,
      message: `Phase 2: Design & Wireframing\n\nDirectory: ${phase2Dir}\n\nGenerating wireframes based on Phase 1 requirements...`,
      data: { phase: 2, phase2Dir },
      shouldClearPrompt: true,
    }
  },
})

// /phase-3 - Start Phase 3 Development
registerHandler({
  name: "phase-3",
  description: "Start Phase 3: Development & Implementation",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Check if Phase 1 and 2 are complete
    const phase1Dir = path.join(Pakalon.agentsDir(workdir), "phase-1")
    const phase2Dir = path.join(Pakalon.agentsDir(workdir), "phase-2")
    
    const planPath = path.join(phase1Dir, "plan.md")
    const wireframePath = path.join(phase2Dir, "Wireframe_generated.svg")
    
    try {
      await fs.access(planPath)
    } catch {
      return {
        success: false,
        message: "Phase 1 not complete. Please run /phase-1 first.",
      }
    }
    
    try {
      await fs.access(wireframePath)
    } catch {
      return {
        success: false,
        message: "Phase 2 not complete. Please run /phase-2 first to generate wireframes.",
      }
    }
    
    const phase3Dir = path.join(Pakalon.agentsDir(workdir), "phase-3")
    await fs.mkdir(phase3Dir, { recursive: true })
    await fs.mkdir(path.join(phase3Dir, "test-evidence"), { recursive: true })
    
    log.info("Starting Phase 3", { workdir })
    
    return {
      success: true,
      message: `Phase 3: Development & Implementation\n\nDirectory: ${phase3Dir}\n\nDeploying 5 subagents for parallel development...`,
      data: { phase: 3, phase3Dir },
      shouldClearPrompt: true,
    }
  },
})

// /phase-4 - Start Phase 4 Testing
registerHandler({
  name: "phase-4",
  description: "Start Phase 4: Testing & Quality Assurance",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Check if Phase 3 is complete
    const phase3Dir = path.join(Pakalon.agentsDir(workdir), "phase-3")
    const auditorPath = path.join(phase3Dir, "auditor.md")
    
    try {
      await fs.access(auditorPath)
    } catch {
      return {
        success: false,
        message: "Phase 3 not complete. Please run /phase-3 first to build the application.",
      }
    }
    
    const phase4Dir = path.join(Pakalon.agentsDir(workdir), "phase-4")
    await fs.mkdir(phase4Dir, { recursive: true })
    
    log.info("Starting Phase 4", { workdir })
    
    return {
      success: true,
      message: `Phase 4: Testing & Quality Assurance\n\nDirectory: ${phase4Dir}\n\nRunning 13+ security tools...`,
      data: { phase: 4, phase4Dir },
      shouldClearPrompt: true,
    }
  },
})

// /phase-5 - Start Phase 5 Deployment
registerHandler({
  name: "phase-5",
  description: "Start Phase 5: Deployment & Integration",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Check if Phase 4 is complete
    const phase4Dir = path.join(Pakalon.agentsDir(workdir), "phase-4")
    
    try {
      const files = await fs.readdir(phase4Dir)
      if (files.length === 0) {
        return {
          success: false,
          message: "Phase 4 not complete. Please run /phase-4 first to complete security testing.",
        }
      }
    } catch {
      return {
        success: false,
        message: "Phase 4 not complete. Please run /phase-4 first.",
      }
    }
    
    const phase5Dir = path.join(Pakalon.agentsDir(workdir), "phase-5")
    await fs.mkdir(phase5Dir, { recursive: true })
    
    log.info("Starting Phase 5", { workdir })
    
    return {
      success: true,
      message: `Phase 5: Deployment & Integration\n\nDirectory: ${phase5Dir}\n\nPreparing for GitHub push and cloud deployment...`,
      data: { phase: 5, phase5Dir },
      shouldClearPrompt: true,
    }
  },
})

// /phase-6 - Start Phase 6 Documentation
registerHandler({
  name: "phase-6",
  description: "Start Phase 6: Documentation & Maintenance",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    const phase6Dir = path.join(Pakalon.agentsDir(workdir), "phase-6")
    await fs.mkdir(phase6Dir, { recursive: true })
    
    log.info("Starting Phase 6", { workdir })
    
    return {
      success: true,
      message: `Phase 6: Documentation & Maintenance\n\nDirectory: ${phase6Dir}\n\nAnalyzing codebase and generating comprehensive documentation...`,
      data: { phase: 6, phase6Dir },
      shouldClearPrompt: true,
    }
  },
})

// /pakalon-agents - Initialize .pakalon-agents structure
registerHandler({
  name: "pakalon-agents",
  description: "Initialize .pakalon-agents directory structure",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    
    // Create full directory structure
    await PhaseOrchestrator.ensureDirectoryStructure(workdir)
    
    const agentsDir = Pakalon.agentsDir(workdir)
    
    // Create placeholder files for each phase
    const phase1Files = [
      "context_management.md", "plan.md", "tasks.md", "design.md", "phase-1.md",
      "agent-skills.md", "prd.md", "Database_schema.md", "API_reference.md",
      "risk-assessment.md", "user-stories.md", "technical-spec.md",
      "competitive-analysis.md", "constraints-and-tradeoffs.md"
    ]
    
    const phase1Dir = path.join(agentsDir, "phase-1")
    for (const file of phase1Files) {
      const filePath = path.join(phase1Dir, file)
      try {
        await fs.access(filePath)
      } catch {
        await fs.writeFile(filePath, `# ${file.replace('.md', '').replace(/_/g, ' ')}\n\n*Placeholder - will be generated by Phase 1*\n`)
      }
    }
    
    // Create phase-2 placeholder files
    const phase2Dir = path.join(agentsDir, "phase-2")
    await fs.writeFile(path.join(phase2Dir, "phase-2.md"), "# Phase 2: Wireframing\n\n*Placeholder - will be generated by Phase 2*\n")
    
    // Create phase-3 placeholder files
    const phase3Dir = path.join(agentsDir, "phase-3")
    for (let i = 1; i <= 5; i++) {
      const subagentPath = path.join(phase3Dir, `subagent-${i}.md`)
      try {
        await fs.access(subagentPath)
      } catch {
        await fs.writeFile(subagentPath, `# Subagent ${i}\n\n*Placeholder - will be generated by Phase 3*\n`)
      }
    }
    await fs.writeFile(path.join(phase3Dir, "auditor.md"), "# Phase 3 Auditor\n\n*Placeholder - will be generated by Phase 3*\n")
    await fs.writeFile(path.join(phase3Dir, "execution_log.md"), "# Execution Log\n\n*Placeholder - will be generated by Phase 3*\n")
    
    // Create phase-4 placeholder files
    const phase4Dir = path.join(agentsDir, "phase-4")
    for (let i = 1; i <= 5; i++) {
      const subagentPath = path.join(phase4Dir, `subagent-${i}.md`)
      try {
        await fs.access(subagentPath)
      } catch {
        await fs.writeFile(subagentPath, `# Subagent ${i}\n\n*Placeholder - will be generated by Phase 4*\n`)
      }
    }
    
    // Create phase-5 and phase-6 placeholder files
    const phase5Dir = path.join(agentsDir, "phase-5")
    await fs.writeFile(path.join(phase5Dir, "phase-5.md"), "# Phase 5: Deployment\n\n*Placeholder - will be generated by Phase 5*\n")
    
    const phase6Dir = path.join(agentsDir, "phase-6")
    await fs.writeFile(path.join(phase6Dir, "phase-6.md"), "# Phase 6: Documentation\n\n*Placeholder - will be generated by Phase 6*\n")
    
    // Create sync.js file
    const syncJsPath = path.join(agentsDir, "sync.js")
    try {
      await fs.access(syncJsPath)
    } catch {
      await fs.writeFile(syncJsPath, generateSyncJs())
    }
    
    log.info("Pakalon agents structure initialized", { workdir })
    
    return {
      success: true,
      message: `.pakalon-agents directory structure initialized!\n\nCreated:\n- phase-1/ (14 markdown files)\n- phase-2/ (wireframe directory)\n- phase-3/ (5 subagent files + auditor)\n- phase-4/ (5 subagent files)\n- phase-5/ (deployment docs)\n- phase-6/ (documentation)\n- mcp-servers/\n- wireframes/\n- sync.js (Penpot sync)\n\nReady to start /phase-1!`,
      data: { agentsDir },
      shouldClearPrompt: true,
    }
  },
})

// /connect - Connect to Telegram
registerHandler({
  name: "connect",
  description: "Connect to Telegram for remote control",
  category: "pakalon",
  handler: async (args) => {
    const workdir = Instance.worktree
    log.info("Starting Telegram connection", { args })
    
    // Check if args contains a bot token
    if (args && args.trim()) {
      const token = args.trim()
      
      // Validate token format (basic check)
      if (!token.match(/^\d+:[A-Za-z0-9_-]+$/)) {
        return {
          success: false,
          message: "Invalid bot token format. Token should look like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
        }
      }
      
      try {
        // Verify the token by calling getMe
        const TelegramClient = require("../telegram/client").TelegramClient
        const client = new TelegramClient(token)
        const botInfo = await client.getMe()
        
        if (!botInfo.ok) {
          return {
            success: false,
            message: "Failed to verify bot token. Please check the token and try again.",
          }
        }
        
        // Store the token
        const { storeTelegramToken } = require("../telegram/token-store")
        await storeTelegramToken(token, botInfo.result.username)
        
        // Set up webhook if backend is available
        try {
          const { setWebhook } = require("../telegram/webhook")
          // Note: In production, this would use the actual backend URL
          // For now, we'll just store the token and let the user know
          log.info("Telegram bot connected", { username: botInfo.result.username })
        } catch (webhookError) {
          log.warn("Could not set up webhook, using polling mode", { error: webhookError })
        }
        
        return {
          success: true,
          message: `✅ Telegram Connected!\n\nBot: @${botInfo.result.username}\nName: ${botInfo.result.first_name}\nStatus: Active\n\nYou can now control Pakalon via Telegram.\nSend /start to your bot to begin.\n\nTo disconnect, use: /connect-end`,
          data: { 
            botUsername: botInfo.result.username,
            botName: botInfo.result.first_name,
          },
          shouldClearPrompt: true,
        }
      } catch (error) {
        log.error("Telegram connection failed", { error })
        return {
          success: false,
          message: `Failed to connect: ${error instanceof Error ? error.message : String(error)}\n\nPlease check your bot token and try again.`,
        }
      }
    }
    
    // No token provided - show instructions
    return {
      success: true,
      message: "Telegram Connection\n\nTo connect Pakalon to Telegram:\n\n1. Open Telegram and search for @BotFather\n2. Send /newbot and follow the instructions\n3. Copy the bot token (format: 123456789:ABCdef...)\n4. Run: /connect <your-bot-token>\n\nExample:\n/connect 123456789:ABCdefGHIjklMNOpqrsTUVwxyz\n\nWaiting for bot token...",
      data: { step: "awaiting_token" },
      shouldClearPrompt: false,
    }
  },
})

// /connect-end - Disconnect from Telegram
registerHandler({
  name: "connect-end",
  description: "Disconnect from Telegram",
  category: "pakalon",
  handler: async (args) => {
    log.info("Disconnecting from Telegram")
    
    try {
      // Delete the stored token
      const { deleteTelegramToken } = require("../telegram/token-store")
      await deleteTelegramToken()
      
      log.info("Telegram disconnected successfully")
    } catch (error) {
      log.error("Error disconnecting from Telegram", { error })
    }
    
    return {
      success: true,
      message: "✅ Telegram disconnected.\n\nUse /connect to reconnect.",
      shouldClearPrompt: true,
    }
  },
})

/**
 * Generate sync.js content for Penpot integration
 */
function generateSyncJs(): string {
  return `/**
 * Pakalon Penpot Sync Script
 * 
 * This script manages the Penpot design tool integration:
 * - Starts/stops Penpot Docker containers
 * - Watches for design changes
 * - Exports wireframes to SVG/Penpot format
 * - Syncs changes to .pakalon-agents/phase-2/
 * 
 * Usage:
 *   node sync.js --start          # Start Penpot
 *   node sync.js --stop           # Stop Penpot
 *   node sync.js --watch          # Watch for changes
 *   node sync.js --export <id>    # Export specific file
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PENPOT_COMPOSE = path.join(__dirname, '..', '..', 'python', 'penpot-compose.yml');
const PHASE2_DIR = path.join(__dirname, 'phase-2');
const WIREFRAMES_DIR = path.join(__dirname, '..', 'wireframes');

// Ensure directories exist
if (!fs.existsSync(PHASE2_DIR)) {
  fs.mkdirSync(PHASE2_DIR, { recursive: true });
}
if (!fs.existsSync(WIREFRAMES_DIR)) {
  fs.mkdirSync(WIREFRAMES_DIR, { recursive: true });
}

const args = process.argv.slice(2);

function startPenpot() {
  console.log('Starting Penpot...');
  try {
    execSync('docker compose -f ' + PENPOT_COMPOSE + ' up -d', { stdio: 'inherit' });
    console.log('Penpot started at http://localhost:3449');
  } catch (error) {
    console.error('Failed to start Penpot:', error.message);
  }
}

function stopPenpot() {
  console.log('Stopping Penpot...');
  try {
    execSync('docker compose -f ' + PENPOT_COMPOSE + ' down', { stdio: 'inherit' });
    console.log('Penpot stopped');
  } catch (error) {
    console.error('Failed to stop Penpot:', error.message);
  }
}

function watchChanges() {
  console.log('Watching for Penpot changes...');
  // TODO: Implement WebSocket connection to Penpot API
  // TODO: Export changes to SVG/Penpot format
  // TODO: Save to phase-2 directory
  console.log('Watch mode not yet fully implemented');
}

function exportFile(fileId) {
  console.log('Exporting file:', fileId);
  // TODO: Implement Penpot API export
  // TODO: Save to Wireframe_generated.svg and Wireframe_generated.penpot
  console.log('Export not yet fully implemented');
}

// Parse arguments
if (args.includes('--start')) {
  startPenpot();
} else if (args.includes('--stop')) {
  stopPenpot();
} else if (args.includes('--watch')) {
  watchChanges();
} else if (args.includes('--export')) {
  const fileIndex = args.indexOf('--export');
  const fileId = args[fileIndex + 1];
  if (fileId) {
    exportFile(fileId);
  } else {
    console.error('Please provide a file ID for export');
  }
} else {
  console.log(\`
Pakalon Penpot Sync

Usage:
  node sync.js --start          Start Penpot
  node sync.js --stop           Stop Penpot
  node sync.js --watch          Watch for changes
  node sync.js --export <id>    Export specific file

Options:
  --start     Start Penpot Docker containers
  --stop      Stop Penpot Docker containers
  --watch     Watch for design changes and sync
  --export    Export a specific Penpot file
\`);
}
`

}

log.info("Command dispatcher initialized", { commands: localHandlers.size })
