/**
 * /help command — Show all Pakalon commands.
 *
 * Lists every available Pakalon command with its description.
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// HelpCommand
// ============================================================================

export class HelpCommand implements CustomCommand {
	name = "help";
	description = "Show all Pakalon commands and their usage";

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const helpText = `
## Pakalon Commands

### Pipeline Commands
| Command | Description |
|---------|-------------|
| \`/pakalon\` | Initialize and run the 6-phase autonomous build pipeline |
| \`/phase-1\` | Run Phase 1: Planning & Requirements |
| \`/phase-2\` | Run Phase 2: Wireframes + Penpot |
| \`/phase-3\` | Run Phase 3: Development (5 sub-agents) |
| \`/phase-4\` | Run Phase 4: Testing & QA (SAST/DAST) |
| \`/phase-5\` | Run Phase 5: Deployment & CI/CD |
| \`/phase-6\` | Run Phase 6: Documentation |
| \`/auditor\` | Run auditor to check implementation vs requirements |

### Normal Mode Commands
| Command | Description |
|---------|-------------|
| \`/init\` | Initialize .pakalon/ directory with planning files |
| \`/plan\` | Generate a planning document (output.md) |
| \`/build\` | Start building from the planning document |
| \`/agents\` | Manage custom AI agent teams |
| \`/history\` | Show session history with prompts and token usage |
| \`/session\` | Manage sessions (info, list, switch, new) |
| \`/resume\` | Resume a previous session |
| \`/new\` | Start a new session |
| \`/undo\` | Undo recent changes (conversation, code, or both) |
| \`/models\` | Choose an AI model (filtered by plan) |
| \`/update\` | Apply a targeted change |
| \`/ans\` | Ask a question without interrupting running agent |
| \`/automations\` | Manage automation workflows |
| \`/web\` | Search the web or fetch content from a URL |
| \`/logout\` | Log out and clear all sessions |
| \`/penpot\` | Open Penpot design tool with current wireframes |

### Utility
| Command | Description |
|---------|-------------|
| \`/help\` | Show this help message |

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| \`Tab\` | Cycle modes: Plan → Edit → Auto-accept → Bypass |
| \`Shift+Tab\` | Toggle model thinking capability |
| \`Ctrl+C\` | Cancel current operation |

### Mode Descriptions
- **Plan**: Only read tools, no code changes
- **Edit**: All file changes require permission
- **Auto-accept**: File writes auto-approved, exec requires permission
- **Bypass**: Full YOLO mode, no permissions required
`;

		ctx.ui.notify(helpText, "info");
		return undefined;
	}
}

export default function helpFactory(api: CustomCommandAPI): HelpCommand {
	return new HelpCommand(api);
}
