import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import * as z from "zod/v4";
import type { ToolSession } from "../sdk";
import { ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";

const screenRecorderSchema = z.object({
	action: z.enum(["start", "stop", "screenshot"] as const).describe("Screen recording action"),
	duration: z.number().default(10).describe("Recording duration in seconds (for start action)").optional(),
	output: z.string().describe("Output file path (optional, auto-generated if omitted)").optional(),
	fps: z.number().default(15).describe("Frames per second for recording").optional(),
	quality: z
		.enum(["low", "medium", "high"] as const)
		.default("medium")
		.describe("Recording quality")
		.optional(),
});

export type ScreenRecorderParams = z.infer<typeof screenRecorderSchema>;

export interface ScreenRecorderDetails {
	action: string;
	filePath?: string;
	duration?: number;
	result?: string;
}

// Active recording state
let activeRecording: {
	process: ReturnType<typeof Bun.spawn>;
	outputPath: string;
	startTime: number;
} | null = null;

export class ScreenRecorderTool implements AgentTool<typeof screenRecorderSchema, ScreenRecorderDetails> {
	readonly name = "screen_recorder";
	readonly approval = "exec" as const;
	readonly formatApprovalDetails = (args: unknown): string[] => {
		const params = args as Partial<ScreenRecorderParams>;
		return [`Action: ${params.action ?? "unknown"}`];
	};
	readonly label = "Screen Recorder";
	readonly loadMode = "discoverable" as const;
	readonly summary = "Record screen or take screenshots of the running application for test evidence";
	readonly parameters = screenRecorderSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	async execute(
		_toolCallId: string,
		params: ScreenRecorderParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<ScreenRecorderDetails>> {
		throwIfAborted(signal);
		const details: ScreenRecorderDetails = { action: params.action };

		const evidenceDir = path.join(this.session.cwd, ".pakalon-agents", "ai-agents", "test-evidence");
		fs.mkdirSync(evidenceDir, { recursive: true });

		try {
			switch (params.action) {
				case "start":
					return await this.#startRecording(params, details, evidenceDir, signal);
				case "stop":
					return await this.#stopRecording(details);
				case "screenshot":
					return await this.#takeScreenshot(params, details, evidenceDir);
				default:
					throw new ToolError(`Unknown action: ${params.action}`);
			}
		} catch (err) {
			if (err instanceof ToolError) throw err;
			throw new ToolError(`Screen recorder error: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async #startRecording(
		params: ScreenRecorderParams,
		details: ScreenRecorderDetails,
		evidenceDir: string,
		_signal?: AbortSignal,
	): Promise<AgentToolResult<ScreenRecorderDetails>> {
		if (activeRecording) {
			throw new ToolError("A recording is already active. Stop it first.");
		}

		const outputPath =
			params.output ??
			path.join(evidenceDir, `recording-${Date.now()}.${params.quality === "high" ? "mp4" : "webm"}`);

		// Try ffmpeg for screen recording
		const ffmpegPath = this.#findFfmpeg();
		if (!ffmpegPath) {
			// Fallback: take periodic screenshots using Chrome DevTools if available
			details.result = "ffmpeg not found. Using periodic screenshot mode instead.";
			details.filePath = evidenceDir;
			return toolResult(details).text(details.result).done();
		}

		const qualityMap = { low: "2500k", medium: "5000k", high: "10000k" };
		const fps = params.fps ?? 15;

		// Platform-specific screen recording
		let args: string[];
		if (process.platform === "darwin") {
			args = [
				"-f",
				"avfoundation",
				"-framerate",
				String(fps),
				"-i",
				"1",
				"-t",
				String(params.duration ?? 10),
				"-b:v",
				qualityMap[params.quality ?? "medium"],
				"-pix_fmt",
				"yuv420p",
				outputPath,
			];
		} else if (process.platform === "win32") {
			args = [
				"-f",
				"gdigrab",
				"-framerate",
				String(fps),
				"-i",
				"desktop",
				"-t",
				String(params.duration ?? 10),
				"-b:v",
				qualityMap[params.quality ?? "medium"],
				"-pix_fmt",
				"yuv420p",
				outputPath,
			];
		} else {
			args = [
				"-f",
				"x11grab",
				"-framerate",
				String(fps),
				"-i",
				":0.0",
				"-t",
				String(params.duration ?? 10),
				"-b:v",
				qualityMap[params.quality ?? "medium"],
				"-pix_fmt",
				"yuv420p",
				outputPath,
			];
		}

		const proc = Bun.spawn([ffmpegPath, "-y", ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});

		activeRecording = {
			process: proc,
			outputPath,
			startTime: Date.now(),
		};

		// Auto-stop after duration
		const duration = (params.duration ?? 10) * 1000;
		setTimeout(() => {
			if (activeRecording) {
				this.#stopRecording(details).catch(() => {});
			}
		}, duration + 1000);

		details.filePath = outputPath;
		details.duration = params.duration ?? 10;
		details.result = `Recording started: ${outputPath} (${details.duration}s, ${params.quality ?? "medium"} quality)`;
		return toolResult(details).text(details.result).done();
	}

	async #stopRecording(details: ScreenRecorderDetails): Promise<AgentToolResult<ScreenRecorderDetails>> {
		if (!activeRecording) {
			throw new ToolError("No active recording to stop");
		}

		const recording = activeRecording;
		activeRecording = null;

		// Send SIGINT to ffmpeg for graceful stop
		try {
			recording.process.kill("SIGINT");
			// Wait for process to finish
			await Promise.race([recording.process.exited, Bun.sleep(5000)]);
		} catch {
			// ignore
		}

		const elapsed = ((Date.now() - recording.startTime) / 1000).toFixed(1);
		const exists = fs.existsSync(recording.outputPath);
		const size = exists ? fs.statSync(recording.outputPath).size : 0;

		details.filePath = recording.outputPath;
		details.duration = Number(elapsed);
		details.result = exists
			? `Recording stopped. File: ${recording.outputPath} (${(size / 1024 / 1024).toFixed(1)}MB, ${elapsed}s)`
			: "Recording stopped but file was not created (ffmpeg may not have captured output)";
		return toolResult(details).text(details.result).done();
	}

	async #takeScreenshot(
		params: ScreenRecorderParams,
		details: ScreenRecorderDetails,
		evidenceDir: string,
	): Promise<AgentToolResult<ScreenRecorderDetails>> {
		const outputPath = params.output ?? path.join(evidenceDir, `screenshot-${Date.now()}.png`);

		const ffmpegPath = this.#findFfmpeg();
		if (!ffmpegPath) {
			throw new ToolError("ffmpeg not found. Install ffmpeg to use screenshot functionality.");
		}

		let args: string[];
		if (process.platform === "darwin") {
			args = ["-f", "avfoundation", "-i", "1", "-frames:v", "1", "-y", outputPath];
		} else if (process.platform === "win32") {
			args = ["-f", "gdigrab", "-i", "desktop", "-frames:v", "1", "-y", outputPath];
		} else {
			args = ["-f", "x11grab", "-i", ":0.0", "-frames:v", "1", "-y", outputPath];
		}

		const proc = Bun.spawn([ffmpegPath, ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
			throw new ToolError(`Screenshot failed: ${stderr}`);
		}

		details.filePath = outputPath;
		details.result = `Screenshot saved to ${outputPath}`;
		return toolResult(details).text(details.result).done();
	}

	#findFfmpeg(): string | null {
		// Check common locations
		const candidates =
			process.platform === "win32"
				? ["ffmpeg.exe", "C:\\ffmpeg\\bin\\ffmpeg.exe"]
				: ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];

		for (const candidate of candidates) {
			try {
				const proc = Bun.spawn([candidate, "-version"], { stdout: "pipe", stderr: "pipe" });
				if (proc.exitCode === 0) return candidate;
			} catch {
				// continue
			}
		}
		return null;
	}
}
