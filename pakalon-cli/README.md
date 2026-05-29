# Pakalon CLI

> AI-powered CLI code editor — build production software in 6 autonomous phases.

> Note: the logo has been removed from the header box.

```
██████╗  █████╗ ██╗  ██╗ █████╗ ██╗      ██████╗ ███╗   ██╗
██╔══██╗██╔══██╗██║ ██╔╝██╔══██╗██║     ██╔═══██╗████╗  ██║
██████╔╝███████║█████╔╝ ███████║██║     ██║   ██║██╔██╗ ██║
██╔═══╝ ██╔══██║██╔═██╗ ██╔══██║██║     ██║   ██║██║╚██╗██║
██║     ██║  ██║██║  ██╗██║  ██║███████╗╚██████╔╝██║ ╚████║
╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
```

## Install

```bash
npm install -g pakalon
```

Or with bun:

```bash
bun install -g pakalon
```

**Requires**: Node.js 20+ or Bun 1.0+

---

## First Run

```bash
pakalon
```

On first launch, Pakalon displays a 6-digit authentication code. Open `https://pakalon.com/auth/device`, enter the code and sign in with GitHub. Your JWT is stored at `~/.config/pakalon/storage.json`.

```bash
pakalon install   # Verify system requirements (no Python needed)
pakalon doctor    # Check system requirements
```

---

## Modes

| Mode | Flag | Description |
|------|------|-------------|
| **Chat** | (default) | Interactive streaming AI conversation |
| **Plan** | `/plan` | Switch to planning mode |
| **Edit** | `/edit` | Switch to code editing mode |
| **Agent (HIL)** | `--agent` | 6-phase agentic mode with human checkpoints (pure TypeScript) |
| **Agent (YOLO)** | `--agent --permission-mode yolo` | Fully autonomous — no prompts |

---

## Commands Reference <3

### Top-level commands

```bash
pakalon [message]          # Start interactive chat (or send single message)
pakalon --version          # Show version
pakalon --help             # Show help
pakalon login              # Authenticate (device code flow)
pakalon logout             # Remove stored credentials
pakalon doctor             # System requirements check
pakalon install            # Install Python bridge dependencies
pakalon init               # Initialize .pakalon/ config in current directory
```

### Slash commands (inside chat)

| Command | Description |
|---------|-------------|
| `/undo` | Undo last code change (opens snapshot picker) |
| `/plan` | Switch to Plan mode |
| `/edit` | Switch to Edit mode |
| `/compact` | Compact conversation context to save tokens |
| `/clear` | Clear chat history |
| `/sessions` | Browse saved sessions |
| `/exit` or `q` | Quit |

### Subcommands

```bash
pakalon models                    # List available models
pakalon models set <model-id>     # Set default model
pakalon sessions                  # List all sessions
pakalon sessions new              # Start a new session
pakalon history                   # Show recent session history
pakalon agents                    # List configured specialist agents
pakalon agents create             # Create a new specialist agent
pakalon agents remove <name>      # Remove an agent
pakalon mcp list                  # List active MCP servers
pakalon mcp add <name> <url>      # Add an MCP server
pakalon mcp remove <name>         # Remove an MCP server
pakalon plugins                   # List installed plugins
pakalon plugins install <pkg>     # Install a plugin
pakalon plugins remove <pkg>      # Remove a plugin
pakalon status                    # Show current auth + plan status
pakalon upgrade                   # Upgrade to Pro plan (opens Polar checkout)
pakalon workflows                 # List saved prompt workflows
pakalon workflows save <name>     # Save current chat as reusable workflow
pakalon /pakalon <prompt>         # Launch 6-phase agentic builder
pakalon setup-token               # CI/CD: store JWT from env PAKALON_TOKEN
pakalon update                    # Update CLI to latest version
```

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

## Agent Mode Guide

Agent mode runs a 6-phase autonomous build pipeline:

```bash
pakalon /pakalon "build a SaaS dashboard with Next.js and PostgreSQL"
```

| Phase | What it builds |
|-------|---------------|
| 1 — Planning | Researches stack, asks clarifying questions, creates plan files |
| 2 — Wireframes | Generates Penpot wireframes from Figma or description |
| 3 — Frontend | Scaffold + components + logic using shadcn/ui registry |
| 4 — Backend | Project files, DB schema, API routes via sub-agents |
| 5 — CI/CD | GitHub Actions workflows + creates PR |
| 6 — Documentation | API docs, README, CHANGELOG |

HIL mode pauses before each phase for your approval.  
YOLO mode (`--permission-mode yolo`) proceeds automatically through all phases.

Pakalon's autonomous executor follows a **PAUL-inspired loop** for each task:

- **Plan** — inspect the repo, gather context, and choose the smallest next action
- **Apply** — perform the change with actual tools instead of just describing commands
- **Unify** — validate the result and summarize what was completed

When language servers are available, the agent can also use **LSP-backed methods** such as definition lookup, references, hover, completion, rename, diagnostics, and workspace symbol search to inspect and validate code changes.

---

## Keyboard Shortcuts (Chat TUI)

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+C` | Cancel stream / Quit |
| `Ctrl+U` | Clear input |
| `Ctrl+O` | Toggle verbose panel |
| `Tab` | Cycle through modes (Chat / Plan / Edit) |
| `↑ / ↓` | Browse input history |

---

## Configuration Files

Pakalon looks for `.pakalon/` in the current directory:

```
.pakalon/
├── plan.md            # Project context fed to every AI call
├── spec.md            # Technical specifications
├── CLAUDE.md          # Agent-specific instructions
└── phase-N.md         # Generated per phase by agentic mode
```

Run `pakalon init` to create the `.pakalon/` scaffold.

---

## Privacy Mode

Enable privacy mode to prevent personal data from being stored in Mem0:

```bash
pakalon --privacy    # (or toggle with Ctrl+P in chat)
```

When enabled:
- Mem0 conversation memory is disabled
- External telemetry is suppressed
- `X-Privacy-Mode: 1` sent to the Python bridge

---

## FAQ

**Python not found**  
Run `pakalon doctor` to diagnose. Ensure Python 3.12+ is installed and on PATH.

**Bridge fails to start**  
Run `pakalon install` to install Python dependencies, then try again.

**Docker not running**  
Docker is only needed for Penpot wireframe generation (Phase 2). All other features work without Docker.

**Can I use Pakalon without a Pro plan?**  
Yes — free users get 30 days of full access. After that, free models (those marked as `free` in `/models`) remain accessible.

**How do I use it in CI/CD?**  
Set `PAKALON_TOKEN` env var to your JWT, then run `pakalon setup-token` or pass `--token` flag.

---

## Development

```bash
git clone https://github.com/pakalon/pakalon
cd pakalon-cli

bun install
bun run dev          # Watch mode
bun run build        # Production build to dist/
bun run test         # Vitest unit tests
bun run type-check   # TypeScript checks
```

---

## License

MIT © Pakalon
# pakalon-cli [EARTHGLOBEEUROPE-AFRICA]
<3
