# Undo

Revert recent code and/or conversation changes. Shows a preview of what will be undone before applying.

## Usage

```
/undo [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--last` | Quick undo both code + chat without preview |
| `--list` | Show last 10 snapshots as numbered list |
| `--target <n>` | Undo to specific snapshot number (from --list) |
| `--code-only` | Undo code changes only |
| `--chat-only` | Undo conversation only |

## Interactive Mode

When run without options, `/undo` shows:
1. Last changed files
2. Recent conversation messages
3. Options to select what to undo:
   - **1. Undo conversation** - Revert chat history only
   - **2. Undo code** - Revert file changes only
   - **3. Undo both** - Revert both code and conversation
   - **4. Do nothing** - Cancel the operation

## Snapshot System

Pakalon automatically creates snapshots at key points:
- Before each phase starts
- After significant code changes
- Before and after interactive prompts

Snapshots include:
- File states (via git or copy-on-write)
- Conversation history
- Phase context

## Examples

```bash
# Interactive undo with preview
/undo

# Quick undo both code and chat
/undo --last

# Show last 10 snapshots
/undo --list

# Undo to specific snapshot
/undo --target 3

# Undo code only
/undo --code-only

# Undo chat only
/undo --chat-only
```

## Keyboard Shortcut

Press `Ctrl+Z` in the chat input as a shortcut for `/undo`.

## Limitations

- Cannot undo past Phase 1 start (initial `/init` is immutable anchor)
- Git-managed files can be reverted via git (faster)
- Non-git files use Pakalon's snapshot system
- Snapshots older than 30 days are automatically pruned

## Safety

The undo system is designed to be safe:
- Always shows preview before applying changes
- Code undo creates backups before reverting
- Conversation undo only affects chat history
- Session can be resumed from any point

## Related Commands

- `/sessions` - View all session history
- `/checkpoint` - Create a manual snapshot