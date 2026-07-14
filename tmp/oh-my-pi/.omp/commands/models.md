# `/models` — OpenRouter model picker

Open the tier-aware model picker. Free users see only `:free` models;
pro users see all 550+ OpenRouter models, sorted newest-first.

## Arguments

- `$ARGUMENTS` — optional. A direct model id (e.g.
  `anthropic/claude-sonnet-4.6`) to switch to without showing the
  picker.

## Steps

1. Fetch the catalog from `GET /v1/models` on the Pakalon backend
   (cached 24h locally; refreshed by the nightly cron).
2. Filter by user tier (from `~/.pakalon/auth.json`).
3. Render a two-tab picker: "Free" / "Pro".
4. On select, update the active model and write the choice to
   `~/.pakalon/storage.json`.
5. Default model is `auto` — `resolveAutoModel` picks
   highest-context-lowest-cost.

## Rules

- Default selection is `auto` for new sessions.
- Free users cannot select a pro model; the picker is read-only.
- `Ctrl+P` cycles through previously-used models for the current role.
