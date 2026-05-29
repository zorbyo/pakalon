# Pakalon Agents — Complete Agent System Documentation

> The autonomous AI agent framework powering Pakalon's 6-phase build pipeline, multi-agent orchestration, LSP-backed code validation, and persistent memory.

---

## Table of Contents

1. [Agent System Overview](#agent-system-overview)
2. [Agent Types](#agent-types)
3. [Built-in Agents](#built-in-agents)
4. [Custom Agents](#custom-agents)
5. [Plugin Agents](#plugin-agents)
6. [Agent Configuration](#agent-configuration)
7. [Agent Tool System](#agent-tool-system)
8. [Permission Modes](#permission-modes)
9. [Agent Isolation](#agent-isolation)
10. [Agent Memory](#agent-memory)
11. [Agent Colors](#agent-colors)
12. [Agent Lifecycle](#agent-lifecycle)
13. [The 6-Phase Pipeline](#the-6-phase-pipeline)
14. [Phase 1: Planning](#phase-1-planning)
15. [Phase 2: Wireframes](#phase-2-wireframes)
16. [Phase 3: Frontend Development](#phase-3-frontend-development)
17. [Phase 4: Security QA](#phase-4-security-qa)
18. [Phase 5: CI/CD](#phase-5-cicd)
19. [Phase 6: Documentation](#phase-6-documentation)
20. [LSP Integration](#lsp-integration)
21. [MCP Server Support](#mcp-server-support)
22. [Memory System](#memory-system)
23. [Bridge Architecture](#bridge-architecture)
24. [Swarm & Orchestration](#swarm--orchestration)
25. [Agent Hooks](#agent-hooks)
26. [Fork Subagents](#fork-subagents)
27. [Agent Progress Tracking](#agent-progress-tracking)
28. [Security Feedback Loop](#security-feedback-loop)
29. [Agent API Reference](#agent-api-reference)

---

## Agent System Overview

Pakalon's agent system is a multi-agent orchestration framework that enables:

- **Single-agent mode** — one AI assistant for chat and editing
- **Multi-agent mode** — multiple specialized agents working in parallel
- **6-phase pipeline** — autonomous application builder with 6 sequential phases
- **LSP-backed validation** — language server integration for code quality
- **MCP extensibility** — external tool and resource providers
- **Persistent memory** — cross-session knowledge with Mem0 adapter
- **Worktree isolation** — each agent can work in its own git branch

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Orchestrator                     │
│         (coordinates all agent activities)          │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
    ┌──────────▼──────────┐  ┌────────▼──────────────┐
    │   Main Agent (TUI)  │  │   Sub-agents (1-5)    │
    │   Chat / Plan / Edit│  │   Phase-specific      │
    └──────────┬──────────┘  └────────┬──────────────┘
               │                      │
    ┌──────────▼──────────────────────▼──────────────┐
    │              Agent Tool Layer                   │
    │  Read | Write | Edit | Bash | Grep | Glob | ... │
    │  LSP  | MCP  | Agent | WebSearch | WebFetch     │
    └──────────┬──────────────────────┬──────────────┘
               │                      │
    ┌──────────▼──────────┐  ┌────────▼──────────────┐
    │  LSP Server Manager │  │  MCP Connection Mgr   │
    │  (per workspace)    │  │  (global + project)   │
    └─────────────────────┘  └───────────────────────┘
```

---

## Agent Types

Pakalon supports four agent source types:

| Type | Source | Description |
|------|--------|-------------|
| **Built-in** | `built-in` | Pre-configured agents shipped with Pakalon |
| **Custom** | `userSettings` / `projectSettings` / `policySettings` / `flagSettings` | User-defined agents via config files or CLI flags |
| **Plugin** | `plugin` | Agents provided by installed plugins |
| **Fork** | `fork` | Dynamically created copies of existing agents |

### Agent Definition Interface

Every agent conforms to `BaseAgentDefinition`:

```typescript
interface BaseAgentDefinition {
  agentType: string;           // Unique identifier
  description?: string;        // What this agent does
  whenToUse?: string;          // When to invoke it
  tools?: string[];            // Available tools
  disallowedTools?: string[];  // Forbidden tools
  allowedTools?: string[];     // Explicitly allowed tools
  skills?: string[];           // Loaded skills
  mcpServers?: AgentMcpServerSpec[];  // MCP server connections
  hooks?: AgentHooksSettings;  // Lifecycle hooks
  color?: AgentColorName;      // UI color
  model?: string;              // Override AI model
  effort?: EffortValue;        // minimum | low | medium | high | maximum
  permissionMode?: PermissionMode;
  maxTurns?: number;           // Maximum conversation turns
  memory?: AgentMemoryScope;   // user | project | local
  background?: boolean;        // Run without blocking UI
  isolation?: AgentIsolation;  // worktree | remote
  omitClaudeMd?: boolean;      // Skip CLAUDE.md loading
  readOnly?: boolean;          // No file modifications
  source?: AgentSource;        // Where this agent came from
}
```

---

## Built-in Agents

Pakalon ships with these built-in agents:

### General Purpose Agent

- **Type:** `general-purpose`
- **Description:** Default agent for all tasks
- **Tools:** Full toolset (Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch, etc.)
- **Use case:** Standard chat, code editing, and agent mode

### Explore Agent

- **Type:** `Explore`
- **Description:** Codebase exploration and pattern discovery
- **Tools:** Read, Grep, Glob, WebSearch, WebFetch
- **Use case:** Understanding unfamiliar codebases, finding patterns
- **Behavior:** One-shot — completes and returns results
- **Toggle:** `PAKALON_EXPLORE_PLAN_AGENTS=false` to disable

### Plan Agent

- **Type:** `Plan`
- **Description:** Pre-planning consultant for complex tasks
- **Tools:** Read, WebSearch, WebFetch, TodoWrite
- **Use case:** Analyzing requirements before implementation
- **Behavior:** One-shot — returns structured plan
- **Toggle:** `PAKALON_EXPLORE_PLAN_AGENTS=false` to disable

### Verification Agent

- **Type:** `verification`
- **Description:** Post-implementation quality verification
- **Tools:** Read, Bash, Grep, LSP diagnostics
- **Use case:** Validating completed work against requirements

---

## Custom Agents

Users can define custom agents in configuration files:

### User Settings (Global)

Location: `~/.config/pakalon/agents.json`

### Project Settings

Location: `.pakalon/agents.json`

### Policy Settings

Organization-wide agent policies (enterprise feature).

### Flag Settings

Via CLI flags: `--agent-type <type> --model <model> --effort <level>`

### Custom Agent Restrictions

Custom agents cannot use:
- `TaskOutput` — prevents output manipulation
- `ExitPlanMode` / `EnterPlanMode` — prevents mode switching
- `Agent` — prevents spawning sub-agents (security)
- `AskUserQuestion` — prevents interactive prompts
- `TaskStop` — prevents task termination
- `Workflow` — prevents workflow manipulation

---

## Plugin Agents

Plugins can register their own agents:

```typescript
interface PluginAgentDefinition extends BaseAgentDefinition {
  source: 'plugin';
  pluginId?: string;
  path?: string;
}
```

Plugins are installed via:
```bash
pakalon plugins install <package>
```

---

## Agent Configuration

### Effort Levels

| Level | Behavior |
|-------|----------|
| `minimum` | Fastest response, minimal analysis |
| `low` | Quick response with basic context |
| `medium` | Balanced speed and thoroughness (default) |
| `high` | Detailed analysis, comprehensive output |
| `maximum` | Deep research, exhaustive results |

### Permission Modes

| Mode | Description |
|------|-------------|
| `default` | Standard permission prompts |
| `acceptEdits` | Auto-accept file edits, prompt for other actions |
| `bypassPermissions` | No prompts at all (YOLO mode) |
| `plan` | Planning mode — no file modifications |
| `auto` | AI decides which actions need approval |
| `bubble` | Prompts bubble up to parent agent |

### Memory Scopes

| Scope | Description |
|-------|-------------|
| `user` | Shared across all projects for this user |
| `project` | Shared within the current project |
| `local` | Session-only memory |

---

## Agent Tool System

### Core Tools

| Tool | Description |
|------|-------------|
| `Read` | Read file contents |
| `Write` | Create or overwrite files |
| `Edit` | Make precise edits to files |
| `Bash` | Execute shell commands |
| `Grep` | Search file contents with regex |
| `Glob` | Find files by pattern |
| `WebSearch` | Search the web |
| `WebFetch` | Fetch URL content |
| `LSP` | Language server operations |
| `MCP` | MCP server tool calls |
| `Agent` | Spawn sub-agents |
| `Skill` | Load specialized skills |
| `TodoWrite` | Manage task lists |
| `ToolSearch` | Search available tools |

### Async Agent Allowed Tools

Background agents can only use:
```
Read, WebSearch, TodoWrite, Grep, WebFetch, Glob, Bash, Edit,
NotebookEdit, Skill, ToolSearch, EnterWorktree, ExitWorktree, Agent
```

### All Agent Disallowed Tools

No agent can use:
```
TaskOutput, ExitPlanMode, EnterPlanMode, Agent (for custom agents),
AskUserQuestion, TaskStop, Workflow
```

---

## Agent Isolation

Agents can run in isolated environments:

### Worktree Isolation

- Each agent gets its own git worktree
- Changes are made on a separate branch
- Results can be merged via PR
- Command: `EnterWorktree` / `ExitWorktree`

### Remote Isolation

- Agent runs on a remote machine
- Useful for resource-intensive tasks
- Requires remote infrastructure configuration

---

## Agent Memory

### Individual Memory

- Private to each user
- Stored in `~/.config/pakalon/memory/`
- SQLite database with FTS5 full-text search
- Supports add, search, update, delete, history operations

### Team Memory

- Shared across team members
- Configured per project
- Combined with individual memory in prompts

### Memory Features

- **Age tracking** — memories track how old they are
- **Relevance search** — finds memories relevant to current context
- **Memory scanning** — scans all memory files for manifest
- **Auto-dream** — automatic memory consolidation during idle time
- **Entrypoint truncation** — prevents memory prompts from exceeding context limits

### Mem0 Adapter

Pakalon implements a Mem0-compatible interface using SQLite:

```typescript
interface Mem0Client {
  add(messages: Mem0Message[], options?): Promise<Mem0Memory>
  search(query: string, options?): Promise<Mem0SearchResult[]>
  get(memoryId: string): Promise<Mem0Memory | null>
  update(memoryId: string, data: Mem0UpdateData): Promise<Mem0Memory | null>
  delete(memoryId: string): Promise<boolean>
  history(memoryId: string): Promise<Mem0HistoryEntry[]>
  getAll(options?): Promise<Mem0Memory[]>
}
```

### Inter-Phase Storage

Phases can store and retrieve data between pipeline stages:

```typescript
interPhaseStore(phase, data, client)   // Store phase output
interPhaseRetrieve(phase, client)       // Retrieve previous phase output
```

---

## Agent Colors

Agents are color-coded in the TUI for visual distinction:

| Color | Theme Name |
|-------|-----------|
| `red` | red_FOR_SUBAGENTS_ONLY |
| `blue` | blue_FOR_SUBAGENTS_ONLY |
| `green` | green_FOR_SUBAGENTS_ONLY |
| `yellow` | yellow_FOR_SUBAGENTS_ONLY |
| `purple` | purple_FOR_SUBAGENTS_ONLY |
| `orange` | orange_FOR_SUBAGENTS_ONLY |
| `pink` | pink_FOR_SUBAGENTS_ONLY |
| `cyan` | cyan_FOR_SUBAGENTS_ONLY |

---

## Agent Lifecycle

### States

| State | Description |
|-------|-------------|
| `starting` | Agent is initializing |
| `running` | Agent is actively working |
| `completed` | Agent finished successfully |
| `failed` | Agent encountered an error |
| `stopped` | Agent was manually stopped |

### Progress Tracking

Each agent reports:
- Current status
- Progress percentage (when available)
- Last tool used
- Recent activities
- Tool use count
- Token count
- Summary of work completed

---

## The 6-Phase Pipeline

The autonomous build pipeline is Pakalon's most powerful feature. It builds complete applications from a single prompt.

```bash
pakalon /pakalon "build a SaaS dashboard with Next.js and PostgreSQL"
```

### Pipeline Flow

```
Phase 1 (Planning) → Phase 2 (Wireframes) → Phase 3 (Frontend)
                                                    ↓
Phase 6 (Docs) ← Phase 5 (CI/CD) ← Phase 4 (Security QA)
```

Each phase:
1. Receives context from previous phases
2. Executes its specialized tasks
3. Stores results for the next phase
4. In HIL mode, pauses for user approval

---

## Phase 1: Planning

**Goal:** Research, clarify requirements, and create project blueprint.

### What It Does

1. **Researches the project** — analyzes the prompt, identifies tech stack
2. **Asks clarifying questions** — presents structured questions with options
3. **Creates plan files** — generates `.pakalon/plan.md`, `.pakalon/spec.md`
4. **Generates CLAUDE.md** — agent-specific instructions for subsequent phases
5. **Manages context budget** — tracks token usage across files

### State

```typescript
interface Phase1State {
  userPrompt: string;
  projectDir: string;
  isYolo: boolean;
  isNewProject: boolean;
  researchContext: string;
  existingCodebaseSummary: string;
  qaAnswers: Map<string, string>;
  contextBudget: Record<string, number>;
  generatedFiles: Map<string, string>;
  skillsMd: string;
  totalContext: number;
  selections: Record<string, string>;
  questions: Array<{
    key: string;
    prompt: string;
    options: string[];
    default: string;
  }>;
}
```

### Output Files

- `.pakalon/plan.md` — project plan and architecture
- `.pakalon/spec.md` — technical specifications
- `.pakalon/CLAUDE.md` — agent instructions
- `.pakalon/phase-1.md` — planning phase report

---

## Phase 2: Wireframes

**Goal:** Generate UI wireframes from design specifications.

### What It Does

1. **Reads Figma data** (if Figma file ID provided)
2. **Generates Penpot wireframes** — creates designs via Penpot API
3. **Exports as SVG** — for preview in the TUI
4. **Exports as JSON** — for further processing by Phase 3
5. **TDD loop** — test-driven design validation

### State

```typescript
interface Phase2State {
  userPrompt: string;
  projectDir: string;
  figmaFileId?: string;
  figmaData?: unknown;
  penpotFileId?: string;
  wireframes: Array<{
    name: string;
    penpotFileId: string;
    components: unknown[];
  }>;
  components: Array<{
    name: string;
    description: string;
    type: string;
    props: Record<string, string>;
  }>;
  designSystem: Record<string, unknown>;
}
```

### Penpot Integration

- Auto-sync with Penpot via `sync.js`
- SVG export for TUI preview
- JSON export for component generation
- Lifecycle management (start/stop containers)

### Output Files

- `.pakalon-agents/ai-agents/phase-2/` — wireframe files
- `.pakalon-agents/wireframes/` — exported wireframes
- `.pakalon/phase-2.md` — wireframe phase report

---

## Phase 3: Frontend Development

**Goal:** Scaffold and implement the frontend application.

### What It Does

1. **Scaffolds project structure** — creates directories, config files
2. **Generates components** — uses shadcn/ui registry for UI components
3. **Implements logic** — state management, API calls, routing
4. **Uses 5 sub-agents (SA1–SA5)** — parallel development:
   - SA1: Layout and navigation
   - SA2: Core UI components
   - SA3: State management and data flow
   - SA4: API integration
   - SA5: Styling and responsive design

### State

```typescript
interface Phase3State {
  userPrompt: string;
  projectDir: string;
  tasksCompleted: string[];
  tasksFailed: string[];
  codeGenerated: string[];
  subAgentResults: Map<string, AgentResult>;
  startTime?: number;
}
```

### Sub-Agent Parallelism

Each sub-agent runs independently with:
- Its own model (configurable)
- Its own tool permissions
- Its own worktree (optional)
- Background execution for parallel throughput

### Output Files

- All frontend source code
- `.pakalon/phase-3.md` — frontend phase report

---

## Phase 4: Security QA

**Goal:** Scan the generated code for security vulnerabilities.

### What It Does

1. **Runs SAST scanners** — static analysis of source code
2. **Runs DAST scanners** — dynamic analysis of running application
3. **Collects results** — aggregates findings from all tools
4. **Security feedback loop** — feeds issues back to the agent for fixing
5. **Generates security report** — comprehensive vulnerability assessment

### State

```typescript
interface Phase4State {
  userPrompt: string;
  projectDir: string;
  securityIssues: Array<{
    tool: string;
    severity: string;
    file: string;
    line?: number;
    message: string;
    rule?: string;
  }>;
  scanResults: Map<string, {
    issues: number;
    error?: string;
    skipped?: boolean;
  }>;
  targetUrl?: string;
}
```

### Security Tools (15+)

| Tool | Type | Purpose |
|------|------|---------|
| **Semgrep** | SAST | Pattern-based code scanning |
| **Gitleaks** | Secrets | Hardcoded secret detection |
| **Bandit** | SAST | Python security analysis |
| **Brakeman** | SAST | Rails security scanner |
| **FindSecBugs** | SAST | Java security analysis |
| **OWASP ZAP** | DAST | Web application scanner |
| **Nikto** | DAST | Web server scanner |
| **SQLmap** | DAST | SQL injection testing |
| **Wapiti** | DAST | Web vulnerability scanner |
| **XSStrike** | DAST | XSS detection |
| **Nmap** | Network | Port and service scanning |
| **SonarQube** | Quality | Code quality + security |
| **ESLint Security** | SAST | JS/TS security rules |
| **Security Headers** | Config | HTTP header validation |

### Security Feedback Loop

```
Scan → Collect Results → Analyse → Feed Back to Agent → Fix → Re-scan
```

The pipeline automatically:
1. Runs all configured scanners
2. Parses results into structured issues
3. Feeds critical/high severity issues back to the development agent
4. Agent fixes the issues
5. Re-scans to verify fixes

### Output Files

- `.pakalon/semgrep-results.json`
- `.pakalon/gitleaks-results.json`
- `.pakalon/bandit-results.json`
- `.pakalon/zap-results.html`
- `.pakalon/nikto-results.json`
- `.pakalon/nmap-results.xml`
- `.pakalon/sqlmap-results/`
- `.pakalon/wapiti-results.json`
- `.pakalon/xsstrike-results.json`
- `.pakalon/sonarqube-results.json`
- `.pakalon/findsecbugs-results.json`
- `.pakalon/brakeman-results.json`
- `.pakalon/eslint-security-results.json`
- `.pakalon/phase-4.md` — security QA report

---

## Phase 5: CI/CD

**Goal:** Generate deployment configurations and create pull requests.

### What It Does

1. **Generates CI/CD pipelines** — GitHub Actions workflows
2. **Creates deployment configs** — Docker, Docker Compose, Kubernetes
3. **Sets up environments** — staging, production configurations
4. **Creates PR** — opens a pull request with all generated code

### State

```typescript
interface Phase5State {
  userPrompt: string;
  projectDir: string;
  deploymentConfigs: string[];
  cicdPipelines: string[];
  deploymentUrl?: string;
  deployTarget?: string;
}
```

### Output Files

- `.github/workflows/ci.yml` — CI pipeline
- `Dockerfile` — container configuration
- `docker-compose.yml` — orchestration
- `.pakalon/phase-5.md` — CI/CD phase report
- Pull Request on GitHub

---

## Phase 6: Documentation

**Goal:** Generate comprehensive documentation for the built application.

### What It Does

1. **Generates README** — project overview, setup instructions
2. **Generates API docs** — endpoint documentation
3. **Generates CHANGELOG** — version history
4. **Documents routes** — all API and web routes
5. **Creates contributing guide** — how to contribute

### State

```typescript
interface Phase6State {
  userPrompt: string;
  projectDir: string;
  docsGenerated: string[];
  routes: string[];
  readmeGenerated: boolean;
  apiDocGenerated: boolean;
  changelogGenerated: boolean;
}
```

### Output Files

- `README.md` — project documentation
- `docs/api.md` — API documentation
- `CHANGELOG.md` — version history
- `CONTRIBUTING.md` — contributor guide
- `.pakalon/phase-6.md` — documentation phase report

---

## LSP Integration

Pakalon's LSP (Language Server Protocol) integration provides IDE-like code intelligence to the AI agent.

### LSP Server Manager

Manages LSP connections per workspace:

```typescript
class LSPServerManager {
  gotoDefinition(filePath, line, character)    // Find symbol definition
  findReferences(filePath, line, character)    // Find all usages
  hover(filePath, line, character)             // Get type info + docs
  documentSymbol(filePath)                     // List symbols in file
  workspaceSymbol(query)                       // Search all symbols
  workspaceDiagnostics(maxFiles?)              // Get errors/warnings
  codeActions(filePath, range, only?)          // Get code actions
  semanticTokens(filePath)                     // Get syntax highlighting
  goToImplementation(filePath, line, character) // Find implementations
  prepareCallHierarchy(filePath, line, character)
  incomingCalls(filePath, line, character)     // Who calls this?
  outgoingCalls(filePath, line, character)     // What does this call?
}
```

### LSP Tool

Exposed as an AI tool with 12 operations:

| Operation | Description |
|-----------|-------------|
| `gotoDefinition` | Jump to where a symbol is defined |
| `findReferences` | Find all usages of a symbol |
| `hover` | Get type information and documentation |
| `documentSymbol` | List all symbols in a file |
| `workspaceSymbol` | Search symbols across the project |
| `workspaceDiagnostics` | Get all errors and warnings |
| `codeAction` | Get available code actions at a location |
| `semanticTokens` | Get syntax token information |
| `goToImplementation` | Find interface implementations |
| `prepareCallHierarchy` | Prepare call hierarchy analysis |
| `incomingCalls` | Find functions that call this function |
| `outgoingCalls` | Find functions called by this function |

### Supported Languages

Any language with an LSP server:

| Extension | Language | Common LSP Server |
|-----------|----------|-------------------|
| `.ts`, `.tsx` | TypeScript | typescript-language-server |
| `.js`, `.jsx` | JavaScript | typescript-language-server |
| `.py` | Python | pyright, pylsp |
| `.go` | Go | gopls |
| `.rs` | Rust | rust-analyzer |
| `.java` | Java | eclipse.jdt.ls |
| `.cs` | C# | omnisharp |
| `.cpp`, `.c` | C/C++ | clangd |
| `.php` | PHP | intelephense |
| `.kt` | Kotlin | kotlin-language-server |
| `.rb` | Ruby | solargraph |

### Passive Diagnostics

LSP diagnostics are automatically collected and fed to the agent:

```typescript
class LSPDiagnosticRegistry {
  // Tracks diagnostics per file
  // Notifies agent of new errors
  // Provides passive feedback without explicit tool calls
}
```

---

## MCP Server Support

MCP (Model Context Protocol) extends Pakalon's capabilities with external tools and resources.

### MCP Connection Manager

Manages connections to MCP servers:

```typescript
interface McpServerConfig {
  name: string;
  url: string;
  description?: string;
  transport?: "sse" | "stdio";
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  authType?: "none" | "oauth" | "bearer";
  authUrl?: string;
  tokenUrl?: string;
  clientId?: string;
}
```

### Configuration Scopes

| Scope | Location | Description |
|-------|----------|-------------|
| Global | `~/.config/pakalon/mcp.json` | Available to all projects |
| Project | `.pakalon/mcp.json` | Project-specific servers |
| Vendored | `vendor/everything-claude-code/` | Pre-configured presets |

### MCP Features

- **SSE transport** — HTTP-based server connections
- **Stdio transport** — process-based server connections
- **OAuth 2.0** — authentication for MCP servers
- **Bearer tokens** — API key authentication
- **Health checks** — server availability monitoring
- **Tool discovery** — automatic tool listing from servers
- **Resource browsing** — explore server resources
- **Prompt execution** — run server-defined prompts
- **Channel notifications** — real-time event streaming
- **Permission management** — channel-level access control
- **Elicitation handling** — interactive server prompts

### CLI Commands

```bash
pakalon mcp list                # List all MCP servers
pakalon mcp add <name> <url>    # Add a new server
pakalon mcp remove <name>       # Remove a server
```

### Official Registry

Pakalon includes a registry of official MCP servers with pre-configured presets.

---

## Memory System

Pakalon's memory system provides persistent knowledge across sessions.

### Memory Types

| Type | Description |
|------|-------------|
| **Individual** | Private memories for each user |
| **Team** | Shared memories across team members |
| **Auto** | Automatically extracted from conversations |

### Memory Storage

- **Database:** SQLite with FTS5 full-text search
- **Location:** `~/.config/pakalon/memory/mem0.sqlite`
- **Schema:** memories, memory_history, memories_fts (virtual table)

### Memory Operations

```typescript
// Add memory
client.add([{ role: 'user', content: '...' }], { userId: 'user123' })

// Search memories (semantic + keyword)
client.search('What are my dietary preferences?', { userId: 'user123', limit: 5 })

// Get specific memory
client.get(memoryId)

// Update memory
client.update(memoryId, { content: '...' })

// Delete memory
client.delete(memoryId)

// View history
client.history(memoryId)

// Get all memories
client.getAll({ userId: 'user123', limit: 100 })
```

### Memory Prompt Building

Memories are formatted into prompts for the AI:

```
## Memory

- [user] I prefer TypeScript over JavaScript
- [project] We use Next.js 16 for the frontend
- [local] Current task is building the auth flow
```

### Memory Age Tracking

- Memories track creation and update timestamps
- Freshness scoring affects search relevance
- Old memories can be automatically consolidated

### Auto-Dream

During idle time, Pakalon can:
- Consolidate related memories
- Remove duplicate entries
- Extract patterns from conversation history

---

## Bridge Architecture

The bridge connects the CLI TUI to the Python backend and remote services.

### Bridge Components

| Component | Purpose |
|-----------|---------|
| `Bridge.ts` | Main bridge class |
| `bridgeApi.ts` | API client for backend communication |
| `bridgeMain.ts` | Bridge lifecycle management |
| `bridgeStatusUtil.ts` | Health check and status reporting |
| `bridgeUI.ts` | TUI display for bridge status |
| `client.ts` | WebSocket/HTTP client |
| `jwtUtils.ts` | JWT token management |
| `trustedDevice.ts` | Device authentication |
| `workSecret.ts` | Inter-process secret sharing |

### Transports

| Transport | Description |
|-----------|-------------|
| **Local HTTP** | Direct connection to local backend |
| **WebSocket** | Real-time streaming responses |
| **Remote** | Connection to cloud backend |
| **REPL** | Interactive debugging mode |

### Bridge Status

```typescript
enum BridgeStatus {
  CONNECTED,
  CONNECTING,
  DISCONNECTED,
  ERROR,
}
```

### Capacity Wake

Automatically wakes the bridge when needed:
- Monitors backend availability
- Reconnects on failure
- Notifies user of status changes

---

## Swarm & Orchestration

### Orchestrator

The central coordinator for all agent activities:

```typescript
interface Orchestrator {
  spawnAgent(config: AgentConfig): Promise<AgentResult>
  stopAgent(agentId: string): Promise<void>
  listAgents(): SpawnedAgent[]
  getProgress(agentId: string): AgentProgress
}
```

### Swarms

Multiple agents working together:

- **Parallel execution** — agents run simultaneously
- **Task distribution** — work split across agents
- **Result aggregation** — combined output from all agents
- **Failure handling** — individual agent failures don't block others

### Fork Subagents

Create copies of existing agents:

```typescript
// Fork directive syntax
// Fork directive: create a copy of 'general-purpose' agent
// with modified tools and system prompt
```

Fork subagents:
- Inherit parent agent's configuration
- Can override specific settings
- Useful for specialized variations of general agents

---

## Agent Hooks

Agents can register lifecycle hooks:

```typescript
interface AgentHooksSettings {
  preToolUse?: string;       // Before any tool is used
  postToolUse?: string;      // After tool completes
  preCompact?: string;       // Before context compaction
  postCompact?: string;      // After context compaction
  permissionRequest?: string; // Before permission prompt
  permissionDenied?: string;  // After permission denied
  postSampling?: string;     // After AI response generation
  stop?: string;             // When agent stops
  sessionStart?: string;     // When session begins
}
```

### Hook Use Cases

- **preToolUse** — log tool usage, validate inputs
- **postToolUse** — validate results, trigger follow-up actions
- **preCompact** — save important context before compaction
- **permissionDenied** — handle denied actions gracefully
- **sessionStart** — load project-specific settings

---

## Agent Progress Tracking

Real-time progress monitoring:

```typescript
interface AgentProgress {
  agentId: string;
  agentName?: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
  progress?: number;           // 0-100 percentage
  message?: string;            // Current activity description
  output?: string;             // Agent output text
  error?: string;              // Error message if failed
  toolUseCount?: number;       // Number of tools used
  tokenCount?: number;         // Tokens consumed
  lastActivity?: ToolActivity; // Most recent tool activity
  recentActivities?: ToolActivity[]; // Last N activities
  summary?: string;            // Work summary
  lastToolName?: string;       // Last tool used
}
```

### Tool Activity

```typescript
interface ToolActivity {
  toolName: string;
  input?: Record<string, unknown>;
  activityDescription?: string;
  isSearch?: boolean;    // Is this a search operation?
  isRead?: boolean;      // Is this a read operation?
}
```

---

## Security Feedback Loop

The pipeline includes an automatic security feedback mechanism:

```
Phase 3 (Frontend) → Phase 4 (Security QA) → Security Issues Found
                                                    ↓
                                    Feed issues back to Phase 3 agent
                                                    ↓
                                    Agent fixes vulnerabilities
                                                    ↓
                                    Re-run security scan
                                                    ↓
                                    If clean → Phase 5 (CI/CD)
                                    If still issues → repeat fix cycle
```

### Implementation

```typescript
// pipeline/security-feedback-loop.ts
function runSecurityFeedbackLoop(
  phase3State: Phase3State,
  phase4State: Phase4State,
  maxIterations: number = 3,
): Promise<Phase4State>
```

- Maximum 3 fix iterations per phase
- Only critical and high severity issues trigger fixes
- Low/medium issues are reported but not auto-fixed
- User can override and proceed at any time

---

## Agent API Reference

### Spawning Agents

```typescript
// Via the Agent tool
const result = await agentTool({
  description: "Find all auth implementations",
  prompt: "Search the codebase for auth middleware, login handlers, and token generation.",
  subagent_type: "Explore",
  model: "sonnet",
  run_in_background: true,
  name: "auth-explorer",
  mode: "default",
  isolation: "worktree",
  cwd: "/path/to/project",
  tools: ["Read", "Grep", "Glob"],
  maxTurns: 20,
});
```

### Agent Result

```typescript
interface AgentToolResult {
  success: boolean;
  output?: string;
  error?: string;
  agentId?: string;
  agentName?: string;
  teamName?: string;
  background?: boolean;
  agentType?: string;
  totalToolUseCount?: number;
  totalDurationMs?: number;
  totalTokens?: number;
}
```

### Spawned Agent

```typescript
interface SpawnedAgent {
  id: string;
  name: string;
  type: string;
  teamName?: string;
  model?: string;
  permissionMode?: PermissionMode;
  cwd?: string;
  background: boolean;
  isolation?: AgentIsolation;
  createdAt: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  result?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}
```

---

## Quick Reference: All Agent Commands

```bash
# List agents
pakalon agents

# Create agent
pakalon agents create

# Remove agent
pakalon agents remove <name>

# Launch agentic mode
pakalon /pakalon "<prompt>"
pakalon --agent "<prompt>"

# Agentic mode flags
pakalon --agent --permission-mode yolo    # No prompts
pakalon --agent --permission-mode hil     # Human-in-the-loop (default)

# Model selection
pakalon --agent --model opus              # Use Claude Opus
pakalon --agent --model sonnet            # Use Claude Sonnet
pakalon --agent --model haiku             # Use Claude Haiku

# Directory and session
pakalon --agent --dir /path/to/project
pakalon --agent --session-id <id>

# Debug
pakalon --agent --verbose                 # Show reasoning
pakalon --agent --debug                   # Write debug log
```

---

## License

MIT © Pakalon. See [LICENSE](LICENSE) for details.
