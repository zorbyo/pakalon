/**
 * Dynamic Skill Discovery
 *
 * Discovers skill directories by walking up from file paths during a session.
 * When the model reads/writes/edits a file, this module checks ancestor
 * directories for .claude/skills/ directories and loads any skills found there.
 *
 * Skills closer to the file (deeper paths) take precedence over shallower ones.
 *
 * This re-exports the dynamic skill API from loadSkillsDir.ts for clean
 * separation of concerns — the core loading logic lives in loadSkillsDir.ts
 * while this module provides the public discovery surface.
 */

import {
  discoverSkillDirsForPaths as discoverDirs,
  addSkillDirectories as addDirs,
  getDynamicSkills as getSkills,
  activateConditionalSkillsForPaths as activateConditional,
  onDynamicSkillsLoaded,
  clearDynamicSkills as clearSkills,
  getConditionalSkillCount,
} from "./loadSkillsDir.js";

export type { LoadedFrom } from "./loadSkillsDir.js";

/**
 * Discovers skill directories by walking up from file paths to cwd.
 * Only discovers directories below cwd (cwd-level skills are loaded at startup).
 *
 * @param filePaths Array of file paths to check
 * @param cwd Current working directory (upper bound for discovery)
 * @returns Array of newly discovered skill directories, sorted deepest first
 */
export async function discoverSkillDirsForPaths(
  filePaths: string[],
  cwd: string,
): Promise<string[]> {
  return discoverDirs(filePaths, cwd);
}

/**
 * Loads skills from the given directories and merges them into the dynamic skills map.
 * Skills from directories closer to the file (deeper paths) take precedence.
 *
 * @param dirs Array of skill directories to load from (sorted deepest first)
 */
export async function addSkillDirectories(dirs: string[]): Promise<void> {
  return addDirs(dirs);
}

/**
 * Gets all dynamically discovered skills discovered from file paths during the session.
 */
export function getDynamicSkills(): ReturnType<typeof getSkills> {
  return getSkills();
}

/**
 * Activates conditional skills (skills with paths frontmatter) whose path
 * patterns match the given file paths. Activated skills are added to the
 * dynamic skills map, making them available to the model.
 *
 * @param filePaths Array of file paths being operated on
 * @param cwd Current working directory (paths are matched relative to cwd)
 * @returns Array of newly activated skill names
 */
export function activateConditionalSkillsForPaths(
  filePaths: string[],
  cwd: string,
): string[] {
  return activateConditional(filePaths, cwd);
}

/**
 * Register a callback to be invoked when dynamic skills are loaded.
 * Used by other modules to clear caches without creating import cycles.
 * Returns an unsubscribe function.
 */
export { onDynamicSkillsLoaded };

/**
 * Gets the number of pending conditional skills (for testing/debugging).
 */
export { getConditionalSkillCount };

/**
 * Clears dynamic skill state (for testing).
 */
export function clearDynamicSkills(): void {
  clearSkills();
}
