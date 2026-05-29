/**
 * VideoAnalysisTool — AI tool for analyzing video files.
 * Extracts frames and uses vision models to describe video content.
 */
import { z } from "zod";
import { buildTool, type ToolDef, type ToolCallProgress } from "../tool-types.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { analyzeVideo } from "../../media/videoAnalysis.js";
import { validateVideoFile } from "../../media/videoValidator.js";
import {
  SUPPORTED_VIDEO_FORMATS,
  MAX_VIDEO_SIZE_MB,
  DEFAULT_MAX_FRAMES,
  DEFAULT_FRAME_INTERVAL_SECONDS,
  type VideoAnalysisResult,
} from "../../media/videoTypes.js";
import logger from "../../utils/logger.js";

const VIDEO_ANALYSIS_TOOL_NAME = "video_analysis";

const inputSchema = lazySchema(() =>
  z.strictObject({
    videoPath: z.string().describe("Absolute or relative path to the video file"),
    maxFrames: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .default(DEFAULT_MAX_FRAMES)
      .describe("Maximum number of frames to extract and analyze (1-50)"),
    prompt: z
      .string()
      .optional()
      .describe("Custom analysis prompt. If omitted, uses default detailed analysis prompt"),
    model: z
      .string()
      .optional()
      .describe("Vision model to use (default: google/gemini-2.0-flash-001)"),
    summarize: z
      .boolean()
      .optional()
      .default(true)
      .describe("Generate a summary of the entire video (default: true)"),
    includeTimestamps: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include timestamps in frame analysis output"),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    summary: z.string().optional(),
    frameCount: z.number().optional(),
    frames: z
      .array(
        z.object({
          index: z.number(),
          timestamp: z.string(),
          description: z.string(),
          labels: z.array(z.string()).optional(),
          objects: z.array(z.string()).optional(),
          text: z.string().optional(),
        }),
      )
      .optional(),
    metadata: z
      .object({
        duration: z.number(),
        width: z.number(),
        height: z.number(),
        fps: z.number(),
        codec: z.string(),
        format: z.string(),
        hasAudio: z.boolean(),
      })
      .optional(),
    processingTime: z.number().optional(),
    error: z.string().optional(),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

type Input = z.infer<InputSchema>;
type Output = z.infer<OutputSchema>;

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

export const VideoAnalysisTool = buildTool({
  name: VIDEO_ANALYSIS_TOOL_NAME,
  searchHint: "analyze video content using AI vision",
  maxResultSizeChars: 100_000,
  shouldDefer: true,

  get inputSchema(): InputSchema {
    return inputSchema();
  },

  get outputSchema(): OutputSchema {
    return outputSchema();
  },

  async description(input: Partial<Input>): Promise<string> {
    const path = input.videoPath ?? "a video file";
    const frames = input.maxFrames ?? DEFAULT_MAX_FRAMES;
    return `Analyze video "${path}" by extracting ${frames} frames and using AI vision to describe content`;
  },

  async prompt(): Promise<string> {
    return `You have a video analysis tool that can extract frames from video files and analyze them using AI vision models.

The tool supports:
- Video formats: ${SUPPORTED_VIDEO_FORMATS.join(", ")}
- Maximum file size: ${MAX_VIDEO_SIZE_MB}MB
- Frame extraction at regular intervals
- AI-powered frame analysis with object detection, text recognition, and scene description
- Video summary generation from multiple frame analyses

Use this tool when the user asks to analyze, describe, or understand video content.`;
  },

  userFacingName(): string {
    return "Video Analysis";
  },

  isConcurrencySafe(): boolean {
    return true;
  },

  isEnabled(): boolean {
    return true;
  },

  isReadOnly(): boolean {
    return true;
  },

  toAutoClassifierInput(input: Input): string {
    return input.videoPath;
  },

  async validateInput(
    { videoPath }: Input,
  ): Promise<{ result: true } | { result: false; message: string; errorCode: number }> {
    if (!videoPath) {
      return { result: false, message: "Video path is required", errorCode: 1 };
    }

    const validation = await validateVideoFile(videoPath);
    if (!validation.valid) {
      return {
        result: false,
        message: validation.error ?? "Invalid video file",
        errorCode: 2,
      };
    }

    return { result: true };
  },

  interruptBehavior() {
    return "cancel" as const;
  },

  renderToolUseMessage(input: Partial<Input>): string {
    const path = input.videoPath ?? "video";
    const frames = input.maxFrames ?? DEFAULT_MAX_FRAMES;
    return `Analyzing video: ${path} (${frames} frames)`;
  },

  async call(
    input: Input,
    context: {
      abortController?: AbortController;
      toolUseId?: string;
    },
    _canUseTool: unknown,
    _parentMessage: unknown,
    onProgress?: ToolCallProgress<{
      type: "video_analysis";
      stage?: string;
      frameIndex?: number;
      totalFrames?: number;
      message?: string;
    }>,
  ): Promise<{ data: Output }> {
    const { videoPath, maxFrames, prompt, model, summarize } = input;

    logger.info(`VideoAnalysisTool called: ${videoPath}`);

    if (onProgress) {
      onProgress({
        toolUseID: context.toolUseId ?? "video_analysis",
        data: {
          type: "video_analysis",
          stage: "validating",
          message: `Validating video: ${videoPath}`,
        },
      });
    }

    const validation = await validateVideoFile(videoPath);
    if (!validation.valid) {
      return {
        data: {
          success: false,
          error: validation.error ?? "Video validation failed",
        },
      };
    }

    if (validation.warnings.length > 0) {
      logger.warn(`Video warnings: ${validation.warnings.join("; ")}`);
    }

    if (onProgress) {
      onProgress({
        toolUseID: context.toolUseId ?? "video_analysis",
        data: {
          type: "video_analysis",
          stage: "extracting_frames",
          message: `Extracting up to ${maxFrames} frames...`,
        },
      });
    }

    const result: VideoAnalysisResult = await analyzeVideo(videoPath, {
      maxFrames,
      prompt,
      model,
      summarize,
      includeTimestamps: input.includeTimestamps,
    });

    if (!result.success) {
      return {
        data: {
          success: false,
          error: result.error ?? "Video analysis failed",
          processingTime: result.processingTime,
        },
      };
    }

    if (onProgress) {
      onProgress({
        toolUseID: context.toolUseId ?? "video_analysis",
        data: {
          type: "video_analysis",
          stage: "complete",
          frameIndex: result.frameAnalyses.length,
          totalFrames: result.frameAnalyses.length,
          message: `Analysis complete: ${result.frameAnalyses.length} frames analyzed`,
        },
      });
    }

    const output: Output = {
      success: true,
      summary: result.summary,
      frameCount: result.frameAnalyses.length,
      frames: result.frameAnalyses.map((fa) => ({
        index: fa.frameIndex,
        timestamp: formatTimestamp(fa.timestamp),
        description: fa.description,
        labels: fa.labels,
        objects: fa.objects,
        text: fa.text,
      })),
      metadata: result.metadata
        ? {
            duration: result.metadata.duration,
            width: result.metadata.width,
            height: result.metadata.height,
            fps: result.metadata.fps,
            codec: result.metadata.codec,
            format: result.metadata.format,
            hasAudio: result.metadata.hasAudio,
          }
        : undefined,
      processingTime: result.processingTime,
    };

    return { data: output };
  },

  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): { type: "tool_result"; tool_use_id: string; content: string } {
    if (!content.success) {
      return {
        tool_use_id: toolUseID,
        type: "tool_result",
        content: `Error: ${content.error ?? "Unknown error"}`,
        is_error: true,
      };
    }

    const parts: string[] = [];

    if (content.metadata) {
      const m = content.metadata;
      parts.push(`<video_metadata>`);
      parts.push(`  Duration: ${formatDuration(m.duration)}`);
      parts.push(`  Resolution: ${m.width}x${m.height}`);
      parts.push(`  FPS: ${m.fps}`);
      parts.push(`  Codec: ${m.codec}`);
      parts.push(`  Format: ${m.format}`);
      parts.push(`  Audio: ${m.hasAudio ? "Yes" : "No"}`);
      parts.push(`</video_metadata>`);
    }

    if (content.summary) {
      parts.push(`<summary>\n${content.summary}\n</summary>`);
    }

    if (content.frames && content.frames.length > 0) {
      parts.push(`<frame_analyses count="${content.frames.length}">`);
      for (const frame of content.frames) {
        parts.push(`  <frame index="${frame.index}" timestamp="${frame.timestamp}">`);
        parts.push(`    <description>${frame.description}</description>`);
        if (frame.labels && frame.labels.length > 0) {
          parts.push(`    <labels>${frame.labels.join(", ")}</labels>`);
        }
        if (frame.objects && frame.objects.length > 0) {
          parts.push(`    <objects>${frame.objects.join(", ")}</objects>`);
        }
        if (frame.text) {
          parts.push(`    <text>${frame.text}</text>`);
        }
        parts.push(`  </frame>`);
      }
      parts.push(`</frame_analyses>`);
    }

    if (content.processingTime) {
      parts.push(`Processing time: ${content.processingTime}ms`);
    }

    return {
      tool_use_id: toolUseID,
      type: "tool_result",
      content: parts.join("\n\n"),
    };
  },

  async checkPermissions(): Promise<{ behavior: "allow" }> {
    return { behavior: "allow" };
  },
} satisfies ToolDef<InputSchema, Output>);

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default VideoAnalysisTool;
