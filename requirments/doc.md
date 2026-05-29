**PAKALON**

#Techstack

| Component            | Technology                        | Version/Notes                          |
| -------------------- | --------------------------------- | -------------------------------------- |
| **Languages**        | TypeScript + Bun                  | TS v5.7, Bun latest                    |
|                      | Python                            | **v3.12+** (embedded for AI agents)    |
| **CLI Framework**    | Ink + React                       | Terminal UI components                 |
|                      | Commander.js                      | Command routing                        |
| **Layout Engine**    | Yoga                              | Terminal layout                        |
| **TUI Visuals**      | Ink + Figlet + terminal-image     | ASCII + inline images                  |
| **API/Backend**      | **Embedded in CLI**               | **NO separate backend** (Axum removed) |
| **ORM**              | Drizzle ORM                       | For cloud sync only (optional)         |
| **Database (Local)** | **Bun SQLite**                    | Embedded, zero-config                  |
| **Database (Cloud)** | Turso or Supabase                 | Optional sync                          |
| **Agent Framework**  | **LangGraph  Python + FastAPI **  | v0.2+                                  |
|                      | **Vercel AI SDK**                 | v4 (primary AI interface)              |
| **State Management** | TanStack Query + Zustand          | Query v5.90+, Zustand v5.0+            |
| **Payment**          | **Polar**                         | Choose one                             |
| **Auth**             | Clerk                             | Pro users only                         |
| **Web Scraping**     | Firecrawl                         | v2.5 (Docker or API)                   |
| **RAG/Vector DB**    | Chroma/LanceDB Registry-based RAG | Local and also internet seacrhing      |
| **MCP Servers**      | MCP + vercel's agent browser      | v1.0                                   |
| **Design Tool**      | Penpot                            | v2.11.1 (local Docker)                 |
| **Image Processing** | Sharp (primary)                   | Node.js native                         |
|                      | imgproxy                          | Docker (optional)                      |
| **Storage**          | Local filesystem (default)        | Zero config                            |
|                      | MinIO                             | Self-hosted S3 (optional)              |
|                      | cloudinary                        | Cloud backup (optional)                |
| **AI Models**        | OpenRouter                        | Direct SDK or via Vercel AI SDK        |
| **Security Tools**   | All via Docker                    | Semgrep, ZAP, etc.                     |
| **Deployment**       | npm registry                      | `npm install -g pakalon`               |
| **Cloud Services**   | Vercel                            | Marketing + telemetry API only         |
|                      | Supabase                          | Auth/telemetry DB (free tier)          |
| **Memory**           | Mem0                              | Via Docker                             |
| **Web scrapping**    | Firecrawl                         | To search across internet, scrape data |
| **Email services**   | Resend                            | To notify users about plan & billing   |


#Working

 Based on all our conversations and your updated requirements, here is the **complete working architecture** of **Pakalon CLI** (local-first, terminal-based AI code editor):

---

## **PAKALON CLI - COMPLETE WORKING ARCHITECTURE**

---

### **1. SYSTEM OVERVIEW**

Pakalon CLI is a **local-first, terminal-based AI code editor** that runs entirely on the user's machine. It uses a **credit-based system** (not project-based) tracked by machine ID. The application operates through **6 sequential phases**, each handled by specialized AI agents that pass context via `.md` files.

---

### **2. CORE ARCHITECTURE**

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER MACHINE (LOCAL)                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  PAKALON CLI (TypeScript + Bun + Ink + React)           │   │
│  │  ├─ Terminal UI (Ink components)                        │   │
│  │  ├─ Command Router (Commander.js)                       │   │
│  │  ├─ Local SQLite DB (Bun SQLite)                        │   │
│  │  │   ├─ User credits tracking                           │   │
│  │  │   ├─ Machine ID & authentication                     │   │
│  │  │   ├─ Chat history & memory                           │   │
│  │  │   └─ Project state & progress                        │   │
│  │  ├─ Vercel AI SDK (OpenRouter provider)                 │   │
│  │  └─ Mem0 Memory (Docker)                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌───────────────────────────┼───────────────────────────────┐ │
│  │                           ▼                                │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │  Python AI Agents (LangGraph + FastAPI subprocess)  │  │ │
│  │  │  ├─ Phase 1: Planning Agent                         │  │ │
│  │  │  ├─ Phase 2: Design Agent (+TDD screenshots)        │  │ │
│  │  │  ├─ Phase 3: Development Agent (5 sub-agents)       │  │ │
│  │  │  ├─ Phase 4: Testing Agent (5 sub-agents)           │  │ │
│  │  │  ├─ Phase 5: Deployment Agent                       │  │ │
│  │  │  └─ Phase 6: Maintenance Agent                      │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │  Docker Containers (spawned on demand)              │  │ │
│  │  │  ├─ Penpot (localhost:9001) - Phase 2 & 3           │  │ │
│  │  │  ├─ Mem0 (memory persistence)                       │  │ │
│  │  │  ├─ Firecrawl (web scraping)                        │  │ │
│  │  │  ├─ Security Tools (Phase 4):                      │  │ │
│  │  │  │   ├─ Free: Bandit, FindSecBugs, Brakeman, etc.   │  │ │
│  │  │  │   └─ Pro: +Semgrep, SonarQube, Gitleaks, ZAP     │  │ │
│  │  │  └─ Registry RAG (component search)                 │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │  Local File System                                  │  │ │
│  │  │  ~/pakalon-projects/                                │  │ │
│  │  │  └── {project-name}/                                │  │ │
│  │  │      ├── ai-agents/                                 │  │ │
│  │  │      │   ├── phase-1/phase-1.md                     │  │ │
│  │  │      │   ├── phase-2/phase-2.md (+TDD screenshots)  │  │ │
│  │  │      │   ├── phase-3/                                │  │ │
│  │  │      │   │   ├── subagent-1.md (frontend)            │  │ │
│  │  │      │   │   ├── subagent-2.md (backend)             │  │ │
│  │  │      │   │   ├── subagent-3.md (integration)         │  │ │
│  │  │      │   │   ├── subagent-4.md (debugging)           │  │ │
│  │  │      │   │   └── subagent-5.md (verification)        │  │ │
│  │  │      │   ├── phase-4/                                │  │ │
│  │  │      │   │   ├── subagent-1.md (SAST)                │  │ │
│  │  │      │   │   ├── subagent-2.md (DAST)                │  │ │
│  │  │      │   │   ├── subagent-3.md (code review)         │  │ │
│  │  │      │   │   ├── subagent-4.md (CI/CD)               │  │ │
│  │  │      │   │   └── subagent-5.md (cybersecurity)       │  │ │
│  │  │      │   ├── phase-5/phase-5.md                      │  │ │
│  │  │      │   └── phase-6/phase-6.md                      │  │ │
│  │  │      ├── wireframes/ (Penpot exports)                 │  │ │
│  │  │      ├── frontend/ (generated code)                   │  │ │
│  │  │      └── backend/ (generated code)                    │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Optional cloud sync)
┌─────────────────────────────────────────────────────────────────┐
│  MINIMAL CLOUD INFRASTRUCTURE                                   │
│  ├─ Vercel: Marketing site + Telemetry API (Edge Functions)     │
│  ├─ Supabase: Auth DB (GitHub OAuth + 2FA), Credit tracking     │
│  ├─ Polar: Payment processing ($20/month pro plan)              │
│  └─ Resend: Email notifications (billing reminders)             │
└─────────────────────────────────────────────────────────────────┘

