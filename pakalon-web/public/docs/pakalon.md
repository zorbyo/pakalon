# Pakalon — Complete Documentation

> AI-Powered CLI Code Editor. Build production-ready applications with one prompt.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Dual-Mode Architecture](#dual-mode-architecture)
4. [Technology Stack](#technology-stack)
5. [Installation](#installation)
6. [Authentication](#authentication)
7. [CLI Commands](#cli-commands)
8. [Slash Commands](#slash-commands)
9. [Flags](#flags)
10. [Chat Mode](#chat-mode)
11. [Agent Mode (6-Phase Pipeline)](#agent-mode-6-phase-pipeline)
12. [LSP Integration](#lsp-integration)
13. [MCP Server Support](#mcp-server-support)
14. [Penpot Design Integration](#penpot-design-integration)
15. [Memory System (Mem0)](#memory-system-mem0)
16. [Model Management](#model-management)
17. [Security Features](#security-features)
18. [Web Dashboard](#web-dashboard)
19. [Automations](#automations)
20. [Billing & Plans](#billing--plans)
21. [Self-Hosted Mode](#self-hosted-mode)
22. [Configuration](#configuration)
23. [Development Setup](#development-setup)
24. [Deployment](#deployment)

---

## Overview

Pakalon is an AI-powered CLI code editor that combines a streaming chat interface with a 6-phase autonomous build pipeline. It unifies your AI workflow with seamless authentication, usage tracking, security scanning, and design tooling — all from your terminal.

**Key capabilities:**
- Interactive AI chat with streaming responses
- 6-phase autonomous application builder
- LSP-backed code inspection and validation
- 15+ open-source security scanning tools
- Penpot wireframe generation and sync
- Persistent AI memory (Mem0)
- Cloud dashboard with usage analytics
- Self-hosted mode with local LLM support (Ollama/LM Studio)

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  pakalon-web                    │
│  Next.js 16 · Tailwind v3 · Supabase · Polar    │
│  Marketing + Dashboard + Device Auth UI         │
└─────────────────────┬───────────────────────────┘
                      │ HTTPS REST
                      ▼
┌─────────────────────────────────────────────────┐
│                pakalon-backend                  │
│  FastAPI 0.115 · PostgreSQL 16 · Redis 7        │
│  Auth / Billing / Models / Telemetry            │
│                                                 │
│  POST /auth/devices      device code flow       │
│  GET  /models            OpenRouter catalog     │
│  GET  /sessions          chat history           │
│  GET  /usage             token analytics        │
│  POST /billing/checkout  Polar checkout         │
│  POST /webhooks/polar    Polar events           │
│  POST /webhooks/clerk    Clerk events           │
└─────────────────────────────────────────────────┘
         │
         │ Clerk JWT (HS256, 90-day)
         ▼
┌─────────────────────────────────────────────────┐
│                 pakalon-cli                     │
│  TypeScript 5.7 · Bun · Ink 6.7 TUI           │
│  Zustand · Drizzle ORM · Vercel AI SDK          │
│                                                 │
│  Chat mode → streams to OpenRouter              │
│  Agent mode → spawns Python bridge              │
└─────────────────────┬───────────────────────────┘
                      │ HTTP 127.0.0.1:7432
                      ▼
┌─────────────────────────────────────────────────┐
│           Python Bridge (local only)            │
│  FastAPI · LangGraph 0.3 · Mem0 · ChromaDB      │
│                                                 │
│  Phase 1  Planning — research + Q&A + 12 files  │
│  Phase 2  Wireframes — Penpot SVG + TDD loop    │
│  Phase 3  5-subagent development (SA1–SA5)      │
│  Phase 4  5-subagent security QA (SAST/DAST)    │
│  Phase 5  CI/CD — GitHub Actions + PR           │
│  Phase 6  Documentation — API docs + README     │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│                 Penpot (Design)                 │
│  Docker: python/penpot-compose.yml              │
│  Port: 3449                                     │
│  Sync: sync.js (auto-sync wireframes)           │
└─────────────────────────────────────────────────┘
```

---

## Dual-Mode Architecture

Pakalon operates in two distinct modes controlled by the `PAKALON_MODE` environment variable:

### Cloud Mode (`PAKALON_MODE=cloud`)

The full SaaS platform experience:
- **Authentication:** Supabase JWT via GitHub OAuth (Clerk)
- **Database:** PostgreSQL 16 (Supabase hosted)
- **AI Models:** OpenRouter proxy with 100+ models
- **Billing:** Polar SDK ($22/month Pro plan)
- **Schedulers:** APScheduler + Trigger.dev for automation cron jobs
- **Features:** Full dashboard, usage analytics, automations, telemetry, geo-blocking

### Self-Hosted Mode (`PAKALON_MODE=selfhosted`)

Local deployment with zero cloud dependencies:
- **Authentication:** None (localhost only, no auth required)
- **Database:** SQLite (`.pakalon/backend.db`)
- **AI Models:** Ollama (`http://localhost:11434`) and/or LM Studio (`http://localhost:1234`)
- **Billing:** Not applicable
- **Schedulers:** Disabled
- **Features:** Local model discovery, streaming chat, provider health checks
- **Security:** Mode-gate middleware blocks all non-local endpoints

**Mode Selection Flow:**
1. Landing page presents "Cloud" and "Self-Hosted" options
2. Cloud → redirects to `/login` (GitHub OAuth)
3. Self-Hosted → redirects to GitHub repo for cloning
4. Self-hosted users access `/selfhosted/` dashboard (no login)

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **pakalon-backend** | Python 3.12, FastAPI, PostgreSQL 16, Redis 7, Supabase JWT | Auth, billing, model proxy, telemetry API |
| **pakalon-cli** | TypeScript 5.7, Bun, Ink 6.7, Native Pipeline (no Python) | CLI TUI + 6-phase agentic mode |
| **pakalon-web** | Next.js 16, Tailwind v3, Supabase (GitHub OAuth), Polar | Marketing website + dashboard |
| **Penpot** | Docker Compose (frontend + backend + exporter) | Open-source design tool for wireframes |

### Key Dependencies

**Backend:**
- FastAPI 0.115+ — async web framework
- SQLAlchemy 2.0 async — ORM
- Alembic — database migrations
- python-jose — JWT handling
- Polar SDK — billing
- Resend — email delivery
- APScheduler 3 — background jobs
- svix — webhook verification
- httpx — async HTTP client

**CLI:**
- Ink 6.8 — React-based TUI framework
- Vercel AI SDK (ai 6.0) — streaming AI responses
- Zustand 5 — state management
- Drizzle ORM — local SQLite storage
- simple-git — git operations
- web-tree-sitter — AST parsing
- @modelcontextprotocol/sdk — MCP server support
- playwright — browser automation
- @supabase/supabase-js — auth client

**Web:**
- Next.js 16 — React framework
- Radix UI — accessible components
- Recharts — data visualization
- Sonner — toast notifications
- @xyflow/react — workflow editor

---

## Installation

### Global Install (Recommended)

```bash
npm install -g pakalon
# or
bun install -g pakalon
```

**Requires:** Node.js 20+ or Bun 1.0+

### From Source

```bash
git clone https://github.com/pakalon/pakalon
cd pakalon-cli
bun install
bun run dev          # Watch mode
bun run build        # Production build to dist/
```

### Verify Installation

```bash
pakalon --version
pakalon doctor       # Check system requirements
pakalon install      # Install Python bridge dependencies
```

---

## Authentication

### Cloud Mode

Pakalon uses a **device code flow** for CLI authentication:

1. Run `pakalon` — a 6-digit code appears
2. Open `https://pakalon.com/auth/device` in browser
3. Enter the code and sign in with GitHub
4. JWT is stored at `~/.config/pakalon/storage.json`
5. JWT uses HS256 signing with 90-day expiry

**Web Dashboard Auth:**
- Supabase GitHub OAuth
- Token exchange: Supabase token → Pakalon JWT via `/auth/web-signin`
- Stored in localStorage as Bearer header

### Self-Hosted Mode

No authentication required. The application runs locally and assumes a trusted environment.

**Security note:** Self-hosted mode should only run on localhost or behind a reverse proxy with authentication. Do not expose to the public internet.

### Session Management

```bash
pakalon login       # Authenticate (device code flow)
pakalon logout      # Remove stored credentials
pakalon status      # Show current auth + plan status
```

---

## CLI Commands

### Top-Level Commands

| Command | Description |
|---------|-------------|
| `pakalon` | Start interactive chat (or send single message) |
| `pakalon [message]` | Send a message and get a response |
| `pakalon --version` | Show version |
| `pakalon --help` | Show help |
| `pakalon login` | Authenticate (device code flow) |
| `pakalon logout` | Remove stored credentials |
| `pakalon doctor` | System requirements check |
| `pakalon install` | Install Python bridge dependencies |
| `pakalon init` | Initialize `.pakalon/` config in current directory |

### Subcommands

| Command | Description |
|---------|-------------|
| `pakalon models` | List available models |
| `pakalon models set <model-id>` | Set default model |
| `pakalon sessions` | List all sessions |
| `pakalon sessions new` | Start a new session |
| `pakalon history` | Show recent session history |
| `pakalon agents` | List configured specialist agents |
| `pakalon agents create` | Create a new specialist agent |
| `pakalon agents remove <name>` | Remove an agent |
| `pakalon mcp list` | List active MCP servers |
| `pakalon mcp add <name> <url>` | Add an MCP server |
| `pakalon mcp remove <name>` | Remove an MCP server |
| `pakalon plugins` | List installed plugins |
| `pakalon plugins install <pkg>` | Install a plugin |
| `pakalon plugins remove <pkg>` | Remove a plugin |
| `pakalon status` | Show current auth + plan status |
| `pakalon upgrade` | Upgrade to Pro plan (opens Polar checkout) |
| `pakalon workflows` | List saved prompt workflows |
| `pakalon workflows save <name>` | Save current chat as reusable workflow |
| `pakalon /pakalon <prompt>` | Launch 6-phase agentic builder |
| `pakalon setup-token` | CI/CD: store JWT from env `PAKALON_TOKEN` |
| `pakalon update` | Update CLI to latest version |

---

## Slash Commands

Available inside the interactive chat:

| Command | Description |
|---------|-------------|
| `/undo` | Undo last code change (opens snapshot picker) |
| `/plan` | Switch to Plan mode |
| `/edit` | Switch to Edit mode |
| `/compact` | Compact conversation context to save tokens |
| `/clear` | Clear chat history |
| `/sessions` | Browse saved sessions |
| `/penpot` | Open Penpot + start the sync bridge |
| `/pakalon` | Launch 6-phase agentic builder |
| `/exit` or `q` | Quit |

---

## Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--agent` | `-a` | Start in agentic mode |
| `--dir <path>` | `-d` | Set working directory |
| `--model <id>` | `-m` | Set model for this session |
| `--permission-mode <mode>` | | `hil` (default) or `yolo` |
| `--verbose` | | Show internal reasoning panel |
| `--no-banner` | | Hide ASCII banner |
| `--session-id <id>` | | Resume a specific session |
| `--debug` | | Write debug log to `~/.config/pakalon/debug.log` |

---

## Chat Mode

The default interactive mode provides streaming AI conversation:

### Features
- **Streaming responses** — tokens appear in real-time via SSE
- **Code execution** — AI can run commands and read/write files
- **File snapshots** — every code change is snapshotted for undo
- **Context compaction** — `/compact` reduces token usage
- **Input history** — browse previous messages with ↑/↓
- **Multi-line input** — Shift+Enter for new lines

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+C` | Cancel stream / Quit |
| `Ctrl+U` | Clear input |
| `Ctrl+O` | Toggle verbose panel |
| `Tab` | Cycle through modes (Chat / Plan / Edit) |
| `↑ / ↓` | Browse input history |

### Modes Within Chat

- **Chat** (default) — interactive AI conversation
- **Plan** (`/plan`) — planning mode for architecture and design
- **Edit** (`/edit`) — code editing mode with file operations

---

## Agent Mode (6-Phase Pipeline)

Agent mode runs a fully autonomous build pipeline:

```bash
pakalon /pakalon "build a SaaS dashboard with Next.js and PostgreSQL"
```

### Permission Modes

- **HIL (Human-in-the-Loop)** — pauses before each phase for approval (default)
- **YOLO** — fully autonomous, no prompts (`--permission-mode yolo`)

### The 6 Phases

| Phase | Name | What It Does |
|-------|------|-------------|
| **1** | Planning | Researches the project, asks clarifying questions, creates plan files, spec files, and CLAUDE.md instructions |
| **2** | Wireframes | Generates Penpot wireframes from Figma or description, exports as SVG + JSON |
| **3** | Frontend | Scaffolds project structure, creates components with shadcn/ui, implements logic |
| **4** | Backend | Creates project files, database schema, API routes via 5 sub-agents (SA1–SA5) |
| **5** | CI/CD | Generates GitHub Actions workflows, creates pull request |
| **6** | Documentation | Writes API docs, README, CHANGELOG |

### PAUL-Inspired Loop

Each phase follows a PAUL-inspired autonomous loop:

- **Plan** — inspect the repo, gather context, choose the smallest next action
- **Apply** — perform the change with actual tools instead of just describing commands
- **Unify** — validate the result and summarize what was completed

### Configuration Files

Pakalon creates a `.pakalon/` directory in your project:

```
.pakalon/
├── plan.md              # Project context fed to every AI call
├── spec.md              # Technical specifications
├── CLAUDE.md            # Agent-specific instructions
├── phase-1.md           # Planning phase output
├── phase-2.md           # Wireframes phase output
├── phase-3.md           # Frontend phase output
├── phase-4.md           # Backend phase output
├── phase-5.md           # CI/CD phase output
└── phase-6.md           # Documentation phase output
```

Run `pakalon init` to create the scaffold without starting agent mode.

---

## LSP Integration

When language servers are available, Pakalon's agent uses **LSP-backed methods** to inspect and validate code changes:

### Supported LSP Operations

| Operation | Purpose |
|-----------|---------|
| **Definition lookup** | Jump to where symbols are defined |
| **References** | Find all usages of a symbol |
| **Hover** | Get type information and documentation |
| **Completion** | Get code completions at cursor |
| **Rename** | Rename symbols across the codebase |
| **Diagnostics** | Get errors, warnings, and hints |
| **Workspace symbols** | Search symbols across the entire project |

### How It Works

1. Pakalon detects available language servers in the project
2. Connects to the LSP via stdio protocol
3. Uses LSP responses to validate code changes before applying them
4. Provides LSP diagnostics as feedback to the AI agent
5. Enables precise code modifications with full type awareness

### Supported Languages

Any language with an LSP server is supported. Common ones include:
- TypeScript/JavaScript (typescript-language-server)
- Python (pyright, pylsp)
- Go (gopls)
- Rust (rust-analyzer)
- Java (eclipse.jdt.ls)

---

## MCP Server Support

Pakalon supports the **Model Context Protocol (MCP)** for extending AI capabilities:

```bash
pakalon mcp list                # List active MCP servers
pakalon mcp add <name> <url>    # Add an MCP server
pakalon mcp remove <name>       # Remove an MCP server
```

### What MCP Provides

- External tool access (databases, APIs, file systems)
- Custom resource providers
- Prompt templates
- Real-time data sources

### Configuration

MCP servers are configured in the project's `.pakalon/` directory or globally in `~/.config/pakalon/`.

---

## Penpot Design Integration

Penpot is an open-source design tool integrated into Pakalon for wireframe generation.

### How It Works

1. **Phase 2** of the agent pipeline generates wireframes
2. Wireframes are created in Penpot via its API
3. Changes in Penpot are automatically synced back to `.pakalon-agents/`
4. Wireframes are exported as SVG for preview and JSON for further processing

### Running Penpot

**Option A: CLI Slash Command (Recommended)**
```bash
pakalon
/penpot
# Opens Penpot and starts the sync bridge
```

**Option B: Direct sync.js**
```bash
cd pakalon-cli/python/agents
node sync.js --start                    # Start Penpot only
node sync.js --start --file <file-id>   # Start + auto-sync specific file
node sync.js --watch --file <file-id>   # Watch only (Penpot already running)
node sync.js --lifecycle --file <file-id>  # Auto-manages container lifecycle
node sync.js --stop                     # Stop Penpot
```

**Option C: Manual Docker Compose**
```bash
cd pakalon-cli
docker compose -f python/penpot-compose.yml up -d
# Access Penpot at: http://localhost:3449
# Stop: docker compose -f python/penpot-compose.yml down
```

### Penpot Sync Features

- **Auto-sync** — changes in Penpot are automatically exported to `.pakalon-agents/`
- **SVG Export** — wireframes exported as SVG for preview
- **JSON Export** — full design data exported as JSON for further processing
- **Lifecycle Management** — `sync.js` manages container start/stop automatically

### Environment Variables

```bash
PENPOT_HOST=http://localhost:3449
PENPOT_API_TOKEN=<your-penpot-token>
PENPOT_EMAIL=<your-email>
PENPOT_PASSWORD=<your-password>
```

---

## Memory System (Mem0)

Pakalon uses **Mem0** for persistent AI memory that learns and adapts from every session.

### Features

- **Cross-session memory** — AI remembers preferences, project context, and patterns
- **Automatic extraction** — memories are extracted from conversations without manual input
- **Contextual retrieval** — relevant memories are retrieved based on current conversation
- **Privacy mode** — disable memory storage with `--privacy` or `Ctrl+P`

### How It Works

Mem0 uses a combination of:
- **LLM-based extraction** — identifies key facts from conversations
- **Vector storage** — ChromaDB for semantic memory retrieval
- **Temporal reasoning** — understands when memories were created and their relevance

### Privacy Mode

```bash
pakalon --privacy    # Disable memory and telemetry
```

When enabled:
- Mem0 conversation memory is disabled
- External telemetry is suppressed
- `X-Privacy-Mode: 1` header sent to the Python bridge

---

## Model Management

### Cloud Mode Models

Pakalon proxies to **OpenRouter** with 100+ AI models:

```bash
pakalon models              # List available models
pakalon models set <id>     # Set default model
```

**Model filtering by plan:**
- **Free users** — only `:free` tier models
- **Pro users** — all models including premium

Each model includes:
- Context window size
- Remaining context percentage
- Provider information
- Tier classification

### Self-Hosted Mode Models

Local model discovery from Ollama and LM Studio:

```bash
# Via the self-hosted dashboard at /selfhosted/models
GET /local/providers    # Check Ollama/LM Studio health
GET /local/models       # Discover available local models
```

**Supported local providers:**
- **Ollama** — `http://localhost:11434` (models via `/api/tags`)
- **LM Studio** — `http://localhost:1234` (models via `/v1/models`)

Model IDs use the format: `ollama:llama3` or `lmstudio:codellama-7b`

### Auto Model Selection

The backend provides an `/models/auto` endpoint that returns the single best-fit model for the user's plan. The CLI uses this as the default model selection.

---

## Security Features

Pakalon includes **15+ open-source security scanning tools** for Phase 4 security QA. These run via Docker containers and scan your codebase for vulnerabilities.

### Security Tools

| Tool | Category | Purpose | License |
|------|----------|---------|---------|
| **Semgrep** | SAST | Code scanning with pattern matching | LGPL 2.1 |
| **Gitleaks** | Secrets | Detect hardcoded secrets and API keys | MIT |
| **Bandit** | SAST | Python security analysis | Apache 2.0 |
| **Brakeman** | SAST | Ruby on Rails security scanner | LGPL |
| **FindSecBugs** | SAST | Java security analysis (SpotBugs plugin) | LGPL |
| **OWASP ZAP** | DAST | Web application security scanner | Apache 2.0 |
| **Nikto** | DAST | Web server vulnerability scanner | GPL |
| **SQLmap** | DAST | SQL injection detection and exploitation | GPL |
| **Wapiti** | DAST | Web application vulnerability scanner | GPL |
| **XSStrike** | DAST | Cross-site scripting detection | GPL |
| **Nmap** | Network | Network port and service scanning | Custom |
| **SonarQube** | Quality | Code quality and security analysis | LGPL |
| **ESLint Security** | SAST | JavaScript/TypeScript security rules | BSD |
| **Security Headers** | Config | HTTP security header validation | MIT |

### Running Security Scans

**Baseline Scans (SAST)**
```bash
cd pakalon-cli
docker compose -f docker-compose.security.yml up -d
# Starts: semgrep, gitleaks, bandit
```

**Full Security Suite (SAST + DAST)**
```bash
docker compose -f docker-compose.security.yml --profile full up -d
# Starts all 15+ tools
```

**Runtime Scanners Only (DAST)**
```bash
docker compose -f docker-compose.security.yml --profile dast up -d
# Starts: ZAP, Nikto, Nmap, SQLmap, Wapiti, XSStrike, Security Headers
```

**Specific Tools**
```bash
docker compose -f docker-compose.security.yml up semgrep      # Code scanning
docker compose -f docker-compose.security.yml up gitleaks     # Secrets detection
docker compose -f docker-compose.security.yml up bandit       # Python security
docker compose -f docker-compose.security.yml up zap          # OWASP ZAP scanner
docker compose -f docker-compose.security.yml up nikto        # Web server scanner
docker compose -f docker-compose.security.yml up nmap         # Network scanner
```

### Security Reports

All scan results are written to `pakalon-cli/.pakalon/`:
- `semgrep-results.json`
- `gitleaks-results.json`
- `bandit-results.json`
- `zap-results.html` / `zap-results.xml`
- `nikto-results.json`
- `nmap-results.xml`
- `sqlmap-results/`
- `wapiti-results.json`
- `xsstrike-results.json`
- `sonarqube-results.json`
- `findsecbugs-results.json`
- `brakeman-results.json`
- `eslint-security-results.json`

### Configuration

```bash
# Set target URL for DAST scanners
export SECURITY_TARGET_URL=http://localhost:3000
export SECURITY_TARGET_HOST=localhost
```

Runtime scanners target `http://host.docker.internal:3000` by default. Start your local app first, or set `SECURITY_TARGET_URL` / `SECURITY_TARGET_HOST` before running them.

---

## Web Dashboard

The Pakalon web dashboard (`pakalon-web`) provides a comprehensive web interface for monitoring and managing your Pakalon usage.

### Features

| Feature | Description |
|---------|-------------|
| **Dashboard Overview** | Token usage, session count, lines of code written |
| **Session History** | Browse all chat sessions with message counts |
| **Usage Analytics** | Token consumption by model, daily usage charts |
| **Contribution Heatmap** | GitHub-style heatmap of daily activity |
| **Model Usage** | Breakdown of tokens used per model |
| **Billing Management** | Subscription status, upgrade, cancel, manage portal |
| **Profile Settings** | Display name, privacy mode toggle |
| **Login Events** | Security log of all authentication events |
| **Automations** | Create, manage, and monitor automated workflows |
| **Visual Workflow Editor** | Drag-and-drop workflow builder with @xyflow/react |
| **Support** | Submit support tickets |

### Automations Dashboard

- **Template Library** — pre-built automation templates
- **Cron Jobs** — schedule automations with timezone support
- **Webhook Triggers** — trigger automations via HTTP webhooks
- **Execution Logs** — detailed node-level execution logs
- **Version Control** — workflow versioning with rollback
- **Connector Management** — OAuth connectors for GitHub, Slack, etc.
- **Import/Export** — share workflows as JSON

### Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/login` | Authentication (GitHub OAuth) |
| `/pricing` | Plan comparison and upgrade |
| `/dashboard` | Main dashboard |
| `/dashboard/automations` | Automation management |
| `/dashboard/billing` | Subscription management |
| `/dashboard/profile` | User settings |
| `/dashboard/support` | Support tickets |
| `/docs` | Documentation |
| `/changelog` | Release notes |

---

## Automations

Pakalon's automation system enables scheduled and triggered AI workflows.

### Trigger Types

| Type | Description |
|------|-------------|
| **Cron** | Scheduled execution (e.g., daily, weekly) |
| **Webhook** | HTTP-triggered execution |
| **Manual** | On-demand execution from dashboard |

### Scheduler Backends

- **APScheduler** — primary scheduler running in the backend process
- **Trigger.dev** — optional fallback for reliability (mirrored jobs)

### Workflow Versions

Every workflow change creates a new version:
- View version history
- Compare versions
- Rollback to any previous version

### Connectors

OAuth connectors for external services:
- GitHub (code repositories)
- Slack (notifications)
- More connectors available via the dashboard

---

## Billing & Plans

### Plans

| Plan | Price | Features |
|------|-------|----------|
| **Free** | $0 | 30 days full access, then free-tier models only |
| **Pro** | $22/month | All models, automations, priority support |

### Trial System

- New users get 30 days of full access
- Trial days remaining shown in dashboard
- After trial: free models remain accessible

### Billing Management

```bash
pakalon upgrade              # Open Polar checkout
```

**Dashboard features:**
- Subscription status and period
- Cancel subscription
- Manage billing portal
- Grace period handling (payment failures)
- Usage charges tracking

### Webhooks

- **Polar webhooks** — subscription events (created, updated, canceled)
- **Supabase auth webhooks** — user lifecycle events
- All webhooks verified via svix signatures

---

## Self-Hosted Mode

Run Pakalon locally with your own Ollama and/or LM Studio models. No auth, no cloud dependencies, works offline.

### Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/pakalon/pakalon
cd pakalon

# 2. Configure backend
cd pakalon-backend
cp .env.selfhosted.example .env
uv sync

# 3. Start Ollama or LM Studio
ollama pull llama3
ollama serve

# 4. Start backend
uv run uvicorn app.main:app --reload --port 8000

# 5. Start web dashboard
cd ../pakalon-web
npm install
npm run dev

# 6. Open http://localhost:3000/selfhosted
```

### Docker Compose

```bash
docker compose -f docker-compose.selfhosted.yml up -d
```

This runs the backend in self-hosted mode with SQLite persistence.

### Self-Hosted API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/local/health` | Self-hosted health check |
| POST | `/local/sync` | CLI connectivity verification |
| GET | `/local/providers` | Ollama/LM Studio status |
| GET | `/local/models` | Discover local models |
| POST | `/local/chat` | Streaming chat completion |

### Security

- **No authentication** — runs on localhost only
- **Mode-gate middleware** — blocks all non-local endpoints
- **SQLite database** — no external database required
- **Firewall recommended** — restrict access to local network

### Configuration

```env
PAKALON_MODE=selfhosted
PAKALON_OLLAMA_URL=http://localhost:11434
PAKALON_LMSTUDIO_URL=http://localhost:1234
ENVIRONMENT=development
JWT_SECRET=<generate-random-32-byte-hex>
```

---

## Configuration

### CLI Configuration

Global config at `~/.config/pakalon/`:
- `storage.json` — JWT tokens, session data
- `debug.log` — debug output (when `--debug` flag used)

### Project Configuration

Per-project config at `.pakalon/`:
- `plan.md` — project context for AI
- `spec.md` — technical specifications
- `CLAUDE.md` — agent-specific instructions
- `phase-N.md` — generated per phase

### Environment Variables

**Backend:**
```env
PAKALON_MODE=cloud|selfhosted
ENVIRONMENT=development|staging|production
DATABASE_URL=postgresql+psycopg://...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...
JWT_SECRET=<32-byte-hex>
OPENROUTER_MASTER_KEY=sk-or-v1-...
POLAR_ACCESS_TOKEN=polar_at_...
RESEND_API_KEY=re_...
ALLOWED_ORIGINS=["http://localhost:3000"]
```

**Web:**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

**CLI:**
```env
PAKALON_TOKEN=<jwt-from-device-auth>
```

---

## Development Setup

### Backend

```bash
cd pakalon-backend
uv sync
cp .env.example .env
docker compose up -d
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

**Backend available at:** `http://localhost:8000`
**Interactive docs:** `http://localhost:8000/docs`

### Web Dashboard

```bash
cd pakalon-web
npm install
npm run dev
```

**Web available at:** `http://localhost:3000`

### CLI

```bash
cd pakalon-cli
bun install
bun dev              # Watch mode
bun run build        # Production build
./dist/index.js      # Run built version
```

### Testing

**Backend:**
```bash
cd pakalon-backend
uv run pytest -v                    # All tests
uv run pytest tests/test_selfhosted_mode.py -v  # Self-hosted tests
uv run pytest --cov=app --cov-report=html       # With coverage
```

**CLI:**
```bash
cd pakalon-cli
bun run test         # Vitest unit tests
bun run type-check   # TypeScript checks
```

**Web:**
```bash
cd pakalon-web
npm run build        # Ensures no type errors
```

---

## Deployment

### Backend (Docker)

```bash
cd pakalon-backend
docker build -t pakalon-backend .
docker run -d -p 8000:8000 --env-file .env pakalon-backend
```

### Backend (Cloud/VPS)

1. Set `ENVIRONMENT=production`
2. Use managed PostgreSQL (Supabase, AWS RDS, etc.)
3. Run behind nginx with TLS termination
4. Set `ALLOWED_ORIGINS` to your frontend URL
5. Run `alembic upgrade head` before deploying

### Web Dashboard (Vercel/Netlify)

1. Connect repository to Vercel/Netlify
2. Set environment variables
3. Deploy automatically on git push

### CLI Distribution

```bash
# Build standalone binary
bun run build

# Publish to npm
npm publish

# Or distribute binary directly
./dist/index.js
```

### Self-Hosted Deployment

```bash
docker compose -f docker-compose.selfhosted.yml up -d
```

Or on a VPS:
```bash
docker run -d \
  -p 8000:8000 \
  --env-file .env \
  --name pakalon-selfhosted \
  pakalon-backend
```

---

## License

MIT © Pakalon. See [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to Pakalon.

## Security

See [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.

## Self-Hosted Guide

See [SELFHOSTED.md](SELFHOSTED.md) for complete self-hosting instructions.
