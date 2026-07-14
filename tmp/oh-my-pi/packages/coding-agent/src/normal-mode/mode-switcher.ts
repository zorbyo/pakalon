/**
 * Mode switcher for Pakalon normal mode.
 * Manages Plan, Edit, Auto-accept, and Bypass modes.
 */

export type PakalonNormalMode = "plan" | "edit" | "auto-accept" | "bypass";

export let currentMode: PakalonNormalMode = "plan";

export function getCurrentMode(): PakalonNormalMode {
	return currentMode;
}

export function switchMode(mode: PakalonNormalMode): void {
	currentMode = mode;
}

export function nextMode(): PakalonNormalMode {
	const modes: PakalonNormalMode[] = ["plan", "edit", "auto-accept", "bypass"];
	const idx = modes.indexOf(currentMode);
	currentMode = modes[(idx + 1) % modes.length]!;
	return currentMode;
}

export function isReadOnlyMode(): boolean {
	return currentMode === "plan";
}

export function isAutoAcceptMode(): boolean {
	return currentMode === "auto-accept" || currentMode === "bypass";
}
