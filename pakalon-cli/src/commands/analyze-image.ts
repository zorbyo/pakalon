/**
 * /analyze-image command — Analyze image files using AI vision models.
 * Provides detailed description of image content.
 */
import path from "path";
import fs from "fs";
import { analyzeImage } from "@/media/index.js";
import logger from "@/utils/logger.js";
import type { CommandContext, CommandResult } from "./types.js";

function isSuccessfulAnalysis(message: string): boolean {
  return !message.startsWith("Error:") && !message.startsWith("Analysis failed:");
}

export async function cmdAnalyzeImage(imagePath: string): Promise<string> {
  // Validate input
  if (!imagePath) {
    return `Usage: /analyze-image <path-to-image>

Example:
  /analyze-image ./screenshot.png
  /analyze-image ./photo.jpg
`;
  }

  // Resolve path
  const resolvedPath = path.resolve(process.cwd(), imagePath);

  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File not found: ${resolvedPath}`;
  }

  // Validate file extension
  const ext = path.extname(resolvedPath).toLowerCase();
  const validExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"];
  if (!validExtensions.includes(ext)) {
    return `Error: Unsupported file format: ${ext}\nSupported formats: ${validExtensions.join(", ")}`;
  }

  try {
    // Get API key
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    if (!apiKey) {
      return "Error: No API key configured. Please set OPENROUTER_API_KEY or run /config to set up.";
    }

    // Analyze the image
    const result = await analyzeImage(resolvedPath, apiKey);

    if (!result.success) {
      return `Analysis failed: ${result.error}`;
    }

    // Format the output
    let output = `\n[Image] Image Analysis: ${path.basename(resolvedPath)}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    output += `${result.description}\n`;
    output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    return output;
  } catch (error) {
    logger.error("Image analysis failed:", error);
    return `Error analyzing image: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Command definition for CLI mode
export const analyzeImageCommand = {
  name: "analyze-image",
  description: "Analyze an image file using AI vision models",
  usage: "/analyze-image <path>",
  execute: async (_context: CommandContext, args: string[]): Promise<CommandResult> => {
    const message = args.length === 0
      ? await cmdAnalyzeImage("")
      : await cmdAnalyzeImage(args[0]!);
    return {
      success: isSuccessfulAnalysis(message),
      message,
    };
  },
};

export default analyzeImageCommand;
