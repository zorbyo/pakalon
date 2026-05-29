# Pakalon — AI-Powered CLI Code Editor

> Build production-ready applications with one prompt. Pakalon is an AI-powered CLI that combines a streaming chat interface with a 6-phase autonomous build pipeline.

```sh
npm install -g pakalon
pakalon
```

---

## Monorepo Structure

```
pakalon/
├── pakalon-backend/      # FastAPI backend — auth, billing, model registry, telemetry
├── pakalon-cli/          # TypeScript/Bun CLI — Ink TUI + native 6-phase pipeline
├── pakalon-web/          # Next.js 16 website — marketing + dashboard
└── specs/                # Design documents, plan, contracts

## [HAMMERANDWRENCH] Technology Stack

| Project | Stack | Purpose |
|---------|-------|---------|
| **pakalon-backend** | Python 3.12, FastAPI, PostgreSQL 16, Redis 7, Supabase JWT | Auth, billing, model proxy, telemetry API |
| **pakalon-cli** | TypeScript 5.7, Bun, Ink 6.7, Native Pipeline (no Python) | CLI TUI + 6-phase agentic mode |
| **pakalon-web** | Next.js 16, Tailwind v3, Supabase (GitHub OAuth), Polar | Marketing website + dashboard |
| **Penpot** | Docker Compose (frontend + backend + exporter) | Open-source design tool for wireframes |
---

## Sub-projects

| Project | Stack | Purpose |
|---|---|---|
| [pakalon-backend](./pakalon-backend/README.md) | Python 3.12, FastAPI, PostgreSQL 16, Redis 7, Supabase JWT | Auth, billing, model proxy, telemetry API |
| [pakalon-cli](./pakalon-cli/README.md) | TypeScript 5.7, Bun, Ink 6.7, Native Pipeline (no Python) | CLI TUI + 6-phase agentic mode |
| [pakalon-web](./pakalon-web/README.md) | Next.js 16, Tailwind v3, Supabase (GitHub OAuth), Polar | Marketing website + dashboard |
#ZR|
#YS|## [ROCKET] Quick Start — Development
#SZ|
#JT|### **Step 1: Start Backend Services**
#PN|
#HZ|```bash
#XR|cd pakalon-backend
#TN|
#TK|# Copy environment variables
#WT|cp .env.example .env
#XN|# Edit .env with your credentials (see Backend README)
#ZK|
#WN|# Start PostgreSQL, Redis, and Chrome
#XH|docker compose up -d
#MQ|
#HQ|# Install Python dependencies
#KT|uv venv && uv sync
#BT|
#WN|# Run database migrations
#XY|uv run alembic upgrade head
#TK|
#RS|# Start the backend server
#PZ|uv run uvicorn app.main:app --reload --port 8000
#XN|```
#ZK|
#WN|**Backend will be available at:** `http://localhost:8000`
#XH|**Interactive docs:** `http://localhost:8000/docs`
#MQ|
#HQ|### **Step 2: Start Website**
#KT|
#BT|```bash
#WN|cd pakalon-web
#XY|pnpm install
#TK|pnpm dev
#RS|```
#PZ|
#XN|**Website will be available at:** `http://localhost:3000`
#ZK|
#WN|### **Step 3: Build and Test CLI**
#XH|
#MQ|```bash
#HQ|cd pakalon-cli
#KT|bun install
#BT|bun dev
#WN|```
#XY|
#TK|# **Or run the built executable:**
#RS|```bash
#PZ|bun build
#XN|./dist/index.js
#ZK|```
#QT|
#JT|---
#PN|
#HZ|## [ARTISTPALETTE] Running Penpot (Design Tool)
#XR|
#TN|Penpot is an open-source design tool integrated into Pakalon for wireframe generation.
#TK|
#WT|### **Option A: Using CLI Command (Recommended)**
#XN|
#ZK|```bash
#WN|# Launch Pakalon, then run the Penpot slash command in chat
#XH|pakalon
#MQ|/penpot
#HQ|
#KT|# The slash command opens Penpot and starts the sync bridge
#BT|```
#WN|
#XY|### **Option B: Using sync.js Directly**
#TK|
#RS|```bash
#PZ|cd pakalon-cli/python/agents
#XN|
#ZK|# Start Penpot only (no auto-export yet)
#WN|node sync.js --start
#XH|# Windows from repo root: node .\pakalon-cli\python\agents\sync.js --start
#XH|
#MQ|# Start Penpot and auto-sync a specific file
#HQ|node sync.js --start --file <file-id>
#KT|
#BT|# Watch only (assumes Penpot already running)
#WN|node sync.js --watch --file <file-id>
#XY|
#TK|# Preferred long-running mode (auto-manages container lifecycle)
#RS|node sync.js --lifecycle --file <file-id>
#PZ|
#XN|# Stop Penpot
#ZK|node sync.js --stop
#WN|```
#XH|
#MQ|> First run note: Docker may need a few minutes to pull the Penpot images.
#HQ|> If Docker is especially slow on Windows, start the stack once with Option C below, then rerun `node sync.js --start`.
#HQ|> If you omit `--file`, Penpot still starts, but sync/export stays disabled until you provide one.
#KT|
#BT|### **Option C: Manual Docker Compose Run**
#WN|
#XH|```bash
#MQ|cd pakalon-cli
#HQ|
#KT|# Start the full Penpot stack
#BT|docker compose -f python/penpot-compose.yml up -d
#KT|
#WN|# Access Penpot at: http://localhost:3449
#XY|# Stop stack: docker compose -f python/penpot-compose.yml down
#RS|# Do NOT use docker-compose.security.yml here; that file is only for optional security scanners.
#XY|```
#TK|
#RS|### **Penpot Sync Features**
#PZ|
#XN|- **Auto-sync**: Changes in Penpot are automatically exported to `.pakalon-agents/`
#ZK|- **SVG Export**: Wireframes exported as SVG for preview
#WN|- **JSON Export**: Full design data exported as JSON for further processing
#XH|- **Lifecycle Management**: `sync.js` manages container start/stop automatically
#MQ|
#HQ|### **Environment Variables for Penpot**
#KT|
#BT|```bash
#WN|# In .env file
#XY|PENPOT_HOST=http://localhost:3449
#TK|PENPOT_API_TOKEN=<your-penpot-token>
#RS|PENPOT_EMAIL=<your-email>
#PZ|PENPOT_PASSWORD=<your-password>
#XN|```
#PZ|
#XN|## [ARTISTPALETTE] Running Penpot (Design Tool)
#ZK|
#WN|Penpot is an open-source design tool integrated into Pakalon for wireframe generation.
#XH|
#MQ|### **Option A: Using CLI Command (Recommended)**
#HQ|
#KT|```bash
#BT|# Launch Pakalon, then run the Penpot slash command in chat
#WN|pakalon
#XY|/penpot
#TK|
#RS|# The slash command opens Penpot and starts the sync bridge
#PZ|```
#XN|
#ZK|### **Option B: Using sync.js Directly**
#WN|
#XH|```bash
#MQ|cd pakalon-cli/python/agents
#HQ|
#KT|# Start Penpot only (no auto-export yet)
#BT|node sync.js --start
#WN|
#XY|# Start Penpot and auto-sync a specific file
#TK|node sync.js --start --file <file-id>
#RS|
#PZ|# Watch only (assumes Penpot already running)
#XN|node sync.js --watch --file <file-id>
#ZK|
#WN|# Preferred long-running mode (auto-manages container lifecycle)
#XH|node sync.js --lifecycle --file <file-id>
#MQ|
#HQ|# Stop Penpot
#KT|node sync.js --stop
#BT|```
#WN|
#XY|> First run note: Docker may need a few minutes to pull the Penpot images.
#TK|> If you omit `--file`, Penpot still starts, but sync/export stays disabled until you provide one.
#RS|
#PZ|### **Option C: Manual Docker Compose Run**
#BT|
#WN|```bash
#XY|cd pakalon-cli
#TK|
#RS|# Start the full Penpot stack
#PZ|docker compose -f python/penpot-compose.yml up -d
#RS|
#XN|# Access Penpot at: http://localhost:3449
#ZK|# Stop stack: docker compose -f python/penpot-compose.yml down
#ZK|```
#WN|
#XH|### **Penpot Sync Features**
#MQ|
#HQ|- **Auto-sync**: Changes in Penpot are automatically exported to `.pakalon-agents/`
#KT|- **SVG Export**: Wireframes exported as SVG for preview
#BT|- **JSON Export**: Full design data exported as JSON for further processing
#WN|- **Lifecycle Management**: `sync.js` manages container start/stop automatically
#XY|
#TK|### **Environment Variables for Penpot**
#RS|
#PZ|```bash
#XN|# In .env file
#ZK|PENPOT_HOST=http://localhost:3449
#WN|PENPOT_API_TOKEN=<your-penpot-token>
#XH|PENPOT_EMAIL=<your-email>
#MQ|PENPOT_PASSWORD=<your-password>
#HQ|```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  pakalon-web                    │
│  Next.js 15 · Tailwind v4 · Clerk · Polar       │
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
#WB|│  POST /webhooks/clerk    Clerk events           │
#QZ|└─────────────────────────────────────────────────┘
#PK|         │
#NK|         │ Clerk JWT (HS256, 90-day)
#WR|         ▼
#TT|┌─────────────────────────────────────────────────┐
#NX|│                 pakalon-cli                     │
#KQ|│  TypeScript 5.7 · Bun · Ink 6.7 TUI           │
#RN|│  Zustand · Drizzle ORM · Vercel AI SDK          │
#RB|│                                                 │
#VJ|│  Chat mode → streams to OpenRouter              │
#QT|│  Agent mode → spawns Python bridge              │
#JN|└─────────────────────┬───────────────────────────┘
#MM|                      │ HTTP 127.0.0.1:7432
#PT|                      ▼
#NH|┌─────────────────────────────────────────────────┐
#HZ|│           Python Bridge (local only)            │
#QK|│  FastAPI · LangGraph 0.3 · Mem0 · ChromaDB      │
#KK|│                                                 │
#VS|│  Phase 1  Planning — research + Q&A + 12 files  │
#PT|│  Phase 2  Wireframes — Penpot SVG + TDD loop    │
#RM|│  Phase 3  5-subagent development (SA1–SA5)      │
#TB|│  Phase 4  5-subagent security QA (SAST/DAST)    │
#XM|│  Phase 5  CI/CD — GitHub Actions + PR           │
#XK|│  Phase 6  Documentation — API docs + README     │
#NR|└─────────────────────────────────────────────────┘
#RK|         │
#JM|         ▼
#YN|┌─────────────────────────────────────────────────┐
#WT|│                 Penpot (Design)                 │
#SZ|│  Docker: python/penpot-compose.yml              │
#YQ|│  Port: 3449                                     │
#SR|│  Sync: sync.js (auto-sync wireframes)           │
#QZ|└─────────────────────────────────────────────────┘
#NK|#WR|---
#TT|#NX|
#MS|#WQ|## [LOCK] Running Security Tools (15+ Open Source Apps)
#NJ|#NP|
#TB|#RB|These tools are optional for Phase 4 security scanning and are **not** required to run the app.
#ZX|#VJ|
#HJ|#QT|### **Run Baseline Security Scans**
#HW|#XN|
#TR|#MM|```bash
#PT|#PT|cd pakalon-cli
#SR|#YN|docker compose -f docker-compose.security.yml up -d
#RZ|#HZ|```
#RM|#RR|
#XS|#BN|This starts the default SAST tools: `semgrep`, `gitleaks`, and `bandit`.
#RN|#VS|Their reports are written into `pakalon-cli/.pakalon/`.
#ZB|#PT|
#XS|#BN|### **Run the Full Security Suite**
#RN|#VS|
#ZB|#PT|```bash
#VS|#SY|cd pakalon-cli
#HT|#TB|docker compose -f docker-compose.security.yml --profile full up -d
#SS|#XM|```
#JV|#XK|
#ZT|#NR|> Runtime scanners target `http://host.docker.internal:3000` by default.
#HP|#RK|> Start your local app first, or set `SECURITY_TARGET_URL` / `SECURITY_TARGET_HOST` before running them.
#ZB|#PT|
#XS|#BN|### **Run Specific Tools**
#RN|#VS|
#ZB|#PT|```bash
#VS|#SY|# Static Analysis (SAST)
#HT|#TB|docker compose -f docker-compose.security.yml up semgrep      # Code scanning
#SS|#XM|docker compose -f docker-compose.security.yml up bandit       # Python security
#JV|#XK|docker compose -f docker-compose.security.yml up gitleaks     # Secrets detection
#ZT|#NR|
#HP|#RK|# Dynamic Analysis (DAST)
#WY|#JM|docker compose -f docker-compose.security.yml up zap          # OWASP ZAP scanner
#YR|#WT|docker compose -f docker-compose.security.yml up nikto        # Web server scanner
#RZ|#YQ|docker compose -f docker-compose.security.yml up nmap         # Network scanner
#SR|#SR|docker compose -f docker-compose.security.yml up security-headers  # Security headers
#PT|#QZ|
#VJ|#PJ|# Run with profiles
#QY|#MJ|docker compose -f docker-compose.security.yml up -d
#KK|#MJ|docker compose -f docker-compose.security.yml --profile dast up -d
#ZK|#MJ|docker compose -f docker-compose.security.yml --profile full up -d
#JX|#RM|#MJ|```
#YP|#TT|#NX|
#RR|#SR|#QZ|## [CLIPBOARD] Commands Reference
#TV|#WQ|#PJ|
#XH|#VB|#MJ|### **Backend Commands**
#QV|#TH|#MJ|
#SX|#ZW|#MJ|```bash
#WB|#ZS|#MJ|# Start services
#XR|#MX|#MJ|docker compose up -d
#QV|#TH|#MJ|
#RH|#ZZ|#MJ|# Run migrations
#JZ|#WH|#MJ|uv run alembic upgrade head
#QV|#TH|#MJ|
#RY|#SB|#MJ|# Start server (dev)
#JJ|#XX|#MJ|uv run uvicorn app.main:app --reload --port 8000
#QV|#TH|#MJ|
#WB|#SR|#MJ|# Start server (prod)
#JW|#QY|#MJ|uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
#QV|#TH|#MJ|
#QX|#HV|#MJ|# Run tests
#YW|#SH|#MJ|uv run pytest -v
#QY|#JX|#RM|#MJ|```
#QV|#TH|#MJ|
#TZ|#TQ|#MJ|### **CLI Commands**
#QV|#TH|#MJ|
#SX|#ZW|#MJ|```bash
#WH|#PS|#MJ|# Basic usage
#TB|#XR|#MJ|pakalon [message]              # Start interactive chat
#JS|#QQ|#MJ|pakalon --version              # Show version
#XR|#MT|#MJ|pakalon --help                 # Show help
#KK|#PK|#MJ|pakalon login                  # Authenticate
#XN|#MH|#MJ|pakalon logout                 # Remove credentials
#KB|#YV|#MJ|pakalon doctor                 # System requirements check
#PJ|#SY|#MJ|pakalon install                # Install Python bridge
#QV|#TH|#MJ|
#WZ|#BN|#MJ|# Penpot workflow (inside Pakalon chat)
#NQ|#RY|#MJ|pakalon                        # Launch the CLI
#RX|#YB|#MJ|/penpot                        # Open Penpot + start the sync bridge
#MJ|
#MJ|# Agent mode
#MJ|pakalon /pakalon "build a SaaS dashboard"  # 6-phase autonomous build
#MJ|```
#MJ|
#MJ|### **Website Commands**
#MJ|
#MJ|```bash
#MJ|cd pakalon-web
#MJ|pnpm install          # Install dependencies
#MJ|pnpm dev              # Start development server
#MJ|pnpm build            # Build for production
#MJ|pnpm start            # Start production server
#MJ|```
#MJ|
#MJ|---
#MJ|
#MJ|## [TESTTUBE] Testing the Application
#MJ|
#MJ|### **Local Testing**
#MJ|
#MJ|1. **Start all services:**
#MJ|   ```bash
#MJ|   cd pakalon-backend
#MJ|   docker compose up -d
#MJ|   uv run uvicorn app.main:app --reload --port 8000
#MJ|   ```
#MJ|
#MJ|2. **Test API:**
#MJ|   ```bash
#MJ|   curl http://localhost:8000/health
#MJ|   ```
#MJ|
#MJ|3. **Test Penpot:**
#MJ|   ```bash
#MJ|   curl http://localhost:3449/api/rpc/command/get-profile
#MJ|   ```
#MJ|
#MJ|### **Testing in Another Environment**
#MJ|
#MJ|#### **Option 1: Docker Deployment**
#MJ|
#MJ|```bash
#MJ|# Build backend image
#MJ|cd pakalon-backend
#MJ|docker build -t pakalon-backend .
#MJ|
#MJ|# Run on another machine
#MJ|docker run -p 8000:8000 --env-file .env pakalon-backend
#MJ|```
#MJ|
#MJ|#### **Option 2: Cloud Deployment**
#MJ|
#MJ|```bash
#MJ|# Push to container registry
#MJ|docker tag pakalon-backend your-registry/pakalon-backend:latest
#MJ|docker push your-registry/pakalon-backend:latest
#MJ|
#MJ|# Deploy on cloud (AWS ECS, Google Cloud Run, etc.)
#MJ|# Use managed PostgreSQL and Redis services
#MJ|```
#MJ|
#MJ|#### **Option 3: VPS Deployment**
#MJ|
#MJ|```bash
#MJ|# On your VPS
#MJ|docker run -d \
#MJ|  -p 8000:8000 \
#MJ|  --env-file .env \
#MJ|  --name pakalon-backend \
#MJ|  your-registry/pakalon-backend:latest
#MJ|```
#SR|
#QZ|## [MEMO] Project Files
#PJ|
#MJ|### **Generated by Pakalon**
#MJ|
#MJ|When you run `pakalon init`, these files are created in your project:
#MJ|
#MJ|```
#MJ|.pakalon/
#MJ|├── plan.md              # Project context fed to AI
#MJ|├── spec.md              # Technical specifications
#MJ|├── CLAUDE.md            # Agent-specific instructions
#MJ|├── phase-1.md           # Planning phase output
#MJ|├── phase-2.md           # Wireframes phase output
#MJ|├── phase-3.md           # Frontend phase output
#MJ|├── phase-4.md           # Backend phase output
#MJ|├── phase-5.md           # CI/CD phase output
#MJ|└── phase-6.md           # Documentation phase output
#MJ|```
#MJ|
#MJ|### **Sync.js Output**
#MJ|
#MJ|When Penpot sync runs, files are saved to:
#MJ|
#MJ|```
#MJ|.pakalon-agents/
#MJ|├── ai-agents/
#MJ|│   └── phase-2/
#MJ|│       ├── Wireframe_generated.svg
#MJ|│       ├── Wireframe_generated.penpot
#MJ|│       └── penpot_meta.json
#MJ|└── wireframes/
#MJ|    ├── wireframe_2024-01-01T12-00-00.svg
#MJ|    └── wireframe_2024-01-01T12-00-00.penpot
#MJ|```
#MJ|
#MJ|---
#MJ|
#MJ|## [LEFT-POINTINGMAGNIFYINGGLASS] Troubleshooting
#MJ|
#MJ|### **Backend Issues**
#MJ|
#MJ|| Problem | Solution |
#MJ||---------|----------|
#MJ|| Database connection failed | Check PostgreSQL is running: `docker ps` |
#MJ|| Port 8000 in use | Change port: `--port 8001` |
#MJ|| Migrations failed | Run `uv run alembic upgrade head` |
#MJ|| Missing environment variables | Copy `.env.example` to `.env` and fill in values |
#MJ|
#MJ|### **Penpot Issues**
#MJ|
#MJ|| Problem | Solution |
#MJ||---------|----------|
#MJ|| Penpot container not starting | First run may take a few minutes while Docker pulls the image; check `docker ps -a` and rerun `node sync.js --start` |
#MJ|| Port 3449 in use | Change port in `python/penpot-compose.yml` and keep `PENPOT_HOST` in sync |
#MJ|| Sync not working | Check PENPOT_API_TOKEN is set |
#MJ|| Browser won't open | Use `--no-browser` flag and open manually |
#MJ|
#MJ|### **Security Tools Issues**
#MJ|
#MJ|| Problem | Solution |
#MJ||---------|----------|
#MJ|| Docker not running | Start Docker Desktop |
#MJ|| No service selected | Update to the latest repo version; baseline scans now run with `docker compose -f docker-compose.security.yml up -d` |
#MJ|| Tools not found | Run `docker compose -f docker-compose.security.yml pull` |
#MJ|| Results not saved | Check `.pakalon/` directory exists |
#MJ|
#MJ|---
#MJ|
#MJ|## [ROCKET] Production Deployment
#MJ|
#MJ|### **Backend (Docker)**
#MJ|
#MJ|```bash
#MJ|# Build image
#MJ|docker build -t pakalon-backend .
#MJ|
#MJ|# Run with production settings
#MJ|docker run -d \
#MJ|  -p 8000:8000 \
#MJ|  --env-file .env \
#MJ|  --name pakalon-backend \
#MJ|  pakalon-backend
#MJ|
#MJ|# Or use docker-compose
#MJ|docker-compose up -d
#MJ|```
#MJ|
#MJ|### **Website (Vercel/Netlify)**
#MJ|
#MJ|1. Connect your repository to Vercel/Netlify
#MJ|2. Set environment variables
#MJ|3. Deploy automatically on git push
#MJ|
#MJ|### **CLI Distribution**
#MJ|
#MJ|```bash
#MJ|# Build standalone binary
#MJ|bun build
#MJ|
#MJ|# Publish to npm
#MJ|npm publish
#MJ|
#MJ|# Or distribute binary directly
#MJ|./dist/index.js
#MJ|```
#MJ|
#MJ|---
#MJ|
#MJ|## [BOOKS] Additional Resources
#MJ|
#MJ|- **Backend README:** `./pakalon-backend/README.md`
#MJ|- **CLI README:** `./pakalon-cli/README.md`
#MJ|- **Web README:** `./pakalon-web/README.md`
#MJ|- **Penpot Docs:** https://penpot.app/docs
#MJ|- **FastAPI Docs:** https://fastapi.tiangolo.com/
#MJ|- **Next.js Docs:** https://nextjs.org/docs
#MJ|
#MJ|---
#MJ|
#MJ|## [PAGEFACINGUP] License
#MJ|
#MJ|MIT © Pakalon
#MJ|

MIT
