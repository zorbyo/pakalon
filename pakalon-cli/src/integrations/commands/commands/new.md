# New

Create a new Pakalon session while preserving the current working session.

## Usage

```
/new [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--name <session-name>` | Optional name for the new session |
| `--keep-context` | Include current session context in new session |
| `--project <path>` | Project directory (default: current) |

## Description

The `/new` command creates a fresh session while ensuring your current work is saved. All sessions are stored in the backend and can be resumed later.

### What Happens

1. Current session state is saved automatically
2. A new session ID is generated
3. New session starts with empty context (or optionally with current context)
4. Old session is stored and can be resumed with `/sessions`

## Examples

```bash
# Start a new session in current directory
/new

# Start new session with a name
/new --name "feature-auth-implementation"

# Start new session keeping current context
/new --keep-context
```

## Session Management

- All sessions are automatically persisted to backend
- Sessions can be listed with `/sessions`
- To resume a previous session, use `/sessions` and select the session
- Sessions are stored even if you close pakalon without explicitly saving

## Use Cases

- **Parallel development**: Start a new session to work on a different feature while preserving your current work
- **Experimentation**: Try out changes in a new session without affecting the original
- **Context switching**: Quick context switch when moving between tasks
- **Code review**: Create a new session to review PR changes

## Related Commands

- `/sessions` - List all saved sessions
- `/save-session` - Save current session with a name
- `/resume-session` - Resume a specific session