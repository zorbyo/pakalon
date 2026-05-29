/**
 * TypeScript types for video analysis module.
 */

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  format: string;
  size: number;
  bitrate: number;
  audioCodec?: string;
  hasAudio: boolean;
}

export interface VideoValidationResult {
  valid: boolean;
  path: string;
  format: string;
  size: number;
  metadata?: VideoMetadata;
  error?: string;
  warnings: string[];
}

export interface FrameExtractionOptions {
  maxFrames?: number;
  intervalSeconds?: number;
  fps?: number;
  maxWidth?: number;
  quality?: number;
  outputDir?: string;
}

export interface ExtractedFrame {
  path: string;
  timestamp: number;
  index: number;
  width: number;
  height: number;
  size: number;
}

export interface FrameExtractionResult {
  success: boolean;
  frames: ExtractedFrame[];
  outputDir: string;
  error?: string;
  metadata?: VideoMetadata;
}

export interface VideoAnalysisOptions {
  maxFrames?: number;
  frameIntervalSeconds?: number;
  prompt?: string;
  model?: string;
  apiKey?: string;
  includeTimestamps?: boolean;
  summarize?: boolean;
}

export interface FrameAnalysisResult {
  frameIndex: number;
  timestamp: number;
  description: string;
  labels?: string[];
  objects?: string[];
  text?: string;
}

export interface VideoAnalysisResult {
  success: boolean;
  summary?: string;
  frameAnalyses: FrameAnalysisResult[];
  metadata?: VideoMetadata;
  duration?: number;
  error?: string;
  processingTime?: number;
}

export const SUPPORTED_VIDEO_FORMATS = [
  ".mp4",
  ".webm",
  ".avi",
  ".mov",
  ".mkv",
  ".m4v",
  ".3gp",
  ".wmv",
  ".flv",
] as const;

export type SupportedVideoFormat = (typeof SUPPORTED_VIDEO_FORMATS)[number];

export const MAX_VIDEO_SIZE_MB = 500;
export const MAX_VIDEO_DURATION_SECONDS = 3600;
export const DEFAULT_MAX_FRAMES = 10;
export const DEFAULT_FRAME_INTERVAL_SECONDS = 5;
export const DEFAULT_FRAME_QUALITY = 85;
export const DEFAULT_FRAME_MAX_WIDTH = 1280;
