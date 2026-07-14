# `/agents` — Create / run a parallel agent team

Create a team of up to 8 agents that can run in parallel. Each agent
has its own system prompt, color, and tool allow-list.

## Arguments

- `$ARGUMENTS` — optional. A team name to edit/create; otherwise the
  TUI modal opens in "create" mode.

## Steps

1. Open the TUI modal: name the team, add 1-8 members.
2. For each member: name, system prompt (multi-line), color, tool
   allow-list.
3. Save the team to `.pakalon/agents/<team>.json` + push the system
   prompts to Mem0.
4. On invocation `@<agent-name>`, spawn a `task` subagent with the
   spec's tools + system prompt; the parent agent is the dispatcher.
5. Members run in parallel and report back; the dispatcher merges
   results into one user-facing message.

## File format

```json
{
  "name": "research-team",
  "members": [
    {
      "id": "x",
      "name": "Codebase auditor",
      "systemPrompt": "You audit the codebase for missing features...",
      "color": "#3B82F6",
      "tools": ["read", "search", "find"]
    }
  ]
}
```