```

## 2.1 OPERATING MODE ROUTER (Architecture Addition)
Add this inside the CORE ARCHITECTURE section, between the PAKALON CLI box and the Python AI Agents box:

│  ├─ Operating Mode Router                             │
│  │   ├─ Chat Mode Agent (Direct tool-calling)         │
│  │   └─ Phase Mode Router (Sequential 1→6)            │



---

### **3. AUTHENTICATION & CREDIT SYSTEM**

**Login Flow:**
1. User runs `pakalon login` in terminal
2. CLI generates TOTP secret → displays QR code as ASCII art in terminal
3. User scans QR code with authenticator app (Google/Microsoft Authenticator)
4. CLI prompts for 6-digit code
5. User enters code in terminal
6. CLI verifies against Supabase Auth
7. On success: Machine ID registered, credits loaded locally

**Credit Tracking (Cursor/Claude Code style):**
- **Free Users**: 10 messages/day, free OpenRouter models only
- **Pro Users**: 25 messages/day, all OpenRouter models
- Credits reset daily at 2:00 AM local time
- Tracked by **machine ID** + **user ID** stored in local SQLite
- On login: CLI checks Supabase for plan status → caches locally

**Billing:**
- Pro: $20/month (prepaid)
- Reminder emails: Last 7 days via Resend
- Grace period: 3 days after due date


## 3.1 DUAL MODE OPERATION (Complete Specification)
Replace your existing "Dual Mode Operation" section with this:

DUAL MODE OPERATION
Pakalon CLI operates in two mutually exclusive modes. The mode determines agent behavior, file structure creation, and credit consumption strategy.

| Mode       | Trigger                  | .pakalon Folder | Agent Type                                      | Use Case                          |
|------------|--------------------------|-----------------|-------------------------------------------------|-----------------------------------|
| Chat Mode  | Start typing without /init | NOT CREATED    | Single tool-calling agent (read/edit/bash)     | Quick fixes, CSS changes, small edits in existing projects |
| Project Mode | Execute /init          | CREATED with full structure | LangGraph multi-agent workflow (6 phases) | Full-stack builds, complex apps, greenfield projects |


**PATH A: CHAT MODE (Agent Coding Mode)**
Trigger: User opens CLI in any directory and types requests without /init

Behavior:

AI acts as intelligent coding assistant with direct file access
Uses tool calling: read_file, edit_file, execute_command, web_search, MCP_invocation
No project structure enforced, no .pakalon folder created
Credits deducted per message (10 free/day, 25 pro/day)
Mem0 retains conversation history for context
Can access both Global MCP (~/.pakalon/mcp-servers/) and Project-local MCP (if in a directory with .pakalon/mcp-servers/)

Example Interactions:

User: "Change button color to blue in src/components/Button.tsx"
AI: [read_file] → [edit_file] → "Done. Changed bg-red-500 to bg-blue-500"

User: "Add authentication to this Next.js app"  
AI: [analyze codebase] → [execute: npm install next-auth] → [write: auth.ts] → "Auth configured"


Limitations:

No phase workflow, no design.md generation
No automatic testing or security scanning
No deployment automation (manual only)

**PATH B: PROJECT MODE (/init)**
Trigger: User executes /init command

Behavior:

Creates .pakalon/ folder with complete structure
Smart Detection: Analyzes existing codebase (if any)
Retrospective Filling: Auto-fills .md files based on completion percentage
Conditional Entry: Jumps to appropriate phase based on current state
Retrospective Filling Logic:

When /init detects existing code:

1. Scan: package.json, folder structure, git history, file timestamps
2. Analyze: Determine completion % per component
   - Backend: 70% (API routes exist, models defined)
   - Frontend: 20% (only index.html present)
   - Integration: 0%
3. Fill Markdowns:
   - technical-spec.md: Pre-fill "Backend: Node.js/Express, Database: Mongo..."
   - tasks.md: Mark backend tasks 1-7 as "COMPLETE", frontend tasks 8-15 as "PENDING"
   - plan.md: Note "Existing codebase detected, continuing from 45% completion"
   - context_management.md: Calculate tokens needed for remaining 55% only
4. Phase Skip:
   - If user specified "--skip-design" OR frontend files detected: Phase 2 marked "SKIPPED - Using existing UI"
   - Start at Phase 3, Sub-Agent 2 (Backend already exists, skip Sub-Agent 1)


Constraint Respect:

If user specifies "no frontend changes": Set design.md status to "LOCKED - User requested no UI changes", skip Phase 2 entirely, start Phase 3 at Sub-Agent 2 (Backend)


| Command              | From         | To           | Behavior                                                                               |
| -------------------- | ------------ | ------------ | -------------------------------------------------------------------------------------- |
| /init                | Chat Mode    | Project Mode | Creates .pakalon/, starts Phase 1 (or retrospective analysis)                          |
| /chat                | Project Mode | Chat Mode    | Exits phase workflow, returns to direct tool-calling agent (context preserved in Mem0) |
| /mode <chat\|project> | Any          | Forced       | Explicitly sets mode regardless of .pakalon folder existence                           |

---

### **4. PHASE WORKFLOW (Sequential, Context-Passing)**

Each phase reads the previous phase's `.md` file before starting.

---

#### **PHASE 1: Planning & Requirements**

**Trigger:** User types initial prompt or `/phase1`

**Human-in-the-Loop Mode:**
- AI asks clarifying questions as **multiple-choice options** (Claude Code style)
- Example: "Choose frontend stack:"
  1. HTML/CSS/JS
  2. React/Next.js/Vite/Shadcn
  3. Electron/Vite
  4. Custom input
- Follow-up questions appear below (e.g., "3D design needed?", "Dual theme?")
- User selects number → AI saves to memory → asks next question
- Loop continues until user types "complete" or clicks "End Phase 1"

**YOLO Mode:**
- AI generates everything automatically
- No user interaction
- Uses web scraping (Firecrawl) + MCP servers to gather best practices

**Outputs (saved to `ai-agents/phase-1/`):**
- `phase-1.md` (main document)
- `agent-skills.md`
- `prd.md`
- `risk-assessment.md`
- `user-stories.md`
- `technical-spec.md`
- `competitive-analysis.md`
- `constraints-and-tradeoffs.md`

**Transition:** On completion, auto-starts Phase 2

---

#### **PHASE 2: Design & Architecture**

**Trigger:** Auto-start after Phase 1, or `/phase2`

**Process:**
1. Reads `phase-1.md`
2. Generates wireframes as **screenshots** (TDD approach)
3. Opens **Penpot** (localhost:9001) with wireframes loaded
4. User can edit in Penpot OR select elements via **visual editor** in terminal

**Visual Editor Feature:**
- Click button in terminal chat → Penpot design opens in browser
- User clicks element in Penpot → Element ID appears in terminal chat
- User types changes in terminal → AI applies to specific element only
- Multiple selections supported

**TDD (Test-Driven Design):**
- Screenshots of wireframes saved to `ai-agents/phase-2/screenshots/`
- Test cases written: "Must have X pages", "Button must be at Y position"
- Validation: Compare final design against test cases

**Confirmation:**
- Human-in-the-Loop: "Accept Design?" button in terminal
- YOLO: Auto-accept if tests pass

**Outputs:**
- `phase-2.md` (design decisions)
- `wireframes/` (Penpot exports)
- `tdd-screenshots/` (design test evidence)

**Page Count Validation:**
- AI verifies number of pages matches Phase 1 requirements
- If mismatch: Return to Phase 1 for clarification

---

#### **PHASE 3: Development & Implementation**

**Trigger:** Auto-start after Phase 2 acceptance, or `/phase3`

**Sub-Agents (Sequential, Auto-called):**

| Sub-Agent | Task | Reads | Writes |
|-----------|------|-------|--------|
| **Sub-Agent 1** | Frontend coding | `phase-2.md`, wireframes | `frontend/`, `subagent-1.md` |
| **Sub-Agent 2** | Backend & Supabase setup | `subagent-1.md` | `backend/`, `subagent-2.md` |
| **Sub-Agent 3** | Frontend-Backend integration | `subagent-1.md`, `subagent-2.md` | Integrated code, `subagent-3.md` |
| **Sub-Agent 4** | Debugging & auto-fix | All above | Fixed code, `subagent-4.md` |
| **Sub-Agent 5** | Verification & user handoff | All above | `subagent-5.md`, user testing instructions |

**Frontend Development:**
- Uses **Registry-based RAG** to fetch components from:
  - 21st.dev, ReactBits, DaisyUI, Preline, TailwindFlex, Dribbble, MagicUI, Spline, Aura.build
- Web scraping (Firecrawl) for user-provided reference URLs
- Tech stack: Tailwind CSS + Shadcn UI + Radix UI

**Supabase Integration:**
- If user provides Supabase credentials: Auto-create tables, auth, storage, edge functions
- If no credentials: Use local SQLite for development

**User Interaction (Human-in-the-Loop):**
- After Sub-Agent 1: "Confirm Frontend?" or "Make Changes"
- Changes requested → Return to Sub-Agent 1 with specific instructions
- YOLO: Auto-confirm if tests pass

**Confirmation:**
- "End Phase 3 & Start Phase 4" button appears only after all 5 sub-agents complete

---

#### **PHASE 4: Testing & Quality Assurance**

**Trigger:** Auto-start after Phase 3, or `/phase4`

**Requirement Validation:**
- Compares built application against `phase-1.md` requirements
- Identifies missing/skeleton features
- If gaps found: Returns to Phase 3 with specific fix list

**Test Case Generation:**
- AI writes test cases based on `phase-1.md` user stories
- Must pass before marking complete

**Testing Types:**
- **Black Box:** User story validation (external behavior)
- **White Box:** Internal structure testing via `.xml` test navigation file

**Sub-Agents:**

| Sub-Agent | Tools (Docker) | Access |
|-----------|---------------|--------|
| **Sub-Agent 1 (SAST)** | Bandit, FindSecBugs, Brakeman, ESLint | Free + Pro |
| **Sub-Agent 2 (DAST)** | sqlmap, Wapiti, XSStrike | Free + Pro |
| **Sub-Agent 3 (Code Review)** | AI semantic analysis | Free + Pro |
| **Sub-Agent 4 (CI/CD)** | Pipeline configuration | Pro only |
| **Sub-Agent 5 (Cybersecurity)** | Semgrep, SonarQube, Gitleaks, OWASP ZAP, Nikto | Pro only |

**Auto-Fix Loop:**
- Find bug → Document → Fix → Re-test → Loop 2x
- If unresolved: Escalate to user with detailed report

**Outputs:**
- `phase-4/subagent-{1-5}.md` (detailed findings)
- Security reports (JSON + human-readable)

**Transition:** Auto-start Phase 5 if clean, or return to Phase 3 if issues

---

#### **PHASE 5: Deployment & Integration**

**Trigger:** Auto-start after Phase 4, or `/phase5`

**Export Options (via terminal menu):**
1. **Download locally** - Zip project files
2. **Deploy to cloud** - AWS, GCP, Azure, DigitalOcean, Railway, Render, Vercel, Netlify, Haiku
   - User provides credentials
   - AI configures CI/CD pipeline
3. **Push to GitHub** - Create repo, push code
4. **Custom domain** - Configure DNS (if web app)

**Delete Project:**
- Red button in menu
- Confirmation: Type project name exactly
- Deletes: All files, chat history, AI memory, local DB entries
- Free user: Redirect to pricing (cannot create new project)
- Pro user: Can create new if quota remains

**Output:** `phase-5.md` (deployment log)

---

#### **PHASE 6: Maintenance & Operations**

**Trigger:** `/phase6` (optional), or auto-trigger on bug reports

**Features:**
- Documentation generation for end-users
- Bug monitoring (if user reports issues)
- Auto-call Phase 3 (debugging sub-agent) if bugs found
- Auto-redeploy via Phase 5 after fixes

**Output:** `phase-6.md`

---

### **5. CHAT INTERFACE & COMMANDS**

**Slash Commands:**
- `/phase1` through `/phase6` - Jump to specific phase (if previous completed)
- `/plugin` - List marketplace plugins
- `/help` - Show available commands

**Visual Editor Command:**
- Click "Visual Editor" button → Opens Penpot
- Select element in Penpot → Appears in chat as `#element-id`
- Type changes → Applied only to selected element

