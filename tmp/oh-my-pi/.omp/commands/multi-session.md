# `/multi-session` — Open the multi-session dashboard

Open the dashboard that lists all live sessions in a TUI grid. Each
card shows the session id, project, model, and a blinking working
indicator.

## Arguments

- `$ARGUMENTS` — none.

## Steps

1. Build the dashboard cards from `listSessions()`.
2. Render the grid (TUI).
3. `+` creates a new session (`/new`).
4. `Enter` on a card swaps the active session.
5. `Ctrl+M` (or running `/multi-session` again) returns to the
   dashboard from an active session.
