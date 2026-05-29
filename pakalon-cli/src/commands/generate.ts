/**
 * /generate command — AI image generation (Pro feature).
 * T-IMG-01: Calls the Python image_gen bridge tool.
 *
 * Usage:
 *   /generate <prompt>
 *   /generate <prompt> --size 1792x1024 --quality hd --style vivid
 *   pakalon generate "A minimalist SaaS dashboard" --size 1792x1024
 */
import path from "path";
import { getApiClient } from "@/api/client.js";
import { useStore } from "@/store/index.js";
import logger from "@/utils/logger.js";

export interface GenerateImageOptions {
  prompt: string;
  size?: "1024x1024" | "1792x1024" | "1024x1792";
  quality?: "standard" | "hd";
  style?: "natural" | "vivid";
  /** Project directory (default: cwd) */
  projectDir?: string;
  /** If true, print result path to stdout (non-TUI mode) */
  printMode?: boolean;
}

export interface GenerateImageResult {
  ok: boolean;
  url?: string;
  localPath?: string;
  provider?: string;
  prompt?: string;
  size?: string;
  error?: string;
  planBlocked?: boolean;
}

/**
 * Generate an AI image via the backend bridge.
 * Returns the result with url and local path.
 */
export async function cmdGenerateImage(
  opts: GenerateImageOptions
): Promise<GenerateImageResult> {
  const { prompt, size = "1024x1024", quality = "standard", style = "natural", projectDir } = opts;

  if (!prompt || prompt.trim().length < 3) {
    return { ok: false, error: "Please provide a description (3+ chars) for the image." };
  }

  try {
    const api = getApiClient();
    const res = await api.post<{
      ok: boolean;
      url?: string;
      local_path?: string;
      provider?: string;
      revised_prompt?: string;
      size?: string;
      error?: string;
      plan_blocked?: boolean;
    }>("/tools/generate-image", {
      prompt: prompt.trim(),
      size,
      quality,
      style,
      project_dir: projectDir ?? process.cwd(),
    });

    const d = res.data;

    if (d.plan_blocked) {
      return {
        ok: false,
        planBlocked: true,
        error:
          "[Lock] Image generation is a Pro-only feature.\n" +
          "Upgrade at https://pakalon.com/pricing to unlock it.",
      };
    }

    if (!d.ok || d.error) {
      return { ok: false, error: d.error ?? "Image generation failed." };
    }

    return {
      ok: true,
      url: d.url,
      localPath: d.local_path,
      provider: d.provider,
      prompt: d.revised_prompt ?? prompt,
      size: d.size,
    };
  } catch (err: unknown) {
    // Python bridge has been removed — image generation now requires API route
    logger.error("[generate] API route failed and Python bridge is no longer available", { err: String(err) });
    return {
      ok: false,
      error:
        "Image generation requires the API route.\n" +
        "Ensure the backend is running or use a different image generation service.",
    };
  }
}

/**
 * Print-mode handler: called from yargs `pakalon generate "<prompt>"`.
 */
export async function cmdGeneratePrint(prompt: string, opts: Omit<GenerateImageOptions, "prompt">): Promise<void> {
  console.log(`\n[Art] Generating image: "${prompt}" …\n`);
  const result = await cmdGenerateImage({ prompt, ...opts });

  if (!result.ok) {
    if (result.planBlocked) {
      console.error(result.error);
    } else {
      console.error(`[X] ${result.error}`);
    }
    process.exit(1);
  }

  console.log(`[OK] Image generated!`);
  if (result.provider) console.log(`   Provider  : ${result.provider}`);
  if (result.prompt) console.log(`   Prompt    : ${result.prompt}`);
  if (result.size) console.log(`   Size      : ${result.size}`);
  if (result.url) console.log(`   URL       : ${result.url}`);
  if (result.localPath) console.log(`   Saved to  : ${result.localPath}`);
  console.log();
}
