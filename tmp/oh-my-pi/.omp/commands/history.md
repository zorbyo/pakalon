# `/history` — File change history

Show the per-project history of file changes and prompts. Scoped to
the current project directory.

## Arguments

- `$ARGUMENTS` — optional. `--all` to show across all projects,
  `--json` for machine-readable output, `--limit N` to cap the
  number of rows (default 50).

## Steps

1. Resolve the project directory (current cwd by default).
2. Read `~/.pakalon/storage.json` to get `machineId`; read
   `~/.pakalon/events-<YYYY-MM-DD>.jsonl` for today's events.
3. For each event, format a row: timestamp, type, summary, token
   delta.
4. Show context-window used in each session when `--usage` is passed.
5. Indicate which changes were `accept` vs `reject` (from the
   permission cards).

## Output

A table with columns: Time | Action | Status | Tokens | Notes.
