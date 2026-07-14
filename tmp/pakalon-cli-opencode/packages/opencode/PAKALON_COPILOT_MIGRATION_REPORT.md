# Pakalon CLI Migration Report: Achieving Copilot CLI & Claude Code CLI Parity

**Document Version:** 1.0  
**Date:** $(date +%Y-%m-%d)  
**Status:** DRAFT - Requires Validation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Reference Architecture: GitHub Copilot CLI](#2-reference-architecture-github-copilot-cli)
3. [Reference Architecture: Claude Code CLI](#3-reference-architecture-claude-code-cli)
4. [Pakalon CLI Current State](#4-pakalon-cli-current-state)
5. [Gap Analysis](#5-gap-analysis)
6. [Implementation Plan](#6-implementation-plan)
7. [Tool-by-Tool Comparison](#7-tool-by-tool-comparison)
8. [Command Execution Deep Dive](#8-command-execution-deep-dive)
9. [MCP Integration Details](#9-mcp-integration-details)
10. [Security Architecture](#10-security-architecture)
11. [Hook System Design](#11-hook-system-design)
12. [Migration Checklist](#12-migration-checklist)

---

## 1. Executive Summary

### 1.1 Purpose

This document provides a comprehensive technical analysis and migration plan to align Pakalon CLI's functionality with GitHub Copilot CLI and Claude Code CLI. It identifies feature gaps, recommends implementation strategies, and provides a phased roadmap for achieving parity.

### 1.2 Scope

- **In Scope:** CLI command execution, tool calling patterns, MCP integration, session management, hook systems, security mechanisms
- **Out of Scope:** Frontend/Desktop application features, cloud infrastructure, enterprise-specific features

### 1.3 Current Assessment Summary

| Aspect            | Copilot CLI     | Claude Code       | Pakalon             | Status           |
| ----------------- | --------------- | ----------------- | ------------------- | ---------------- |
| Language          | Go              | TypeScript        | TypeScript          | ✅ Parity        |
| Runtime           | Native          | Node.js           | Bun                 | ✅ Pakalon Ahead |
| Tool Registry     | Shell-based     | Structured        | Structured          | ✅ Parity        |
| Command Parser    | Shell native    | Tree-sitter       | Tree-sitter         | ✅ Parity        |
| MCP Support       | GitHub-specific | Full stdio        | Full implementation | ✅ Pakalon Ahead |
| Hook System       | Limited         | PreToolUse hooks  | None                | ❌ Gap           |
| Workflow Patterns | None            | Markdown commands | None                | ❌ Gap           |
| Security          | Token-based     | Hook validation   | DAST/SAST           | ✅ Pakalon Ahead |

### 1.4 Key Recommendations

1. **Immediate (P0):** Implement hook system for pre/post tool execution validation
2. **Short-term (P1):** Add workflow command pattern support (markdown-based commands)
3. **Medium-term (P2):** Enhance MCP stdio server support with tool discovery
4. **Long-term (P3):** Add session forking and checkpoint-based undo

---

## 2. Reference Architecture: GitHub Copilot CLI

### 2.1 Core Technology Stack

| Component             | Technology                   | Notes                                |
| --------------------- | ---------------------------- | ------------------------------------ |
| **Language**          | Go                           | Compiled, single binary distribution |
| **Architecture**      | Agent-based with JSON-RPC    | Client-server over stdio             |
| **Authentication**    | GitHub OAuth / Token         | Via GH_TOKEN env var                 |
| **Extension Model**   | MCP (Model Context Protocol) | GitHub MCP server built-in           |
| **Shell Integration** | Native shell execution       | Delegates to system shell            |

### 2.2 Command Execution Flow

```
User Input → Shell Parsing → Agent Processing → Tool Execution → Output
                ↓                ↓                  ↓
            OS Shell         JSON-RPC           GitHub API
```

### 2.3 Built-in Commands

| Command   | Description               | Example                      |
| --------- | ------------------------- | ---------------------------- |
| `/shell`  | Execute raw shell command | `/shell ls -la`              |
| `/ask`    | Ask about code            | `/ask explain this function` |
| `/git`    | Git operations            | `/git commit -m "fix"`       |
| `/gh`     | GitHub operations         | `/gh issue create`           |
| `/search` | Code search               | `/search function name`      |

### 2.4 Tool Capabilities

Copilot CLI tools are primarily shell-based:

| Tool           | Implementation          | Notes     |
| -------------- | ----------------------- | --------- |
| **File Read**  | `cat`, `head`, `tail`   | Via shell |
| **File Write** | `echo`, `tee`, `printf` | Via shell |
| **Grep**       | `grep`, `rg`            | Via shell |
| **Glob**       | `find`, `ls`            | Via shell |
| **Bash**       | Direct execution        | Via shell |

### 2.5 Security Model

- **Token-based authentication** (GH_TOKEN, GITHUB_TOKEN)
- **GitHub permission mapping** - Maps GitHub OAuth scopes to capabilities
- **Workspace trust** - Folder-level trust configuration
- **No command validation** - Trusts shell execution fully
- **Action preview** - Shows actions before execution

### 2.6 Session Management

- Session persistence via JSONL files
- Session resume with `--resume` flag
- Context compaction (automatic)
- Session plan via `/session plan`

---

## 3. Reference Architecture: Claude Code CLI

### 3.1 Core Technology Stack

| Component             | Technology                    | Notes                      |
| --------------------- | ----------------------------- | -------------------------- |
| **Language**          | TypeScript                    | Node.js runtime            |
| **Architecture**      | Agent-based with tool calling | Structured tool pattern    |
| **Protocol**          | MCP (Model Context Protocol)  | Full stdio support         |
| **Plugin System**     | Custom hook/command system    | Markdown-based definitions |
| **Shell Integration** | Via Bash tool with hooks      | node-pty for PTY           |

### 3.2 Tool System Architecture

Claude Code uses a structured tool interface:

```typescript
interface Tool {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: { ... }
    required: string[]
  }
}
```

### 3.3 Available Tools

| Tool          | Purpose                 | Key Features                         |
| ------------- | ----------------------- | ------------------------------------ |
| **Bash**      | Shell command execution | Streaming, timeout, validation hooks |
| **Read**      | File reading            | Line range, truncation               |
| **Write**     | File creation/editing   | Atomic write                         |
| **Edit**      | In-place edits          | Diff-based                           |
| **Grep**      | Content search          | Regex, context lines                 |
| **Glob**      | File pattern matching   | Recursive support                    |
| **WebFetch**  | HTTP requests           | GET/POST, headers                    |
| **WebSearch** | Web search              | Multiple providers                   |
| **Grep**      | Code search             | Pattern matching                     |

### 3.4 Hook System

Claude Code implements a sophisticated pre-tool-use hook system:

```typescript
// Hook configuration (hooks.json)
{
  "hooks": {
    "pre_tool_use": [
      {
        "tool": "Bash",
        "command": "python3 hooks/validate-bash.py"
      }
    ]
  }
}
```

**Hook Exit Codes:**

- `0` - Pass validation
- `1` - Error in validation
- `2` - Block with warning

### 3.5 Command Workflow Patterns

Commands are defined in Markdown with YAML frontmatter:

```markdown
---
description: Complete build and test workflow
allowed-tools: Bash(*)
---

Build: !`bash ${CLAUDE_PLUGIN_ROOT}/scripts/build.sh`
Test: !`bash ${CLAUDE_PLUGIN_ROOT}/scripts/test.sh`
```

### 3.6 MCP Integration

Claude Code supports stdio-based MCP servers:

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"],
    "env": { "LOG_LEVEL": "debug" }
  }
}
```

### 3.7 Security Features

| Feature                 | Implementation                   | Notes                             |
| ----------------------- | -------------------------------- | --------------------------------- |
| **Command Validation**  | PreToolUse hooks                 | Regex-based pattern matching      |
| **Tool Allowlist**      | `allowed-tools` in commands      | Restricts which tools can be used |
| **Pattern Blocking**    | Hooks reject dangerous patterns  | e.g., suggests `rg` over `grep`   |
| **Safe Command Bypass** | Hooks auto-approve safe commands | Read-only commands bypass prompt  |

---

## 4. Pakalon CLI Current State

### 4.1 Core Technology Stack

| Component           | Technology                | Actual Usage                    |
| ------------------- | ------------------------- | ------------------------------- |
| **Language**        | TypeScript                | ✅ All source in TypeScript     |
| **Runtime**         | Bun                       | ✅ Primary runtime              |
| **Package Manager** | Bun                       | ✅ bun.lock                     |
| **Build System**    | Bun Build                 | ✅ bun build                    |
| **AI SDK**          | Vercel AI SDK             | ✅ Via `ai` package             |
| **TUI Framework**   | Solid.js + custom         | ⚠️ NOT Ink/React                |
| **Database**        | SQLite                    | ✅ Via drizzle-orm + bun:sqlite |
| **ORM**             | Drizzle ORM               | ✅ drizzle-orm                  |
| **CLI Parser**      | Yargs                     | ✅ yargs                        |
| **PTY**             | bun-pty                   | ⚠️ NOT node-pty                 |
| **MCP SDK**         | @modelcontextprotocol/sdk | ✅ v1.25.2                      |
| **Parser**          | web-tree-sitter           | ✅ tree-sitter-bash             |
| **Server**          | Hono                      | ✅ hono                         |

### 4.2 Source Code Structure

**Actual Path:** `packages/opencode/src/`

```
src/
├── agent/           # Agent definitions and configuration
│   ├── agent.ts     # Main agent namespace (build, plan, explore, etc.)
│   └── prompt/      # System prompts
├── tool/            # Tool implementations (SINGULAR, not "tools")
│   ├── registry.ts  # Tool registry and loading
│   ├── bash.ts      # Bash tool with PTY
│   ├── read.ts      # File reading
│   ├── write.ts     # File writing
│   ├── edit.ts      # In-place editing
│   ├── glob.ts      # Glob pattern matching
│   ├── grep.ts      # Content search
│   ├── webfetch.ts  # HTTP requests
│   ├── websearch.ts # Web search
│   ├── codesearch.ts # Code search
│   ├── skill.ts     # Skill system
│   ├── task.ts      # Task management
│   ├── fleet.ts     # Parallel execution
│   ├── lsp.ts       # Language Server Protocol
│   └── ...
├── mcp/             # MCP server management
│   ├── manager.ts   # Server lifecycle management
│   ├── catalog.ts   # MCP server catalog
│   ├── auth.ts      # OAuth handling
│   └── policy.ts    # Security policies
├── security/        # Security implementations
│   ├── index.ts     # Security orchestrator
│   ├── sast.ts      # Static Analysis
│   ├── dast.ts      # Dynamic Analysis
│   ├── parser.ts    # Command parsing
│   └── report.ts    # Security reports
├── shell/           # Shell integration
│   └── shell.ts     # Shell detection and management
├── pty/             # PTY operations
│   ├── index.ts     # PTY pool management
│   └── schema.ts    # PTY types
├── penpot/          # Penpot integration
│   ├── client.ts    # Penpot API client
│   ├── sync.ts      # Design sync
│   └── docker.ts    # Penpot container management
├── server/          # HTTP server
│   └── server.ts    # Hono server
├── session/         # Session management
│   └── session.ts   # Session handling
├── provider/        # AI provider management
│   └── provider.ts  # Multi-provider support
├── project/         # Project management
│   └── instance.ts  # Project instance
├── cli/             # CLI commands
│   ├── cmd/         # Command definitions
│   └── ui.ts        # CLI UI
├── permission/      # Permission system
│   └── arity.ts     # Permission rules
└── ...
```

### 4.3 Existing Agent Types

Pakalon defines multiple agent types in `src/agent/agent.ts`:

| Agent          | Mode     | Purpose                      |
| -------------- | -------- | ---------------------------- |
| **build**      | primary  | Default execution agent      |
| **plan**       | primary  | Planning mode, no edit tools |
| **general**    | subagent | Multi-step tasks             |
| **explore**    | subagent | Codebase exploration         |
| **compaction** | primary  | Context compaction           |
| **title**      | primary  | Title generation             |
| **summary**    | primary  | Summary generation           |

### 4.4 Tool Registry

**Location:** `src/tool/registry.ts`

**Registered Tools:**

```typescript
const defaultTools = [
  InvalidTool,
  QuestionTool, // Optional
  BashTool, // Shell execution
  ReadTool, // File reading
  GlobTool, // Pattern matching
  GrepTool, // Content search
  EditTool, // In-place edits
  WriteTool, // File creation
  TaskTool, // Task management
  WebFetchTool, // HTTP requests
  TodoWriteTool, // Todo write
  WebSearchTool, // Web search
  CodeSearchTool, // Code search
  SkillTool, // Skill execution
  ApplyPatchTool, // Patch application
  PakalonTool, // Pakalon-specific
  StoreMemoryTool, // Memory storage
  RetrieveMemoryTool,
  ListMemoriesTool,
  FleetTool, // Parallel execution
  ReadAgentTool,
  ReportIntentTool,
  ShowFileTool,
  PakalonDocumentationTool,
  LspTool, // Optional (experimental flag)
  BatchTool, // Optional (experimental flag)
  PlanExitTool, // Optional (plan mode)
]
```

### 4.5 MCP Implementation

**Location:** `src/mcp/manager.ts`

**Features:**

- Server management (add, remove, list, enable, disable)
- Scope: global and project
- Catalog integration
- OAuth support
- Configuration via JSON files

### 4.6 Security Features

**Location:** `src/security/`

| Component               | Status         | Description              |
| ----------------------- | -------------- | ------------------------ |
| **DAST**                | ✅ Implemented | Dynamic analysis         |
| **SAST**                | ✅ Implemented | Static analysis          |
| **Parser**              | ✅ Implemented | Tree-sitter bash parsing |
| **Trust System**        | ✅ Implemented | Workspace trust          |
| **Self-kill Detection** | ✅ Implemented | Prevents killing CLI     |

### 4.7 Bash Tool Implementation

**Location:** `src/tool/bash.ts`

**Key Features:**

- Tree-sitter parsing for security analysis
- PTY-based execution via bun-pty
- Security validation before execution
- Permission checking
- Timeout handling (default 2 minutes)
- Streaming output
- Metadata tracking
- Working directory control
- Environment variable support

---

## 5. Gap Analysis

### 5.1 Critical Gaps

| Gap                           | Severity | Description                           | Impact                                  |
| ----------------------------- | -------- | ------------------------------------- | --------------------------------------- |
| **Hook System**               | P0       | No pre/post tool execution hooks      | Cannot validate commands before running |
| **Command Workflow Patterns** | P0       | No markdown-based command definitions | Limited workflow automation             |
| **Session Forking**           | P1       | No session branching                  | Cannot experiment with alternate paths  |
| **Checkpoint-based Undo**     | P1       | No file snapshots for rollback        | Cannot undo destructive changes         |

### 5.2 Tool System Gaps

| Feature                 | Claude Code | Pakalon | Status            |
| ----------------------- | ----------- | ------- | ----------------- |
| Tool description schema | ✅          | ⚠️      | Needs enhancement |
| Tool examples           | ✅          | ❌      | Missing           |
| Input validation        | ✅          | ⚠️      | Basic             |
| Result truncation       | ✅          | ⚠️      | Implemented       |

### 5.3 MCP Gaps

| Feature             | Claude Code | Pakalon | Status      |
| ------------------- | ----------- | ------- | ----------- |
| Tool discovery      | ✅          | ❌      | Missing     |
| Deferred loading    | ✅          | ⚠️      | Partial     |
| stdio server config | ✅          | ✅      | Implemented |
| OAuth for MCP       | ✅          | ✅      | Implemented |

### 5.4 Security Gaps

| Feature               | Claude Code | Pakalon | Status      |
| --------------------- | ----------- | ------- | ----------- |
| Hook validation       | ✅          | ❌      | Missing     |
| Pattern blocking      | ✅          | ✅      | Implemented |
| Safe command bypass   | ✅          | ✅      | Implemented |
| Network path blocking | ✅          | ❌      | Missing     |

### 5.5 Session Gaps

| Feature             | Claude Code | Pakalon | Status      |
| ------------------- | ----------- | ------- | ----------- |
| Session persistence | ✅          | ✅      | Implemented |
| Session resume      | ✅          | ✅      | Implemented |
| Session forking     | ✅          | ❌      | Missing     |
| Checkpoint undo     | ✅          | ❌      | Missing     |
| Session files cmd   | ✅          | ❌      | Missing     |

---

## 6. Implementation Plan

### 6.1 Phase 1: Hook System (P0 - Critical)

**Duration:** 2 weeks  
**Goal:** Implement pre/post tool execution hooks like Claude Code

#### Task 1.1: Hook Registry

**File:** `src/tool/hook.ts` (NEW)

```typescript
export namespace ToolHook {
  export type HookType = "pre_tool_use" | "post_tool_use"

  export interface HookConfig {
    tool?: string // Tool name filter (or "*" for all)
    command: string // Command to execute
    timeout?: number // Timeout in ms (default 30000)
  }

  export interface HookResult {
    ok: boolean
    message?: string
    action?: "allow" | "block" | "warn"
  }

  // Load hooks from config
  export async function loadHooks(): Promise<HookConfig[]>

  // Execute pre-tool hooks
  export async function runPreHooks(tool: string, input: unknown): Promise<HookResult>

  // Execute post-tool hooks
  export async function runPostHooks(tool: string, result: unknown): Promise<void>
}
```

#### Task 1.2: Hook Configuration File

**File:** `.pakalon/hooks.json`

```json
{
  "hooks": {
    "pre_tool_use": [
      {
        "tool": "Bash",
        "command": "python3 hooks/validate-bash.py"
      }
    ],
    "post_tool_use": [
      {
        "tool": "Bash",
        "command": "hooks/log-execution.sh"
      }
    ]
  }
}
```

#### Task 1.3: Hook Execution Integration

**Modify:** `src/tool/registry.ts`

```typescript
// Add hook execution before tool call
export async function executeTool(name: string, args: unknown, ctx: ToolContext) {
  const tool = await getTool(name)

  // Run pre-hooks
  const preResult = await ToolHook.runPreHooks(name, args)
  if (!preResult.ok || preResult.action === "block") {
    throw new Error(`Hook blocked: ${preResult.message}`)
  }
  if (preResult.action === "warn") {
    console.warn(`Hook warning: ${preResult.message}`)
  }

  // Execute tool
  const result = await tool.execute(args, ctx)

  // Run post-hooks
  await ToolHook.runPostHooks(name, result)

  return result
}
```

### 6.2 Phase 2: Command Workflow Patterns (P0 - Critical)

**Duration:** 2 weeks  
**Goal:** Support markdown-based workflow commands

#### Task 2.1: Workflow Parser

**File:** `src/command/workflow.ts` (NEW)

```typescript
export interface WorkflowCommand {
  name: string
  description: string
  allowedTools: string[] | ["*"]
  steps: WorkflowStep[]
}

export interface WorkflowStep {
  description?: string
  tool: string
  args: Record<string, unknown>
}

export namespace WorkflowParser {
  // Parse markdown workflow definition
  export function parse(content: string): WorkflowCommand[]

  // Load workflows from .pakalon/commands/
  export async function loadWorkflows(): Promise<WorkflowCommand[]>
}
```

#### Task 2.2: Workflow Executor

**File:** `src/command/executor.ts` (NEW)

```typescript
export namespace WorkflowExecutor {
  // Execute a workflow command
  export async function execute(
    workflow: WorkflowCommand,
    ctx: ToolContext
  ): Promise<WorkflowResult[]>

  // Stream output for long-running workflows
  export async function *executeStream(
    workflow: WorkflowCommand,
    ctx: ToolContext
  ): AsyncGenerator<WorkflowEvent>
}
```

#### Task 2.3: Command Registration

**File:** `src/cli/cmd/workflow.ts` (NEW)

```typescript
export const WorkflowCommand = {
  command: "workflow",
  describe: "Manage workflow commands",
  builder: (yargs) =>
    yargs
      .command("list", "List available workflows", {}, listWorkflows)
      .command("run <name>", "Run a workflow", {}, runWorkflow)
      .command("init", "Initialize workflow template", {}, initWorkflow),
}
```

### 6.3 Phase 3: Session Enhancement (P1)

**Duration:** 3 weeks  
**Goal:** Add session forking and checkpoint-based undo

#### Task 3.1: Session Forking

**File:** `src/session/fork.ts` (NEW)

```typescript
export interface SessionFork {
  id: string
  parentId: string
  createdAt: Date
  name: string
}

export namespace SessionManager {
  // Fork current session
  export async function forkSession(name: string, options?: ForkOptions): Promise<SessionFork>

  // List session branches
  export async function listForks(): Promise<SessionFork[]>

  // Merge forked session back
  export async function mergeSession(forkId: string): Promise<void>
}
```

#### Task 3.2: Checkpoint System

**File:** `src/session/checkpoint.ts` (NEW)

```typescript
export interface Checkpoint {
  id: string
  sessionId: string
  createdAt: Date
  files: FileSnapshot[]
  description: string
}

export interface FileSnapshot {
  path: string
  content: string
  hash: string
}

export namespace CheckpointManager {
  // Create checkpoint
  export async function createCheckpoint(description: string): Promise<Checkpoint>

  // Restore checkpoint
  export async function restoreCheckpoint(checkpointId: string): Promise<void>

  // List checkpoints
  export async function listCheckpoints(): Promise<Checkpoint[]>

  // Delete checkpoint
  export async function deleteCheckpoint(checkpointId: string): Promise<void>
}
```

### 6.4 Phase 4: MCP Tool Discovery (P1)

**Duration:** 2 weeks  
**Goal:** Add MCP tool discovery and deferred loading

#### Task 4.1: Tool Discovery

**File:** `src/mcp/discovery.ts` (NEW)

```typescript
export interface DiscoveredTool {
  name: string
  description: string
  inputSchema: object
  source: string // MCP server name
}

export namespace MCPToolDiscovery {
  // Discover all tools from configured MCP servers
  export async function discoverTools(): Promise<DiscoveredTool[]>

  // Search tools by name/description
  export async function searchTools(query: string): Promise<DiscoveredTool[]>

  // Get tool details
  export async function getToolDetails(name: string): Promise<DiscoveredTool | null>
}
```

#### Task 4.2: Deferred Tool Loading

**File:** `src/mcp/deferred.ts` (NEW)

```typescript
export class DeferredToolLoader {
  private loadedTools: Map<string, unknown>
  private loaders: Map<string, () => Promise<unknown>>

  constructor() {
    this.loadedTools = new Map()
    this.loaders = new Map()
  }

  // Register a deferred loader
  register(key: string, loader: () => Promise<unknown>): void

  // Load a specific tool
  async loadTool(key: string): Promise<unknown>

  // Load all registered tools
  async loadAll(): Promise<void>

  // Get cached tool or null
  getCached(key: string): unknown | null
}
```

### 6.5 Phase 5: Network Path Blocking (P2)

**Duration:** 1 week  
**Goal:** Add UNC path blocking for Windows security

#### Task 5.1: UNC Path Detection

**Modify:** `src/security/parser.ts`

```typescript
// Add UNC path detection
const UNC_PATH_REGEX = /^\\\\[\w\-\.]+\\/u

export function detectUNCPaths(command: string): string[] {
  const paths: string[] = []
  // Parse command and extract paths
  // Check for UNC paths
  return paths
}
```

#### Task 5.2: Network Path Blocking

**Modify:** `src/tool/bash.ts`

```typescript
// In security analysis section
if (security.uncPaths.length > 0) {
  throw new Error(`Network paths are not allowed: ${security.uncPaths.join(", ")}`)
}
```

---

## 7. Tool-by-Tool Comparison

### 7.1 Bash Tool

| Feature             | Claude Code | Pakalon        | Implementation      |
| ------------------- | ----------- | -------------- | ------------------- |
| Streaming output    | ✅          | ✅             | Via PTY             |
| Timeout handling    | ✅          | ✅             | Configurable        |
| Working directory   | ✅          | ✅             | Via workdir param   |
| Environment vars    | ✅          | ✅             | Via shell.env hook  |
| Security parsing    | ⚠️ Hooks    | ✅ Tree-sitter | Tree-sitter + hooks |
| PreToolUse hook     | ✅          | ❌             | Need to implement   |
| Safe command bypass | ✅          | ✅             | isSafeCommand check |
| Output truncation   | ✅          | ✅             | Via Truncate        |
| Signal handling     | ✅          | ✅             | SIGINT/SIGTERM      |

**Pakalon Advantage:** Tree-sitter parsing for command analysis  
**Claude Code Advantage:** Hook system for validation

### 7.2 Grep Tool

| Feature          | Claude Code | Pakalon | Implementation      |
| ---------------- | ----------- | ------- | ------------------- |
| Pattern matching | ✅          | ✅      | Regex support       |
| File type filter | ✅          | ✅      | Via -g flag         |
| Context lines    | ✅          | ✅      | Via -C flag         |
| Case insensitive | ✅          | ✅      | Via -i flag         |
| Recursive search | ✅          | ✅      | Default             |
| Output limit     | ✅          | ✅      | Via truncation      |
| Hidden files     | ⚠️          | ✅      | Respects .gitignore |

### 7.3 Glob Tool

| Feature          | Claude Code | Pakalon | Implementation      |
| ---------------- | ----------- | ------- | ------------------- |
| Pattern matching | ✅          | ✅      | minimatch           |
| Recursive        | ✅          | ✅      | \*\* glob           |
| Hidden files     | ⚠️          | ✅      | dot: true           |
| Absolute paths   | ✅          | ✅      | Via absolute option |
| Follow symlinks  | ⚠️          | ✅      | Via symlink option  |

### 7.4 Read Tool

| Feature             | Claude Code | Pakalon | Implementation   |
| ------------------- | ----------- | ------- | ---------------- |
| Line range          | ✅          | ✅      | Via start/end    |
| Truncation          | ✅          | ✅      | Via MAX_BYTES    |
| Binary detection    | ✅          | ⚠️      | Need enhancement |
| Large file handling | ✅          | ✅      | Streaming        |
| Symbolic links      | ✅          | ✅      | Via realpath     |

### 7.5 Write Tool

| Feature            | Claude Code | Pakalon | Implementation |
| ------------------ | ----------- | ------- | -------------- |
| Atomic write       | ✅          | ✅      | Via temp file  |
| Create directories | ✅          | ✅      | auto-mkdir     |
| Overwrite prompt   | ⚠️          | ❌      | Need to add    |
| Backup creation    | ⚠️          | ❌      | Need to add    |

### 7.6 Edit Tool

| Feature        | Claude Code | Pakalon | Implementation       |
| -------------- | ----------- | ------- | -------------------- |
| Diff-based     | ✅          | ✅      | Via TextMate grammar |
| Validation     | ✅          | ⚠️      | Basic                |
| Multiple edits | ✅          | ✅      | Via apply_patch      |
| Undo support   | ⚠️          | ❌      | Need checkpoint      |

---

## 8. Command Execution Deep Dive

### 8.1 Claude Code Execution Flow

```
1. User types command
2. Parse command into tool calls
3. Check allowed-tools restrictions
4. For each tool:
   a. Run pre_tool_use hooks
   b. Execute tool
   c. Run post_tool_use hooks
5. Return results
```

### 8.2 Pakalon Execution Flow (Current)

```
1. User input via CLI
2. Route to agent
3. Generate tool calls via AI
4. For each tool call:
   a. Check permission rules
   b. Parse command (tree-sitter)
   c. Security analysis
   d. Execute via PTY
   e. Truncate output
   f. Return results
5. Update session
```

### 8.3 Target Pakalon Execution Flow (With Hooks)

```
1. User input via CLI
2. Route to agent
3. Generate tool calls via AI
4. For each tool call:
   a. Check permission rules
   b. Parse command (tree-sitter)
   c. Security analysis
   d. Run pre_tool_use hooks  ← NEW
   e. Execute via PTY
   f. Run post_tool_use hooks  ← NEW
   g. Truncate output
   h. Return results
5. Update session
```

### 8.4 Key Differences

| Aspect           | Claude Code       | Pakalon            | Notes                 |
| ---------------- | ----------------- | ------------------ | --------------------- |
| Hook timing      | Before/after tool | N/A                | Pakalon needs hooks   |
| Permission check | Via allowed-tools | Via PermissionNext | Different approaches  |
| Security         | Hooks regex       | Tree-sitter AST    | Pakalon more thorough |
| Output streaming | Real-time         | Via PTY events     | Similar               |

---

## 9. MCP Integration Details

### 9.1 Claude Code MCP Support

Claude Code uses stdio-based MCP servers:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

### 9.2 Pakalon MCP Architecture

**Current Implementation:**

```typescript
// src/mcp/manager.ts
interface MCPServerInfo {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled: boolean
  scope: "global" | "project"
}
```

**Configuration Files:**

- Global: `~/.pakalon/mcp.json`
- Project: `.pakalon/mcp.json`

### 9.3 MCP Protocol Support

| Feature          | Claude Code | Pakalon | Status        |
| ---------------- | ----------- | ------- | ------------- |
| stdio transport  | ✅          | ✅      | Implemented   |
| SSE transport    | ❌          | ✅      | Pakalon ahead |
| HTTP transport   | ❌          | ✅      | Pakalon ahead |
| OAuth for MCP    | ❌          | ✅      | Pakalon ahead |
| Tool discovery   | ✅          | ❌      | Gap           |
| Deferred loading | ✅          | ⚠️      | Partial       |

### 9.4 Tool Discovery Protocol

**Proposed Implementation:**

```typescript
// src/mcp/discovery.ts
export async function discoverTools(): Promise<DiscoveredTool[]> {
  const servers = await MCPManager.listServers()
  const tools: DiscoveredTool[] = []

  for (const server of servers) {
    if (!server.enabled) continue

    // Start MCP server process
    const process = spawn(server.command, server.args, {
      env: { ...process.env, ...server.env },
    })

    // Send tool discovery request
    process.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    )

    // Parse response
    // ...
  }

  return tools
}
```

---

## 10. Security Architecture

### 10.1 Claude Code Security

Claude Code relies on hook-based validation:

```python
# Example: validate-bash.py
_VALIDATION_RULES = [
  (r"^grep\b", "Use 'rg' (ripgrep) instead of 'grep'"),
  (r"^find\s+\S+\s+-name\b", "Use 'rg --files -g pattern' instead"),
]

def _validate_command(command: str) -> list[str]:
  issues = []
  for pattern, message in _VALIDATION_RULES:
    if re.search(pattern, command):
      issues.append(message)
  return issues
```

### 10.2 Pakalon Security (Current)

**Tree-sitter based parsing:**

```typescript
// src/tool/bash-security.ts
export namespace BashSecurity {
  export interface SecurityAnalysis {
    safeCommand: boolean
    dangerousPatterns: string[]
    selfKill: { detected: boolean; reason?: string }
    uncPaths: string[]
    outputRedirection: { hasWriteRedirection: boolean }
  }

  export function analyze(command: string, tree: Tree): SecurityAnalysis
}
```

### 10.3 Security Comparison

| Feature             | Claude Code | Pakalon         | Winner          |
| ------------------- | ----------- | --------------- | --------------- |
| Command parsing     | Regex       | Tree-sitter AST | **Pakalon**     |
| Pattern detection   | Regex       | Heuristic + AST | **Pakalon**     |
| Self-kill detection | ❌          | ✅              | **Pakalon**     |
| Hook validation     | ✅          | ❌              | **Claude Code** |
| DAST/SAST           | ❌          | ✅              | **Pakalon**     |
| Network blocking    | ❌          | ❌              | Tie             |

### 10.4 Recommended Security Enhancements

1. **Add Hook System:** Implement pre/post tool hooks
2. **Add Network Path Blocking:** Block UNC paths on Windows
3. **Add Command Complexity Limits:** Prevent zip bombs, etc.
4. **Add Rate Limiting:** Prevent excessive tool calls

---

## 11. Hook System Design

### 11.1 Hook Types

```typescript
type HookType =
  | "pre_tool_use" // Before tool execution
  | "post_tool_use" // After tool execution
  | "pre_command" // Before CLI command
  | "post_command" // After CLI command
```

### 11.2 Hook Configuration Schema

```typescript
interface HookDefinition {
  type: HookType
  tool?: string // Tool filter (optional)
  command: string // Command to execute
  timeout?: number // Timeout in ms
  env?: Record<string, string> // Environment variables
}

interface HookResult {
  ok: boolean
  message?: string
  action?: "allow" | "block" | "warn"
  data?: unknown // Additional data from hook
}
```

### 11.3 Hook Execution Flow

```
1. Load hooks from .pakalon/hooks.json
2. Filter hooks by tool name
3. For each hook:
   a. Spawn process
   b. Send JSON input via stdin
   c. Wait for result (with timeout)
   d. Parse JSON result
   e. Handle action (allow/block/warn)
4. Return aggregated result
```

### 11.4 Hook Input/Output Format

**Pre-Tool Hook Input:**

```json
{
  "hook_type": "pre_tool_use",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf /tmp/*",
    "timeout": 30000
  },
  "context": {
    "session_id": "abc123",
    "user_id": "user1",
    "working_directory": "/project"
  }
}
```

**Pre-Tool Hook Output:**

```json
{
  "ok": true,
  "message": "Command is safe",
  "action": "allow"
}
```

### 11.5 Built-in Validation Hooks

```typescript
// src/tool/hook-validators.ts
export const BuiltInValidators = {
  // Suggest ripgrep over grep
  grepOverRipgrep: {
    type: "pre_tool_use",
    tool: "Bash",
    validate: (input) => {
      if (/^grep\b/.test(input.command)) {
        return { ok: true, action: "warn", message: "Consider using 'rg' instead of 'grep'" }
      }
      return { ok: true, action: "allow" }
    },
  },

  // Block dangerous rm commands
  safeRm: {
    type: "pre_tool_use",
    tool: "Bash",
    validate: (input) => {
      if (/rm\s+-rf\s+(\/|--no-preserve-root)/.test(input.command)) {
        return { ok: true, action: "block", message: "Dangerous rm command blocked" }
      }
      return { ok: true, action: "allow" }
    },
  },
}
```

---

## 12. Migration Checklist

### Phase 1: Hook System

- [ ] Create `src/tool/hook.ts`
- [ ] Implement hook registry
- [ ] Implement hook loader
- [ ] Implement pre-tool hooks
- [ ] Implement post-tool hooks
- [ ] Add `.pakalon/hooks.json` schema
- [ ] Update tool executor to call hooks
- [ ] Add CLI command: `pakalon hook list`
- [ ] Add CLI command: `pakalon hook add`
- [ ] Add CLI command: `pakalon hook remove`
- [ ] Write tests for hook system
- [ ] Document hook system

### Phase 2: Workflow Patterns

- [ ] Create `src/command/workflow.ts`
- [ ] Implement workflow parser
- [ ] Implement workflow executor
- [ ] Add `.pakalon/commands/` directory support
- [ ] Add CLI command: `pakalon workflow list`
- [ ] Add CLI command: `pakalon workflow run <name>`
- [ ] Add CLI command: `pakalon workflow init`
- [ ] Write tests for workflow system
- [ ] Document workflow system
- [ ] Create example workflows

### Phase 3: Session Enhancement

- [ ] Create `src/session/fork.ts`
- [ ] Implement session fork
- [ ] Implement session list
- [ ] Create `src/session/checkpoint.ts`
- [ ] Implement checkpoint create
- [ ] Implement checkpoint restore
- [ ] Implement checkpoint list
- [ ] Add CLI: `pakalon session fork`
- [ ] Add CLI: `pakalon checkpoint create`
- [ ] Add CLI: `pakalon checkpoint restore`
- [ ] Add CLI: `pakalon checkpoint list`
- [ ] Write tests
- [ ] Document session features

### Phase 4: MCP Enhancement

- [ ] Create `src/mcp/discovery.ts`
- [ ] Implement tool discovery protocol
- [ ] Implement tool search
- [ ] Create `src/mcp/deferred.ts`
- [ ] Implement deferred loading
- [ ] Update MCP manager
- [ ] Add CLI: `pakalon mcp tools`
- [ ] Add CLI: `pakalon mcp search <query>`
- [ ] Write tests
- [ ] Document MCP features

### Phase 5: Security Enhancement

- [ ] Add UNC path detection
- [ ] Add network path blocking
- [ ] Add command complexity limits
- [ ] Add rate limiting
- [ ] Write tests
- [ ] Document security features

---

## Appendix A: File Locations Reference

### Actual Pakalon Source Structure

```
packages/opencode/src/
├── tool/                    # Tools (SINGULAR)
│   ├── bash.ts             # Bash tool (PTY-based)
│   ├── read.ts             # Read tool
│   ├── write.ts            # Write tool
│   ├── edit.ts             # Edit tool
│   ├── glob.ts             # Glob tool
│   ├── grep.ts             # Grep tool
│   ├── registry.ts         # Tool registry
│   ├── truncation.ts       # Output truncation
│   └── ...
├── agent/                  # Agent system (SINGULAR)
│   └── agent.ts           # Agent definitions
├── mcp/                    # MCP integration
│   ├── manager.ts         # Server management
│   ├── catalog.ts        # Server catalog
│   └── ...
├── security/              # Security tools
│   ├── index.ts          # Security orchestrator
│   ├── sast.ts           # Static analysis
│   ├── dast.ts           # Dynamic analysis
│   └── ...
├── session/               # Session management
│   └── session.ts        # Session handling
├── shell/                # Shell integration
│   └── shell.ts          # Shell detection
├── pty/                  # PTY operations
│   └── index.ts          # PTY pool
├── penpot/               # Penpot integration
│   └── ...
└── ...
```

### Key Dependencies

```json
{
  "@modelcontextprotocol/sdk": "1.25.2",
  "ai": "catalog",
  "bun-pty": "0.4.8",
  "web-tree-sitter": "0.25.10",
  "tree-sitter-bash": "0.25.0",
  "hono": "catalog",
  "effect": "catalog",
  "drizzle-orm": "1.0.0-beta.16",
  "zod": "catalog"
}
```

---

## Appendix B: Comparison Matrix

| Feature             | Copilot CLI | Claude Code | Pakalon    | Gap           |
| ------------------- | ----------- | ----------- | ---------- | ------------- |
| **Execution**       |
| Bash tool           | ✅ Shell    | ✅ PTY      | ✅ PTY     | None          |
| Streaming           | ✅          | ✅          | ✅         | None          |
| Timeout             | ✅          | ✅          | ✅         | None          |
| Workdir             | ✅          | ✅          | ✅         | None          |
| **Tool Registry**   |
| Centralized         | ✅          | ✅          | ✅         | None          |
| Dynamic loading     | ❌          | ✅          | ✅         | None          |
| Plugin tools        | ✅ MCP      | ✅ Hooks    | ✅ Plugins | None          |
| **Security**        |
| Permission prompts  | ✅          | ✅          | ✅         | None          |
| Safe command bypass | ❌          | ✅          | ✅         | Claude ahead  |
| Hook validation     | ❌          | ✅          | ❌         | Gap           |
| Tree-sitter parsing | ❌          | ❌          | ✅         | Pakalon ahead |
| DAST/SAST           | ❌          | ❌          | ✅         | Pakalon ahead |
| **MCP**             |
| stdio servers       | ✅          | ✅          | ✅         | None          |
| Tool discovery      | ❌          | ✅          | ❌         | Gap           |
| Deferred loading    | ❌          | ✅          | ⚠️         | Partial       |
| **Session**         |
| Persistence         | ✅          | ✅          | ✅         | None          |
| Resume              | ✅          | ✅          | ✅         | None          |
| Fork                | ❌          | ✅          | ❌         | Gap           |
| Checkpoint undo     | ❌          | ✅          | ❌         | Gap           |
| **Workflows**       |
| Markdown commands   | ❌          | ✅          | ❌         | Gap           |
| Multi-step          | ❌          | ✅          | ⚠️         | Partial       |

---

## Appendix C: Recommended Dependencies to Keep

```json
{
  "dependencies": {
    "typescript": "^5.x",
    "bun": ">=1.0",
    "ai": "catalog",
    "zod": "catalog",
    "hono": "catalog",
    "effect": "catalog",
    "@modelcontextprotocol/sdk": "^1.25",
    "bun-pty": "^0.4",
    "web-tree-sitter": "^0.25",
    "tree-sitter-bash": "^0.25",
    "drizzle-orm": "^1.0",
    "yargs": "^18",
    "remeda": "catalog"
  }
}
```

---

## Appendix D: Implementation Priority

| Priority | Feature            | Effort | Impact | Phase |
| -------- | ------------------ | ------ | ------ | ----- |
| P0       | Hook System        | Medium | High   | 1     |
| P0       | Workflow Patterns  | Medium | High   | 2     |
| P1       | Session Forking    | Low    | Medium | 3     |
| P1       | Checkpoint Undo    | Medium | High   | 3     |
| P1       | MCP Discovery      | Medium | Medium | 4     |
| P2       | Network Blocking   | Low    | Medium | 5     |
| P2       | Command Complexity | Low    | Low    | 5     |

---

## Conclusion

Pakalon CLI is already ahead of Copilot CLI and Claude Code CLI in several areas:

- Security (tree-sitter parsing, DAST/SAST)
- MCP implementation (multiple transports, OAuth)
- Tool registry (dynamic loading, plugin support)

However, key gaps exist:

- No hook system (unlike Claude Code)
- No workflow patterns (unlike Claude Code)
- No session forking or checkpoint undo

This report provides a detailed roadmap to close these gaps while maintaining Pakalon's unique strengths.

---

**Document End**
