import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { PhaseId } from "./types";

const PHASE_DIR = (cwd: string, phase: PhaseId) => path.join(cwd, ".pakalon-agents", "ai-agents", phase);

const REQUIRED_FILES: Partial<Record<PhaseId, string[]>> = {
	"phase-1": ["plan.md", "tasks.md", "user-stories.md", "phase-1.md"],
	"phase-2": ["Wireframe_generated.svg", "Wireframe_generated.json", "Wireframe_generated.penpot", "phase-2.md"],
	"phase-3": ["subagent-1.md", "subagent-2.md", "subagent-3.md", "subagent-4.md", "subagent-5.md"],
	"phase-4": [
		"subagent-1.md",
		"subagent-2.md",
		"subagent-3.md",
		"subagent-4.md",
		"subagent-5.md",
		"whitebox_testing.xml",
		"blackbox_testing.xml",
	],
	"phase-5": ["phase-5.md", "deployment-guide.md"],
	"phase-6": ["phase-6.md"],
};

export function hasPhaseOutputs(cwd: string, phase: PhaseId): boolean {
	const dir = PHASE_DIR(cwd, phase);
	if (!fs.existsSync(dir)) return false;
	const required = REQUIRED_FILES[phase];
	if (!required) return false;
	return required.every(f => fs.existsSync(path.join(dir, f)));
}

export function writePhaseSummary(cwd: string, phase: PhaseId, summary: string): void {
	const dir = PHASE_DIR(cwd, phase);
	fs.mkdirSync(dir, { recursive: true });
	const banner = `\n\n---\n_Appended by /${phase} at ${new Date().toISOString()}_\n`;
	const file = path.join(dir, `${phase}.md`);
	let existing = "";
	try {
		existing = fs.readFileSync(file, "utf-8");
	} catch {}
	const next = existing ? `${existing}${banner}${summary}\n` : `# ${phase}\n\n${summary}\n`;
	fs.writeFileSync(file, next);
	logger.info(`phase: wrote summary to ${file}`, { phase });
}

export function readLatestPhaseSummary(cwd: string, phase: PhaseId): string | null {
	const file = path.join(PHASE_DIR(cwd, phase), `${phase}.md`);
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return null;
	}
}
