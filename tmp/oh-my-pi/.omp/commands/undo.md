# `/undo` — Revert recent code or conversation changes

Undo the most recent change(s). A follow-up `ask` card offers four
choices: undo conversation, undo code, undo both, do nothing.

## Arguments

- `$ARGUMENTS` — optional. `--code` to skip the prompt and revert
  code only. `--conversation` for conversation only.

## Steps

1. Read the most recent `git log` entry in the project worktree.
2. Read the most recent 1-2 user/assistant turns from the session
   transcript.
3. Show the `ask` card with the four choices.
4. On selection:
   - **undo conversation** — pop the last 1-2 turns from the
     transcript, no git change.
   - **undo code** — `git revert HEAD` (soft) and reset the working
     tree to the prior commit.
   - **undo both** — both of the above.
   - **do nothing** — no change, no tokens consumed.

## Rules

- "Do nothing" is the no-op that uses zero tokens; it must be
  selectable on every prompt.
- The undo is always the most recent change; older history is in
  `/history`.
