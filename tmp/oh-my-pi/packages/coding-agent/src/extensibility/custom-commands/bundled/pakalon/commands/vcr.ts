/**
 * /vcr command — Session recording and replay.
 *
 * Allows users to record, list, replay, and analyze past session recordings.
 * Per CLI-req.md §VCR: "Replay past sessions to understand what happened,
 * debug issues, or review the conversation flow."
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import {
	analyzeRecording,
	deleteRecording,
	formatAnalysis,
	formatReplayOutput,
	listRecordings,
	loadRecording,
} from "../../../../pakalon/vcr/index";

// ============================================================================
// VcrCommand
// ============================================================================

export class VcrCommand implements CustomCommand {
	name = "vcr";
	description = "Session recording and replay (list, replay, analyze, delete)";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const subcommand = (args[0] || "list").toLowerCase();
		const projectPath = this.api.cwd;

		switch (subcommand) {
			case "list": {
				const recordings = listRecordings(projectPath);
				if (recordings.length === 0) {
					ctx.ui.notify("No recordings found. Recordings are created automatically during sessions.", "info");
					return undefined;
				}

				const lines = ["## Session Recordings\n"];
				for (const rec of recordings.slice(0, 20)) {
					const date = new Date(rec.startTime).toLocaleString();
					const duration = rec.metadata.totalDuration
						? `${Math.round(rec.metadata.totalDuration / 1000)}s`
						: "unknown";
					const events = rec.metadata.eventCount;
					const model = rec.metadata.model ?? "unknown";
					lines.push(`### ${rec.id}`);
					lines.push(`- Date: ${date}`);
					lines.push(`- Session: ${rec.sessionId}`);
					lines.push(`- Duration: ${duration}`);
					lines.push(`- Events: ${events}`);
					lines.push(`- Model: ${model}`);
					lines.push("");
				}

				ctx.ui.notify(lines.join("\n"), "info");
				return undefined;
			}

			case "replay": {
				const recordingId = args[1];
				if (!recordingId) {
					ctx.ui.notify("Usage: /vcr replay <recording-id>", "info");
					return undefined;
				}

				const recording = loadRecording(projectPath, recordingId);
				if (!recording) {
					ctx.ui.notify(`Recording not found: ${recordingId}`, "error");
					return undefined;
				}

				const output = formatReplayOutput(recording, {
					showTimestamps: true,
					showToolDetails: true,
				});

				ctx.ui.notify(output, "info");
				return undefined;
			}

			case "analyze": {
				const recordingId = args[1];
				if (!recordingId) {
					ctx.ui.notify("Usage: /vcr analyze <recording-id>", "info");
					return undefined;
				}

				const recording = loadRecording(projectPath, recordingId);
				if (!recording) {
					ctx.ui.notify(`Recording not found: ${recordingId}`, "error");
					return undefined;
				}

				const analysis = analyzeRecording(recording);
				const output = formatAnalysis(analysis);

				ctx.ui.notify(output, "info");
				return undefined;
			}

			case "delete": {
				const recordingId = args[1];
				if (!recordingId) {
					ctx.ui.notify("Usage: /vcr delete <recording-id>", "info");
					return undefined;
				}

				const deleted = deleteRecording(projectPath, recordingId);
				if (deleted) {
					ctx.ui.notify(`Recording deleted: ${recordingId}`, "info");
				} else {
					ctx.ui.notify(`Recording not found: ${recordingId}`, "error");
				}
				return undefined;
			}

			default: {
				const lines = [
					"## VCR — Session Recording & Replay\n",
					"**Subcommands:**",
					"- `/vcr list` — List all recordings",
					"- `/vcr replay <id>` — Replay a recording",
					"- `/vcr analyze <id>` — Analyze a recording",
					"- `/vcr delete <id>` — Delete a recording",
					"",
					"Recordings capture messages, tool calls, and results.",
					"Use analyze to get statistics on tool usage, tokens, and errors.",
				];
				ctx.ui.notify(lines.join("\n"), "info");
				return undefined;
			}
		}
	}
}

export default function vcrFactory(api: CustomCommandAPI): VcrCommand {
	return new VcrCommand(api);
}
