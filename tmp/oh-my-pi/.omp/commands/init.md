# `/init` — Initialize `.pakalon/` for normal mode

Create the smaller `.pakalon/` directory used by normal mode
(non-initialized) sessions. Use `/pakalon` instead if you want the
full 6-phase SDLC.

## Arguments

- `$ARGUMENTS` — optional. `--force` to overwrite an existing
  `.pakalon/` without prompting.

## Steps

1. Detect whether the project is already in agents mode (`.pakalon-agents/`
   present) and refuse if so — point the user at `/pakalon`.
2. Create `.pakalon/agents/`, `.pakalon/sessions/`,
   `.pakalon/automations/`, `.pakalon/workflows/`.
3. Write:
   - `.pakalon/agents/skills.md` — empty skills registry.
   - `.pakalon/plan.md` — plan template.
   - `.pakalon/task.md` — task list template.
   - `.pakalon/user-stories.md` — user stories template.
   - `.pakalon/context-management.md` — token budget template.
   - `.pakalon/settings.local.json` — `allowedPermissions: {}`,
     `autoAcceptTools: []`, `deniedTools: []`.
4. Print a summary of created files.

## Rules

- HIL mode asks the user for overwrite permission if `.pakalon/`
  exists. YOLO auto-overwrites.
- After init, the default mode is `plan` (read-only) until the user
  presses `tab` to enter `edit`.
