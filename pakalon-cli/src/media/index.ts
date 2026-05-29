/**
 * Image/video analysis and generation — pure TypeScript via OpenRouter vision API.
 * Replaces Python bridge /tools/analyze_image, /tools/analyze_video,
 * /tools/generate_image, /tools/generate_video.
 */
import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";

// Re-export video analysis modules
export { analyzeVideo, analyzeVideoBatch } from "./videoAnalysis.js";
export { extractFrames, cleanupFrames } from "./videoFrameExtractor.js";
export { validateVideoFile, isSupportedVideoFormat, getVideoMimeType } from "./videoValidator.js";
export * from "./videoTypes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MediaAnalysisResult {
  success: boolean;
  description?: string;
  labels?: string[];
  text?: string;
  error?: string;
}

export interface MediaGenerationOptions {
  prompt: string;
  outputPath?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidance?: number;
}

export interface MediaGenerationResult {
  success: boolean;
  filePath?: string;
  url?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Image Analysis (OpenRouter Vision API)
// ---------------------------------------------------------------------------

/**
 * Analyze an image using OpenRouter's vision-capable models.
 */
export async function analyzeImage(
  imagePath: string,
  apiKey?: string,
): Promise<MediaAnalysisResult> {
  try {
    if (!fs.existsSync(imagePath)) {
      return { success: false, error: `File not found: ${imagePath}` };
    }

    const key = apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    if (!key) {
      return { success: false, error: "OPENROUTER_API_KEY not set" };
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = getMimeType(ext);
    const base64 = imageBuffer.toString("base64");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this image in detail. Describe what you see, including objects, text, colors, composition, and any notable features." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      return { success: false, error: `OpenRouter API returned ${response.status}` };
    }

    const data = await response.json() as any;
    const description = data.choices?.[0]?.message?.content ?? "No analysis available";

    return { success: true, description };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Image Generation (Replicate/fal.ai APIs)
// ---------------------------------------------------------------------------

/**
 * Generate an image from a text prompt using fal.ai or Replicate.
 */
export async function generateImage(options: MediaGenerationOptions): Promise<MediaGenerationResult> {
  const {
    prompt,
    outputPath,
    model = "flux",
    width = 1024,
    height = 1024,
    steps = 28,
    guidance = 3.5,
  } = options;

  const falKey = process.env.FAL_KEY ?? "";
  const replicateKey = process.env.REPLICATE_API_TOKEN ?? "";

  if (!falKey && !replicateKey) {
    return { success: false, error: "Neither FAL_KEY nor REPLICATE_API_TOKEN is set" };
  }

  try {
    // Try fal.ai first
    if (falKey) {
      return await generateWithFal(prompt, falKey, model, width, height, outputPath);
    }

    // Fall back to Replicate
    if (replicateKey) {
      return await generateWithReplicate(prompt, replicateKey, model, steps, guidance, outputPath);
    }

    return { success: false, error: "No generation API key available" };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function generateWithFal(
  prompt: string,
  apiKey: string,
  model: string,
  width: number,
  height: number,
  outputPath?: string,
): Promise<MediaGenerationResult> {
  const modelMap: Record<string, string> = {
    "flux": "fal-ai/flux",
    "flux-schnell": "fal-ai/flux/schnell",
    "flux-pro": "fal-ai/flux-pro",
    "sdxl": "fal-ai/stable-diffusion-xl",
  };

  const falModel = modelMap[model] ?? "fal-ai/flux";

  const response = await fetch(`https://queue.fal.run/${falModel}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Key ${apiKey}`,
    },
    body: JSON.stringify({
      prompt,
      image_size: { width, height },
      num_images: 1,
    }),
  });

  if (!response.ok) {
    return { success: false, error: `fal.ai returned ${response.status}` };
  }

  const data = await response.json() as any;
  const imageUrl = data.images?.[0]?.url;

  if (!imageUrl) {
    return { success: false, error: "No image URL in response" };
  }

  // Download the image
  if (outputPath) {
    const imageResponse = await fetch(imageUrl);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    return { success: true, filePath: outputPath, url: imageUrl };
  }

  return { success: true, url: imageUrl };
}

async function generateWithReplicate(
  prompt: string,
  apiKey: string,
  model: string,
  steps: number,
  guidance: number,
  outputPath?: string,
): Promise<MediaGenerationResult> {
  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Token ${apiKey}`,
    },
    body: JSON.stringify({
      version: "black-forest-labs/flux-schnell",
      input: {
        prompt,
        num_inference_steps: steps,
        guidance_scale: guidance,
      },
    }),
  });

  if (!response.ok) {
    return { success: false, error: `Replicate returned ${response.status}` };
  }

  const data = await response.json() as any;

  // Poll for completion
  let prediction = data;
  while (prediction.status === "starting" || prediction.status === "processing") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { "Authorization": `Token ${apiKey}` },
    });
    prediction = await pollResponse.json();
  }

  const imageUrl = prediction.output?.[0];
  if (!imageUrl) {
    return { success: false, error: "No image URL in prediction output" };
  }

  if (outputPath) {
    const imageResponse = await fetch(imageUrl);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    return { success: true, filePath: outputPath, url: imageUrl };
  }

  return { success: true, url: imageUrl };
}

// ---------------------------------------------------------------------------
// Video Generation (stub — uses same API pattern as image generation)
// ---------------------------------------------------------------------------

/**
 * Generate a video from a text prompt using fal.ai.
 */
export async function generateVideo(options: MediaGenerationOptions): Promise<MediaGenerationResult> {
  const { prompt, outputPath, model = "minimax" } = options;

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) {
    return { success: false, error: "FAL_KEY not set (required for video generation)" };
  }

  try {
    const modelMap: Record<string, string> = {
      "minimax": "fal-ai/minimax-video",
      "wan": "fal-ai/wan-video",
      "runway": "fal-ai/runway-gen3",
      "svd": "fal-ai/stable-video-diffusion",
    };

    const falModel = modelMap[model] ?? "fal-ai/minimax-video";

    const response = await fetch(`https://queue.fal.run/${falModel}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${falKey}`,
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      return { success: false, error: `fal.ai returned ${response.status}` };
    }

    const data = await response.json() as any;
    const videoUrl = data.video?.url ?? data.url;

    if (!videoUrl) {
      return { success: false, error: "No video URL in response" };
    }

    if (outputPath) {
      const videoResponse = await fetch(videoUrl);
      const buffer = Buffer.from(await videoResponse.arrayBuffer());
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, buffer);
      return { success: true, filePath: outputPath, url: videoUrl };
    }

    return { success: true, url: videoUrl };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}
