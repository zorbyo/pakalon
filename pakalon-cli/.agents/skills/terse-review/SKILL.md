---
name: terse-review
description: Generate one-line code review comments with severity prefixes
origin: Pakalon
---

# Terse-Review: One-Line Code Review Comments

Generates ultra-compact, PR-ready code review comments with severity prefixes.

## When to Activate

- User says "/terse-review"
- User says "review this code"
- User says "review PR" or "review changes"
- User asks for code review feedback

## Format

```
L<line>: <severity> <problem>. <fix>.
<file>:L<line>: <severity> <problem>. <fix>. (for multi-file)
```

## Severity Prefixes

| Prefix | Meaning | When to Use |
|--------|---------|-------------|
| [LARGEREDCIRCLE] bug: | Broken behavior | Will cause incident, crash, data loss |
| [LARGEYELLOWCIRCLE] risk: | Works but fragile | Race conditions, missing null checks, swallowed errors |
| [LARGEBLUECIRCLE] nit: | Style/naming | Author can safely ignore |
| ? q: | Genuine question | Not a suggestion, seeking understanding |

## Rules

### ALWAYS:
- Quote exact line numbers
- Quote exact symbol/function names in backticks
- Give concrete fix suggestion
- Be specific about the problem

### NEVER:
- "I noticed that..."
- "It seems like..."
- "You might want to consider..."
- Vague suggestions
- Multiple issues in one comment (split them)

## Examples

### GOOD:
```
L42: [LARGEREDCIRCLE] bug: user can be null after .find(). Add guard before .email.
L88-140: [LARGEBLUECIRCLE] nit: 50-line fn does 4 things. Extract validate/normalize/persist.
L15: [LARGEYELLOWCIRCLE] risk: unhandled promise rejection. Add .catch() or await try/catch.
L56: ? q: why use sync fs here? async would avoid blocking the thread.
```

### BAD:
```
L42: I noticed that on line 42 you're not checking if the user object is null
before accessing the email property. This could potentially cause a crash if
the user is not found in the database.

It looks like this function is doing a lot of things and might benefit from
being broken up into smaller functions.
```

## Auto-Clarity Rules

Exit terse mode for:

### Security Findings (CVE-class):
Write full paragraph explaining:
- What the vulnerability is
- How it can be exploited
- Potential impact
- Recommended fix
Then resume terse for remaining comments.

### Architectural Disagreements:
Give rationale, not just one-liner:
```
L23: [LARGEYELLOWCIRCLE] risk: this tight coupling will make testing hard. Consider extracting
an interface here so the concrete impl can be mocked in tests.
```

### Onboarding (author is new):
Include brief "why" context:
```
L42: [LARGEREDCIRCLE] bug: NPE risk here — if user not found, .email access crashes.
This check should go right after .find(). We've had incidents from this pattern.
```

## Multi-File Reviews

When reviewing across files:
```
auth/service.ts:L42: [LARGEREDCIRCLE] bug: user null after find(). Guard before .email.
auth/middleware.ts:L15: [LARGEYELLOWCIRCLE] risk: token expiry not checked. Add validation.
```

## Output

Return comments ready to paste into PR. One comment per line. Group by severity if helpful (all [LARGEREDCIRCLE] first, then [LARGEYELLOWCIRCLE], then [LARGEBLUECIRCLE], then ?).