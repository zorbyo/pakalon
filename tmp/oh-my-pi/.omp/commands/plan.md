# `/plan` — Create a planning doc for the next prompt

For normal mode: when a user types a prompt that needs a non-trivial
plan first, the agent analyzes the prompt and emits `output.md` in
the project root. The user can then edit the plan and run `/build`
to execute it.

## Arguments

- `$ARGUMENTS` — optional. A free-form prompt; if absent, the most
  recent user message is used.

## Steps

1. Read the prompt + any `@-mentions` in scope.
2. Run the planner LLM (in Hindsight/Mem0 context).
3. Write `output.md` with: overview, architecture, tasks, acceptance
   criteria.
4. The user edits the plan in their editor if needed.
5. `/build` consumes the most recent `output.md` and starts a
   phase-3-style build (subagents 1-4 only, no auditor, no
   phase 4).

## Rules

- In plan mode (default for normal mode), only read tools are
  available; this is the standard plan flow.