**Document Upload:**
- Copy-paste `.md` or `.txt` files directly into terminal
- AI analyzes and incorporates into context

**Interrupt:**
- `Esc` x2 - Stop current generation
- `Ctrl+J` or `Shift+Enter` - New line in chat input

**Bash Commands:**
- All Claude Code commands available: `bash`, `grep`, `read`, `ls`, `cat`, etc.
- Full terminal access within chat interface

---

### **6. FILE STRUCTURE**

```
~/pakalon-projects/
└── {project-name}/
    ├── .pakalon/                          # Hidden folder (all project data)
    │   ├── ai-agents/
    │   │   ├── phase-1/
    |   |   |   ├── context_management.md
    │   │   │   ├── plan.md                # Build plan (NEW)
    │   │   │   ├── tasks.md               # Task breakdown (NEW)
    │   │   │   ├── design.md              # Design specs with Agent Skills (NEW)
    │   │   │   ├── phase-1.md             # Summary
    │   │   │   ├── agent-skills.md
    │   │   │   ├── prd.md
    │   │   │   ├── risk-assessment.md
    │   │   │   ├── user-stories.md
    │   │   │   ├── technical-spec.md
    │   │   │   ├── competitive-analysis.md
    │   │   │   └── constraints-and-tradeoffs.md
    │   │   ├── phase-2/
    │   │   │   ├── phase-2.md
    │   │   │   └── tdd-screenshots/       # TDD evidence (NEW)
    │   │   ├── phase-3/
    │   │   │   ├── subagent-1.md
    │   │   │   ├── subagent-2.md
    │   │   │   ├── subagent-3.md
    │   │   │   ├── subagent-4.md
    │   │   │   ├── subagent-5.md
    |   |   |   ├── execution_log.md
    │   │   │   └── test-evidence/         # Screenshots/videos (NEW)
    │   │   ├── phase-4/
    │   │   │   ├── subagent-1.md
    │   │   │   ├── subagent-2.md
    │   │   │   ├── subagent-3.md
    │   │   │   ├── subagent-4.md
    │   │   │   ├── subagent-5.md
    │   │   │   ├── blackbox_testing.xml   # (NEW)
    │   │   │   └── whitebox_testing.xml   # (NEW)
    │   │   ├── phase-5/
    │   │   │   └── phase-5.md
    │   │   └── phase-6/
    │   │       └── phase-6.md
    │   ├── mcp-servers/                   # Project-specific MCP servers (NEW)
    │   ├── wireframes/                    # Penpot exports
    │   └── pakalon.db                     # SQLite database
    │
    └── (visible project files - code, README, etc.)
```

---

**6.1 CONTEXT MANAGEMENT ENFORCEMENT PROTOCOL**
Add this after the context_management.md example in your Context Management System section:

Enforcement Rules
Creation Trigger:

Generated immediately after plan.md completion in Phase 1
Blocked: Phase 2 cannot start until context_management.md exists and is validated
Compression Mechanism:

80% Threshold: When any phase reaches 80% of its token allocation, Context Compression Agent automatically:
Summarizes completed work into 500-token "Phase Summary"
Archives full details to Mem0 with timestamp
Refreshes context window: Keeps only system prompt + phase summary + current task
Logs compression event to execution_log.md
Hard Stop Behavior:

100% Limit: When token allocation exhausted:
HIL Mode: Halt execution, display: "Token limit reached for Phase 3. Options: (1) Compress & Continue (2) Switch to lighter model (3) Reduce scope"
YOLO Mode: Auto-trigger compression, if still insufficient after compression → escalate to user with error report
Budget Checking:

Each sub-agent must check context_management.md before first LLM call
Sub-Agent header in code: assert current_tokens < phase_budget, "Token budget exceeded"



### **7. MEMORY & STATE MANAGEMENT**

**Mem0 (Docker):**
- Persists conversation context across sessions
- Stores user preferences, project history
- Enables "continue where you left off" (autosave)

**SQLite Local Storage:**
- Machine ID binding
- Daily credit usage tracking
- Project state snapshots
- Offline queue (syncs when online)

**7.1 OPENROUTER ARCHITECTURE CORRECTION**
Replace your AI Model Management section with this corrected version:

AI Model Implementation (OpenRouter)
Architecture Flow (Corrected):

┌─────────────┐     ┌──────────────────────┐     ┌─────────────┐
│   CLI       │────>│ Vercel Edge Function │────>│  OpenRouter │
│ (No API Key)│     │ (Master Key + Auth)  │     │   API       │
└─────────────┘     └──────────────────────┘     └─────────────┘
        │                     │
        │              ┌──────┴──────┐
        │              │  Supabase   │
        └─────────────>│ Credit Check│
                       └─────────────┘


Key Security Rule:

NO API KEYS IN CLI: OpenRouter key stored ONLY in Vercel Edge Environment Variables (OPENROUTER_MASTER_KEY)
CLI sends JWT token to Vercel Edge → Edge validates credits (Supabase) → Edge calls OpenRouter → Stream response back to CLI
Dynamic Model Fetching:

