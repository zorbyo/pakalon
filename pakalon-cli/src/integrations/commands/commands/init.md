# Init

Initialize a Pakalon project in the current directory. Creates the `.pakalon/` structure with planning artifacts and agent configurations.

## Usage

```
/init [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--project <name>` | Project name (default: current directory name) |
| `--template <name>` | Use a specific template |
| `--skip-prompts` | Skip interactive questions (use defaults) |
| `--force` | Overwrite existing .pakalon/ if present |

## What It Does

1. Creates `.pakalon/` directory structure:
   ```
   .pakalon/
   ├── plan.md           # Project context
   ├── spec.md           # Technical specifications
   ├── CLAUDE.md         # Agent instructions
   ├── phase-1.md        # Planning phase output
   ├── phase-2.md        # Wireframes phase output
   ├── phase-3.md        # Development phase output
   ├── phase-4.md        # Security phase output
   ├── phase-5.md        # CI/CD phase output
   ├── phase-6.md        # Documentation phase output
   ├── skills/           # Agent skills
   └── sessions/         # Session history
   ```

2. Starts Phase 1 (Planning) workflow

3. In **HIL mode**: Asks for confirmation before each phase
4. In **YOLO mode**: Runs all phases automatically

## Examples

```bash
# Initialize in current directory
/init

# Initialize with custom project name
/init --project my-saas-app

# Skip all prompts (YOLO behavior)
/init --skip-prompts

# Force reinitialize (overwrites existing)
/init --force
```

## Behavior

### HIL Mode (Human-in-Loop)
- Prompts for confirmation before each phase
- Shows what will be built before building
- Allows reviewing and modifying plan

### YOLO Mode
- Automatically runs all phases
- No confirmation prompts
- Use `--permission-mode yolo` flag when starting pakalon

## Notes

- Running `/init` in an existing project triggers retrospective analysis
- Existing `.pakalon/` is preserved unless `--force` is used
- Session history is maintained across `/init` calls