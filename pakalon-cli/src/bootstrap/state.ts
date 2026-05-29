/**
 * Bootstrap State - Session and directory state management
 *
 * Manages the session ID, original working directory, and project root
 * for the CLI session lifecycle.
 */

import { randomUUID } from 'crypto';

let currentSessionId: string | null = null;
let currentOriginalCwd: string = process.cwd();
let currentProjectRoot: string = process.cwd();

/**
 * Get the current session ID, generating one if not set
 */
export function getSessionId(): string {
  if (!currentSessionId) {
    currentSessionId = randomUUID();
  }
  return currentSessionId;
}

/**
 * Set the session ID
 */
export function setSessionId(id: string): void {
  currentSessionId = id;
}

/**
 * Get the original working directory (before any worktree switches)
 */
export function getOriginalCwd(): string {
  return currentOriginalCwd;
}

/**
 * Set the original working directory
 */
export function setOriginalCwd(cwd: string): void {
  currentOriginalCwd = cwd;
}

/**
 * Get the current project root
 */
export function getProjectRoot(): string {
  return currentProjectRoot;
}

/**
 * Set the project root
 */
export function setProjectRoot(root: string): void {
  currentProjectRoot = root;
}

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

/**
 * Reset all state (for testing)
 */
export function resetState(): void {
  currentSessionId = null;
  currentOriginalCwd = process.cwd();
  currentProjectRoot = process.cwd();
}