Endpoint: GET https://openrouter.ai/api/v1/models (cached 1 hour in ~/.pakalon/models-cache.json)
Free Tier Filter: model.id.endsWith(':free') (automatic filtering)
Pro Tier: No filter, full access to frontier models (anthropic/claude-3.5-sonnet, openai/gpt-4o, etc.)
New Models: Automatically appear after cache refresh, no CLI update required
Rate Limiting:

Checked at Vercel Edge layer before OpenRouter call
Free: 10 requests/day (reset 02:00 local time)
Pro: 25 requests/day

---

##  **8. GLOBAL MCP STORAGE**

~/.pakalon/
├── mcp-servers/           # Global MCP installations
├── config.json           # Global settings
└── telemetry.json        # Machine ID, usage tracking


**ADDITIONAL WORKING**



### **1. PHASE 1: PLANNING & REQUIREMENTS (Enhanced)**

**Smart Questioning Logic:**

| User Input Type | AI Behavior |
|-----------------|-------------|
| **Complete tech stack provided** (e.g., "E-commerce, HTML/CSS/JS frontend, Supabase backend") | Ask **specific follow-ups**: "Which auth provider?", "Payment gateway preference?" |
| **Vague prompt** (e.g., "Build e-commerce website") | Ask **minimum 10 general questions**: Purpose, target audience, tech preferences, scale, etc. |

**New Files Generated:**
- `plan.md` - Complete build plan (created first)
- `tasks.md` - Phase-by-phase task breakdown (created from plan.md)
- `design.md` - Design specifications using **Vercel Agent Skills** 
- `phase-1.md` - Summary of all above files

**Agent Skills Integration:**
- Analyzes user requirements against Vercel Labs Agent Skills 
- Matches appropriate skills to project type
- Embeds skill references in `design.md`

**MCP Servers:**
- User can add MCP servers via chat: `/mcp add <name> <url>`
- **Global install**: Stored in `~/.pakalon/mcp-servers/`
- **Project install**: Stored in `~/pakalon-projects/{project}/.pakalon/mcp-servers/`
- All official MCP servers available 

**Workflow:**
1. User gives initial prompt
2. AI analyzes completeness
3. **Smart questioning** (specific or general based on input)
4. Each answer saved to **Mem0 memory** 
5. After each question: Option to continue or **"End Phase 1"**
6. On end: Generate `plan.md` → `context_management.md` → `tasks.md` → `design.md` → `phase-1.md`
7. Auto-start Phase 2

**4.1 PHASE 1 OUTPUTS (Corrected List)**
In your PHASE 1: Planning & Requirements section, replace the Outputs list with this:

Outputs (saved to ai-agents/phase-1/):

plan.md - Complete build plan (created first)
tasks.md - Phase-by-phase task breakdown (created from plan.md)
design.md - Design specifications using Vercel Agent Skills
context_management.md - Token budget allocation per phase (REQUIRED before Phase 2)
phase-1.md - Summary of all above files
agent-skills.md
prd.md
risk-assessment.md
user-stories.md
technical-spec.md
competitive-analysis.md
constraints-and-tradeoffs.md

---

### **2. PHASE 2: DESIGN & ARCHITECTURE (Enhanced with TDD)**

**Test-Driven Design (TDD):**
- AI generates wireframes
- **Vercel Agent Browser**  opens wireframe in browser
- Takes **screenshot** → saves to `phase-2/tdd-screenshots/`
- Compares screenshot against `design.md` requirements
- If mismatch: Auto-adjust wireframe

**Visual Editor Integration:**
- Penpot opens at `localhost:9001`
- **Element selection sync**: Click in Penpot → Element ID appears in terminal chat
- User types changes in terminal → Applies only to selected element
- **Vercel Agent Browser** verifies design alignment with requirements 

**Page Count Validation:**
- AI counts pages in wireframe
- Validates against `plan.md` requirements
- If mismatch: Returns to Phase 1 for clarification

**Confirmation:**
- "Accept Design" button in terminal
- Screenshot saved only after approval (HIL mode)
- YOLO: Auto-approve if tests pass

---

### **3. PHASE 3: DEVELOPMENT (Enhanced with Agent Browser & Chrome DevTools MCP)**

**Sub-Agent 1 (Frontend) - Enhanced:**
- Uses **Registry-based RAG** for components
- **Vercel Agent Browser** scrapes reference websites 
- Extracts: Colors, typography, spacing, animations
- Updates `design.md` with scraped styling

**Testing with Chrome DevTools MCP** :
- Sub-Agent 5 (Verification) starts local server
- **Chrome DevTools MCP** opens app in Chrome 
- Automated testing:
  - Clicks buttons
  - Fills forms
  - Tests user flows
  - Captures **screenshots** and **screen recordings**
  - Generates performance report
- If errors found: Returns to respective sub-agent with screenshot/video evidence

**Image/Video Analysis:**
- AI analyzes screenshots/recordings using vision models (via OpenRouter)
- Identifies UI issues, console errors, network failures
- Auto-fixes or reports to user

---

### **4. PHASE 4: TESTING (Enhanced with XML Testing)**

**Test Case Generation:**
- AI writes test cases based on `plan.md` requirements
- **Black Box Testing**: `blackbox_testing.xml` - User story validation
- **White Box Testing**: `whitebox_testing.xml` - Internal structure, architecture, code paths

**Testing Execution:**
- SAST/DAST tools run via Docker
- Chrome DevTools MCP for browser automation 
- Compare actual vs. expected from `plan.md`
- Missing features listed → Return to Phase 3


---

### **5. PHASE 5: DEPLOYMENT (Enhanced with GitHub Integration)**

**GitHub Features:**
- Push code to repository
- Create pull requests
- Auto-detect issues from PR comments
- Debug and fix issues via AI agents

**Deployment Options:**
- All cloud services (AWS, GCP, Azure, Railway, Render, Vercel, Netlify, etc.)



### **7. AUTHENTICATION (Updated)**

**Website + CLI Integration:**
- User installs CLI: `npm install -g pakalon`
- First run: `pakalon login`
- Terminal displays **6-digit code** + URL
- User opens website → Logs in (GitHub OAuth via Supabase) → Enters 6-digit code
- CLI verifies → Starts session

**Machine Tracking:**
- `telemetry.machineId` - Unique per installation
- `telemetry.macMachineId` - Hardware-based
- `telemetry.devDeviceId` - Device-based
- Stored in `~/.config/pakalon/storage.json`
- Prevents trial abuse (same as Cursor) 

**Privacy Mode:**
- Option in settings
- Prevents model providers from retaining data
- Stops third-party training on code

---

### **8. COMMANDS (Updated)**

| Command | Description |
|---------|-------------|
| `/init` | Initialize project structure (auto-runs in YOLO, asks in HIL) |
| `/phase1` - `/phase6` | Jump to specific phase (if prerequisites met) |
| `/plugin` | List marketplace plugins |
| `/mcp add <name> <url>` | Add MCP server (global or project) |
| `/mcp list` | List installed MCP servers |
| `/models` | List available OpenRouter models |
| `/workflows` | List available workflows |
| `/directory` | Show project structure |
| `/agents` | List active AI agents |
| `/web <url>` | Open URL in Agent Browser |
| `@<file>` | Mention file/folder in chat |
| `--permission-mode <human-in-loop\\|yolo>` | Set interaction mode |
| `--resume` | Resume interrupted session |
| `--debug` | Debug mode |
| `--verbose` | Verbose output |
| `/undo` | revert the code and conversations
**Keyboard Shortcuts:**
- `Esc` x2 - Stop generation
- `Ctrl+J` or `Shift+Enter` - New line in chat

---

### **CORE CONCEPTS**
## Dual Mode Operation


| Mode                  | Trigger                       | Use Case                                    |
| --------------------- | ----------------------------- | ------------------------------------------- |
| **Agent Coding Mode** | Direct prompt without `/init` | Simple edits, quick fixes, file operations  |
| **Phase Mode**        | `/init` command executed      | Full project building, complex applications |


## PATH A: AGENT CODING MODE (No /init)##
Trigger: User opens CLI in any directory and starts typing requests without running /init
Behavior:
AI acts as intelligent coding assistant
Uses tool calling: read_file, edit_file, execute_command, web_search
No project structure enforced
No .pakalon folder created
Credits deducted per message (10 free/day, 25 pro/day)
Example Interactions:

