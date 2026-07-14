# `/ans` — Side-channel Q&A

Ask a question without interrupting the active session. A fresh
subagent is spawned with the parent's transcript attached as
read-only context; the foreground session keeps working.

## Arguments

- `$ARGUMENTS` — required. The question to ask.

## Steps

1. Snapshot the current session's transcript.
2. Spawn a `Session.deriveChild({readonly: true, tools:
   ['read','search','find','recall']})` with the snapshot as context.
3. The child answers the question in a separate TUI panel.
4. On dismiss, the child session is discarded (no transcript
   written back).

## Use case

While phase 3 is building the frontend, the user can type
`/ans what is the tech stack that is used here?` and get an
immediate answer without the build stopping.
