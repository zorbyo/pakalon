/**
 * Top-level CLI command table.
 *
 * Lives in its own module (importable without side effects) so that tests can
 * inspect the registered subcommands without triggering the side-effectful
 * top-level await in `cli.ts`. Adding a new subcommand here is enough to make
 * `runCli` route to it instead of forwarding the argv as a prompt to
 * `launch` — see #1496 for the original "args silently leak to the LLM"
 * regression that motivated the split.
 */
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";

export const commands: CommandEntry[] = [
	{ name: "launch", load: () => import("./commands/launch").then(m => m.default) },
	{ name: "acp", load: () => import("./commands/acp").then(m => m.default) },
	{ name: "auth-broker", load: () => import("./commands/auth-broker").then(m => m.default) },
	{ name: "auth-gateway", load: () => import("./commands/auth-gateway").then(m => m.default) },
	{ name: "agents", load: () => import("./commands/agents").then(m => m.default) },
	{ name: "commit", load: () => import("./commands/commit").then(m => m.default) },
	{ name: "completions", load: () => import("./commands/completions").then(m => m.default) },
	{ name: "__complete", load: () => import("./commands/complete").then(m => m.default) },
	{ name: "config", load: () => import("./commands/config").then(m => m.default) },
	{ name: "grep", load: () => import("./commands/grep").then(m => m.default) },
	{ name: "grievances", load: () => import("./commands/grievances").then(m => m.default) },
	{ name: "install", load: () => import("./commands/install").then(m => m.default) },
	{ name: "plugin", load: () => import("./commands/plugin").then(m => m.default) },
	{ name: "setup", load: () => import("./commands/setup").then(m => m.default) },
	{ name: "shell", load: () => import("./commands/shell").then(m => m.default) },
	{ name: "read", load: () => import("./commands/read").then(m => m.default) },
	{ name: "ssh", load: () => import("./commands/ssh").then(m => m.default) },
	{ name: "stats", load: () => import("./commands/stats").then(m => m.default) },
	{ name: "update", load: () => import("./commands/update").then(m => m.default) },
	{ name: "tiny-models", load: () => import("./commands/tiny-models").then(m => m.default) },
	{ name: "worktree", load: () => import("./commands/worktree").then(m => m.default), aliases: ["wt"] },
	{ name: "search", load: () => import("./commands/web-search").then(m => m.default), aliases: ["q"] },
	// Pakalon commands
	{
		name: "pakalon",
		load: () => import("./commands/pakalon-init").then(m => m.pakalonAgentsCommand),
		aliases: ["pakalon-agents"],
	},
	{ name: "init", load: () => import("./commands/pakalon-init").then(m => m.pakalonInitCommand) },
	{ name: "phase-1", load: () => import("./commands/phases").then(m => m.phase1Command) },
	{ name: "phase-2", load: () => import("./commands/phases").then(m => m.phase2Command) },
	{ name: "phase-3", load: () => import("./commands/phases").then(m => m.phase3Command) },
	{ name: "phase-4", load: () => import("./commands/phases").then(m => m.phase4Command) },
	{ name: "phase-5", load: () => import("./commands/phases").then(m => m.phase5Command) },
	{ name: "phase-6", load: () => import("./commands/phases").then(m => m.phase6Command) },
	{ name: "pakalon-init", load: () => import("./commands/pakalon-init").then(m => m.default) },
	{ name: "pakalon-local-models", load: () => import("./commands/pakalon-local-models").then(m => m.default) },
	{ name: "pakalon-doctor", load: () => import("./commands/pakalon-doctor").then(m => m.default) },
	{ name: "skills", load: () => import("./commands/skills-cmd").then(m => m.skillsCommand), aliases: ["skill"] },
	{ name: "models", load: () => import("./commands/models-selector").then(m => m.modelsSelectorCommand) },
	{ name: "multi-session", load: () => import("./commands/multi-session").then(m => m.multiSessionCommand) },
	// Auth & self-hosted
	{ name: "auth", load: () => import("./commands/auth-commands").then(m => m.authCommand) },
	{ name: "login", load: () => import("./commands/auth-commands").then(m => m.loginCommand) },
	{ name: "self-hosted", load: () => import("./commands/auth-commands").then(m => m.selfHostedCommand) },
	// Missing Pakalon commands
	{ name: "update", load: () => import("./commands/design-update").then(m => m.designUpdateCommand) },
	{ name: "connect", load: () => import("./commands/connect").then(m => m.connectCommand) },
	{ name: "connect-end", load: () => import("./commands/connect").then(m => m.connectEndCommand) },
	{ name: "undo", load: () => import("./commands/undo").then(m => m.undoCommand) },
	{ name: "automations", load: () => import("./commands/automations").then(m => m.automationsCommand) },
	{ name: "session", load: () => import("./commands/session-manager").then(m => m.sessionCommand) },
	{ name: "new", load: () => import("./commands/session-manager").then(m => m.newSessionCommand) },
	{ name: "resume", load: () => import("./commands/session-manager").then(m => m.resumeCommand) },
	{ name: "history", load: () => import("./commands/session-manager").then(m => m.historyCommand) },
	{ name: "penpot", load: () => import("./commands/penpot-commands").then(m => m.penpotCommand) },
	{ name: "billing", load: () => import("./commands/billing").then(m => m.billingCommand) },
	{ name: "cost", load: () => import("./commands/billing").then(m => m.costCommand) },
	{ name: "logout", load: () => import("./commands/billing").then(m => m.logoutCommand) },
];

/**
 * Return true when `first` matches a registered subcommand name or alias.
 *
 * Flags (`-…`) and `@file` arguments are never subcommands; for those the CLI
 * runner skips ahead to the default `launch` command.
 */
export function isSubcommand(first: string | undefined): boolean {
	if (!first || first.startsWith("-") || first.startsWith("@")) return false;
	return commands.some(entry => entry.name === first || entry.aliases?.includes(first));
}
