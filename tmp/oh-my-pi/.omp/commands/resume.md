# `/resume` — Resume a previous session

Re-open a past session and continue from where it left off.

## Arguments

- `$ARGUMENTS` — optional. The session id; if omitted, the most
  recent session for the current `projectDir` is resumed.

## Steps

1. Resolve the session id (arg or last-recent for this project).
2. Load the transcript from
   `~/.local/share/pakalon/sessions/<project-hash>/<session-id>.jsonl`.
3. Set the active session and re-emit the transcript to the TUI.
4. Subsequent prompts append to this session.

## Rules

- Sessions are scoped per project directory. Cross-project use
  requires `--global`.
- `/resume` is an alias for `/session` (when no arg) and
  `/session <id>` (with arg).
