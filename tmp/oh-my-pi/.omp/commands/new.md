# `/new` — Create a new session

Start a new session with a fresh transcript, isolated to a new
`pi-iso` worktree.

## Arguments

- `$ARGUMENTS` — none. The new session is empty; the user types the
  first prompt after.

## Steps

1. Allocate a new session id (UUIDv7).
2. Create a worktree at `~/.omp/wt/<project-hash>/<session-id>/`.
3. Persist the session in
   `~/.local/share/pakalon/sessions/<project-hash>/<session-id>.jsonl`.
4. Set the new session as the active one.
5. The previous session is closed (transcript preserved).

## Rules

- Each session has its own chat history but shares gitignored
  scratch state.
- The `+` button in the multi-session dashboard is equivalent to
  `/new`.
