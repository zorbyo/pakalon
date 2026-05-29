/**
 * Current Working Directory utility
 *
 * Provides centralized CWD management for the CLI.
 * Wraps process.chdir() to allow tracking and restoration.
 */

/**
 * Get the current working directory
 */
export function getCwd(): string {
  return process.cwd();
}

/**
 * Set the current working directory
 */
export function setCwd(cwd: string): void {
  process.chdir(cwd);
}