User: "Change button color to blue in src/components/Button.tsx"
AI: [Reads file] → [Edits file] → "Done. Changed bg-red-500 to bg-blue-500"

User: "Add authentication to this Next.js app"
AI: [Analyzes codebase] → [Installs NextAuth] → [Creates auth config] → "Authentication added"

Features Available:
All MCP servers (global + project-local)
File editing and creation
Command execution
Web scraping (Firecrawl)
Image/video analysis
No phase restrictions

## PATH B: PHASE MODE (/init executed)##
Trigger: User runs /init command
Behavior:
Creates .pakalon/ folder with complete structure
Analyzes existing codebase (if any)
Auto-fills .md files based on found code
Runs Phase 1 → 6 sequentially
For New Projects:
Empty .md files created
Phase 1 starts with user prompt
Full 6-phase lifecycle executed
For Existing Projects (50% built):
AI scans current codebase
Auto-generates .md files:
package.json → technical-spec.md
Folder structure → plan.md, tasks.md
UI components → design.md
Existing code → Partial phase-1.md
Only fills up to completion level
User can specify: "No frontend changes" → frontend sections marked complete


## CONTEXT MANAGEMENT SYSTEM##
File: context_management.md (Generated in Phase 1 after plan.md)
Purpose: Allocate token budget across phases to prevent context overflow and control costs.

# context_management.md

## Model Configuration
- Model Selected: claude-3.5-sonnet
- Context Window: 200,000 tokens
- Max Output: 8,192 tokens
- Cost per 1M tokens: $3.00

## Token Allocation Strategy

### Phase 1 (Planning)
- Allocation: 15% (30,000 tokens)
- Usage: Requirements gathering, plan creation, context management setup
- Reserve: 5,000 tokens for output

### Phase 2 (Design)
- Allocation: 20% (40,000 tokens)
- Usage: Wireframe generation, TDD screenshots, design validation
- Reserve: 10,000 tokens for design specs

### Phase 3 (Development)
- Allocation: 35% (70,000 tokens)
- Sub-Agent 1 (Frontend): 15% (30,000 tokens)
- Sub-Agent 2 (Backend): 10% (20,000 tokens)
- Sub-Agent 3 (Integration): 10% (20,000 tokens)
- Sub-Agent 4 (Debug): 5% (10,000 tokens)
- Sub-Agent 5 (Verify): 5% (10,000 tokens)

### Phase 4 (Testing)
- Allocation: 15% (30,000 tokens)
- Usage: SAST/DAST analysis, test case generation

### Phase 5 (Deployment)
- Allocation: 10% (20,000 tokens)
- Usage: Cloud API interactions, deployment logs

### Phase 6 (Maintenance)
- Allocation: 5% (10,000 tokens)
- Usage: Documentation, bug fixes

## Buffer & Recovery
- Emergency Reserve: 5% (10,000 tokens)
- Context Compression Trigger: 80% of phase allocation
- Compression Method: Summarize completed work → Archive to Mem0 → Fresh context

## User Selection (Human-in-the-Loop)
- Conservative (65%): Recommended for new projects
- Standard (80%): Balanced approach
- Aggressive (95%): Maximum capability
- Custom: [User inputs percentage]

## YOLO Mode Auto-Selection
- Simple project: 70%
- Medium project: 85%
- Complex project: 95%

**User Interaction (Human-in-the-Loop):** 
AI: "This project requires significant context. Choose token usage:"

1. Conservative (65%) - Safe, cost-effective
2. Standard (80%) - Balanced approach  
3. Aggressive (95%) - Maximum capability
4. Custom: [Enter percentage]

Note: Minimum 65% for new projects, 35% for existing projects

Your choice: _

## Enforcement:
Each phase checks token usage against allocation
At 80% usage: Trigger context compression
At 100% usage: Halt phase, request user intervention or auto-compress
Sub-agents plan work within their token budget

**OPENROUTER AI MODEL IMPLEMENTATION**
API Key Strategy: SINGLE KEY with Backend Filtering 
Dynamic Model List:
CLI fetches fresh model list on startup
Caches for 1 hour
/models command shows all available with indicators (free/pro)
New models appear automatically without CLI update

## PHASE 3 EXECUTION LOGGING
File: execution_log.md (Created at Phase 3 start, updated by each sub-agent)
Purpose: Complete audit trail of all actions for verification and debugging.


## AUTHENTICATION & MACHINE TRACKING
Login Flow:
User runs pakalon login
CLI generates TOTP secret → displays QR code (ASCII art)
User scans with authenticator app
CLI prompts for 6-digit code
User enters code
CLI verifies via Supabase Auth
On success: Machine ID registered
// ~/.config/pakalon/storage.json
{
  "telemetry": {
    "machineId": "uuid-v4-unique-per-install",
    "macMachineId": "hash-of-mac-address",
    "devDeviceId": "hash-of-device-fingerprint",
    "lastLogin": "2024-01-15T10:30:00Z",
    "plan": "free|pro",
    "dailyRequests": 7,
    "dailyReset": "2024-01-16T02:00:00Z"
  }
}

Privacy Controls:
Privacy Mode: Prevents model providers from retaining data
Data export: User can request all stored data
Account deletion: Full removal within 30 days



### **10. WORKFLOW SUMMARY**

```
User: npm install -g pakalon
       pakalon login → 6-digit code → Website auth → CLI starts

┌─────────────────────────────────────────────────────────────┐
│  PATH A: CHAT MODE (No /init)                               │
│  User: "Fix CSS in button.tsx"                              │
│  AI:   [Direct tool call: read → edit]                      │
│  Result: Immediate file change, no .pakalon created         │
│  Credits: Deducted 1 message                                │
└─────────────────────────────────────────────────────────────┘
                              OR
┌─────────────────────────────────────────────────────────────┐
│  PATH B: PROJECT MODE (/init executed)                      │
│                                                             │
│  Step 1: /init                                              │
│  CLI:  Detects existing codebase?                           │
│    ├─ YES → Analyze completion % → Fill .md files partially │
│    └─ NO  → Create empty .md structure                      │
│                                                             │
│  Step 2: Phase 1                                            │
│  User: "Build e-commerce site" (vague)                      │
│  AI:   Smart questioning (10 general OR specific follow-ups)│
│        → Saved to Mem0                                      │
│        → User clicks "End Phase 1"                          │
│        → Generate plan.md → tasks.md → design.md            │
│        → Generate context_management.md (token budgets)     │
│        → Auto-start Phase 2                                 │
│                                                             │
│  Step 3: Phase 2                                            │
│  AI:   Generate wireframes → Agent Browser screenshot       │
│        → TDD validation                                     │
│        → Penpot opens (optional edit)                       │
│        → "Accept Design" → phase-2.md                       │
│                                                             │
│  Step 4: Phase 3 (with Execution Logging)                   │
│  AI:   Sub-agents execute (1→5)                             │
│        → Each action logged to execution_log.md             │
│        → Token budget checked per sub-agent                 │
│        → Sub-Agent 5 verifies execution_log.md              │
│        → Chrome DevTools MCP tests app                      │
│        → phase-3.md + execution_log.md                      │
│                                                             │
│  Step 5: Phase 4                                            │
│  AI:   Generate blackbox_testing.xml + whitebox_testing.xml │
│        → SAST/DAST via Docker                               │
│        → Compare with plan.md                               │
│        → Return to Phase 3 if gaps found                    │
│                                                             │
│  Step 6: Phase 5                                            │
│  User: Select deploy target (AWS/Vercel/GitHub/etc)         │
│  AI:   Configure CI/CD → Deploy → phase-5.md                │
│                                                             │
│  Step 7: Phase 6 (Optional)                                 │
│  AI:   Monitor → Fix bugs → Redeploy                        │
└─────────────────────────────────────────────────────────────┘




```

 Here is the complete **UNDO System** specification to insert into your `doc.md`:

---

### **11. UNDO SYSTEM (/undo)**

Pakalon implements a **Git-like snapshot system** that tracks both conversation state and codebase state after every significant operation. This enables granular rollback capabilities without requiring external version control.

#### **11.1 Architecture**

