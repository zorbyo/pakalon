# `/session` — List / switch sessions

List the sessions for the current project directory and let the user
pick one to resume.

## Arguments

- `$ARGUMENTS` — optional. A `session_id` to switch directly.

## Steps

1. List sessions for the current `projectDir` from
   `~/.local/share/pakalon/sessions/<project-hash>/`.
2. Each row: session id, started-at, last activity, token count.
3. On selection, set as the active session and resume its transcript.
4. `/resume` is the same as `/session` with no arg; `/resume <id>` is
   the same as `/session <id>`.

## Rules

- Sessions are scoped per project directory.
- Cross-project session access requires `--global`.
