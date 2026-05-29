/**
 * Screen Reader Mode — accessible TUI with static text instead of spinners.
 * Matches Copilot CLI's --screen-reader flag.
 *
 * When enabled:
 * - Spinners are replaced with static text labels
 * - Dynamic updates use newlines instead of overwrites
 * - Color is minimized for better screen reader compatibility
 */

let screenReaderMode = false;

/**
 * Enable screen reader mode.
 */
export function enableScreenReaderMode(): void {
  screenReaderMode = true;
}

/**
 * Check if screen reader mode is active.
 */
export function isScreenReaderMode(): boolean {
  return screenReaderMode;
}

/**
 * Get a spinner replacement for screen reader mode.
 * Returns a static text label instead of animated characters.
 */
export function getSpinnerLabel(phase: string): string {
  return `[${phase}...]`;
}

/**
 * Wrap text for screen reader output — ensures proper line breaks.
 */
export function screenReaderText(text: string): string {
  return text + "\n";
}
