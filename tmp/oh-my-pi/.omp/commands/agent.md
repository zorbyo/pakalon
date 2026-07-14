# `/agent` — Ad-hoc single-agent creation

Create a one-off agent inline (without persisting to a team file)
for a single task.

## Arguments

- `$ARGUMENTS` — required. The system prompt for the agent.

## Steps

1. Open a TUI prompt for the agent name (default: random adjective
   + animal).
2. Use the supplied `$ARGUMENTS` as the system prompt.
3. Spawn the agent immediately; the user gives the first task in
   the next prompt.
4. On session end, the agent is discarded (no `.pakalon/agents/`
   file written).
