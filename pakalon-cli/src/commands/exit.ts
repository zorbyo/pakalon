/**
 * Exit Command for Pakalon CLI
 * 
 * Graceful shutdown with cleanup.
 */

import type { CommandContext, CommandResult } from "./types.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExitOptions {
  /** Exit code */
  code?: number;
  /** Exit reason for logging */
  reason?: string;
  /** Force exit without cleanup */
  force?: boolean;
  /** Save session before exit */
  saveSession?: boolean;
}

// ---------------------------------------------------------------------------
// Goodbye Messages
// ---------------------------------------------------------------------------

const GOODBYE_MESSAGES = [
  "Goodbye! [Wave]",
  "See you later! *",
  "Until next time! [Rocket]",
  "Happy coding! [Computer]",
  "Take care! [Star]",
  "Bye for now! [Party]",
  "May your builds always succeed! [Hammer]",
  "Stay curious! [Search]",
];

function getRandomGoodbye(): string {
  const index = Math.floor(Math.random() * GOODBYE_MESSAGES.length);
  return GOODBYE_MESSAGES[index] ?? GOODBYE_MESSAGES[0]!;
}

// ---------------------------------------------------------------------------
// Cleanup Handlers
// ---------------------------------------------------------------------------

type CleanupHandler = () => void | Promise<void>;
const cleanupHandlers: Map<string, CleanupHandler> = new Map();

export function registerCleanupHandler(
  id: string,
  handler: CleanupHandler
): void {
  cleanupHandlers.set(id, handler);
}

export function unregisterCleanupHandler(id: string): void {
  cleanupHandlers.delete(id);
}

async function runCleanupHandlers(): Promise<void> {
  for (const [id, handler] of cleanupHandlers) {
    try {
      logger.debug(`[exit] Running cleanup handler: ${id}`);
      await handler();
    } catch (error) {
      logger.error(`[exit] Cleanup handler ${id} failed: ${error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Session Persistence
// ---------------------------------------------------------------------------

export interface SessionState {
  id: string;
  messages: unknown[];
  timestamp: number;
  cwd: string;
}

let onSaveSession: ((state: SessionState) => Promise<void>) | null = null;

export function setSessionSaveHandler(
  handler: (state: SessionState) => Promise<void>
): void {
  onSaveSession = handler;
}

async function saveCurrentSession(context: CommandContext): Promise<void> {
  if (!onSaveSession) return;

  try {
    const state: SessionState = {
      id: `session-${Date.now()}`,
      messages: context.messages ?? [],
      timestamp: Date.now(),
      cwd: process.cwd(),
    };

    await onSaveSession(state);
    logger.info(`[exit] Session saved: ${state.id}`);
  } catch (error) {
    logger.error(`[exit] Failed to save session: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

let isShuttingDown = false;

export async function gracefulShutdown(
  code: number = 0,
  reason: string = "user_exit"
): Promise<never> {
  if (isShuttingDown) {
    process.exit(code);
  }

  isShuttingDown = true;
  logger.info(`[exit] Graceful shutdown initiated (reason: ${reason})`);

  try {
    // Run cleanup handlers with timeout
    const cleanupTimeout = setTimeout(() => {
      logger.warn("[exit] Cleanup timeout, forcing exit");
      process.exit(code);
    }, 5000);

    await runCleanupHandlers();
    clearTimeout(cleanupTimeout);

    // Final log
    logger.info(`[exit] Shutdown complete (code: ${code})`);
  } catch (error) {
    logger.error(`[exit] Error during shutdown: ${error}`);
  }

  process.exit(code);
}

// ---------------------------------------------------------------------------
// Background Session Detection
// ---------------------------------------------------------------------------

/**
 * Check if running in a background tmux session
 */
export function isBackgroundSession(): boolean {
  return !!process.env.PAKALON_BG_SESSION || !!process.env.TMUX;
}

/**
 * Detach from tmux session instead of exiting
 */
export function detachFromTmux(): boolean {
  try {
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const result = spawnSync("tmux", ["detach-client"], {
      stdio: "inherit",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Worktree Detection
// ---------------------------------------------------------------------------

export interface WorktreeSession {
  path: string;
  branch: string;
  isActive: boolean;
}

let getCurrentWorktreeSession: (() => WorktreeSession | null) | null = null;

export function setWorktreeSessionGetter(
  getter: () => WorktreeSession | null
): void {
  getCurrentWorktreeSession = getter;
}

function checkWorktreeSession(): WorktreeSession | null {
  return getCurrentWorktreeSession?.() ?? null;
}

// ---------------------------------------------------------------------------
// Command Implementation
// ---------------------------------------------------------------------------

export const exitCommand = {
  name: "exit",
  aliases: ["quit", "q"],
  description: "Exit the CLI",
  usage: "/exit [--force] [--save]",
  category: "session",

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const options: ExitOptions = {
      code: 0,
      reason: "user_command",
      force: false,
      saveSession: false,
    };

    // Parse arguments
    for (const arg of args) {
      switch (arg) {
        case "--force":
        case "-f":
          options.force = true;
          break;
        case "--save":
        case "-s":
          options.saveSession = true;
          break;
      }
    }

    // Check for background session
    if (isBackgroundSession() && !options.force) {
      logger.info("[exit] Detaching from background session");
      const detached = detachFromTmux();
      
      if (detached) {
        return {
          success: true,
          message: "Detached from background session",
        };
      }
    }

    // Check for worktree session
    const worktree = checkWorktreeSession();
    if (worktree?.isActive && !options.force) {
      return {
        success: false,
        message: `Active worktree session on branch '${worktree.branch}'.\nUse /exit --force to exit anyway, or commit your changes first.`,
      };
    }

    // Save session if requested
    if (options.saveSession) {
      await saveCurrentSession(context);
    }

    // Goodbye message
    const goodbye = getRandomGoodbye();
    logger.info(`[exit] ${goodbye}`);

    // Call onDone callback if available
    if (context.onDone) {
      context.onDone(goodbye);
    }

    // Graceful shutdown
    if (options.force) {
      process.exit(options.code);
    } else {
      // Schedule shutdown to allow this response to be sent
      setImmediate(() => {
        gracefulShutdown(options.code, options.reason);
      });
    }

    return {
      success: true,
      message: goodbye,
    };
  },
};

// ---------------------------------------------------------------------------
// Signal Handlers
// ---------------------------------------------------------------------------

// Handle SIGINT (Ctrl+C)
process.on("SIGINT", () => {
  if (isShuttingDown) {
    logger.warn("[exit] Force exit on second SIGINT");
    process.exit(1);
  }
  gracefulShutdown(0, "sigint");
});

// Handle SIGTERM
process.on("SIGTERM", () => {
  gracefulShutdown(0, "sigterm");
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  exitCommand,
  gracefulShutdown,
  registerCleanupHandler,
  unregisterCleanupHandler,
  setSessionSaveHandler,
  setWorktreeSessionGetter,
  isBackgroundSession,
  detachFromTmux,
  getRandomGoodbye,
  GOODBYE_MESSAGES,
};
