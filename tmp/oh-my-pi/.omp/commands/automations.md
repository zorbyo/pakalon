# `/automations` — Cron + webhook workflows

Create or manage scheduled automations. Each automation is a
natural-language prompt that runs on a cron schedule, materialized
into a tool-calling session by the main agent.

## Arguments

- `$ARGUMENTS` — optional. `list` | `create <name>` | `delete <id>`.

## Steps

1. List existing automations from `.pakalon/automations/*.json`
   (managed by `pakalon/automations/cron.ts: listAutomations`).
2. Templates gallery (built-in: "PR-issue check", "Daily standup
   summary", "Weekly cost report") — each is a stub that the user
   edits into a real automation.
3. Create flow: name → natural-language prompt → connected
   accounts (Slack, GitHub, …) → cron expression.
4. The CLI's background tick (`pakalon/automations/cron.ts:
   tickAutomations`) runs every minute from the TUI's background
   hook, evaluates the cron field, and dispatches matching
   automations to a fresh sub-agent that executes the prompt.
5. Each automation result is logged to
   `.pakalon/automations/<id>.last.log` for auditing.

## File format

```json
{
  "id": "pr-issue-check",
  "name": "PR issue check",
  "description": "Daily check for open PRs older than 3 days",
  "prompt": "Check for open PRs older than 3 days in <repo> and post a summary to #dev",
  "integrations": ["github:<repo>", "slack:#dev"],
  "cron": "0 9 * * 1-5",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

Storage: `<project>/.pakalon/automations/<id>.json`.
