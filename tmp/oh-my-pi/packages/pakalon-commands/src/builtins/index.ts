import type { SlashCommand } from "../types";
import { ADMIN_COMMANDS } from "./admin";
import { AUTOMATION_COMMANDS } from "./automation";
import { EXTRAS_COMMANDS } from "./extras";
import { GENERAL_COMMANDS } from "./general";
import { MODE_COMMANDS } from "./modes";
import { PHASE_COMMANDS } from "./phases";
import { SESSION_COMMANDS } from "./sessions";

export const ALL_BUILTIN_COMMANDS: SlashCommand[] = [
	...GENERAL_COMMANDS,
	...MODE_COMMANDS,
	...PHASE_COMMANDS,
	...SESSION_COMMANDS,
	...ADMIN_COMMANDS,
	...AUTOMATION_COMMANDS,
	...EXTRAS_COMMANDS,
];
