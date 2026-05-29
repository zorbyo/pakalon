/**
 * Session Backgrounding - Continue sessions in the background
 * 
 * Allows sessions to run in the background while the user
 * continues with other tasks or sessions.
 */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

export interface BackgroundSession {
  id: string;
  sessionId: string;
  startedAt: Date;
  status: "running" | "paused" | "completed" | "failed";
  pid?: number;
  outputPath: string;
  error?: string;
}

export interface BackgroundSessionOptions {
  sessionId: string;
  projectDir?: string;
  resume?: boolean;
}

const BACKGROUND_SESSIONS_DIR = path.join(
  process.env.PAKALON_CONFIG_DIR || path.join(os.homedir(), ".config", "pakalon"),
  "background-sessions"
);

class SessionBackgroundManager {
  private activeSessions: Map<string, BackgroundSession> = new Map();
  private sessionProcesses: Map<string, ChildProcess> = new Map();

  constructor() {
    this.ensureDir();
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(BACKGROUND_SESSIONS_DIR, { recursive: true });
    } catch {
    }
  }

  async startSession(options: BackgroundSessionOptions): Promise<{
    success: boolean;
    backgroundSession?: BackgroundSession;
    error?: string;
  }> {
    const { sessionId } = options;

    if (this.activeSessions.has(sessionId)) {
      const existing = this.activeSessions.get(sessionId)!;
      if (existing.status === "running") {
        return { success: true, backgroundSession: existing };
      }
    }

    const outputPath = path.join(BACKGROUND_SESSIONS_DIR, `${sessionId}.log`);
    const backgroundSession: BackgroundSession = {
      id: `bg-${sessionId}`,
      sessionId,
      startedAt: new Date(),
      status: "running",
      outputPath,
    };

    this.activeSessions.set(sessionId, backgroundSession);

    return { success: true, backgroundSession };
  }

  async stopSession(sessionId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: "Session not found" };
    }

    const process = this.sessionProcesses.get(sessionId);
    if (process) {
      process.kill("SIGTERM");
      this.sessionProcesses.delete(sessionId);
    }

    session.status = "completed";
    this.activeSessions.delete(sessionId);

    return { success: true };
  }

  async pauseSession(sessionId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: "Session not found" };
    }

    const process = this.sessionProcesses.get(sessionId);
    if (process) {
      process.kill("SIGSTOP");
    }

    session.status = "paused";
    return { success: true };
  }

  async resumeSession(sessionId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: "Session not found" };
    }

    const process = this.sessionProcesses.get(sessionId);
    if (process) {
      process.kill("SIGCONT");
    }

    session.status = "running";
    return { success: true };
  }

  async getSessionStatus(sessionId: string): Promise<BackgroundSession | null> {
    return this.activeSessions.get(sessionId) || null;
  }

  async listActiveSessions(): Promise<BackgroundSession[]> {
    return Array.from(this.activeSessions.values());
  }

  async getSessionOutput(sessionId: string): Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: "Session not found" };
    }

    try {
      const output = await fs.readFile(session.outputPath, "utf-8");
      return { success: true, output };
    } catch {
      return { success: false, output: "" };
    }
  }

  async notifySessionComplete(sessionId: string, success: boolean, error?: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.status = success ? "completed" : "failed";
    if (error) session.error = error;

    try {
      await fs.appendFile(
        session.outputPath,
        `\n[${new Date().toISOString()}] Session ${success ? "completed" : "failed"}\n`
      );
    } catch {
    }
  }
}

let globalBackgroundManager: SessionBackgroundManager | null = null;

export function getSessionBackgroundManager(): SessionBackgroundManager {
  if (!globalBackgroundManager) {
    globalBackgroundManager = new SessionBackgroundManager();
  }
  return globalBackgroundManager;
}

export async function startBackgroundSession(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  const manager = getSessionBackgroundManager();
  const result = await manager.startSession({ sessionId });
  return { success: result.success, error: result.error };
}

export async function stopBackgroundSession(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  const manager = getSessionBackgroundManager();
  return manager.stopSession(sessionId);
}

export async function listBackgroundSessions(): Promise<BackgroundSession[]> {
  const manager = getSessionBackgroundManager();
  return manager.listActiveSessions();
}