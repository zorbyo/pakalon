/**
 * Screen Recording — records terminal sessions for Phase 4 testing evidence.
 * 
 * Uses FFmpeg to capture terminal output as video.
 * Supports:
 * - Start/stop recording
 * - Pause/resume
 * - Capture to file
 * - Generate proof of test execution
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

export interface RecordingOptions {
  outputPath?: string;
  format?: "mp4" | "webm" | "gif";
  fps?: number;
  quality?: "low" | "medium" | "high";
  includeAudio?: boolean;
}

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  outputPath: string | null;
  fileSize: number;
}

const QUALITY_PRESETS = {
  low: { crf: 28, preset: "veryfast" },
  medium: { crf: 23, preset: "medium" },
  high: { crf: 18, preset: "slow" },
};

const FORMAT_EXTENSIONS = {
  mp4: "mp4",
  webm: "webm",
  gif: "gif",
};

class ScreenRecorder {
  private process: ChildProcess | null = null;
  private state: RecordingState = {
    isRecording: false,
    isPaused: false,
    duration: 0,
    outputPath: null,
    fileSize: 0,
  };
  private startTime: number = 0;
  private pausedDuration: number = 0;
  private pauseStartTime: number = 0;
  private outputPath: string | null = null;
  private options: RecordingOptions;

  constructor(options: RecordingOptions = {}) {
    this.options = {
      outputPath: path.join(os.tmpdir(), `pakalon-recording-${randomUUID()}`),
      format: "mp4",
      fps: 30,
      quality: "medium",
      includeAudio: false,
      ...options,
    };
  }

  async start(): Promise<{ success: boolean; outputPath: string; error?: string }> {
    if (this.state.isRecording) {
      return { success: false, outputPath: "", error: "Already recording" };
    }

    try {
      const extension = FORMAT_EXTENSIONS[this.options.format ?? "mp4"];
      const outputFile = `${this.options.outputPath}.${extension}`;
      this.outputPath = outputFile;

      if (!this.isFFmpegAvailable()) {
        return {
          success: false,
          outputPath: "",
          error: "FFmpeg not installed. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)",
        };
      }

      const preset = QUALITY_PRESETS[this.options.quality ?? "medium"];
      
      const args = this.buildFFmpegArgs(outputFile, preset);
      
      this.process = spawn("ffmpeg", args, {
        stdio: "ignore",
        detached: false,
      });

      this.process.on("error", (err) => {
        console.error("Recording error:", err);
        this.state.isRecording = false;
      });

      this.process.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.error(`Recording exited with code ${code}`);
        }
        this.state.isRecording = false;
      });

      this.startTime = Date.now();
      this.pausedDuration = 0;
      this.state.isRecording = true;
      this.state.isPaused = false;
      this.state.outputPath = outputFile;

      this.startDurationMonitor();

      return { success: true, outputPath: outputFile };
    } catch (error) {
      return {
        success: false,
        outputPath: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  pause(): boolean {
    if (!this.state.isRecording || this.state.isPaused) {
      return false;
    }

    try {
      if (this.process && !this.process.killed) {
        this.process.kill("SIGSTOP");
      }
      this.pauseStartTime = Date.now();
      this.state.isPaused = true;
      return true;
    } catch {
      return false;
    }
  }

  resume(): boolean {
    if (!this.state.isRecording || !this.state.isPaused) {
      return false;
    }

    try {
      if (this.process && !this.process.killed) {
        this.process.kill("SIGCONT");
      }
      this.pausedDuration += Date.now() - this.pauseStartTime;
      this.state.isPaused = false;
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<{ success: boolean; outputPath: string; duration: number; fileSize: number }> {
    if (!this.state.isRecording) {
      return { success: false, outputPath: "", duration: 0, fileSize: 0 };
    }

    const duration = this.getDuration();

    try {
      if (this.process && !this.process.killed) {
        this.process.kill("SIGTERM");
        await this.waitForProcessExit(this.process);
      }

      this.state.isRecording = false;
      this.state.isPaused = false;

      let fileSize = 0;
      if (this.outputPath && fs.existsSync(this.outputPath)) {
        const stats = fs.statSync(this.outputPath);
        fileSize = stats.size;
      }

      return {
        success: true,
        outputPath: this.outputPath ?? "",
        duration,
        fileSize,
      };
    } catch (error) {
      return {
        success: false,
        outputPath: this.outputPath ?? "",
        duration,
        fileSize: 0,
      };
    }
  }

  getState(): RecordingState {
    return {
      ...this.state,
      duration: this.getDuration(),
      fileSize: this.outputPath && fs.existsSync(this.outputPath)
        ? fs.statSync(this.outputPath).size
        : 0,
    };
  }

  private getDuration(): number {
    if (!this.startTime) return 0;
    const elapsed = Date.now() - this.startTime - this.pausedDuration;
    return Math.max(0, elapsed);
  }

  private isFFmpegAvailable(): boolean {
    try {
      execSync("which ffmpeg", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  private buildFFmpegArgs(outputFile: string, preset: { crf: number; preset: string }): string[] {
    const args = [
      "-f", "avfoundation",
      "-i", this.getScreenInput(),
      "-c:v", this.options.format === "gif" ? "gif" : "libx264",
      "-crf", String(preset.crf),
      "-preset", preset.preset,
      "-pix_fmt", "yuv420p",
      "-r", String(this.options.fps),
    ];

    if (this.options.format === "gif") {
      args.push("-loop", "0");
    }

    args.push("-y", outputFile);

    return args;
  }

  private getScreenInput(): string {
    if (process.platform === "darwin") {
      return "1:0";
    }
    if (process.platform === "linux") {
      return ":0.0";
    }
    if (process.platform === "win32") {
      return "desktop";
    }
    return "";
  }

  private startDurationMonitor(): void {
    const interval = setInterval(() => {
      if (!this.state.isRecording) {
        clearInterval(interval);
        return;
      }
      this.state.duration = this.getDuration();
    }, 1000);
  }

  private waitForProcessExit(process: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      process.on("exit", () => resolve());
      setTimeout(() => resolve(), 2000);
    });
  }
}

let globalRecorder: ScreenRecorder | null = null;

export function startRecording(options?: RecordingOptions): Promise<{ success: boolean; outputPath: string; error?: string }> {
  if (globalRecorder?.getState().isRecording) {
    return Promise.resolve({ success: false, outputPath: "", error: "Already recording" });
  }
  globalRecorder = new ScreenRecorder(options);
  return globalRecorder.start();
}

export function pauseRecording(): boolean {
  return globalRecorder?.pause() ?? false;
}

export function resumeRecording(): boolean {
  return globalRecorder?.resume() ?? false;
}

export function stopRecording(): Promise<{ success: boolean; outputPath: string; duration: number; fileSize: number }> {
  if (!globalRecorder) {
    return Promise.resolve({ success: false, outputPath: "", duration: 0, fileSize: 0 });
  }
  const result = await globalRecorder.stop();
  globalRecorder = null;
  return result;
}

export function getRecordingState(): RecordingState | null {
  return globalRecorder?.getState() ?? null;
}

export function isRecording(): boolean {
  return globalRecorder?.getState().isRecording ?? false;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export { ScreenRecorder };