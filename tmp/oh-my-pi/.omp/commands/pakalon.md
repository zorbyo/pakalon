# `/pakalon` — Initialize the 6-phase build pipeline

Initialize `.pakalon-agents/` in the current directory and start the
6-phase autonomous build pipeline (Planning → Wireframes → Development
→ Testing → Deployment → Documentation).

## Arguments

- `$ARGUMENTS` — optional. A natural-language description of what to
  build, e.g. `Build a SaaS dashboard with Next.js and PostgreSQL`.
- Flags can be supplied before the prompt:
  - `--hil`, `--human` — human-in-loop mode (default: yolo).
  - `--yolo` — fully autonomous, no user prompts.
  - `--phase N`, `-p N` — jump directly to phase N (1-6).
  - `--iterations N`, `-i N` — max auditor iterations (default 10).
  - `--status`, `-s` — show pipeline status.
  - `--reset` — clear pipeline state.
  - `--help`, `-h` — show full help.

## Steps

1. **Detect existing project.** If `package.json`, `pyproject.toml`,
   `Cargo.toml`, `go.mod`, `pom.xml`, etc. exists, run a quick LLM
   pre-scan and pre-fill `plan.md` and `user-stories.md` to the
   current state.
2. **Tech-stack elicitation** (HIL only). For each layer (frontend,
   backend, DB, auth, payments, hosting) present 4-5 options via the
   `ask` tool, with a final "End phase 1" option that proceeds to
   phase 2 immediately.
3. **Brainstorming / Q&A.** Minimum 10 follow-up questions in
   plain-prompt mode; 4-5 in detailed-prompt mode. Answers stored in
   Mem0 (`mem0.retain`).
4. **Web research** (optional, when enabled). Run `web_scrape` over
   the 12 reference sites (lightswind, reactbits, daisyui, …) plus
   a Firecrawl search; digest into `competitive-analysis.md`.
5. **Vercel Agent Skills matching.** Clone
   `vercel-labs/agent-skills` and `nextlevelbuilder/ui-ux-pro-max-skill`
   into `.pakalon-agents/mcp-servers/cache/agent-skills/`, match by
   description, copy selected skills into `agent-skills.md`.
6. **Document generation.** For each of the 14 phase-1 markdown files,
   the LLM is given a static system prompt from
   `packages/pakalon-graph/prompts/phase-1/<file>.md` and writes the
   file via the `write` tool.
7. **Sub-task generation.** `tasks.md` is split into the smallest
   units one subagent in phase 3 can complete in ≤ one context
   window. Each task gets a token budget; 10% phase buffer.
8. **Context handoff doc.** `context_management.md` enumerates
   per-phase + per-subagent token caps.
9. **Approval** (HIL only). Show a summary card with
   "Approve and run phase 2".

## Outputs

- `.pakalon-agents/state.json` — orchestrator state.
- `.pakalon-agents/ai-agents/phase-1/*.md` — 14 planning files.
- `.pakalon-agents/ai-agents/sync.js` — Penpot sync watcher.

## Rules

- HIL mode never invokes a phase without the user's `Enter`.
- YOLO mode auto-approves all phases; max 10 auditor iterations.
- Each phase document is committed via `git` so `/undo` works.
- All outputs land in the spec-defined folder layout (CLI-req.md
  lines 458-505).
