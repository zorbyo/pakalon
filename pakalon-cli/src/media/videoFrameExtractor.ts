/**
 * Video frame extraction using ffmpeg.
 * Extracts frames at configurable intervals for AI analysis.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";
import {
  DEFAULT_MAX_FRAMES,
  DEFAULT_FRAME_INTERVAL_SECONDS,
  DEFAULT_FRAME_QUALITY,
  DEFAULT_FRAME_MAX_WIDTH,
  type FrameExtractionOptions,
  type FrameExtractionResult,
  type ExtractedFrame,
  type VideoMetadata,
} from "./videoTypes.js";

export async function extractFrames(
  videoPath: string,
  options: FrameExtractionOptions = {},
): Promise<FrameExtractionResult> {
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const intervalSeconds = options.intervalSeconds ?? DEFAULT_FRAME_INTERVAL_SECONDS;
  const quality = options.quality ?? DEFAULT_FRAME_QUALITY;
  const maxWidth = options.maxWidth ?? DEFAULT_FRAME_MAX_WIDTH;
  const outputDir = options.outputDir ?? createTempDir();

  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    return {
      success: false,
      frames: [],
      outputDir,
      error: `Cannot create output directory: ${err}`,
    };
  }

  const metadata = await getVideoDuration(videoPath);
  if (!metadata || metadata.duration <= 0) {
    return {
      success: false,
      frames: [],
      outputDir,
      error: "Cannot determine video duration",
    };
  }

  const framePaths: string[] = [];
  const timestamps: number[] = [];
  const totalFrames = Math.min(
    maxFrames,
    Math.ceil(metadata.duration / intervalSeconds),
  );

  for (let i = 0; i < totalFrames; i++) {
    const timestamp = i * intervalSeconds;
    if (timestamp >= metadata.duration) break;
    timestamps.push(timestamp);

    const frameName = `frame_${String(i).padStart(4, "0")}.jpg`;
    const framePath = path.join(outputDir, frameName);

    const success = await extractSingleFrame(videoPath, timestamp, framePath, quality, maxWidth);
    if (success) {
      framePaths.push(framePath);
    } else {
      logger.warn(`Failed to extract frame at ${timestamp}s`);
    }
  }

  if (framePaths.length === 0) {
    return {
      success: false,
      frames: [],
      outputDir,
      error: "No frames could be extracted",
    };
  }

  const frames: ExtractedFrame[] = [];
  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i]!;
    try {
      const stat = fs.statSync(framePath);
      const dims = getImageDimensions(framePath);
      frames.push({
        path: framePath,
        timestamp: timestamps[i] ?? 0,
        index: i,
        width: dims.width,
        height: dims.height,
        size: stat.size,
      });
    } catch {
      frames.push({
        path: framePath,
        timestamp: timestamps[i] ?? 0,
        index: i,
        width: 0,
        height: 0,
        size: 0,
      });
    }
  }

  logger.info(`Extracted ${frames.length} frames from ${path.basename(videoPath)}`);

  return {
    success: true,
    frames,
    outputDir,
    metadata,
  };
}

async function extractSingleFrame(
  videoPath: string,
  startSeconds: number,
  outputPath: string,
  quality: number,
  maxWidth: number,
): Promise<boolean> {
  try {
    const { executeBash } = await import("@/tools/bash.js");

    const scaleFilter = `scale='min(${maxWidth},iw)':'-2'`;
    const command = [
      `ffmpeg`,
      `-v quiet`,
      `-ss ${startSeconds}`,
      `-i "${videoPath}"`,
      `-vframes 1`,
      `-vf "${scaleFilter}"`,
      `-q:v ${quality}`,
      `-y`,
      `"${outputPath}"`,
    ].join(" ");

    const result = await executeBash({
      command,
      timeout: 30000,
    });

    if (result.exitCode !== 0) {
      logger.warn(`ffmpeg stderr: ${result.stderr}`);
      return false;
    }

    return fs.existsSync(outputPath);
  } catch (err) {
    logger.warn(`Frame extraction failed: ${err}`);
    return false;
  }
}

async function getVideoDuration(videoPath: string): Promise<VideoMetadata | undefined> {
  try {
    const { executeBash } = await import("@/tools/bash.js");

    const result = await executeBash({
      command: `ffprobe -v quiet -print_format json -show_format "${videoPath}"`,
      timeout: 15000,
    });

    if (result.exitCode !== 0 || !result.stdout) {
      return undefined;
    }

    const probe = JSON.parse(result.stdout);
    const format = probe.format ?? {};
    const duration = parseFloat(format.duration ?? "0");

    if (isNaN(duration) || duration <= 0) {
      return undefined;
    }

    return {
      duration,
      width: 0,
      height: 0,
      fps: 0,
      codec: "unknown",
      format: String(format.format_name ?? "unknown"),
      size: parseInt(String(format.size ?? 0), 10),
      bitrate: parseInt(String(format.bit_rate ?? 0), 10),
      hasAudio: false,
    };
  } catch {
    return undefined;
  }
}

function getImageDimensions(imagePath: string): { width: number; height: number } {
  try {
    const buffer = fs.readFileSync(imagePath);
    if (buffer.length < 24) return { width: 0, height: 0 };

    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let i = 2;
      while (i < buffer.length - 1) {
        if (buffer[i] === 0xff) {
          const marker = buffer[i + 1];
          if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
            const height = (buffer[i + 5]! << 8) | buffer[i + 6]!;
            const width = (buffer[i + 7]! << 8) | buffer[i + 8]!;
            return { width, height };
          }
          i += (buffer[i + 2]! << 8) | buffer[i + 3]!;
        } else {
          i++;
        }
      }
    }
  } catch {
    // ignore
  }
  return { width: 0, height: 0 };
}

function createTempDir(): string {
  const tmpBase = path.join(os.tmpdir(), "pakalon-video");
  if (!fs.existsSync(tmpBase)) {
    fs.mkdirSync(tmpBase, { recursive: true });
  }
  return fs.mkdtempSync(path.join(tmpBase, "frames_"));
}

export async function cleanupFrames(outputDir: string): Promise<void> {
  try {
    if (outputDir.startsWith(os.tmpdir()) || outputDir.includes("pakalon-video")) {
      fs.rmSync(outputDir, { recursive: true, force: true });
      logger.info(`Cleaned up frame directory: ${outputDir}`);
    }
  } catch (err) {
    logger.warn(`Failed to cleanup frames: ${err}`);
  }
}
