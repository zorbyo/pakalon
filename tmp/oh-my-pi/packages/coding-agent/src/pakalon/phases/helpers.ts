/**
 * Helpers for `/phase-N` slash commands.
 *
 * - Re-entry detection: if the target phase's directory already has
 *   outputs, the user is asked to confirm (HIL) or auto-confirmed
 *   (YOLO) before re-running.
 * - Doc generation: each `/phase-N` call writes a per-phase summary
 *   to `phase-N/phase-N.md` after the run completes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export type PhaseId = "phase-1" | "phase-2" | "phase-3" | "phase-4" | "phase-5" | "phase-6";
export const ALL_PHASES: PhaseId[] = ["phase-1", "phase-2", "phase-3", "phase-4", "phase-5", "phase-6"];

const PHASE_DIR = (cwd: string, phase: PhaseId) => path.join(cwd, ".pakalon-agents", "ai-agents", phase);
const REQUIRED_FILES: Record<PhaseId, string[]> = {
	"phase-1": ["plan.md", "tasks.md", "user-stories.md", "phase-1.md"],
	"phase-2": ["Wireframe_generated.svg", "Wireframe_generated.json", "Wireframe_generated.penpot", "phase-2.md"],
	"phase-3": ["subagent-1.md", "subagent-2.md", "subagent-3.md", "subagent-4.md", "subagent-5.md", "phase-3.md"],
	"phase-4": [
		"subagent-1.md",
		"subagent-2.md",
		"subagent-3.md",
		"subagent-4.md",
		"subagent-5.md",
		"phase-4.md",
		"whitebox_testing.xml",
		"blackbox_testing.xml",
	],
	"phase-5": ["phase-5.md", "DEPLOYMENT.md", "Dockerfile", ".github/workflows/pakalon-ci.yml"],
	"phase-6": ["Doc.md", "README.md", "phase-6.md"],
};

/** Has the given phase already produced the required outputs? */
export function hasPhaseOutputs(cwd: string, phase: PhaseId): boolean {
	const dir = PHASE_DIR(cwd, phase);
	if (!fs.existsSync(dir)) return false;
	const required = REQUIRED_FILES[phase];
	return required.every(f => fs.existsSync(path.join(dir, f)));
}

/** Re-entry guard for HIL. Returns true if the caller should proceed. */
export function shouldRerunPhase(
	cwd: string,
	phase: PhaseId,
	mode: "HIL" | "YOLO",
	confirm: () => Promise<boolean> | boolean,
): Promise<boolean> {
	if (!hasPhaseOutputs(cwd, phase)) return Promise.resolve(true);
	if (mode === "YOLO") return Promise.resolve(true);
	return Promise.resolve(confirm());
}

/** Write a one-line "phase completed" summary to `phase-N/phase-N.md`. */
export function writePhaseSummary(cwd: string, phase: PhaseId, summary: string): void {
	const dir = PHASE_DIR(cwd, phase);
	fs.mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString();
	const banner = `\n\n---\n_Appended by /${phase} at ${stamp}_\n`;
	const file = path.join(dir, "phase-N.md" === `${phase}.md` ? `${phase}.md` : `${phase}.md`);
	// Append the new summary section; create the file if missing.
	let existing = "";
	try {
		existing = fs.readFileSync(file, "utf-8");
	} catch {
		/* missing */
	}
	const next = existing ? `${existing}${banner}${summary}\n` : `# ${phase}\n\n${summary}\n`;
	fs.writeFileSync(file, next);
	logger.info(`phase: wrote summary to ${file}`, { phase });
}

/**
 * Try to read the latest prior completion summary for the given
 * phase, or `null` if none exists.
 */
export function readLatestPhaseSummary(cwd: string, phase: PhaseId): string | null {
	const file = path.join(PHASE_DIR(cwd, phase), `${phase}.md`);
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return null;
	}
}

/**
 * Render a human-readable Phase 4 override prompt when critical/high
 * findings persist after auto-remediation (CLI-req.md §337).
 * Returns the rendered text, or null if no override is pending.
 */
export function renderPhase4OverrideMessage(cwd: string): string | null {
	const overrideFile = path.join(PHASE_DIR(cwd, "phase-4"), "phase-4-override.json");
	try {
		const raw = fs.readFileSync(overrideFile, "utf-8");
		const data = JSON.parse(raw);
		if (data.type !== "phase-4-override") return null;
		const total = data.severity.critical + data.severity.high;
		const lines: string[] = [
			"⚠  Phase 4 found critical/high security findings that could not be auto-remediated.",
			"",
			`  Critical: ${data.severity.critical}  |  High: ${data.severity.high}`,
			`  Remediation iterations: ${data.remediationIterations}`,
			"",
			"  Options:",
			"    • Run /phase-5 to proceed despite warnings",
			"    • Run /phase-3 to re-run development & fix findings",
			"    • Review .pakalon-agents/ai-agents/phase-4/ for detailed reports",
			"",
		];
		return lines.join("\n");
	} catch {
		return null;
	}
}
