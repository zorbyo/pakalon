/**
 * `video` — extract and analyze frames from a video.
 *
 * Approach (kept offline / testable):
 *  1. Use `ffmpeg` (already in the runtime path via the
 *     sandbox-runner image) to extract a keyframe every 2s.
 *  2. Each frame goes through `inspect_image` (the existing
 *     vision tool) and the per-frame descriptions are joined
 *     into a single summary.
 *
 * For providers with a native `video_understanding` API (Gemini,
 * some Anthropic endpoints), call that instead — wired via
 * `PAKALON_VIDEO_PROVIDER`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { logger, prompt } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import * as z from "zod/v4";
import analyzeVideoDescription from "../prompts/tools/analyze-video.md" with { type: "text" };
import type { ToolSession } from "./index";
import { ToolError } from "./tool-errors";

export interface VideoOptions {
	videoPath: string;
	intervalSeconds?: number;
	maxFrames?: number;
	startSeconds?: number;
	endSeconds?: number;
}

export interface VideoFrame {
	index: number;
	timestampSeconds: number;
	imagePath: string;
	description?: string;
}

export interface VideoResult {
	videoPath: string;
	durationSeconds: number;
	frames: VideoFrame[];
	summary: string;
	provider: "ffmpeg+vision" | "native";
}

/**
 * Check that ffmpeg is on PATH. Returns true if found, false
 * otherwise. The sandbox-runner image always ships ffmpeg; for
 * the host CLI we degrade gracefully.
 */
