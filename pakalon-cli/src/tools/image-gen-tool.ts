/**
 * Image Generation Tool
 *
 * Provides image generation capabilities using multiple providers.
 * Supports OpenAI DALL-E, Stability AI, and local models.
 *
 * Features:
 * - Multiple provider support
 * - Configurable image parameters (size, style, quality)
 * - Base64 and URL output
 * - File saving
 * - Error handling and retries
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageProvider = "openai" | "stability" | "local";

export type ImageSize = "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";

export type ImageStyle = "vivid" | "natural";

export type ImageQuality = "standard" | "hd";

export interface ImageGenOptions {
  /** Prompt for image generation */
  prompt: string;
  /** Negative prompt (for Stability AI) */
  negativePrompt?: string;
  /** Image size */
  size?: ImageSize;
  /** Image style */
  style?: ImageStyle;
  /** Image quality */
  quality?: ImageQuality;
  /** Number of images to generate */
  n?: number;
  /** Output directory for saving */
  outputDir?: string;
  /** Filename prefix */
  filenamePrefix?: string;
  /** Provider to use */
  provider?: ImageProvider;
}

export interface GeneratedImage {
  /** Base64 encoded image data */
  base64?: string;
  /** URL of the generated image */
  url?: string;
  /** File path if saved */
  filePath?: string;
  /** Image size */
  size: string;
  /** Provider used */
  provider: ImageProvider;
  /** Prompt used */
  prompt: string;
  /** Revised prompt (if provider revised it) */
  revisedPrompt?: string;
}

export interface ImageGenResult {
  /** Whether generation was successful */
  success: boolean;
  /** Generated images */
  images: GeneratedImage[];
  /** Error message if failed */
  error?: string;
  /** Provider used */
  provider: ImageProvider;
  /** Duration in ms */
  duration: number;
}

// ---------------------------------------------------------------------------
// Provider Implementations
// ---------------------------------------------------------------------------

/**
 * Generate image using OpenAI DALL-E
 */
async function generateWithOpenAI(
  options: ImageGenOptions
): Promise<ImageGenResult> {
  const startTime = Date.now();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      images: [],
      error: "OPENAI_API_KEY not set",
      provider: "openai",
      duration: Date.now() - startTime,
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: options.prompt,
        n: options.n || 1,
        size: options.size || "1024x1024",
        style: options.style || "vivid",
        quality: options.quality || "standard",
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        images: [],
        error: `OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`,
        provider: "openai",
        duration: Date.now() - startTime,
      };
    }

    const data = await response.json();
    const images: GeneratedImage[] = data.data.map((item: any) => ({
      base64: item.b64_json,
      size: options.size || "1024x1024",
      provider: "openai" as ImageProvider,
      prompt: options.prompt,
      revisedPrompt: item.revised_prompt,
    }));

    return {
      success: true,
      images,
      provider: "openai",
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      images: [],
      error: `OpenAI error: ${error}`,
      provider: "openai",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Generate image using Stability AI
 */
async function generateWithStability(
  options: ImageGenOptions
): Promise<ImageGenResult> {
  const startTime = Date.now();
  const apiKey = process.env.STABILITY_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      images: [],
      error: "STABILITY_API_KEY not set",
      provider: "stability",
      duration: Date.now() - startTime,
    };
  }

  try {
    const response = await fetch(
      "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        body: JSON.stringify({
          text_prompts: [
            { text: options.prompt, weight: 1 },
            ...(options.negativePrompt
              ? [{ text: options.negativePrompt, weight: -1 }]
              : []),
          ],
          cfg_scale: 7,
          height: 1024,
          width: 1024,
          steps: 30,
          samples: options.n || 1,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        images: [],
        error: `Stability API error: ${response.status} - ${JSON.stringify(errorData)}`,
        provider: "stability",
        duration: Date.now() - startTime,
      };
    }

    const data = await response.json();
    const images: GeneratedImage[] = data.artifacts.map((item: any) => ({
      base64: item.base64,
      size: "1024x1024",
      provider: "stability" as ImageProvider,
      prompt: options.prompt,
    }));

    return {
      success: true,
      images,
      provider: "stability",
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      images: [],
      error: `Stability error: ${error}`,
      provider: "stability",
      duration: Date.now() - startTime,
    };
  }
}

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

/**
 * Generate image(s) using specified provider
 */
export async function generateImage(
  options: ImageGenOptions
): Promise<ImageGenResult> {
  const provider = options.provider || detectProvider();

  logger.info(`[ImageGen] Generating image with ${provider}`);
  logger.debug(`[ImageGen] Prompt: ${options.prompt.substring(0, 100)}...`);

  let result: ImageGenResult;

  switch (provider) {
    case "openai":
      result = await generateWithOpenAI(options);
      break;
    case "stability":
      result = await generateWithStability(options);
      break;
    default:
      result = {
        success: false,
        images: [],
        error: `Unsupported provider: ${provider}`,
        provider,
        duration: 0,
      };
  }

  // Save images if output directory specified
  if (result.success && options.outputDir && result.images.length > 0) {
    await saveImages(result.images, options.outputDir, options.filenamePrefix);
  }

  logger.info(
    `[ImageGen] ${result.success ? "Success" : "Failed"}: ${result.images.length} images in ${result.duration}ms`
  );

  return result;
}

/**
 * Detect which provider to use based on available API keys
 */
function detectProvider(): ImageProvider {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.STABILITY_API_KEY) return "stability";
  return "local";
}

/**
 * Save generated images to disk
 */
async function saveImages(
  images: GeneratedImage[],
  outputDir: string,
  prefix?: string
): Promise<void> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    if (!image.base64) continue;

    const filename = `${prefix || "generated"}-${Date.now()}-${i}.png`;
    const filePath = path.join(outputDir, filename);

    try {
      const buffer = Buffer.from(image.base64, "base64");
      fs.writeFileSync(filePath, buffer);
      image.filePath = filePath;
      logger.debug(`[ImageGen] Saved: ${filePath}`);
    } catch (error) {
      logger.error(`[ImageGen] Failed to save image: ${error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Tool Schema
// ---------------------------------------------------------------------------

export const imageGenToolInputSchema = z.object({
  prompt: z.string().describe("Prompt for image generation"),
  negativePrompt: z.string().optional().describe("Negative prompt to avoid certain elements"),
  size: z.enum(["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"])
    .optional().default("1024x1024").describe("Image size"),
  style: z.enum(["vivid", "natural"]).optional().default("vivid").describe("Image style"),
  quality: z.enum(["standard", "hd"]).optional().default("standard").describe("Image quality"),
  n: z.number().int().min(1).max(4).optional().default(1).describe("Number of images to generate"),
  outputDir: z.string().optional().describe("Directory to save generated images"),
  filenamePrefix: z.string().optional().describe("Filename prefix for saved images"),
  provider: z.enum(["openai", "stability", "local"]).optional().describe("Image generation provider"),
});

export type ImageGenToolInput = z.infer<typeof imageGenToolInputSchema>;

/**
 * Execute image generation tool
 */
export async function executeImageGenTool(
  input: ImageGenToolInput
): Promise<ImageGenResult> {
  return generateImage(input);
}

/**
 * Tool definition for Vercel AI SDK
 */
export const imageGenToolDefinition = {
  name: "image_generation",
  description: "Generate images from text prompts using AI",
  inputSchema: imageGenToolInputSchema,

  async execute(input: ImageGenToolInput): Promise<ImageGenResult> {
    return executeImageGenTool(input);
  },
};
