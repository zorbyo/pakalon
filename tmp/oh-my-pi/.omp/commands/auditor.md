# `/auditor` — Run the auditor agent

Read-only scan of the codebase against the user requirements in
phase-1, with prioritized missing/partial features. Part of the
phase 3 loop.

## Arguments

- `$ARGUMENTS` — optional. `--iter N` to set max iterations (default
  from project state). `--yolo` for autonomous loop.

## Steps

1. Read `.pakalon-agents/ai-agents/phase-1/*.md` (14 planning files).
2. Read the codebase (`read`, `search`, `find` only — no writes).
3. Diff requirements vs. implementation, producing a table of
   `COMPLETE | PARTIAL | MISSING` per requirement.
4. Write `.pakalon-agents/ai-agents/phase-3/auditor.md`.
5. **HIL:** ask user "implement all / do nothing / core features".
6. **YOLO:** auto-loop up to 10 times, dispatching remediators each
   iteration.
7. Stop when no MISSING/PARTIAL rows remain.
