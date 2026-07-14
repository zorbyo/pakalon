/**
 * @-mention resolver helper for the TUI. Surfaces the list of agent
 * teams defined in the current project so the editor's `@` autocomplete
 * can show them. Wraps the existing
 * `modes/internal-url-autocomplete.ts` mechanism.
 */

import type { AgentDefinition } from "./registry";
import { listAgents } from "./registry";

export function getMentionableAgents(projectDir: string): AgentDefinition[] {
	return listAgents(projectDir);
}
