# Ans

Start a Q&A session that runs in parallel with the working AI agent. Use this to ask questions without interrupting ongoing work.

## Usage

```
/ans <question>
```

## Description

The `/ans` command spawns a lightweight sub-agent to answer your question while the main AI agent continues working on its current task.

### How It Works

1. `/ans` captures the current context
2. Spawns a new sub-agent with the question
3. Main agent continues its work uninterrupted
4. Sub-agent provides answers based on captured context
5. Both agents work concurrently

## Examples

```bash
# While AI is building a website, ask about the tech stack
/ans what is the tech stack being used here?

# Ask about specific code
/ans explain the authentication flow

# Ask about project structure
/ans what files were created in phase 3?

# Quick clarification
/ans what does this error mean?
```

## Use Cases

### During Long-Running Tasks

While the AI is building a full-stack application:
```
User: /ans what database is being used?
Agent (sub-agent): Based on the Phase 1 selections, PostgreSQL is configured as the database...
```

### Code Exploration

While AI is implementing features:
```
User: /ans show me the API routes defined so far
Agent (sub-agent): The following API routes have been created:
  - POST /api/auth/login
  - POST /api/auth/register
  - GET /api/projects
  ...
```

### Understanding Progress

While AI is running phases:
```
User: /ans what phase are we on and what's been completed?
Agent (sub-agent): Currently on Phase 3 (Development).
  Completed: Phase 1 (Planning), Phase 2 (Wireframes)
  In progress: Frontend scaffolding
```

## Key Features

- **Non-blocking**: Main agent continues without interruption
- **Context-aware**: Inherits relevant context from current session
- **Lightweight**: Uses smaller/faster model for quick answers
- **Concurrent**: Multiple `/ans` calls can run simultaneously
- **Works in both modes**: Available with or without `/init`

## Limitations

- Sub-agent has limited context window
- Cannot modify files or run commands
- Cannot see very recent changes (last few turns)
- Answers are based on available context, not live analysis

## Keyboard Shortcut

Press `Ctrl+Shift+A` as a shortcut for `/ans` (insert mode).

## Related Commands

- `/init` - Initialize project mode
- `/new` - Start new session
- `/sessions` - View session history