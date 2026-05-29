/**
 * Compact Warning State
 *
 * Manages the state for suppressing repeat compaction warnings
 * during a session.
 */

let warningSuppressed = false;

/**
 * Suppress the compact warning for the remainder of the session.
 */
export function suppressCompactWarning(): void {
  warningSuppressed = true;
}

/**
 * Check if the compact warning is currently suppressed.
 */
export function isCompactWarningSuppressed(): boolean {
  return warningSuppressed;
}

/**
 * Reset the compact warning suppression state.
 */
export function resetCompactWarning(): void {
  warningSuppressed = false;
}