```
┌─────────────────────────────────────────────────────────────┐
│                    SNAPSHOT MANAGER                         │
│  (Integrated into Bun SQLite + Local Filesystem)            │
├─────────────────────────────────────────────────────────────┤
│  ~/pakalon-projects/{project}/.pakalon/snapshots/           │
│  ├── snapshot-index.db         # SQLite: metadata & diffs   │
│  └── archives/                 # Compressed state bundles   │
│      ├── snap-{uuid}-code.tar.gz    # File system state    │
│      ├── snap-{uuid}-mem0.json      # Conversation state   │
│      └── snap-{uuid}-context.json   # Token usage state    │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   ┌─────────┐           ┌─────────┐          ┌──────────┐
   │  Code   │           │  Chat   │          │ Context  │
   │ Snapshot│           │ History │          │ Budget   │
   │ (Files) │           │ (Mem0)  │          │ (Tokens) │
   └─────────┘           └─────────┘          └──────────┘
```

#### **11.2 Snapshot Triggers**

A snapshot is automatically created **before** any of these operations:

| Trigger Event | Mode | Snapshot Content |
|--------------|------|------------------|
| File write/edit | Chat | Code state + Conversation context |
| Tool execution (bash) | Chat | Pre-execution file state + Chat log |
| Sub-agent completion | Project | Entire codebase + Mem0 session + Token usage |
| Phase transition | Project | Full `.pakalon/` state + Execution log |
| MCP server invocation | Both | Pre-invocation state + Parameters |

**Retention Policy:**
- Chat Mode: Last 50 snapshots (configurable in `~/.pakalon/config.json`)
- Project Mode: Last 100 snapshots + 1 permanent checkpoint per phase completion
- Auto-pruning: Snapshots older than 30 days removed (except phase checkpoints)

#### **11.3 Data Structure**

**SQLite Schema (`snapshot-index.db`):**
```sql
CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,           -- UUID v4
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    mode TEXT CHECK(mode IN ('chat', 'project')),
    phase INTEGER,                 -- NULL if Chat Mode, 1-6 if Project
    sub_agent INTEGER,             -- NULL if not in Phase 3
    trigger TEXT,                  -- 'file_edit', 'phase_transition', etc.
    code_hash TEXT,                -- SHA256 of archived codebase
    conversation_turn INTEGER,     -- Message count in Mem0
    token_usage INTEGER,           -- Cumulative tokens at snapshot
    archive_path TEXT,             -- Path to .tar.gz file
    description TEXT               -- Auto-generated summary of changes
);

CREATE TABLE diff_log (
    snapshot_id TEXT REFERENCES snapshots(id),
    file_path TEXT,
    change_type TEXT CHECK(change_type IN ('added', 'modified', 'deleted')),
    lines_added INTEGER,
    lines_removed INTEGER,
    preview TEXT                   -- First 200 chars of diff
);
```

#### **11.4 /undo Workflow**

**Step 1: Command Invocation**
```
User: /undo
CLI:  [Loads latest snapshot metadata]
CLI:  [Calculates diff between current state and snapshot-{n-1}]
```

**Step 2: Preview Generation**
The terminal displays a **TUI diff preview**:

```
┌──────────────────────────────────────────────────────────────┐
│  UNDO PREVIEW - Last Operation                               │
├──────────────────────────────────────────────────────────────┤
│  Timestamp: 2024-01-15 14:23:01                              │
│  Operation: Sub-Agent 3 (Integration) - API route creation   │
│  Files Changed: 3                                            │
│  Conversation: 12 messages (847 tokens)                      │
├──────────────────────────────────────────────────────────────┤
│  CODE CHANGES:                                               │
│   src/api/routes.ts          | +45 lines, -3 lines           │
│     @@ export const createOrder = async (...)                │
│                                                              │
│     src/db/schema.ts           | +12 lines, -0 lines         │
│     @@ added 'orders' table definition                       │
│                                                              │
│    package.json               | Modified (dependency added)  │
├──────────────────────────────────────────────────────────────┤
│  CONVERSATION SNIPPET:                                       │
│  User: "Connect the frontend cart to backend"                │
│  AI:  "I'll create the API routes and database schema..."    │
│  AI:  [Tool: write_file src/api/routes.ts]                   │
└──────────────────────────────────────────────────────────────┘

Select action:
  1.  Undo Conversation Only  (Keep code, revert chat history)
  2.  Undo Code Only         (Keep chat, revert file changes)
  3.  Undo Both              (Full rollback to previous state)
  4.  Do Nothing             (Cancel - 0 tokens consumed)

Choice [1-4]: _
```

**Step 3: Action Execution**

| Choice | Behavior | Token Consumption | Technical Action |
|--------|----------|-------------------|------------------|
| **1. Undo Conversation** | Reverts Mem0 memory to previous state, preserves all file changes | **0 tokens** (no AI call) | Restore `mem0.json` from snapshot, truncate conversation log in SQLite, update context counter |
| **2. Undo Code** | Reverts files to previous state, preserves conversation history | **0 tokens** (no AI call) | Extract `snap-{uuid}-code.tar.gz` to project root, restore file permissions, update `execution_log.md` with rollback entry |
| **3. Undo Both** | Full state rollback (code + conversation) | **0 tokens** (no AI call) | Restore both archives, reset token usage counter to snapshot value, update `context_management.md` budget |
| **4. Do Nothing** | No changes, exit undo menu | **0 tokens** | No operation, return to previous prompt |

**Step 4: Confirmation**
```
Choice: 2 (Undo Code Only)

 Reverted 3 files to state: 2024-01-15 14:22:15
   - src/api/routes.ts (deleted)
   - src/db/schema.ts (reverted -12 lines)
   - package.json (reverted dependency)

 Conversation preserved (12 messages remain)
 Token budget restored: +2,847 tokens available

[Press Enter to continue]
```

#### **11.5 Integration Points**

**With Context Management:**
- Undoing code/conversation restores token usage to the snapshot's recorded value
- Updates `context_management.md` with recovered tokens
- Prevents "token leakage" from rolled-back operations

**With Execution Log:**
- Every undo operation is **appended** to `execution_log.md` as:
  ```markdown
  [UNDO EVENT] 2024-01-15 14:25:00
  - Type: Code Only
  - Restored Snapshot: snap-a3f5d2
  - Reason: User initiated /undo
  - Files Affected: 3
  ```

**With Mem0:**
- Conversation undo truncates Mem0 vector DB to specific message ID
- Preserves memory embeddings prior to snapshot (no re-embedding cost)

**With Phase Workflow (Project Mode):**
- If undo crosses phase boundaries (e.g., undoing Phase 2 work while in Phase 3):
  - **HIL Mode:** Warning: "This will return to Phase 2. Continue?" 
  - **YOLO Mode:** Auto-adjusts phase indicator in `.pakalon/status.json`
- Cannot undo past Phase 1 start (initial `/init` is immutable anchor)

#### **11.6 Edge Cases & Rules**

1. **Multi-file Atomicity:** If a snapshot contains 5 file changes, undoing code reverts all 5 atomically (no partial undo of single files)
2. **Merge Conflicts:** If user manually edited files after AI changes, undo detects conflicts and shows: "[!] Manual changes detected. Force overwrite or abort?"
3. **Dependency Safety:** Undoing `package.json` changes triggers `npm install` rollback to previous lockfile state automatically
4. **Git Integration:** If project is git-initialized, Pakalon creates a commit before applying undo (safety backup)
5. **Pro vs Free:**
   - Free: Max 10 undo operations per day (counted like messages)
   - Pro: Unlimited undo operations
   - **Exception:** "Do Nothing" never counts against quota

#### **11.7 Command Reference**

| Command | Arguments | Description |
|---------|-----------|-------------|
| `/undo` | none | Interactive undo with preview (last operation) |
| `/undo --last` | none | Quick undo both (code + chat) without preview |
| `/undo --list` | none | Show last 10 snapshots as numbered list |
| `/undo --target <n>` | Snapshot number | Undo to specific snapshot (from `/undo --list`) |
| `/undo --code-only` | none | Skip preview, immediately undo code |
| `/undo --chat-only` | none | Skip preview, immediately undo conversation |

**Keyboard Shortcuts:**
- `Ctrl+Z` (in chat input): Alias for `/undo`
- `Esc` during preview: Cancel (equivalent to option 4)

