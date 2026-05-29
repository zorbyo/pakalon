/**
 * Alt-Screen Mode — full-screen TUI using alternate screen buffer.
 * Matches Copilot CLI's --alt-screen flag.
 *
 * When enabled, uses the terminal's alternate screen buffer (like vim/less)
 * which provides a full-screen experience that restores the previous
 * terminal content on exit.
 */

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";

let altScreenActive = false;

/**
 * Enter alternate screen buffer.
 */
export function enterAltScreen(): void {
  if (altScreenActive) return;
  process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE);
  altScreenActive = true;
}

/**
 * Exit alternate screen buffer and restore previous content.
 */
export function exitAltScreen(): void {
  if (!altScreenActive) return;
  process.stdout.write(CURSOR_SHOW + ALT_SCREEN_OFF);
  altScreenActive = false;
}

/**
 * Check if alt-screen mode is currently active.
 */
export function isAltScreenActive(): boolean {
  return altScreenActive;
}

/**
 * Setup alt-screen with cleanup on exit.
 */
export function setupAltScreen(): void {
  enterAltScreen();

  const cleanup = () => exitAltScreen();
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}
