/**
 * Bridge UI - Terminal display for bridge status.
 *
 * Provides a logger that renders status information to the terminal,
 * including QR codes, session status, and reconnection state.
 */

import chalk from "chalk";
import type {
  BridgeConfig,
  BridgeLogger,
  SessionActivity,
  SpawnMode,
} from "./types.js";
import {
  buildBridgeConnectUrl,
  buildBridgeSessionUrl,
  buildIdleFooterText,
  buildActiveFooterText,
  formatDuration,
  truncateToWidth,
  FAILED_FOOTER_TEXT,
  wrapWithOsc8Link,
  TOOL_DISPLAY_EXPIRY_MS,
  timestamp,
} from "./bridgeStatusUtil.js";

export function createBridgeLogger(options: {
  verbose: boolean;
  write?: (s: string) => void;
}): BridgeLogger {
  const write = options.write ?? ((s: string) => process.stdout.write(s));
  const verbose = options.verbose;

  let statusLineCount = 0;
  let currentState: "idle" | "attached" | "titled" | "reconnecting" | "failed" =
    "idle";
  let currentStateText = "Ready";
  let repoName = "";
  let branch = "";
  let debugLogPath = "";
  let connectUrl = "";
  let cachedIngressUrl = "";
  let cachedEnvironmentId = "";
  let activeSessionUrl: string | null = null;
  let qrVisible = false;
  let lastToolSummary: string | null = null;
  let lastToolTime = 0;
  let sessionActive = 0;
  let sessionMax = 1;
  let spawnModeDisplay: "same-dir" | "worktree" | null = null;
  let spawnMode: SpawnMode = "single-session";
  const sessionDisplayInfo = new Map<
    string,
    { title?: string; url: string; activity?: SessionActivity }
  >();
  let connectingTimer: ReturnType<typeof setInterval> | null = null;
  let connectingTick = 0;

  function clearStatusLines(): void {
    if (statusLineCount <= 0) return;
    write(`\x1b[${statusLineCount}A`);
    write("\x1b[J");
    statusLineCount = 0;
  }

  function countVisualLines(text: string): number {
    const cols = process.stdout.columns || 80;
    let count = 0;
    for (const logical of text.split("\n")) {
      if (logical.length === 0) {
        count++;
        continue;
      }
      const width = stringWidth(logical);
      count += Math.max(1, Math.ceil(width / cols));
    }
    if (text.endsWith("\n")) {
      count--;
    }
    return count;
  }

  function writeStatus(text: string): void {
    write(text);
    statusLineCount += countVisualLines(text);
  }

  function renderStatusLine(): void {
    if (currentState === "reconnecting" || currentState === "failed") {
      return;
    }

    clearStatusLines();

    const isIdle = currentState === "idle";
    const indicator = "*";
    const indicatorColor = isIdle ? chalk.green : chalk.cyan;
    const baseColor = isIdle ? chalk.green : chalk.cyan;
    const stateText = baseColor(currentStateText);

    let suffix = "";
    if (repoName) {
      suffix += chalk.dim(" · ") + chalk.dim(repoName);
    }
    if (branch && spawnMode !== "worktree") {
      suffix += chalk.dim(" · ") + chalk.dim(branch);
    }

    if (debugLogPath) {
      writeStatus(
        chalk.yellow("[DEBUG] Logs: ") + chalk.dim(debugLogPath) + "\n"
      );
    }
    writeStatus(`${indicatorColor(indicator)} ${stateText}${suffix}\n`);

    if (sessionMax > 1) {
      const modeHint =
        spawnMode === "worktree"
          ? "New sessions will be created in an isolated worktree"
          : "New sessions will be created in the current directory";
      writeStatus(
        ` ${chalk.dim(`Capacity: ${sessionActive}/${sessionMax} · ${modeHint}`)}\n`
      );
      for (const [, info] of sessionDisplayInfo) {
        const titleText = info.title
          ? truncateToWidth(info.title, 35)
          : chalk.dim("Attached");
        const titleLinked = wrapWithOsc8Link(titleText, info.url);
        const act = info.activity;
        const showAct = act && act.type !== "result" && act.type !== "error";
        const actText = showAct
          ? chalk.dim(` ${truncateToWidth(act.summary, 40)}`)
          : "";
        writeStatus(` ${titleLinked}${actText}  `);
      }
    }

    if (sessionMax === 1) {
      const modeText =
        spawnMode === "single-session"
          ? "Single session · exits when complete"
          : spawnMode === "worktree"
            ? `Capacity: ${sessionActive}/1 · New sessions will be created in an isolated worktree`
            : `Capacity: ${sessionActive}/1 · New sessions will be created in the current directory`;
      writeStatus(` ${chalk.dim(modeText)}\n`);
    }

    if (sessionMax === 1 && !isIdle && lastToolSummary && Date.now() - lastToolTime < TOOL_DISPLAY_EXPIRY_MS) {
      writeStatus(` ${chalk.dim(truncateToWidth(lastToolSummary, 60))}\n`);
    }

    const url = activeSessionUrl ?? connectUrl;
    if (url) {
      writeStatus("\n");
      const footerText = isIdle
        ? buildIdleFooterText(url)
        : buildActiveFooterText(url);
      writeStatus(`${chalk.dim(footerText)}\n`);
    }
  }

  return {
    printBanner(config: BridgeConfig, environmentId: string): void {
      cachedIngressUrl = config.sessionIngressUrl;
      cachedEnvironmentId = environmentId;
      connectUrl = buildBridgeConnectUrl(environmentId, cachedIngressUrl);

      if (verbose) {
        write(chalk.dim(`Remote Control`) + ` v1.0.0\n`);
      }
      if (verbose) {
        if (config.spawnMode !== "single-session") {
          write(chalk.dim(`Spawn mode: `) + `${config.spawnMode}\n`);
          write(
            chalk.dim(`Max concurrent sessions: `) + `${config.maxSessions}\n`
          );
        }
        write(chalk.dim(`Environment ID: `) + `${environmentId}\n`);
      }
      if (config.sandbox) {
        write(chalk.dim(`Sandbox: `) + `${chalk.green("Enabled")}\n`);
      }
      write("\n");
    },

    logSessionStart(sessionId: string, prompt: string): void {
      if (verbose) {
        const short = truncateToWidth(prompt, 80);
        write(
          chalk.dim(`[${timestamp()}]`) +
            ` Session started: ${chalk.white(`"${short}"`)} (${chalk.dim(sessionId)})\n`
        );
      }
    },

    logSessionComplete(sessionId: string, durationMs: number): void {
      write(
        chalk.dim(`[${timestamp()}]`) +
          ` Session ${chalk.green("completed")} (${formatDuration(durationMs)}) ${chalk.dim(sessionId)}\n`
      );
    },

    logSessionFailed(sessionId: string, error: string): void {
      write(
        chalk.dim(`[${timestamp()}]`) +
          ` Session ${chalk.red("failed")}: ${error} ${chalk.dim(sessionId)}\n`
      );
    },

    logStatus(message: string): void {
      write(chalk.dim(`[${timestamp()}]`) + ` ${message}\n`);
    },

    logVerbose(message: string): void {
      if (verbose) {
        write(chalk.dim(`[${timestamp()}] ${message}`) + "\n");
      }
    },

    logError(message: string): void {
      write(chalk.red(`[${timestamp()}] Error: ${message}`) + "\n");
    },

    logReconnected(disconnectedMs: number): void {
      write(
        chalk.dim(`[${timestamp()}]`) +
          ` ${chalk.green("Reconnected")} after ${formatDuration(disconnectedMs)}\n`
      );
    },

    setRepoInfo(repo: string, branchName: string): void {
      repoName = repo;
      branch = branchName;
    },

    setDebugLogPath(path: string): void {
      debugLogPath = path;
    },

    updateIdleStatus(): void {
      currentState = "idle";
      currentStateText = "Ready";
      lastToolSummary = null;
      lastToolTime = 0;
      activeSessionUrl = null;
      renderStatusLine();
    },

    setAttached(sessionId: string): void {
      currentState = "attached";
      currentStateText = "Connected";
      lastToolSummary = null;
      lastToolTime = 0;

      if (sessionMax <= 1) {
        activeSessionUrl = buildBridgeSessionUrl(
          sessionId,
          cachedEnvironmentId,
          cachedIngressUrl
        );
      }
      renderStatusLine();
    },

    updateReconnectingStatus(delayStr: string, elapsedStr: string): void {
      clearStatusLines();
      currentState = "reconnecting";
      writeStatus(
        `${chalk.yellow("⟳")} ${chalk.yellow("Reconnecting")} ${chalk.dim("·")} ${chalk.dim(`retrying in ${delayStr}`)} ${chalk.dim("·")} ${chalk.dim(`disconnected ${elapsedStr}`)}\n`
      );
    },

    updateFailedStatus(error: string): void {
      clearStatusLines();
      currentState = "failed";

      let suffix = "";
      if (repoName) {
        suffix += chalk.dim(" · ") + chalk.dim(repoName);
      }
      if (branch) {
        suffix += chalk.dim(" · ") + chalk.dim(branch);
      }

      writeStatus(
        `${chalk.red("[X]")} ${chalk.red("Remote Control Failed")}${suffix}\n`
      );
      writeStatus(`${chalk.dim(FAILED_FOOTER_TEXT)}\n`);

      if (error) {
        writeStatus(`${chalk.red(error)}\n`);
      }
    },

    updateSessionStatus(
      _sessionId: string,
      _elapsed: string,
      activity: SessionActivity,
      _trail: string[]
    ): void {
      if (activity.type === "tool_start") {
        lastToolSummary = activity.summary;
        lastToolTime = Date.now();
      }
      renderStatusLine();
    },

    clearStatus(): void {
      clearStatusLines();
    },

    toggleQr(): void {
      qrVisible = !qrVisible;
      renderStatusLine();
    },

    updateSessionCount(active: number, max: number, mode: SpawnMode): void {
      if (sessionActive === active && sessionMax === max && spawnMode === mode)
        return;
      sessionActive = active;
      sessionMax = max;
      spawnMode = mode;
    },

    setSpawnModeDisplay(mode: "same-dir" | "worktree" | null): void {
      if (spawnModeDisplay === mode) return;
      spawnModeDisplay = mode;
      if (mode) spawnMode = mode;
    },

    addSession(sessionId: string, url: string): void {
      sessionDisplayInfo.set(sessionId, { url });
    },

    updateSessionActivity(sessionId: string, activity: SessionActivity): void {
      const info = sessionDisplayInfo.get(sessionId);
      if (!info) return;
      info.activity = activity;
    },

    setSessionTitle(sessionId: string, title: string): void {
      const info = sessionDisplayInfo.get(sessionId);
      if (!info) return;
      info.title = title;

      if (currentState === "reconnecting" || currentState === "failed") return;
      if (sessionMax === 1) {
        currentState = "titled";
        currentStateText = truncateToWidth(title, 40);
      }
      renderStatusLine();
    },

    removeSession(sessionId: string): void {
      sessionDisplayInfo.delete(sessionId);
    },

    refreshDisplay(): void {
      if (currentState === "reconnecting" || currentState === "failed") return;
      renderStatusLine();
    },
  };
}

// Minimal stringWidth implementation for terminal columns
function stringWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.charCodeAt(0);
    if (code > 127) {
      width += 2; // Non-ASCII characters are typically double-width
    } else {
      width += 1;
    }
  }
  return width;
}

export type { BridgeLogger, BridgeConfig, SessionActivity, SpawnMode };