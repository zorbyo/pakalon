/**
 * Tmux Pane Integration for Teammate Visualization
 * 
 * Provides real-time visualization of teammate agents in tmux panes,
 * allowing users to see agent activity in separate windows.
 */

import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import logger from "@/utils/logger.js";

export interface TmuxPaneInfo {
  windowId: string;
  paneId: string;
  agentId: string;
  agentName: string;
  status: "active" | "idle" | "completed" | "error";
  lastOutput?: string;
  startedAt: Date;
}

export interface TmuxLayoutConfig {
  orientation: "horizontal" | "vertical";
  mainPaneSize?: number;
  teammatePaneHeight?: number;
}

const DEFAULT_LAYOUT: TmuxLayoutConfig = {
  orientation: "vertical",
  teammatePaneHeight: 20,
};

class TmuxPaneManager extends EventEmitter {
  private panes: Map<string, TmuxPaneInfo> = new Map();
  private layout: TmuxLayoutConfig;
  private sessionName: string;
  private baseWindow: string;

  constructor(sessionName = "pakalon", layout?: Partial<TmuxLayoutConfig>) {
    super();
    this.sessionName = sessionName;
    this.baseWindow = "main";
    this.layout = { ...DEFAULT_LAYOUT, ...layout };
  }

  isTmuxAvailable(): boolean {
    try {
      execSync("which tmux", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  initializeSession(): boolean {
    if (!this.isTmuxAvailable()) {
      logger.warn("[TmuxPane] tmux not available");
      return false;
    }

    try {
      // Create session if it doesn't exist
      execSync(`tmux new-session -d -s "${this.sessionName}" -n "${this.baseWindow}" 2>/dev/null || true`);
      this.createLayout();
      logger.info(`[TmuxPane] Initialized tmux session: ${this.sessionName}`);
      return true;
    } catch (err) {
      logger.error("[TmuxPane] Failed to initialize tmux session:", err);
      return false;
    }
  }

  private createLayout(): void {
    if (this.layout.orientation === "horizontal") {
      // Split main pane horizontally for teammates
      execSync(`tmux split-window -h -t "${this.sessionName}:${this.baseWindow}" -l ${this.layout.mainPaneSize ?? 80}`);
    } else {
      // Split main pane vertically
      execSync(`tmux split-window -v -t "${this.sessionName}:${this.baseWindow}" -l ${this.layout.teammatePaneHeight ?? 20}`);
    }
  }

  createAgentPane(agentId: string, agentName: string): string | null {
    if (!this.isTmuxAvailable()) return null;

    try {
      const windowName = `agent-${agentId}`;
      const paneId = `${this.sessionName}:${agentName}`;

      // Create new window for the agent
      execSync(`tmux new-window -t "${this.sessionName}" -n "${windowName}"`);

      // Split into input/output panes
      execSync(`tmux split-window -v -t "${paneId}" -l 50%`);

      const info: TmuxPaneInfo = {
        windowId: windowName,
        paneId,
        agentId,
        agentName,
        status: "active",
        startedAt: new Date(),
      };

      this.panes.set(agentId, info);
      this.emit("pane:created", info);
      logger.info(`[TmuxPane] Created pane for agent ${agentId}`);

      return paneId;
    } catch (err) {
      logger.error(`[TmuxPane] Failed to create agent pane:`, err);
      return null;
    }
  }

  updatePaneStatus(agentId: string, status: TmuxPaneInfo["status"], output?: string): void {
    const info = this.panes.get(agentId);
    if (!info) return;

    info.status = status;
    if (output) info.lastOutput = output;

    this.emit("pane:updated", info);

    // Update pane display
    const title = `[${status.toUpperCase()}] ${info.agentName}`;
    this.setPaneTitle(agentId, title);
  }

  setPaneTitle(agentId: string, title: string): void {
    const info = this.panes.get(agentId);
    if (!info) return;

    try {
      execSync(`tmux select-pane -t "${info.paneId}" -T "${title}"`);
    } catch {
      // Ignore errors setting title
    }
  }

  sendToPane(agentId: string, data: string): void {
    const info = this.panes.get(agentId);
    if (!info) return;

    try {
      execSync(`tmux send-keys -t "${info.paneId}" "${data.replace(/"/g, '\\"')}" Enter`);
    } catch (err) {
      logger.warn(`[TmuxPane] Failed to send to pane:`, err);
    }
  }

  closeAgentPane(agentId: string): void {
    const info = this.panes.get(agentId);
    if (!info) return;

    try {
      execSync(`tmux kill-window -t "${this.sessionName}:${info.windowId}"`);
      this.panes.delete(agentId);
      this.emit("pane:closed", agentId);
      logger.info(`[TmuxPane] Closed pane for agent ${agentId}`);
    } catch (err) {
      logger.warn(`[TmuxPane] Failed to close pane:`, err);
    }
  }

  getActivePanes(): TmuxPaneInfo[] {
    return Array.from(this.panes.values()).filter((p) => p.status === "active");
  }

  getAllPanes(): TmuxPaneInfo[] {
    return Array.from(this.panes.values());
  }

  layoutPanes(type: "tiled" | "even-horizontal" | "even-vertical" | "main-horizontal" | "main-vertical"): void {
    try {
      execSync(`tmux select-layout -t "${this.sessionName}" ${type}`);
      this.emit("layout:changed", type);
    } catch (err) {
      logger.warn("[TmuxPane] Failed to change layout:", err);
    }
  }

  attachToSession(): void {
    if (!this.isTmuxAvailable()) return;

    try {
      execSync(`tmux attach-session -t "${this.sessionName}"`);
    } catch {
      // User may have exited
    }
  }

  detachSession(): void {
    try {
      execSync(`tmux detach -s "${this.sessionName}"`);
    } catch {
      // Ignore
    }
  }

  cleanup(): void {
    try {
      for (const [agentId] of this.panes) {
        this.closeAgentPane(agentId);
      }
      execSync(`tmux kill-session -t "${this.sessionName}" 2>/dev/null || true`);
      this.panes.clear();
      this.emit("session:cleaned");
    } catch {
      // Ignore cleanup errors
    }
  }
}

let tmuxManager: TmuxPaneManager | null = null;

export function getTmuxManager(): TmuxPaneManager {
  if (!tmuxManager) {
    tmuxManager = new TmuxPaneManager();
  }
  return tmuxManager;
}

export function initializeTmuxVisualization(layout?: Partial<TmuxLayoutConfig>): boolean {
  const manager = getTmuxManager();
  if (layout) {
    Object.assign(manager, layout);
  }
  return manager.initializeSession();
}

export function createAgentTmuxPane(agentId: string, agentName: string): string | null {
  return getTmuxManager().createAgentPane(agentId, agentName);
}

export function updateAgentTmuxStatus(agentId: string, status: TmuxPaneInfo["status"], output?: string): void {
  getTmuxManager().updatePaneStatus(agentId, status, output);
}

export default TmuxPaneManager;