#### **11.8 Technical Implementation Notes**

**Storage Efficiency:**
- Snapshots use **binary diff** (rdiff-style) rather than full copies
- 100 snapshots ≈ 50MB for typical project (compressed)
- Auto-cleanup runs every CLI startup to prune old snapshots

**Performance:**
- Undo operation completes in <500ms for projects <1000 files
- Large projects (10k+ files): Show progress bar during extraction

**Safety:**
- Snapshot created **before** undo applied (undo of an undo is possible)
- Max recursion: 10 consecutive undos (prevents infinite loop)

---

### **12. AGENT TEAMS (PARALLEL EXECUTION MODE)**
Agent Teams enable concurrent task execution through multiple specialized sub-agents operating under a parent coordinator. This operates as an extension of Chat Mode (does not require /init) but can also be invoked within Project Mode during Phase 3 development.

**12.1 Architecture**

┌─────────────────────────────────────────────────────────────┐
│                    AGENT TEAM ORCHESTRATOR                  │
├─────────────────────────────────────────────────────────────┤
│  Parent Agent (Coordinator)                                 │
│  ├─ Role:Task distribution, verification,conflict resolution│
│  ├─ Context: Full project state + all sub-agent outputs     │
│  └─ Tools: Delegate, Verify, Merge, Resolve                 │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Agent 01   │  │  Agent 02   │  │  Agent N    │          │
│  │  (Frontend) │  │  (Backend)  │  │  (Testing)  │          │
│  │  Tools:     │  │  Tools:     │  │  Tools:     │          │
│  │  Write, Edit│  │  Write, Edit│  │  Test,      │          │
│  │  MCP, Bash  │  │  DB, API    │  │  Verify     │          │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│         │                │                │                 │
│         └────────────────┴────────────────┘                 │
│                      Parallel Execution                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Shared Memory (Mem0)
                  + Local File System




**12.2 Command Structure**

Command  Syntax   Description
/agents  /agents  Initialize team creation wizard
/agents create /agents create <team-name> Create new team with parent agent
/agents add /agents add <agent-name> --role <role> --tools <tools>   Add member to current team
/<agent-name>  /frontend "Build login page"  Direct command to specific agent
/agents list   /agents list   Show active agents and status
/agents status /agents status Show parallel task queue
/agents merge  /agents merge  Parent agent consolidates all outputs
/agents dissolve  /agents dissolve  Disband team, return to single-agent mode


**12.3 Team Creation Workflow**

Step 1: Initialization

User: /agents
CLI:  [Wizard Starts]
      "Create Agent Team"
      ├─ Team Name: EcommerceSquad
      └─ Parent Agent Name: LeadDev

CLI:  "How many team members? (2-10)"
User: 3

CLI:  "Configure Agent 1:"
      ├─ Name: FrontendDev
      ├─ Role: React/TypeScript Specialist
      ├─ Allowed Tools: file_write, file_edit, web_search, @mcp-21st
      └─ Constraints: Only /frontend folder

CLI:  "Configure Agent 2:"
      ├─ Name: BackendDev  
      ├─ Role: API/Database Engineer
      ├─ Allowed Tools: file_write, bash, supabase_mcp, sql_mcp
      └─ Constraints: Only /backend folder

CLI:  "Configure Agent 3:"
      ├─ Name: TestEngineer
      ├─ Role: QA Specialist
      ├─ Allowed Tools: execute_command, testing_mcp
      └─ Constraints: Read-only code, write to /tests only

CLI:   Team "EcommerceSquad" created with parent "LeadDev"
       Config saved to: ~/.pakalon/teams/EcommerceSquad.json


**Step 2: Parallel Execution**

User: /frontend "Create responsive navbar with cart icon"
User: /backend "Create /api/cart endpoints (GET, POST, DELETE)"
User: /testengineer "Write test cases for cart functionality"

CLI:   Executing 3 tasks in parallel...
      ├─ [FrontendDev] Writing src/components/Navbar.tsx...
      ├─ [BackendDev] Creating src/api/cart.ts...
      └─ [TestEngineer] Drafting tests/cart.test.ts...

        Estimated: 45 seconds


**Step 3: Parent Verification Upon all agents completing:**

LeadDev (Parent): Reviewing 3 submissions...

├─ FrontendDev:  Approved (Navbar matches requirements)
├─ BackendDev:   Needs fix (Missing auth middleware)
└─ TestEngineer: Approved (Coverage: 85%)

[BackendDev] Retry with auth fix? (Y/n): Y


**Step 4: Merge**

User: /agents merge

LeadDev: Consolidating outputs...
├─ Merging Frontend + Backend (API contract check)
├─ Validating Tests against implementation
└─ Final output: 3 files written, 12 tests added

Snapshot created: pre-merge-2024-01-15-143022
Team tasks integrated into main codebase

**12.4 Conflict Resolution**

When agents modify the same file:

 CONFLICT DETECTED: src/types/Cart.ts
├─ FrontendDev modified: CartItem interface (added imageUrl)
└─ BackendDev modified: CartItem interface (added weight)

LeadDev Resolution Options:
1. Accept FrontendDev version
2. Accept BackendDev version  
3. Merge both (Parent AI generates unified interface)
4. Escalate to user

Choice [1-4]: 3

LeadDev: Merged interface created:
         interface CartItem {
           id: string;
           imageUrl: string;  // from FrontendDev
           weight: number;    // from BackendDev
         }


**12.5 Storage Structure**

~/.pakalon/
├── teams/
│   └── {team-name}.json
│       {
│         "parent_agent": "LeadDev",
│         "members": [
│           {
│             "name": "FrontendDev",
│             "role": "React Specialist",
│             "tools": ["file_write", "edit_file", "mcp-21st"],
│             "constraints": {"paths": ["frontend/"], "readonly": false},
│             "context_budget": 50000
│           }
│         ],
│         "parallel_limit": 3,
│         "auto_merge": false
│       }
└── team-sessions/
    └── {session-id}/
        ├── agent-01-output.md
        ├── agent-02-output.md
        └── parent-verification.md

---


### **13. ENHANCED PHASE 1 DOCUMENTATION STRUCTURE**

Phase 1 generates heavily structured markdown files with mandatory sections. The plan.md serves as the master document integrating all sub-documents.

**13.1 plan.md Required Sections**

# PROJECT PLAN: [Project Name]

## 1. PRODUCT REQUIREMENTS DOCUMENT (PRD)

### 1.1 Problem Statement
[Detailed description of user pain points]

### 1.2 Solution Overview
[High-level product description]

### 1.3 Target Users
- Primary: [User persona]
- Secondary: [User persona]

### 1.4 Success Metrics
- KPI 1: [Measurable metric]
- KPI 2: [Measurable metric]

### 1.5 Non-Goals
[Explicitly out of scope features]

---

## 2. HIGH-LEVEL ARCHITECTURE

### 2.1 System Diagram
[Mermaid diagram or ASCII architecture]

### 2.2 Component Overview
| Component | Technology | Responsibility |
|-----------|-----------|----------------|
| Frontend | [Stack] | [Responsibility] |
| Backend | [Stack] | [Responsibility] |
| Database | [Stack] | [Responsibility] |

### 2.3 Data Flow
1. [Step 1 description]
2. [Step 2 description]

---

## 3. ARCHITECTURE DECISIONS (ADRs)

### ADR-001: [Decision Title]
- **Context**: [Why needed]
- **Decision**: [What chosen]
- **Consequences**: [Trade-offs]
- **Status**: [Provisional/Accepted/Deprecated]

### ADR-002: [Next Decision]
...

---

## 4. WORKFLOW SPECIFICATIONS

### 4.1 User Workflows
[Flow diagrams for critical paths]

### 4.2 System Workflows
[Background processes, cron jobs, etc.]

### 4.3 State Machines
[Complex state transitions]

---

## 5. FEATURE SPECIFICATIONS

### 5.1 Core Features
| ID | Feature | Priority | Complexity | Owner |
|----|---------|----------|------------|-------|
| F-001 | [Name] | P0 | High | TBD |
| F-002 | [Name] | P1 | Medium | TBD |

### 5.2 Feature Details (per feature)
#### F-001: [Feature Name]
- **Description**: [Detailed explanation]
- **Acceptance Criteria**: [List]
- **Dependencies**: [Other features/systems]
- **Open Questions**: [TBD items]

