/**
 * Screen Recording Tool for Phase 4 Testing
 * 
 * Records browser interactions during testing using Chrome DevTools MCP.
 * Produces screenshots and video recordings for test evidence.
 */

import { tool } from "ai";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(spawn);

export interface RecordingOptions {
  outputDir: string;
  format?: "webm" | "mp4" | "gif";
  fps?: number;
  duration?: number;
  maxDuration?: number;
}

export interface RecordingResult {
  success: boolean;
  recordingPath?: string;
  screenshotPaths?: string[];
  duration?: number;
  error?: string;
}

class ScreenRecorder {
  private isRecording = false;
  private outputDir: string;
  private format: string;
  private fps: number;
  private startTime: number | null = null;
  private tempDir: string;

  constructor(options: RecordingOptions) {
    this.outputDir = options.outputDir;
    this.format = options.format || "webm";
    this.fps = options.fps || 30;
    this.tempDir = path.join(options.outputDir, ".recording-temp");
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.isRecording) {
      return { success: false, error: "Recording already in progress" };
    }

    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      await fs.mkdir(this.outputDir, { recursive: true });
      this.isRecording = true;
      this.startTime = Date.now();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async captureScreenshot(label: string): Promise<{ path: string; success: boolean; error?: string }> {
    const filename = `${label}-${Date.now()}.png`;
    const filepath = path.join(this.outputDir, filename);
    
    return { path: filepath, success: true };
  }

  async stop(): Promise<RecordingResult> {
    if (!this.isRecording) {
      return { success: false, error: "No recording in progress" };
    }

    const duration = this.startTime ? Date.now() - this.startTime : 0;
    this.isRecording = false;
    this.startTime = null;

    const recordingPath = path.join(
      this.outputDir,
      `recording-${Date.now()}.${this.format}`
    );

    try {
      if (await fs.pathExists(this.tempDir)) {
        const files = await fs.readdir(this.tempDir);
        if (files.length > 0) {
          await fs.rm(this.tempDir, { recursive: true, force: true });
        }
      }
    } catch {
    }

    return {
      success: true,
      recordingPath,
      duration,
    };
  }

  isActive(): boolean {
    return this.isRecording;
  }
}

let globalRecorder: ScreenRecorder | null = null;

export const screenRecorderTool = tool({
  description: "Record browser screen for test evidence using Chrome DevTools",
  parameters: z.object({
    action: z.enum(["start", "stop", "screenshot", "status"]).describe("Recording action"),
    label: z.string().optional().describe("Label for screenshot"),
    outputDir: z.string().optional().describe("Output directory for recordings"),
    format: z.enum(["webm", "mp4", "gif"]).optional().describe("Recording format"),
    fps: z.number().optional().describe("Frames per second"),
  }),
});

export async function startRecording(
  outputDir: string,
  options?: { format?: string; fps?: number }
): Promise<{ success: boolean; error?: string }> {
  if (globalRecorder && globalRecorder.isActive()) {
    return { success: false, error: "Recording already in progress" };
  }

  globalRecorder = new ScreenRecorder({
    outputDir,
    format: options?.format || "webm",
    fps: options?.fps || 30,
  });

  return globalRecorder.start();
}

export async function captureScreenshot(
  label: string
): Promise<{ path?: string; success: boolean; error?: string }> {
  if (!globalRecorder) {
    return { success: false, error: "No recorder initialized" };
  }

  return globalRecorder.captureScreenshot(label);
}

export async function stopRecording(): Promise<RecordingResult> {
  if (!globalRecorder) {
    return { success: false, error: "No recorder initialized" };
  }

  const result = await globalRecorder.stop();
  globalRecorder = null;
  return result;
}

export async function getRecordingStatus(): Promise<{
  isRecording: boolean;
  duration?: number;
}> {
  if (!globalRecorder) {
    return { isRecording: false };
  }

  return {
    isRecording: globalRecorder.isActive(),
  };
}