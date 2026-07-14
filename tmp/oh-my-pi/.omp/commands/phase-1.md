# `/phase-1` … `/phase-6` — Direct phase entry

Jump directly to a specific phase. Only valid when `.pakalon-agents/`
is initialized.

## Arguments

- `$ARGUMENTS` — optional. Anything passed becomes the prompt for
  the phase.

## Steps

1. Check `.pakalon-agents/state.json` exists. If not, error out:
   "Run /pakalon first."
2. Validate the current phase is at most the requested phase (jumping
   forward is allowed; backward requires `--force`).
3. Mark prior phases as completed if jumping forward.
4. Run the phase using the existing prompts in
   `packages/pakalon-graph/prompts/phase-N/`.

## Rules

- The phase argument is positional: `/phase-3` jumps to phase 3.
- No chat input after the command is allowed; the command runs
  synchronously.
