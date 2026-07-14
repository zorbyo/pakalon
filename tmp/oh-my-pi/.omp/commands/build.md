# `/build` — Execute the most recent `output.md`

In normal mode, after `/plan` writes `output.md`, run `/build` to
execute the plan with a phase-3-style 5-subagent pipeline (no
auditor loop, no phase 4).

## Arguments

- `$ARGUMENTS` — optional. A path to a different `output.md` to
  execute.

## Steps

1. Locate the most recent `output.md` (or use the supplied path).
2. Spawn 4 subagents sequentially:
   - **SA1 Frontend** — read `output.md`, build the UI.
   - **SA2 Backend** — read SA1, build APIs + DB.
   - **SA3 Integration** — wire SA1 ↔ SA2.
   - **SA4 Debug & Test** — run, fix, test.
3. Skip the auditor and phase 4. The output is the live code, not
   a markdown report.

## Rules

- If `output.md` is missing, error: "Run /plan first."
- Subagents run in the same session, not isolated worktrees.
