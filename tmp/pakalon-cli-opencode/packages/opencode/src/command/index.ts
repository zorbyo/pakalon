import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID } from "@/session/schema"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_PAKALON from "./template/pakalon.txt"
import PROMPT_PLAN from "./template/plan-mode.txt"
import PROMPT_BUILD from "./template/build.txt"
import PROMPT_AUDITOR from "./template/auditor.txt"
import PROMPT_PENPOT from "./template/penpot.txt"
import PROMPT_UPDATE from "./template/update.txt"
import PROMPT_HISTORY from "./template/history.txt"
import PROMPT_MODELS from "./template/models.txt"
import PROMPT_LOGOUT from "./template/logout.txt"
import PROMPT_UNDO from "./template/undo.txt"
import PROMPT_MCP from "./template/mcp.txt"
import PROMPT_THINK from "./template/think.txt"
import PROMPT_AUTOMATIONS from "./template/automations.txt"
import PROMPT_CONTEXT from "./template/context.txt"
import PROMPT_RESUME from "./template/resume.txt"
import PROMPT_SESSION from "./template/session.txt"
import PROMPT_CHROME_MCP from "./template/chrome-mcp.txt"
import PROMPT_FIGMA from "./template/figma.txt"
import PROMPT_PLUGIN from "./template/plugin.txt"
import PROMPT_PHASE_1 from "./template/phase-1.txt"
import PROMPT_PHASE_2 from "./template/phase-2.txt"
import PROMPT_PHASE_3 from "./template/phase-3.txt"
import PROMPT_PHASE_4 from "./template/phase-4.txt"
import PROMPT_PHASE_5 from "./template/phase-5.txt"
import PROMPT_PHASE_6 from "./template/phase-6.txt"
import PROMPT_PAKALON_AGENTS from "./template/pakalon-agents.txt"
import PROMPT_CONNECT from "./template/connect.txt"
import { MCP } from "../mcp"
import { Skill } from "../skill"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: SessionID.zod,
        arguments: z.string(),
        messageID: MessageID.zod,
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    PAKALON: "pakalon",
    PLAN: "plan",
    BUILD: "build",
    AUDITOR: "auditor",
    MODELS: "models",
    USAGE: "usage",
    PENPOT: "penpot",
    UPDATE: "update",
    HISTORY: "history",
    SESSION: "session",
    NEW: "new",
    RESUME: "resume",
    LOGOUT: "logout",
    AUTOMATIONS: "automations",
    UNDO: "undo",
    ANS: "ans",
    AGENTS: "agents",
    AGENT: "agent",
    WORKFLOWS: "workflows",
    DIRECTORY: "directory",
    WEB: "web",
    MCP: "mcp",
    THINK: "think",
    CONTEXT: "context",
    CHROME_MCP: "chrome-mcp",
    FIGMA: "figma",
    PLUGIN: "plugin",
    PLUGINS: "plugins",
    PHASE_1: "phase-1",
    PHASE_2: "phase-2",
    PHASE_3: "phase-3",
    PHASE_4: "phase-4",
    PHASE_5: "phase-5",
    PHASE_6: "phase-6",
    PAKALON_AGENTS: "pakalon-agents",
    CONNECT: "connect",
    CONNECT_END: "connect-end",
  } as const

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
      [Default.PAKALON]: {
        name: Default.PAKALON,
        description: "initialize 6-phase Pakalon pipeline",
        source: "command",
        get template() {
          return PROMPT_PAKALON.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_PAKALON),
      },
      [Default.PLAN]: {
        name: Default.PLAN,
        description: "enter planning mode - create plan before coding",
        source: "command",
        get template() {
          return PROMPT_PLAN.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_PLAN),
      },
      [Default.BUILD]: {
        name: Default.BUILD,
        description: "execute build from .pakalon/plan.md",
        source: "command",
        get template() {
          return PROMPT_BUILD.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_BUILD),
      },
      [Default.AUDITOR]: {
        name: Default.AUDITOR,
        description: "run auditor agent to check implementation completeness",
        source: "command",
        get template() {
          return PROMPT_AUDITOR.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_AUDITOR),
      },
      [Default.PENPOT]: {
        name: Default.PENPOT,
        description: "open Penpot design interface",
        source: "command",
        get template() {
          return PROMPT_PENPOT
        },
        hints: [],
      },
      [Default.UPDATE]: {
        name: Default.UPDATE,
        description: "make specific changes to current phase output",
        source: "command",
        get template() {
          return PROMPT_UPDATE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_UPDATE),
      },
      [Default.HISTORY]: {
        name: Default.HISTORY,
        description: "show session history",
        source: "command",
        get template() {
          return PROMPT_HISTORY
        },
        hints: [],
      },
      [Default.SESSION]: {
        name: Default.SESSION,
        description: "show current session info with detailed statistics",
        source: "command",
        get template() {
          return PROMPT_SESSION
        },
        hints: [],
      },
      [Default.NEW]: {
        name: Default.NEW,
        description: "start a new session",
        source: "command",
        get template() {
          return "Start a new Pakalon session, creating a fresh context for the current project."
        },
        hints: [],
      },
      [Default.RESUME]: {
        name: Default.RESUME,
        description: "resume an existing session with full context",
        source: "command",
        get template() {
          return PROMPT_RESUME
        },
        hints: ["$1"],
      },
      [Default.LOGOUT]: {
        name: Default.LOGOUT,
        description: "logout and clear authentication tokens",
        source: "command",
        get template() {
          return PROMPT_LOGOUT
        },
        hints: [],
      },
      [Default.MODELS]: {
        name: Default.MODELS,
        description: "list and select AI models",
        source: "command",
        get template() {
          return PROMPT_MODELS
        },
        hints: [],
      },
      [Default.AUTOMATIONS]: {
        name: Default.AUTOMATIONS,
        description: "manage automation workflows for development tasks",
        source: "command",
        get template() {
          return PROMPT_AUTOMATIONS
        },
        hints: ["$1", "$ARGUMENTS"],
      },
      [Default.UNDO]: {
        name: Default.UNDO,
        description: "undo last conversation and/or code changes",
        source: "command",
        get template() {
          return PROMPT_UNDO
        },
        hints: [],
      },
      [Default.ANS]: {
        name: Default.ANS,
        description: "ask a question without interrupting current agent",
        source: "command",
        subtask: true,
        get template() {
          return `You are executing the /ans command for Pakalon.

## Task
Answer the user's question WITHOUT interrupting the main agent's ongoing work.

## CRITICAL: How to Execute
This command MUST run as a SUBTASK. Use the "general" agent to answer the question independently.

### Step 1: Identify the Question
User's question: $ARGUMENTS

### Step 2: Spawn Parallel Subagent
Invoke a subtask using the "general" agent with:
- Agent: "general" (read-only subagent)
- Task: Answer the user's question based on the current codebase context
- Mode: Independent (does not affect main session)

### Step 3: Present Answer
Once the subagent completes, present the answer clearly to the user.

## Rules
- This MUST run as a subtask (subagent mode)
- Do NOT interrupt or pause the main agent
- Do NOT share conversation history with the subagent
- Do NOT consume tokens from the main session's context window
- The answer should be self-contained and complete

## Example Usage
User: /ans What is the current authentication flow?
You: [Spawn general subagent to research and answer]
[Subagent presents answer about auth flow]
You: Here's the answer to your question: [summary]
`
        },
        hints: ["$ARGUMENTS"],
      },
      [Default.AGENTS]: {
        name: Default.AGENTS,
        description: "manage agent teams for parallel execution",
        source: "command",
        get template() {
          return `You are executing the /agents command for Pakalon.

## Task
Manage agent teams for parallel task execution.

## Options
1. **List teams** - Show all configured agent teams
2. **Create team** - Create a new agent team with:
   - Name
   - Description
   - Color
   - Tool permissions
3. **Edit team** - Modify existing team configuration
4. **Delete team** - Remove an agent team
5. **Run task** - Execute a task with a specific team

## Implementation
- Use TeamManager APIs for team lifecycle operations:
  - TeamManager.loadTeams(projectPath)
  - TeamManager.list(), TeamManager.getByName(name)
  - TeamManager.create(projectPath, opts)
  - TeamManager.update(projectPath, id, opts)
  - TeamManager.remove(projectPath, id)
  - TeamManager.executeTask(projectPath, teamId, task)
- Use ParallelExecutor.runParallel(projectPath, tasks) for parallel team runs
- Use TeamManager.listExecutions(teamId?) and ParallelExecutor.formatResults(result) for reporting
- Allow parent agent to verify child work
- Generate reports in markdown format

## Usage
\`\`\`
/agents list                    # List all teams
/agents create <name>           # Create new team
/agents run <team> <task>       # Run task with team
/agents edit <team>             # Edit team config
/agents delete <team>           # Delete team
\`\`\`
`
        },
        hints: ["$1", "$ARGUMENTS"],
      },
      [Default.AGENT]: {
        name: Default.AGENT,
        description: "manage a single agent profile and behavior",
        source: "command",
        get template() {
          return `You are executing the /agent command for Pakalon.

## Task
Help the user manage or inspect a single agent.

## Behavior
- If no arguments are provided, list available agents and show the currently active one.
- If an agent name is provided, explain that agent's role, capabilities, and when to use it.
- If the user asks to switch, configure that agent as the active one for this session.
- If the user asks to customize instructions, provide a safe, concrete update plan.

## User input
$ARGUMENTS`
        },
        hints: ["$ARGUMENTS"],
      },
      [Default.WORKFLOWS]: {
        name: Default.WORKFLOWS,
        description: "inspect and manage project workflows",
        source: "command",
        get template() {
          return `You are executing the /workflows command for Pakalon.

## Task
Show and manage workflows in this project.

## Scope
- Detect available workflows (automation flows, CI flows, and project pipeline states).
- Summarize workflow status and next actions.
- If the user provided arguments, apply them as the specific workflow task request.

## Current project
${Instance.worktree}

## User input
$ARGUMENTS`
        },
        hints: ["$ARGUMENTS"],
      },
      [Default.DIRECTORY]: {
        name: Default.DIRECTORY,
        description: "show and work with current project directory context",
        source: "command",
        get template() {
          return `You are executing the /directory command for Pakalon.

## Task
Inspect and summarize the current working directory and project context.

## Current project root
${Instance.worktree}

## Instructions
- Show key folders/files relevant to active work.
- Highlight where specs, plans, tasks, and source code are located.
- If the user provided arguments, treat them as a focused directory action.

## User input
$ARGUMENTS`
        },
        hints: ["$ARGUMENTS"],
      },
      [Default.WEB]: {
        name: Default.WEB,
        description: "opens and searches across internet",
        source: "command",
        get template() {
          return `Use websearch for this query: $ARGUMENTS

Use livecrawl "preferred", type "auto", and about 8 results unless the user asks for more. The tool aggregates OpenRouter/Exa search and configured Firecrawl/web-scraper backends; include source URLs and do not answer current facts from memory.`
        },
        hints: ["$ARGUMENTS"],
      },
      [Default.MCP]: {
        name: Default.MCP,
        description: "manage MCP servers for enhanced AI capabilities",
        source: "command",
        get template() {
          return PROMPT_MCP
        },
        hints: ["$1", "$ARGUMENTS"],
      },
      [Default.THINK]: {
        name: Default.THINK,
        description: "toggle thinking mode for extended reasoning",
        source: "command",
        get template() {
          return PROMPT_THINK
        },
        hints: ["$1"],
      },
      [Default.CONTEXT]: {
        name: Default.CONTEXT,
        description: "display context window usage and token budget",
        source: "command",
        get template() {
          return PROMPT_CONTEXT
        },
        hints: ["$1"],
      },
      [Default.CHROME_MCP]: {
        name: Default.CHROME_MCP,
        description: "integrate Chrome DevTools MCP for automated browser testing",
        source: "command",
        get template() {
          return PROMPT_CHROME_MCP
        },
        hints: ["$1", "$ARGUMENTS"],
      },
      [Default.FIGMA]: {
        name: Default.FIGMA,
        description: "import and analyze designs from Figma",
        source: "command",
        get template() {
          return PROMPT_FIGMA
        },
        hints: ["$1", "$ARGUMENTS"],
      },
      [Default.PLUGIN]: {
        name: Default.PLUGIN,
        description: "manage Pakalon plugins for extended functionality",
        source: "command",
        get template() {
          return PROMPT_PLUGIN
        },
        hints: ["$1", "$ARGUMENTS"],
      },
      [Default.PLUGINS]: {
        name: Default.PLUGINS,
        description: "manage Pakalon plugins for extended functionality",
        source: "command",
        get template() {
          return PROMPT_PLUGIN
        },
        hints: ["$1", "$ARGUMENTS"],
      },
      [Default.PHASE_1]: {
        name: Default.PHASE_1,
        description: "start Phase 1: Planning & Requirements",
        source: "command",
        get template() {
          return PROMPT_PHASE_1
        },
        hints: [],
      },
      [Default.PHASE_2]: {
        name: Default.PHASE_2,
        description: "start Phase 2: Design & Wireframing",
        source: "command",
        get template() {
          return PROMPT_PHASE_2
        },
        hints: [],
      },
      [Default.PHASE_3]: {
        name: Default.PHASE_3,
        description: "start Phase 3: Development & Implementation",
        source: "command",
        get template() {
          return PROMPT_PHASE_3
        },
        hints: [],
      },
      [Default.PHASE_4]: {
        name: Default.PHASE_4,
        description: "start Phase 4: Testing & Quality Assurance",
        source: "command",
        get template() {
          return PROMPT_PHASE_4
        },
        hints: [],
      },
      [Default.PHASE_5]: {
        name: Default.PHASE_5,
        description: "start Phase 5: Deployment & Integration",
        source: "command",
        get template() {
          return PROMPT_PHASE_5
        },
        hints: [],
      },
      [Default.PHASE_6]: {
        name: Default.PHASE_6,
        description: "start Phase 6: Documentation & Maintenance",
        source: "command",
        get template() {
          return PROMPT_PHASE_6
        },
        hints: [],
      },
      [Default.PAKALON_AGENTS]: {
        name: Default.PAKALON_AGENTS,
        description: "initialize .pakalon-agents directory structure",
        source: "command",
        get template() {
          return PROMPT_PAKALON_AGENTS
        },
        hints: [],
      },
      [Default.CONNECT]: {
        name: Default.CONNECT,
        description: "connect to Telegram for remote control",
        source: "command",
        get template() {
          return PROMPT_CONNECT
        },
        hints: [],
      },
      [Default.CONNECT_END]: {
        name: Default.CONNECT_END,
        description: "disconnect from Telegram",
        source: "command",
        get template() {
          return "Disconnect from Telegram. Stop the webhook connection and display disconnection confirmation."
        },
        hints: [],
      },
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        source: "command",
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      result[name] = {
        name,
        source: "mcp",
        description: prompt.description,
        get template() {
          // since a getter can't be async we need to manually return a promise here
          return new Promise<string>(async (resolve, reject) => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? // substitute each argument with $1, $2, etc.
                  Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            ).catch(reject)
            resolve(
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
            )
          })
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    // Add skills as invokable commands
    for (const skill of await Skill.all()) {
      // Skip if a command with this name already exists
      if (result[skill.name]) continue
      result[skill.name] = {
        name: skill.name,
        description: skill.description,
        source: "skill",
        get template() {
          return skill.content
        },
        hints: [],
      }
    }

    return result
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}

// Re-export command dispatcher
export * as CommandDispatcher from "./dispatcher"
export { 
  type CommandResult, 
  type CommandHandler,
  registerHandler,
  isLocalCommand,
  executeLocalCommand,
  parseCommand,
  getCommands,
} from "./dispatcher"