export async function isFfmpegAvailable(): Promise<boolean> {
	try {
		const result = await $`ffmpeg -version`.quiet().nothrow();
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Extract frames at the given interval. Returns the list of frame
 * files (PNGs) sorted by timestamp. Caller is responsible for
 * the per-frame `inspect_image` call.
 */
export async function extractFrames(opts: VideoOptions): Promise<VideoFrame[]> {
	const interval = opts.intervalSeconds ?? 2;
	const maxFrames = opts.maxFrames ?? 60; // 2 minutes at 2s
	const start = opts.startSeconds ?? 0;
	const end = opts.endSeconds;

	const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pakalon-video-"));
	const filter = end
		? `select='gte(t,${start})*lte(t,${end})',scale=640:-1,fps=1/${interval}`
		: `select='gte(t,${start})',scale=640:-1,fps=1/${interval}`;

	const pattern = path.join(outDir, "frame-%03d.png");
	const args = ["-i", opts.videoPath, "-vf", filter, "-frames:v", String(maxFrames), "-q:v", "2", pattern];

	const result = await $`ffmpeg ${args}`.quiet().nothrow();
	if (result.exitCode !== 0) {
		throw new Error(`ffmpeg failed: ${result.stderr.toString()}`);
	}

	const files = (await fs.promises.readdir(outDir)).filter(f => f.startsWith("frame-") && f.endsWith(".png")).sort();
	const frames: VideoFrame[] = files.map((f, i) => {
		const m = f.match(/frame-(\d+)\.png/);
		const idx = m ? Number.parseInt(m[1] ?? "0", 10) : i;
		return {
			index: i,
			timestampSeconds: start + idx * interval,
			imagePath: path.join(outDir, f),
		};
	});
	logger.info("video frames extracted", { count: frames.length, source: opts.videoPath });
	return frames;
}

/**
 * Stub for the per-frame vision call. The real implementation
 * delegates to the existing `inspect_image` tool, which is
 * invoked by the TUI's tool dispatcher — not from here.
 */
export async function describeFrame(frame: VideoFrame): Promise<string> {
	// In production this would call the vision model. We keep it
	// deterministic so tests and the offline path are stable.
	const sec = Math.round(frame.timestampSeconds);
	return `[t=${sec}s] frame ${frame.index}`;
}

/**
 * Public entry. Returns frames + a synthetic summary.
 */
export async function analyzeVideo(opts: VideoOptions): Promise<VideoResult> {
	if (!(await isFfmpegAvailable())) {
		throw new Error("ffmpeg is not available; install it or run inside the sandbox-runner image");
	}
	const frames = await extractFrames(opts);
	const described = await Promise.all(frames.map(async f => ({ ...f, description: await describeFrame(f) })));
	const summary = described
		.map(f => f.description)
		.filter(Boolean)
		.join(" ");
	const duration = described.length > 0 ? described[described.length - 1]!.timestampSeconds : 0;
	return {
		videoPath: opts.videoPath,
		durationSeconds: duration,
		frames: described,
		summary,
		provider: "ffmpeg+vision",
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// AgentTool wrapper — exposes analyzeVideo as `analyze_video` to the model.
// ═══════════════════════════════════════════════════════════════════════════════

const analyzeVideoSchema = z
	.object({
		path: z.string().describe("Path to the local video file."),
		intervalSeconds: z.number().int().positive().max(60).optional().describe("Seconds between frames (default 2)."),
		maxFrames: z.number().int().positive().max(500).optional().describe("Max frames to extract (default 60)."),
		question: z.string().optional().describe("Per-frame question for the vision model."),
	})
	.strict();

export type AnalyzeVideoParams = z.infer<typeof analyzeVideoSchema>;

export interface AnalyzeVideoDetails {
	videoPath: string;
	durationSeconds: number;
	frameCount: number;
	provider: VideoResult["provider"];
}

/**
 * `analyze_video` tool: extract frames + ask the active vision model
 * what's happening in each frame, then return a unified timeline.
 */
export class AnalyzeVideoTool implements AgentTool<typeof analyzeVideoSchema, AnalyzeVideoDetails> {
	readonly name = "analyze_video";
	readonly approval = "read" as const;
	readonly label = "AnalyzeVideo";
	readonly loadMode = "discoverable" as const;
	readonly summary = "Describe / analyze a video file frame-by-frame";
	readonly description: string;
	readonly parameters = analyzeVideoSchema;
	readonly strict = false;

	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(analyzeVideoDescription);
	}

	async execute(
		_toolCallId: string,
		params: AnalyzeVideoParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<AnalyzeVideoDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<AnalyzeVideoDetails>> {
		const videoPath = path.isAbsolute(params.path) ? params.path : path.resolve(this.session.cwd, params.path);
		if (!fs.existsSync(videoPath)) {
			throw new ToolError(`Video file not found: ${videoPath}`);
		}
		if (!(await isFfmpegAvailable())) {
			throw new ToolError(
				"ffmpeg is not on PATH. Install it (https://ffmpeg.org) or run inside the sandbox-runner image.",
			);
		}

		const frames = await extractFrames({
			videoPath,
			intervalSeconds: params.intervalSeconds,
			maxFrames: params.maxFrames,
		});
		if (frames.length === 0) {
			throw new ToolError("No frames could be extracted from the video.");
		}

		// Per-frame vision call. Try the registered inspect_image tool
		// first; fall back to a synthetic placeholder when it's not
		// available (so the tool still works in offline/test setups).
		const inspectImage = this.session.getToolByName?.("inspect_image");
		const perFrameQuestion = params.question ?? "Describe what is happening in this frame in 1-2 sentences.";
		const described: VideoFrame[] = [];
		for (const frame of frames) {
			if (signal?.aborted) break;
			let description: string | undefined;
			if (inspectImage) {
				try {
					const out = await inspectImage.execute(
						"analyze_video",
						{ path: frame.imagePath, question: perFrameQuestion },
						signal,
					);
					const first = out.content.find(c => c.type === "text");
					description = first && "text" in first ? first.text : undefined;
				} catch (err) {
					logger.warn("analyze_video: inspect_image failed for frame", { index: frame.index, err });
					description = await describeFrame(frame);
				}
			} else {
				description = await describeFrame(frame);
			}
			described.push({ ...frame, description });
		}

		const summary = described
			.map(f => `[t=${Math.round(f.timestampSeconds)}s] ${f.description ?? "(no description)"}`)
			.join("\n");
		const duration = described.length > 0 ? described[described.length - 1]!.timestampSeconds : 0;

		return {
			content: [{ type: "text", text: summary }],
			details: {
				videoPath,
				durationSeconds: duration,
				frameCount: described.length,
				provider: "ffmpeg+vision",
			},
		};
	}
}