---

## 6. INTEGRATION POINTS
- Third-party APIs
- MCP Servers required
- External services

---

## 7. RISK ANALYSIS
| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk] | High | [Strategy] |

---

## 8. TIMELINE & MILESTONES
- Phase 2: [Date/Trigger]
- Phase 3: [Date/Trigger]
- ...


**13.2 user-stories.md Hierarchical Structure**

Scaling Rule:

Small projects (1-2 pages): 3-8 user stories (US-001 to US-008)
Medium projects (3-5 features): 9-15 user stories
Large projects (complex platforms): 16-25+ user stories (up to US-025, US-050 if enterprise)
Template per User Story:

### US-001: [Title]
**As a** [role], **I want** [goal], **so that** [benefit].

#### Priority: [P0/P1/P2]
#### Feature: [Links to F-XXX in plan.md]
#### Estimation: [Story Points]

#### Acceptance Criteria (Gherkin format)
```gherkin
Given [context]
When [action]
Then [expected result]
And [additional verification]
```

Test Scenarios
Scenario ID Type  Description Pre-conditions Steps Expected Result
TS-001-01   Positive Happy path  [Setup]  1. [Step]
2. [Step]   [Outcome]
TS-001-02   Negative Invalid input  [Setup]  1. [Step]
2. [Step]   [Error handling]
TS-001-03   Edge  Boundary case  [Setup]  1. [Step]   [Behavior]
Technical Notes
[Implementation hints]
[Database schema needs]
[API endpoints required]
Dependencies
Blocks: [US-XXX]
Blocked by: [US-YYY]
Related: [US-ZZZ]

**Example Scaling:**
Small E-commerce (Single digit): ├── US-001: User Registration ├── US-002: User Login
├── US-003: Add to Cart └── US-004: Checkout

Enterprise SaaS (20+ stories): ├── US-001: SSO Login (SAML) ├── US-002: MFA Setup ├── ... ├── US-020: Advanced Analytics Export └── US-021: Webhook Configuration



#### **13.3 Generation Rules**

**Auto-Scaling Logic:**
1. **Analyze prompt complexity**: Keyword detection ("simple", "MVP", "prototype" = small; "platform", "enterprise", "scalable" = large)
2. **Count implied entities**: 
   - Entities ≤ 3 → 3-5 stories
   - Entities 4-7 → 8-12 stories  
   - Entities 8+ → 15-25 stories
3. **Deep questioning in Phase 1**:
   - If user says "e-commerce": Ask "Do you need inventory management?" (adds US-00X), "Do you need multi-vendor support?" (adds US-00Y)
   - Continue until user types "complete" or clicks "Generate Plan"

**Detail Enforcement:**
- Every US-XXX must have ≥3 test scenarios (TS-XXX-01, TS-XXX-02, TS-XXX-03)
- Every US-XXX must link to specific Feature ID (F-XXX) in plan.md
- Acceptance criteria must use Gherkin syntax (Given/When/Then)

---

### **14. HOOKS SYSTEM (BOTH MODES)**

Pakalon supports a **CLI hooks system** allowing external scripts to intercept and modify execution flow. Hooks execute as subprocesses before/after key events.

#### **14.1 Hook Architecture**

Event Triggered │ ▼ ┌─────────────┐ │ Hook Found?│──No──> Continue normal execution └──────┬──────┘ │Yes ▼ ┌─────────────┐ ┌──────────────┐ │ Execute │────>│ Exit Code 0 │──> Parse JSON stdout ──> Continue with modified context │ Hook Script │ ├──────────────┤ │ (subprocess)│ │ Exit Code 2 │──> Parse stderr ──> Block operation, show error └─────────────┘ ├──────────────┤ │ Other codes │──> Log warning (verbose mode only), continue └──────────────┘



#### **14.2 Exit Code Behavior**

| Exit Code | Behavior | Stdout | Stderr | Visibility |
|-----------|----------|--------|--------|------------|
| **0** | Success - Continue | **Parsed as JSON** (optional fields) | Ignored | Only in verbose (Ctrl+O) unless specified below |
| **2** | Blocking Error - Halt | Ignored | **Fed to AI as error message** | User sees error immediately |
| **1, 3-255** | Non-blocking Warning | Ignored | Logged | Only in verbose mode (Ctrl+O) |

**Special Cases (Exit 0 with Context):**
- `UserPromptSubmit` (Exit 0): Stdout added to conversation context (AI sees it)
- `SessionStart` (Exit 0): Stdout added to system context (available to all agents)
- Other events (Exit 0): Stdout only visible in verbose mode

#### **14.3 Hook Events**

| Event | Timing | Modifiable? | Use Case |
|-------|--------|-------------|----------|
| `SessionStart` | CLI initializes | Yes | Load custom env vars, set project defaults |
| `UserPromptSubmit` | After user types, before AI processes | Yes | Prompt validation, injection of context |
| `PreToolUse` | Before any tool executes (file write, bash, etc.) | Yes | Security scanning, approval workflows |
| `PostToolUse` | After tool execution completes | Yes | Logging, metrics, auto-backup triggers |
| `PhaseTransition` | Moving between phases 1→2, 2→3, etc. | Yes | Custom validation, notification triggers |
| `SubAgentStart` | Before sub-agent execution | Yes | Context injection, resource limits |
| `SubAgentComplete` | After sub-agent outputs | Yes | Output validation, auto-fix triggers |
| `SnapshotCreate` | Before undo snapshot saved | Yes | Custom backup locations, encryption |
| `MergeConflict` | Agent Teams conflict detected | Yes | Auto-resolution rules |
| `CreditDeduction` | Before deducting user credit | Yes | Custom quota checks, alerts |

#### **14.4 Hook Configuration**

**Global Hooks** (apply to all projects):

~/.pakalon/hooks/ ├── session-start.sh ├── user-prompt-submit.py ├── pre-tool-use.js └── hooks.json [registry]


**Project Hooks** (override global):
~/pakalon-projects/{project}/.pakalon/hooks/ ├── pre-tool-use.sh [overrides global] └── phase-transition.py


**hooks.json Schema:**
```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "command": "./security-scan.sh",
      "timeout_ms": 5000,
      "blocking": true,
      "on_error": "block"
    },
    {
      "event": "UserPromptSubmit", 
      "command": "python3 ~/.pakalon/hooks/enhance-prompt.py",
      "timeout_ms": 2000,
      "blocking": false,
      "on_error": "warn"
    }
  ]
}
14.5 JSON Output Format (Exit 0)
Hooks can return modifications via stdout JSON:

{
  "modified_prompt": "[Injected context] Original user prompt",
  "context_additions": [
    {"role": "system", "content": "Additional instruction"},
    {"role": "user", "content": "Pre-loaded context"}
  ],
  "tool_overrides": {
    "command": "modified_command",
    "timeout": 30000
  },
  "block_message": null,
  "metadata": {
    "hook_version": "1.0",
    "processing_time_ms": 145
  }
}
Field Effects:

modified_prompt: Replaces user's input (UserPromptSubmit only)
context_additions: Prepended to AI context window
tool_overrides: Modifies tool execution parameters
block_message: If set (Exit 2), shown to user as error
14.6 Example Implementations
Security Hook (PreToolUse):

#!/bin/bash
# Exit 2 if command contains dangerous patterns
if [[ "$1" =~ (rm -rf /|mkfs.|>:) ]]; then
  echo "Dangerous command blocked: $1" >&2
  exit 2
fi
echo '{"metadata": {"scanned": true}}'
exit 0
Prompt Enhancement (UserPromptSubmit):

#!/usr/bin/env python3
import json
import sys

user_input = sys.stdin.read()
enhanced = f"[Project: Ecommerce] {user_input}"

output = {
    "modified_prompt": enhanced,
    "context_additions": [
        {"role": "system", "content": "Current tech stack: React + Node.js"}
    ]
}
print(json.dumps(output))
sys.exit(0)
Phase Gate (PhaseTransition):

#!/bin/bash
# Block transition if tests failing
if [ -f "test-results.json" ]; then
  if grep -q '"failed": [1-9]' test-results.json; then
    echo "Cannot enter Phase 4: Tests failing" >&2
    exit 2
  fi
fi
exit 0
```
