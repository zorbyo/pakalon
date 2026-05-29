---
name: terse-commit
description: Generate terse Conventional Commits messages with ≤50 char subjects
origin: Pakalon
---

# Terse-Commit: Terse Conventional Commits

Generates ultra-compact commit messages following Conventional Commits specification with maximum terseness.

## When to Activate

- User says "/terse-commit" or "/commit"
- User says "generate commit message"
- User says "write a commit" or "draft a commit"
- User asks to commit changes

## Format

```
<type>(<scope>): <imperative summary>
```

**Subject line ≤50 characters preferred, 72 hard cap.**
**No trailing period.**
**Body only when "why" isn't obvious.**

## Commit Types

| Type | Use for |
|------|---------|
| feat | New feature |
| fix | Bug fix |
| refactor | Code change that neither fixes bug nor adds feature |
| perf | Performance improvement |
| docs | Documentation only |
| test | Adding or updating tests |
| chore | Maintenance tasks (deps, config, build) |
| build | Build system or CI changes |
| ci | CI configuration changes |
| style | Formatting, no code logic change |
| revert | Reverting a previous commit |

## Rules

### ALWAYS:
- Use imperative mood: "add" not "added", "fix" not "fixes"
- Keep subject line concise
- Include scope when change is file/component-specific
- Use lowercase after colon

### NEVER:
- "This commit does X"
- First person: "I", "we"
- "now", "currently" (redundant)
- "As requested by..." — use Co-authored-by trailer instead
- AI attribution ("Generated with...", "Created by...")
- Emoji unless project convention requires
- Restating scope in subject when scope already identified

## Examples

### GOOD:
```
feat(api): add GET /users/:id/profile
fix(auth): remove null check blocking login
refactor(db): extract query builder
perf(sql): add index on user_id
docs(readme): update installation steps
```

### BAD:
```
feat: add a new endpoint to get user profile information from the database
fixed the bug where users couldn't login
I added a new feature
As requested by John, I updated the code
:rocket: Add new feature!
```

## Auto-Clarity Rules

Include body for:
- Breaking changes → add "BREAKING CHANGE:" in body
- Security fixes
- Data migrations
- Reverts → include full revert context
- Anything not obvious from diff

Omit body when:
- Change is self-explanatory from subject
- Only one or two files affected
- Type/scope already explains everything

## Terse Variations

For extreme terseness (ultra mode):
```
feat(api): GET /users/:id
fix(auth): null check
refactor(db): query builder
```

## Output

Generate a commit message ready to use. If multiple valid approaches exist, pick the most conventional one. If user requests revision, offer 2-3 alternatives.