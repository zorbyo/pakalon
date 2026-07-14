/**
 * /penpot command - Open Penpot and sync wireframes
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import fs from "fs";
import path from "path";

const WIREFRAME_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-2");

export const penpotCommand: CommandEntry = {
	name: "penpot",
	description: "Open Penpot to view/edit wireframes",
	usage: "/penpot",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		const wireframeDir = WIREFRAME_DIR(cwd);

		const svgPath = path.join(wireframeDir, "Wireframe_generated.svg");
		const jsonPath = path.join(wireframeDir, "Wireframe_generated.json");
		const penpotPath = path.join(wireframeDir, "Wireframe_generated.penpot");

		if (!fs.existsSync(svgPath) && !fs.existsSync(jsonPath)) {
			return {
				success: false,
				message: "Error: No wireframes found.\n\nTip: Run /phase-2 first to generate wireframes.",
			};
		}

		try {
			let penpotUrl = "http://localhost:8080";
			try {
				const { startPenpotContainer } = await import("../../pakalon/penpot/docker");
				const handle = await startPenpotContainer();
				penpotUrl = handle.url;
			} catch (err) {
				logger.warn("penpot: Docker container not started, using default URL", { err });
			}

			const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
			Bun.spawn([cmd, penpotUrl], { stdout: "ignore", stderr: "ignore" });

			return {
				success: true,
				message:
					`Opening Penpot\n\n` +
					`Wireframes: ${wireframeDir}\n` +
					`URL: ${penpotUrl}\n\n` +
					`Available files:\n` +
					`   ${fs.existsSync(svgPath) ? "[OK]" : "[--]"} Wireframe_generated.svg\n` +
					`   ${fs.existsSync(jsonPath) ? "[OK]" : "[--]"} Wireframe_generated.json\n` +
					`   ${fs.existsSync(penpotPath) ? "[OK]" : "[--]"} Wireframe_generated.penpot\n\n` +
					`Sync.js will auto-sync changes back to the wireframes.`,
			};
		} catch (err) {
			return {
				success: false,
				message: `Error: Failed to open Penpot: ${err}\n\nTip: Make sure Docker is running and Penpot is configured.`,
			};
		}
	},
};

export default penpotCommand;
