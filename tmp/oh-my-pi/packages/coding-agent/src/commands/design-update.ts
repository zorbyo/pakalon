/**
 * /update command - Apply targeted changes to designs/code
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";

export const designUpdateCommand: CommandEntry = {
	name: "update",
	description: "Apply targeted changes to designs or code (e.g., /update the navbar must be rounded)",
	usage: "/update <change description>",
	async execute(args: string[]) {
		if (!args.length) {
			return {
				success: false,
				message:
					"Error: Please provide a change description.\n\nUsage: /update <change description>\nExample: /update the navbar must be rounded in shape",
			};
		}

		const changeDescription = args.join(" ");
		const fs = await import("fs");
		const path = await import("path");
		const cwd = process.cwd();

		// Check if pakalon-agents is initialized
		const pakalonDir = path.join(cwd, ".pakalon-agents");
		if (!fs.existsSync(pakalonDir)) {
			return {
				success: false,
				message: "Error: Run /pakalon first to initialize the project.",
			};
		}

		logger.info("Design update requested", { changeDescription });

		try {
			// Determine which phase files to update based on context
			const phase1Dir = path.join(pakalonDir, "ai-agents", "phase-1");
			const phase2Dir = path.join(pakalonDir, "ai-agents", "phase-2");
			const phase3Dir = path.join(pakalonDir, "ai-agents", "phase-3");

			// Update design.md with the change description
			const designPath = path.join(phase1Dir, "design.md");
			if (fs.existsSync(designPath)) {
				const currentDesign = fs.readFileSync(designPath, "utf-8");
				const updatedDesign = `${currentDesign}\n\n## User Requested Update (${new Date().toISOString()})\n\n${changeDescription}\n`;
				fs.writeFileSync(designPath, updatedDesign);
			}

			// Update phase-2.md with the change request
			const phase2SummaryPath = path.join(phase2Dir, "phase-2.md");
			if (fs.existsSync(phase2SummaryPath)) {
				const currentSummary = fs.readFileSync(phase2SummaryPath, "utf-8");
				const updatedSummary = `${currentSummary}\n\n## Update Request\n\n${changeDescription}\n`;
				fs.writeFileSync(phase2SummaryPath, updatedSummary);
			}

			// Append to phase-3 auditor.md or create a change log
			const auditorPath = path.join(phase3Dir, "auditor.md");
			const changeLogEntry = `\n\n## Design Update Request (${new Date().toISOString()})\n\n**Change:** ${changeDescription}\n**Status:** Pending implementation\n`;

			if (fs.existsSync(auditorPath)) {
				const currentAudit = fs.readFileSync(auditorPath, "utf-8");
				fs.writeFileSync(auditorPath, currentAudit + changeLogEntry);
			}

			// In a full implementation, this would trigger the appropriate phase agent
			// to apply the changes. For now, we log and confirm the update request.
			return {
				success: true,
				message:
					`[OK] Update request recorded\n\n` +
					`Change: ${changeDescription}\n\n` +
					`Updated files:\n` +
					`   - phase-1/design.md\n` +
					`   - phase-2/phase-2.md\n` +
					`   - phase-3/auditor.md\n\n` +
					`To apply the changes, run /phase-2 or /phase-3 depending on the scope.\n\n` +
					`Tip: Use /phase-2 for design/wireframe changes, /phase-3 for code changes.`,
			};
		} catch (err) {
			logger.error("Design update failed", { err });
			return {
				success: false,
				message: `Error: Failed to apply update: ${err}`,
			};
		}
	},
};

export default designUpdateCommand;
