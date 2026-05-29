/**
 * /analyze-video command — Analyze video files using AI vision models.
 * Extracts frames and provides detailed video content analysis.
 */
import path from "path";
import fs from "fs";
import { analyzeVideo } from "@/media/videoAnalysis.js";
import { validateVideoFile } from "@/media/videoValidator.js";
import logger from "@/utils/logger.js";
import type { CommandContext, CommandResult } from "./types.js";

export interface AnalyzeVideoOptions {
  maxFrames?: number;
  frameInterval?: number;
  prompt?: string;
  summarize?: boolean;
}

function isSuccessfulAnalysis(message: string): boolean {
  return !message.startsWith("Error:") && !message.startsWith("Analysis failed:");
}

export async function cmdAnalyzeVideo(
  videoPath: string,
  options: AnalyzeVideoOptions = {}
): Promise<string> {
  // Validate input
  if (!videoPath) {
    return `Usage: /analyze-video <path-to-video> [options]

Options:
  --max-frames <n>     Maximum frames to extract (default: 8)
  --interval <sec>     Frame extraction interval in seconds (default: 2)
  --prompt <text>     Custom prompt for frame analysis
  --summarize          Generate overall video summary

Example:
  /analyze-video ./video.mp4
  /analyze-video ./video.mp4 --max-frames 10 --summarize
`;
  }

  // Resolve path
  const resolvedPath = path.resolve(process.cwd(), videoPath);

  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File not found: ${resolvedPath}`;
  }

  // Validate video file
  const validation = await validateVideoFile(resolvedPath);
  if (!validation.valid) {
    return `Error: Invalid video file - ${validation.error}`;
  }

  try {
    // Get API key
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    if (!apiKey) {
      return "Error: No API key configured. Please set OPENROUTER_API_KEY or run /config to set up.";
    }

    // Analyze the video
    const result = await analyzeVideo(resolvedPath, {
      apiKey,
      maxFrames: options.maxFrames ?? 8,
      frameIntervalSeconds: options.frameInterval ?? 2,
      prompt: options.prompt,
      summarize: options.summarize ?? true,
    });

    if (!result.success) {
      return `Analysis failed: ${result.error}`;
    }

    // Format the output
    let output = `\n[Video] Video Analysis: ${path.basename(resolvedPath)}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (result.summary) {
      output += `[Memo] Summary:\n${result.summary}\n\n`;
    }

    output += `[Chart] Frame Analysis (${result.frameAnalyses.length} frames analyzed):\n`;
    output += `──────────────────────────────────────────────────\n`;

    for (let i = 0; i < result.frameAnalyses.length; i++) {
      const frame = result.frameAnalyses[i]!;
      const timestamp = frame.timestamp
        ? ` at ${Math.floor(frame.timestamp / 60)}m ${Math.floor(frame.timestamp % 60)}s`
        : "";
      output += `\n[Frame ${i + 1}${timestamp}]\n`;
      output += `${frame.description}\n`;
    }

    output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `Analysis completed in ${result.processingTime ?? 0}ms\n`;

    return output;
  } catch (error) {
    logger.error("Video analysis failed:", error);
    return `Error analyzing video: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Command definition for CLI mode
export const analyzeVideoCommand = {
  name: "analyze-video",
  description: "Analyze a video file using AI vision models",
  usage: "/analyze-video <path> [options]",
  execute: async (_context: CommandContext, args: string[]): Promise<CommandResult> => {
    // Parse options
    const options: AnalyzeVideoOptions = {};
    const fileArgs: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.startsWith("--")) {
        const nextArg = args[i + 1];
        if (arg === "--max-frames" && nextArg && !nextArg.startsWith("--")) {
          options.maxFrames = parseInt(nextArg, 10);
          i++;
        } else if (arg === "--interval" && nextArg && !nextArg.startsWith("--")) {
          options.frameInterval = parseInt(nextArg, 10);
          i++;
        } else if (arg === "--prompt" && nextArg && !nextArg.startsWith("--")) {
          options.prompt = nextArg;
          i++;
        } else if (arg === "--summarize") {
          options.summarize = true;
        }
      } else if (!arg.startsWith("-")) {
        fileArgs.push(arg);
      }
    }

    if (fileArgs.length === 0) {
      const message = await cmdAnalyzeVideo("");
      return {
        success: false,
        message,
      };
    }

    const message = await cmdAnalyzeVideo(fileArgs[0]!, options);
    return {
      success: isSuccessfulAnalysis(message),
      message,
    };
  },
};

export default analyzeVideoCommand;
