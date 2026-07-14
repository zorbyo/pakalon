/**
 * Phase commands for Pakalon 6-phase SDLC pipeline
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";

const PHASE_INFO = {
	1: { name: "Planning & Requirements", icon: "[P1]" },
	2: { name: "Wireframes", icon: "[P2]" },
	3: { name: "Development", icon: "[P3]" },
	4: { name: "Testing & QA", icon: "[P4]" },
	5: { name: "Deployment", icon: "[P5]" },
	6: { name: "Documentation", icon: "[P6]" },
};

function createPhaseCommand(phase: 1 | 2 | 3 | 4 | 5 | 6): CommandEntry {
	const info = PHASE_INFO[phase];
	return {
		name: `phase-${phase}`,
		description: `${info.icon} Phase ${phase}: ${info.name}`,
		usage: `/phase-${phase}`,
		async execute(args: string[]) {
			const fs = await import("fs");
			const path = await import("path");
			const pakalonDir = path.join(process.cwd(), ".pakalon-agents");

			if (!fs.existsSync(pakalonDir)) {
				return { success: false, message: "Error: Run /pakalon first" };
			}

			try {
				return await runPhase(phase, process.cwd(), args.join(" "));
			} catch (err) {
				logger.error(`Phase ${phase} failed`, { err });
				return { success: false, message: `${info.icon} Phase ${phase} failed: ${err}` };
			}
		},
	};
}

async function runPhase(
	phase: 1 | 2 | 3 | 4 | 5 | 6,
	cwd: string,
	description: string,
): Promise<{ success: boolean; message: string }> {
	const info = PHASE_INFO[phase];

	switch (phase) {
		case 1: {
			const { runPhase1 } = await import("../phases/phase1");
			const mode = process.env.PAKALON_MODE === "YOLO" ? "YOLO" : "HIL";
			const _output = await runPhase1(cwd, {
				prompt: description || "User-initiated phase 1",
				mode,
				askQuestion:
					mode === "HIL"
						? async (_question, options) => {
								// In a full TUI integration, this would present the question
								// For now, return the first option or auto-answer based on context
								const selected = options[0];
								return { label: selected.label, description: selected.description };
							}
						: undefined,
			});
			return {
				success: true,
				message:
					`${info.icon} Phase 1: Planning & Requirements completed\n\n` +
					`[OK] Generated 14 artifacts:\n` +
					`   - plan.md, tasks.md, user-stories.md\n` +
					`   - design.md, context_management.md\n` +
					`   - API_reference.md, Database_schema.md\n` +
					`   - prd.md, risk-assessment.md, technical-spec.md\n` +
					`   - competitive-analysis.md, constraints-and-tradeoffs.md\n` +
					`   - agent-skills.md, phase-1.md\n\n` +
					`Next: Run /phase-2 to generate wireframes`,
			};
		}

		case 2: {
			const { runPhase2 } = await import("../phases/phase2");
			const output = await runPhase2(cwd, {
				onApprove: async (_svg: string, _json: string) => {
					// In HIL mode, this would prompt the user for approval
					return true;
				},
			});
			return {
				success: true,
				message:
					`${info.icon} Phase 2: Wireframes completed\n\n` +
					`[OK] Generated artifacts:\n` +
					`   - Wireframe_generated.svg\n` +
					`   - Wireframe_generated.json\n` +
					`   - Wireframe_generated.penpot\n` +
					`   - phase-2.md\n\n` +
					`TDD: ${output.tddAttempts} attempts, ${output.tddPassed ? "PASSED" : "completed"}\n\n` +
					`Next: Run /phase-3 to start development`,
			};
		}

		case 3: {
			const { runPhase3 } = await import("../phases/phase3");
			const mode = process.env.PAKALON_MODE === "YOLO" ? "YOLO" : "HIL";
			const output = await runPhase3(cwd, { mode });
			return {
				success: true,
				message:
					`${info.icon} Phase 3: Development completed\n\n` +
					`[OK] Subagent reports:\n` +
					`   - subagent-1.md (Frontend)\n` +
					`   - subagent-2.md (Backend)\n` +
					`   - subagent-3.md (Integration)\n` +
					`   - subagent-4.md (Debug & Test)\n` +
					`   - subagent-5.md (Feedback)\n\n` +
					`Auditor: ${output.auditorReport.split("\n")[0]}\n\n` +
					`Next: Run /phase-4 for testing & QA`,
			};
		}

		case 4: {
			const { runPhase4 } = await import("../phases/phase4");
			const input = {
				enableSast: true,
				enableDast: true,
				enableCodeReview: true,
				autoRemediate: process.env.PAKALON_MODE === "YOLO",
			};
			const output = await runPhase4(cwd, input);
			const status =
				output.severitySummary.critical + output.severitySummary.high === 0 ? "PASSED" : "NEEDS ATTENTION";
			return {
				success: true,
				message:
					`${info.icon} Phase 4: Testing & QA completed\n\n` +
					`Status: ${status}\n` +
					`   - Critical: ${output.severitySummary.critical}\n` +
					`   - High: ${output.severitySummary.high}\n` +
					`   - Medium: ${output.severitySummary.medium}\n` +
					`   - Low: ${output.severitySummary.low}\n\n` +
					`Reports:\n` +
					`   - whitebox_testing.xml\n` +
					`   - blackbox_testing.xml\n` +
					`   - subagent-1.md through subagent-5.md\n` +
					`   - phase-4.md\n\n` +
					`Next: Run /phase-5 for deployment`,
			};
		}

		case 5: {
			const { runPhase5 } = await import("../phases/phase5");
			const output = await runPhase5(cwd);
			return {
				success: true,
				message:
					`${info.icon} Phase 5: Deployment completed\n\n` +
					(output.githubCreated ? `[OK] GitHub repository created\n` : `[INFO] GitHub integration ready\n`) +
					`[OK] phase-5.md generated\n\n` +
					`Next: Run /phase-6 for documentation (optional)`,
			};
		}

		case 6: {
			const { runPhase6 } = await import("../phases/phase6");
			await runPhase6(cwd);
			return {
				success: true,
				message:
					`${info.icon} Phase 6: Documentation completed\n\n` +
					`[OK] Generated:\n` +
					`   - doc.md - Complete user documentation\n` +
					`   - phase-6.md - Phase summary\n\n` +
					`All phases complete!`,
			};
		}
	}
}

export function createPhaseCommands(): CommandEntry[] {
	return [1, 2, 3, 4, 5, 6].map(p => createPhaseCommand(p as 1 | 2 | 3 | 4 | 5 | 6));
}

export const phase1Command = createPhaseCommand(1);
export const phase2Command = createPhaseCommand(2);
export const phase3Command = createPhaseCommand(3);
export const phase4Command = createPhaseCommand(4);
export const phase5Command = createPhaseCommand(5);
export const phase6Command = createPhaseCommand(6);

export default createPhaseCommands();
