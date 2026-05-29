# Implementation Plan: Closing Feature Gaps in pakalon-cli

> **Goal:** Raise pakalon-cli compliance from ~61% to ~95% by implementing all missing/partial features identified in comparison.md.
> **Constraint:** Pure TypeScript/Node.js — no Python, LangChain, or LangGraph.

---

## Phase A: Quick Wins (Slash Commands, Error Handling, LSP Wiring)

### A1: Fix /ans slash command
- **File:** `src/commands/slash-registry.ts` — register `/ans` command
- **File:** `src/commands/ans.ts` — create handler that spawns lightweight sub-agent
- **Effort:** Small

### A2: Claude Code exit code parsing
- **File:** `src/ai/exit-code-parser.ts` — new module
- **File:** `src/query/QueryEngine.ts` — integrate exit code handling
- **Effort:** Small

### A3: Typed error hierarchy
- **File:** `src/ai/errors.ts` — ProviderError, AuthenticationError, RateLimitError, etc.
- **File:** `src/query/QueryEngine.ts` — use typed errors
- **Effort:** Medium

### A4: LSP integration into phase sub-agents
- **File:** `src/pipeline/session.ts` — wire LSP tools into Phase 3 sub-agent execution
- **Effort:** Medium

### A5: Daily auto-refresh for dynamic model fetching
- **File:** `src/ai/model-refresh.ts` — scheduled model refresh with newest-first ordering
- **Effort:** Small

---

## Phase B: Phase 1 Enhancements (Interactive Q&A, Firecrawl, Context Management)

### B1: Interactive multiple-choice Q&A UI for Phase 1 HIL
- **File:** `src/components/InteractivePrompt.tsx` — new Ink component for multiple-choice
- **File:** `src/pipeline/session.ts` — enhance Phase 1 with interactive Q&A flow
- **File:** `src/components/ChatScreen.tsx` — integrate interactive prompts
- **Effort:** Large

### B2: Firecrawl web scraping integration for Phase 1
- **File:** `src/ai/firecrawl-research.ts` — Firecrawl MCP client for tech research
- **File:** `src/pipeline/session.ts` — wire into Phase 1 planning
- **Effort:** Medium

### B3: context_management.md per-phase token allocation with interactive %
- **File:** `src/pipeline/session.ts` — enhance Phase 1 context_management.md generation
- **File:** `src/components/InteractivePrompt.tsx` — add token allocation prompt
- **Effort:** Medium

### B4: Compaction for context management
- **File:** `src/ai/compaction.ts` — context summarization module
- **File:** `src/query/QueryEngine.ts` — integrate compaction trigger
- **Effort:** Large

---

## Phase C: Memory & Context (mem0 alternative)

### C1: mem0-compatible memory integration
- **File:** `src/memory/mem0-client.ts` — mem0 API client (TypeScript SDK or REST)
- **File:** `src/pipeline/session.ts` — wire inter-phase memory
- **File:** `src/ai/agent-runtime.ts` — inject memory context into agent prompts
- **Effort:** Large

---

## Phase D: Phase 2 Enhancements (Penpot Sync, TDD, Figma)

### D1: sync.js real-time cooldown-based Penpot file watcher
- **File:** `src/ai/penpot-sync.ts` — replace stub with real file watcher using chokidar
- **File:** `src/commands/penpot.ts` — enhance sync start/stop
- **Effort:** Large

### D2: TDD with automated screenshot comparison
- **File:** `src/ai/tdd-screenshot.ts` — Playwright-based screenshot + comparison
- **File:** `src/pipeline/session.ts` — wire into Phase 2 wireframe verification
- **Effort:** Large

### D3: "Accept this design" button UI for Phase 2
- **File:** `src/components/DesignApproval.tsx` — new Ink component
- **File:** `src/pipeline/session.ts` — integrate approval gate
- **Effort:** Medium

### D4: Figma import workflow for Phase 2
- **File:** `src/ai/figma-import.ts` — Figma MCP client for design import
- **File:** `src/pipeline/session.ts` — wire into Phase 2
- **Effort:** Medium

---

