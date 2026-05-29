/**
 * /image command - Generate images from text prompts
 *
 * Usage:
 *   /image <prompt> - Generate an image from a text description
 *   /image <prompt> --size 512x512 - Specify size
 *   /image <prompt> --style natural - Specify style
 *   /image <prompt> --provider openai - Specify provider
 */

import { executeImageGenTool } from "@/tools/image-gen-tool.js";
import type { CommandDefinition } from "./types.js";
import logger from "@/utils/logger.js";

export const imageCommandDefinition: CommandDefinition = {
  name: "image",
  description: "Generate images from text prompts using AI",
  usage: "/image <prompt> [--size 1024x1024] [--style vivid] [--provider openai]",
  category: "advanced",
  requiresAuth: true,
  async execute(_context, args) {
    if (args.length === 0) {
      return {
        success: false,
        message: "Usage: /image <prompt>\n\nOptions:\n  --size <size>     Image size (256x256, 512x512, 1024x1024)\n  --style <style>   Style (vivid, natural)\n  --provider <p>    Provider (openai, stability)\n  --n <count>       Number of images (1-4)",
      };
    }

    // Parse arguments
    const promptParts: string[] = [];
    let size: string | undefined;
    let style: string | undefined;
    let provider: string | undefined;
    let n = 1;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--size" && args[i + 1]) {
        size = args[++i] as any;
      } else if (arg === "--style" && args[i + 1]) {
        style = args[++i] as any;
      } else if (arg === "--provider" && args[i + 1]) {
        provider = args[++i] as any;
      } else if (arg === "--n" && args[i + 1]) {
        n = parseInt(args[++i]) || 1;
      } else {
        promptParts.push(arg);
      }
    }

    const prompt = promptParts.join(" ");
    if (!prompt) {
      return {
        success: false,
        message: "Please provide a prompt for image generation.",
      };
    }

    try {
      logger.info(`[image] Generating image: ${prompt.substring(0, 50)}...`);

      const result = await executeImageGenTool({
        prompt,
        size: size as any,
        style: style as any,
        provider: provider as any,
        n,
        outputDir: process.cwd(),
        filenamePrefix: "pakalon-generated",
      });

      if (!result.success) {
        return {
          success: false,
          message: `Image generation failed: ${result.error}`,
        };
      }

      const imageInfo = result.images.map((img, i) => 
        `Image ${i + 1}: ${img.filePath || "URL only"} (${img.size})`
      ).join("\n");

      return {
        success: true,
        message: [
          `Generated ${result.images.length} image(s) using ${result.provider}`,
          `Duration: ${result.duration}ms`,
          "",
          imageInfo,
        ].join("\n"),
        data: {
          images: result.images.map(img => ({
            filePath: img.filePath,
            size: img.size,
            provider: img.provider,
          })),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[image] Generation failed: ${message}`);
      return {
        success: false,
        message: `Image generation error: ${message}`,
      };
    }
  },
};
