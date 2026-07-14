# `/update` — Scoped single-purpose edit

Make one targeted edit to one file, without touching anything else.
The LLM is forbidden from emitting any other file diffs in the same
turn.

## Arguments

- `$ARGUMENTS` — required. The directive, e.g.
  `the navbar must be rounded in shape`.

## Steps

1. Parse `@-mentions` from the directive; if present, the
   `narrowFileSet` is the resolved mention paths.
2. If no mentions, infer the touched file from the directive (the
   LLM may pick a single file; if more than one is implicated, the
   user is asked to disambiguate).
3. Run a single LLM call with system prompt: "Emit edits only to
   the file(s) in narrowFileSet. Any other file diff is forbidden."
4. Apply the diff via the `edit` tool.
5. Any other `edit`/`write` call outside `narrowFileSet` is
   rejected at runtime by the tool-level filter.

## Rules

- One directive → one or more edits in one file.
- Multiple files require a separate `/update` call each.
