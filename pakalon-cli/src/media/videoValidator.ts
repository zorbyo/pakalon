/**
 * Video file validation — checks format, size, and accessibility.
 */
import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";
import {
  SUPPORTED_VIDEO_FORMATS,
  MAX_VIDEO_SIZE_MB,
  MAX_VIDEO_DURATION_SECONDS,
  type VideoValidationResult,
  type VideoMetadata,
} from "./videoTypes.js";

export function isSupportedVideoFormat(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return (SUPPORTED_VIDEO_FORMATS as readonly string[]).includes(ext);
}

export function getVideoMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".m4v": "video/x-m4v",
    ".3gp": "video/3gpp",
    ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}

export async function validateVideoFile(
  videoPath: string,
  options?: { maxSizeMB?: number; maxDurationSeconds?: number },
): Promise<VideoValidationResult> {
  const warnings: string[] = [];
  const maxSizeMB = options?.maxSizeMB ?? MAX_VIDEO_SIZE_MB;
  const maxDurationSeconds = options?.maxDurationSeconds ?? MAX_VIDEO_DURATION_SECONDS;

  if (!path.isAbsolute(videoPath)) {
    videoPath = path.resolve(videoPath);
  }

  if (!fs.existsSync(videoPath)) {
    return {
      valid: false,
      path: videoPath,
      format: "",
      size: 0,
      error: `File not found: ${videoPath}`,
      warnings,
    };
  }

  const ext = path.extname(videoPath).toLowerCase();
  if (!isSupportedVideoFormat(videoPath)) {
    return {
      valid: false,
      path: videoPath,
      format: ext,
      size: 0,
      error: `Unsupported video format: ${ext}. Supported: ${SUPPORTED_VIDEO_FORMATS.join(", ")}`,
      warnings,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(videoPath);
  } catch (err) {
    return {
      valid: false,
      path: videoPath,
      format: ext,
      size: 0,
      error: `Cannot read file: ${err}`,
      warnings,
    };
  }

  const sizeMB = stat.size / (1024 * 1024);
  if (sizeMB > maxSizeMB) {
    return {
      valid: false,
      path: videoPath,
      format: ext,
      size: stat.size,
      error: `Video too large: ${sizeMB.toFixed(1)}MB (max: ${maxSizeMB}MB)`,
      warnings,
    };
  }

  if (stat.size === 0) {
    return {
      valid: false,
      path: videoPath,
      format: ext,
      size: 0,
      error: "Video file is empty (0 bytes)",
      warnings,
    };
  }

  let metadata: VideoMetadata | undefined;
  try {
    metadata = await getVideoMetadata(videoPath);
    if (metadata) {
      if (metadata.duration > maxDurationSeconds) {
        warnings.push(
          `Video is long (${formatDuration(metadata.duration)}). Analysis may take a while.`,
        );
      }
      if (metadata.width > 4096 || metadata.height > 4096) {
        warnings.push(
          `Very high resolution (${metadata.width}x${metadata.height}). Frames will be downscaled.`,
        );
      }
    }
  } catch (err) {
    warnings.push(`Could not read video metadata: ${err}`);
  }

  logger.info(`Video validated: ${path.basename(videoPath)} (${ext}, ${(sizeMB).toFixed(1)}MB)`);

  return {
    valid: true,
    path: videoPath,
    format: ext,
    size: stat.size,
    metadata,
    warnings,
  };
}

async function getVideoMetadata(videoPath: string): Promise<VideoMetadata | undefined> {
  try {
    const { executeBash } = await import("@/tools/bash.js");

    const result = await executeBash({
      command: `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`,
      timeout: 15000,
    });

    if (result.exitCode !== 0 || !result.stdout) {
      return undefined;
    }

    const probe = JSON.parse(result.stdout);
    const videoStream = probe.streams?.find(
      (s: Record<string, unknown>) => s.codec_type === "video",
    );
    const format = probe.format ?? {};

    if (!videoStream) {
      return undefined;
    }

    const duration = parseFloat(format.duration ?? "0");
    const fps = parseFps(videoStream.r_frame_rate);

    return {
      duration: isNaN(duration) ? 0 : duration,
      width: parseInt(String(videoStream.width ?? 0), 10),
      height: parseInt(String(videoStream.height ?? 0), 10),
      fps,
      codec: String(videoStream.codec_name ?? "unknown"),
      format: String(format.format_name ?? "unknown"),
      size: parseInt(String(format.size ?? 0), 10),
      bitrate: parseInt(String(format.bit_rate ?? 0), 10),
      audioCodec: probe.streams?.find(
        (s: Record<string, unknown>) => s.codec_type === "audio",
      )?.codec_name,
      hasAudio: probe.streams?.some(
        (s: Record<string, unknown>) => s.codec_type === "audio",
      ) ?? false,
    };
  } catch {
    return undefined;
  }
}

function parseFps(frameRate: string): number {
  if (!frameRate) return 0;
  const parts = frameRate.split("/");
  if (parts.length === 2) {
    const num = parseFloat(parts[0] ?? "0");
    const den = parseFloat(parts[1] ?? "1");
    return den !== 0 ? num / den : 0;
  }
  return parseFloat(frameRate) || 0;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