## Phase E: Phase 3 Enhancements (Graph Orchestration, Sub-Agents, RAG)

### E1: Graph-based sub-agent orchestration
- **File:** `src/ai/graph-orchestrator.ts` — state machine graph for Phase 3 sub-agents
- **File:** `src/pipeline/session.ts` — replace linear pipeline with graph execution
- **Effort:** XLarge

### E2: Autonomous sub-agent execution
- **File:** `src/ai/subagent-executor.ts` — execute sub-agent briefs autonomously
- **File:** `src/pipeline/session.ts` — wire into Phase 3
- **Effort:** XLarge

### E3: Registry-based RAG with registry.json
- **File:** `src/ai/component-registry.ts` — registry.json management + RAG search
- **File:** `src/pipeline/session.ts` — wire into Phase 3 frontend sub-agent
- **Effort:** Large

### E4: Curated website scraping pipeline
- **File:** `src/ai/component-scraper.ts` — scrape 12+ curated URLs for components
- **File:** `src/ai/component-registry.ts` — populate registry from scraped data
- **Effort:** Large

---

## Phase F: Phase 4 Enhancements (Security Tools, Sub-Agents, Feedback Loop)

### F1: Full SAST tool suite
- **File:** `docker-compose.security.yml` — add SonarQube, FindSecBugs, Brakeman, ESLint security
- **File:** `src/agents/phase4/sast-runner.ts` — SAST orchestrator
- **Effort:** Large

### F2: Full DAST tool suite
- **File:** `docker-compose.security.yml` — add sqlmap, Wapiti, XSStrike
- **File:** `src/agents/phase4/dast-runner.ts` — DAST orchestrator
- **Effort:** Large

### F3: Hoppscotch API testing
- **File:** `src/agents/phase4/hoppscotch-tester.ts` — API testing via Hoppscotch
- **Effort:** Medium

### F4: Chrome DevTools MCP integration
- **File:** `src/agents/phase4/chrome-devtools.ts` — Chrome DevTools MCP client
- **Effort:** Medium

### F5: Five separate Phase 4 sub-agents
- **File:** `src/agents/phase4/subagent-sast.ts`
- **File:** `src/agents/phase4/subagent-dast.ts`
- **File:** `src/agents/phase4/subagent-code-review.ts`
- **File:** `src/agents/phase4/subagent-cicd.ts`
- **File:** `src/agents/phase4/subagent-cybersec.ts`
- **Effort:** XLarge

### F6: Phase 3→4 automated feedback loop
- **File:** `src/pipeline/session.ts` — implement feedback loop logic
- **Effort:** Large

---

## Phase G: Phase 5 & 6 Enhancements

### G1: Cloud deployment integration
- **File:** `src/agents/phase5/cloud-deploy.ts` — AWS/DO/Azure deployment
- **Effort:** Large

### G2: doc.md generation for Phase 6
- **File:** `src/agents/phase6/doc-generator.ts` — end-user documentation generator
- **Effort:** Medium

---

## Phase H: Auditor Agent

### H1: Autonomous auditor agent
- **File:** `src/agents/auditor/index.ts` — read-only codebase auditor
- **File:** `src/agents/auditor/loop.ts` — iterative audit loop (max 10 iterations)
- **Effort:** Large

---

## Phase I: Agent Browser

### I1: Vercel Agent Browser integration
- **File:** `src/ai/agent-browser.ts` — browser automation for design/TDD
- **File:** `src/pipeline/session.ts` — wire into Phases 1-4
- **Effort:** Large

---

## Execution Order

1. **A1, A2, A3, A5** — Quick wins (can be done in parallel)
2. **B1, B2, B3** — Phase 1 enhancements
3. **C1** — Memory integration
4. **D1, D2, D3, D4** — Phase 2 enhancements
5. **E1, E2, E3, E4** — Phase 3 enhancements
6. **F1, F2, F3, F4, F5, F6** — Phase 4 enhancements
7. **G1, G2** — Phase 5/6 enhancements
8. **H1** — Auditor agent
9. **I1** — Agent browser
10. **A4, B4** — LSP wiring + compaction
