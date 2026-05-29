/**
 * Fullscreen Mode — manages terminal fullscreen state.
 *
 * Provides enter/exit fullscreen with proper cleanup.
 * Uses alternate screen buffer and raw mode for immersive experience.
 * Handles SIGINT/SIGTERM for graceful exit.
 */

import logger from "@/utils/logger.js";

export interface FullscreenOptions {
  hideCursor?: boolean;
  enableRawMode?: boolean;
  cleanupOnExit?: boolean;
  onExit?: () => void;
}

const ESC = "\x1b";
const ENTER_ALT_SCREEN = `${ESC}[?1049h`;
const EXIT_ALT_SCREEN = `${ESC}[?1049l`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`;

let fullscreenActive = false;
let cleanupRegistered = false;
let exitHandler: (() => void) | null = null;

export function enterFullscreen(options: FullscreenOptions = {}): void {
  if (fullscreenActive) return;

  const {
    hideCursor = true,
    enableRawMode = false,
    cleanupOnExit = true,
    onExit,
  } = options;

  exitHandler = onExit ?? null;

  let output = ENTER_ALT_SCREEN + CLEAR_SCREEN;
  if (hideCursor) {
    output += HIDE_CURSOR;
  }

  process.stdout.write(output);
  fullscreenActive = true;

  if (enableRawMode && process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  if (cleanupOnExit && !cleanupRegistered) {
    cleanupRegistered = true;
    registerCleanup(hideCursor, enableRawMode);
  }

  logger.debug("[fullscreen] Entered fullscreen mode");
}

export function exitFullscreen(options: FullscreenOptions = {}): void {
  if (!fullscreenActive) return;

  const { hideCursor = true, enableRawMode = false } = options;

  let output = SHOW_CURSOR + EXIT_ALT_SCREEN;
  process.stdout.write(output);

  if (enableRawMode && process.stdin.isTTY && process.stdin.isRaw) {
    process.stdin.setRawMode(false);
  }

  fullscreenActive = false;
  exitHandler?.();
  exitHandler = null;

  logger.debug("[fullscreen] Exited fullscreen mode");
}

export function toggleFullscreen(options: FullscreenOptions = {}): void {
  if (fullscreenActive) {
    exitFullscreen(options);
  } else {
    enterFullscreen(options);
  }
}

export function isFullscreenActive(): boolean {
  return fullscreenActive;
}

function registerCleanup(hideCursor: boolean, enableRawMode: boolean): void {
  const cleanup = () => {
    if (fullscreenActive) {
      let output = SHOW_CURSOR + EXIT_ALT_SCREEN;
      process.stdout.write(output);

      if (enableRawMode && process.stdin.isTTY && process.stdin.isRaw) {
        process.stdin.setRawMode(false);
      }

      fullscreenActive = false;
      exitHandler?.();
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
  process.on("uncaughtException", (err) => {
    cleanup();
    logger.error("[fullscreen] Uncaught exception during fullscreen", { error: err.message });
  });
}

export function clearScreen(): void {
  process.stdout.write(CLEAR_SCREEN);
}

export function moveCursor(x: number, y: number): void {
  process.stdout.write(`${ESC}[${y};${x}H`);
}

export function moveCursorHome(): void {
  process.stdout.write(`${ESC}[H`);
}

export function saveCursorPosition(): void {
  process.stdout.write(`${ESC}7`);
}

export function restoreCursorPosition(): void {
  process.stdout.write(`${ESC}8`);
}

export function hideCursor(): void {
  process.stdout.write(HIDE_CURSOR);
}

export function showCursor(): void {
  process.stdout.write(SHOW_CURSOR);
}
