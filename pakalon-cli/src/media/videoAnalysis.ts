/**
 * Core video analysis engine — extracts frames and analyzes with AI vision models.
 */
import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";
import { validateVideoFile } from "./videoValidator.js";
import { extractFrames, cleanupFrames } from "./videoFrameExtractor.js";
import {
  DEFAULT_MAX_FRAMES,
  DEFAULT_FRAME_INTERVAL_SECONDS,
  type VideoAnalysisOptions,
  type VideoAnalysisResult,
  type FrameAnalysisResult,
  type VideoValidationResult,
} from "./videoTypes.js";

const DEFAULT_ANALYSIS_PROMPT =
  "Analyze this video frame in detail. Describe the scene, objects, people, text, colors, composition, and any notable features. Be specific and concise.";

const DEFAULT_SUMMARIZE_PROMPT =
  "Based on the following frame-by-frame analysis of a video, provide a comprehensive summary of the video content. Include key events, visual themes, and notable details. Be concise but thorough.";

export async function analyzeVideo(
  videoPath: string,
  options: VideoAnalysisOptions = {},
): Promise<VideoAnalysisResult> {
  const startTime = Date.now();
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";

  if (!apiKey) {
    return {
      success: false,
      frameAnalyses: [],
      error: "OPENROUTER_API_KEY not set. Provide via options.apiKey or environment variable.",
    };
  }

  const validation: VideoValidationResult = await validateVideoFile(videoPath);
  if (!validation.valid) {
    return {
      success: false,
      frameAnalyses: [],
      error: validation.error,
    };
  }

  let frameOutputDir: string | undefined;

  try {
    const extractionResult = await extractFrames(videoPath, {
      maxFrames,
      intervalSeconds: options.frameIntervalSeconds ?? DEFAULT_FRAME_INTERVAL_SECONDS,
    });

    if (!extractionResult.success) {
      return {
        success: false,
        frameAnalyses: [],
        error: extractionResult.error,
        metadata: extractionResult.metadata,
      };
    }

    frameOutputDir = extractionResult.outputDir;
    const frames = extractionResult.frames;

    logger.info(`Analyzing ${frames.length} frames from ${path.basename(videoPath)}`);

    const frameAnalyses: FrameAnalysisResult[] = [];
    const analysisPrompt = options.prompt ?? DEFAULT_ANALYSIS_PROMPT;
    const model = options.model ?? "google/gemini-2.0-flash-001";

    for (const frame of frames) {
      const analysis = await analyzeFrame(frame.path, analysisPrompt, apiKey, model);
      frameAnalyses.push({
        frameIndex: frame.index,
        timestamp: frame.timestamp,
        description: analysis.description,
        labels: analysis.labels,
        objects: analysis.objects,
        text: analysis.text,
      });
    }

    let summary: string | undefined;
    if (options.summarize !== false && frameAnalyses.length > 1) {
      summary = await generateSummary(frameAnalyses, apiKey, model);
    } else if (frameAnalyses.length === 1) {
      summary = frameAnalyses[0]?.description;
    }

    const processingTime = Date.now() - startTime;

    return {
      success: true,
      summary,
      frameAnalyses,
      metadata: extractionResult.metadata,
      duration: extractionResult.metadata?.duration,
      processingTime,
    };
  } catch (err) {
    return {
      success: false,
      frameAnalyses: [],
      error: String(err),
      processingTime: Date.now() - startTime,
    };
  } finally {
    if (frameOutputDir) {
      await cleanupFrames(frameOutputDir);
    }
  }
}

async function analyzeFrame(
  framePath: string,
  prompt: string,
  apiKey: string,
  model: string,
): Promise<{ description: string; labels?: string[]; objects?: string[]; text?: string }> {
  try {
    const imageBuffer = fs.readFileSync(framePath);
    const base64 = imageBuffer.toString("base64");
    const mimeType = "image/jpeg";

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://pakalon.com",
        "X-Title": "Pakalon CLI",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
            ],
          },
        ],
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        description: `[API error: ${response.status}] ${errorText.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    const description = choices?.[0]?.message?.content ?? "No analysis available";

    const labels = extractLabels(description);
    const objects = extractObjects(description);
    const text = extractText(description);

    return { description, labels, objects, text };
  } catch (err) {
    return { description: `[Frame analysis failed: ${err}]` };
  }
}

async function generateSummary(
  frameAnalyses: FrameAnalysisResult[],
  apiKey: string,
  model: string,
): Promise<string> {
  try {
    const frameDescriptions = frameAnalyses
      .map(
        (fa) =>
          `[${formatTimestamp(fa.timestamp)}] Frame ${fa.frameIndex}: ${fa.description}`,
      )
      .join("\n\n");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://pakalon.com",
        "X-Title": "Pakalon CLI",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: `${DEFAULT_SUMMARIZE_PROMPT}\n\nFrame analyses:\n${frameDescriptions}`,
          },
        ],
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      return `[Summary generation failed: ${response.status}]`;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content ?? "No summary available";
  } catch (err) {
    return `[Summary generation failed: ${err}]`;
  }
}

function extractLabels(description: string): string[] {
  const labels: string[] = [];
  const patterns = [
    /(?:label|category|type):\s*([^\n,]+)/gi,
    /(?:scene|setting|environment):\s*([^\n.]+)/gi,
  ];
  for (const pattern of patterns) {
    const matches = description.match(pattern);
    if (matches) {
      labels.push(...matches.map((m) => m.replace(pattern, "$1").trim()));
    }
  }
  return [...new Set(labels)].slice(0, 10);
}

function extractObjects(description: string): string[] {
  const objects: string[] = [];
  const objectPatterns = [
    /\b(?:car|vehicle|person|people|building|tree|trees|dog|cat|animal|bird|water|mountain|sky|cloud|sun|moon|road|street|house|window|door|table|chair|computer|phone|book|plant|flower|food|plate|cup|bottle)\b/gi,
  ];
  for (const pattern of objectPatterns) {
    const matches = description.match(pattern);
    if (matches) {
      objects.push(...matches.map((m) => m.toLowerCase()));
    }
  }
  return [...new Set(objects)].slice(0, 20);
}

function extractText(description: string): string | undefined {
  const textMatch = description.match(/(?:text|words|sign|label|writing|caption)[:\s]+([^\n.]+)/i);
  return textMatch?.[1]?.trim();
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export async function analyzeVideoBatch(
  videoPaths: string[],
  options: VideoAnalysisOptions = {},
): Promise<Map<string, VideoAnalysisResult>> {
  const results = new Map<string, VideoAnalysisResult>();

  for (const videoPath of videoPaths) {
    const result = await analyzeVideo(videoPath, options);
    results.set(videoPath, result);
  }

  return results;
}
