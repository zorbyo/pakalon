/**
 * Plugin Skill Integration
 *
 * Loads and manages skills provided by plugins. Plugins can expose skills
 * via their manifest's `skills` field or by having a `skills/` directory
 * in their plugin root.
 *
 * Plugin skills are created using the same `createSkillCommand()` function
 * as file-based skills, ensuring consistent behavior and lifecycle.
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "@/types-imported/command.js";
import type { LoadedPlugin } from "@/types-imported/plugin.js";
import { parseFrontmatter } from "@/utils/frontmatterParser.js";
import { extractDescriptionFromMarkdown } from "@/utils/markdownConfigLoader.js";
import { logForDebugging } from "@/utils/debug.js";
import { createSkillCommand, parseSkillFrontmatterFields } from "./loadSkillsDir.js";

/**
 * Registry of all skills provided by plugins.
 * Keyed by plugin name for clean cleanup.
 */
const pluginSkillRegistry = new Map<string, Command[]>();

/**
 * Load skills from a plugin's skills directory.
 *
 * Plugin skills follow the same format as project/user skills:
 *   skills/
 *     my-skill/
 *       SKILL.md
 *
 * @param pluginSkillsPath Path to the plugin's skills directory
 * @param pluginName Name of the plugin (for logging and source attribution)
 * @returns Array of loaded skill commands
 */
function loadSkillsFromPluginDir(
  pluginSkillsPath: string,
  pluginName: string,
): Command[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(pluginSkillsPath, { withFileTypes: true });
  } catch (e: unknown) {
    const nodeErr = e as NodeJS.ErrnoException;
    if (nodeErr.code !== "ENOENT" && nodeErr.code !== "EACCES") {
      logForDebugging(
        `[pluginSkills] Failed to read skills dir for plugin '${pluginName}': ${nodeErr.message}`,
      );
    }
    return [];
  }

  const skills: Command[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    try {
      const skillDirPath = path.join(pluginSkillsPath, entry.name);
      const skillFilePath = path.join(skillDirPath, "SKILL.md");

      let content: string;
      try {
        content = fs.readFileSync(skillFilePath, { encoding: "utf-8" });
      } catch {
        continue;
      }

      const { frontmatter, content: markdownContent } = parseFrontmatter(
        content,
        skillFilePath,
      );

      const skillName = entry.name;
      const parsed = parseSkillFrontmatterFields(
        frontmatter,
        markdownContent,
        skillName,
      );

      const command = createSkillCommand({
        ...parsed,
        skillName,
        markdownContent,
        source: "plugin",
        baseDir: skillDirPath,
        loadedFrom: "plugin",
        paths: undefined,
      });

      skills.push(command);
    } catch (error) {
      logForDebugging(
        `[pluginSkills] Error loading skill from plugin '${pluginName}': ${error}`,
      );
    }
  }

  return skills;
}

/**
 * Load skills from a plugin's manifest-level skill definitions.
 * Some plugins define skills inline in their manifest rather than in a directory.
 *
 * @param plugin The loaded plugin to extract skills from
 * @returns Array of manifest-defined skill paths
 */
function getPluginManifestSkillPaths(plugin: LoadedPlugin): string[] {
  const paths: string[] = [];

  // Collect from manifest skills field
  if (plugin.manifest?.skills) {
    const skillsField = plugin.manifest.skills;
    if (typeof skillsField === "string") {
      paths.push(path.resolve(plugin.path, skillsField));
    } else if (Array.isArray(skillsField)) {
      for (const s of skillsField) {
        if (typeof s === "string") {
          paths.push(path.resolve(plugin.path, s));
        }
      }
    }
  }

  // Collect from LoadedPlugin.skillsPath / skillsPaths
  if (plugin.skillsPath) {
    paths.push(path.resolve(plugin.path, plugin.skillsPath));
  }
  if (plugin.skillsPaths) {
    for (const sp of plugin.skillsPaths) {
      paths.push(path.resolve(plugin.path, sp));
    }
  }

  return paths;
}

/**
 * Register skills from a single plugin.
 * Called during plugin initialization.
 *
 * @param plugin The loaded plugin to register skills for
 * @returns Array of registered skill commands
 */
export function registerPluginSkills(plugin: LoadedPlugin): Command[] {
  const existingSkills = pluginSkillRegistry.get(plugin.name) ?? [];
  if (existingSkills.length > 0) {
    logForDebugging(
      `[pluginSkills] Plugin '${plugin.name}' already has ${existingSkills.length} registered skills — deregistering first`,
    );
    deregisterPluginSkills(plugin.name);
  }

  const skills: Command[] = [];

  // 1. Load from manifest-defined skill paths
  const manifestPaths = getPluginManifestSkillPaths(plugin);
  for (const skillsPath of manifestPaths) {
    const dirSkills = loadSkillsFromPluginDir(skillsPath, plugin.name);
    skills.push(...dirSkills);
  }

  // 2. Check for the default plugin skills directory
  const defaultSkillsDir = path.join(plugin.path, "skills");
  if (
    !manifestPaths.some(
      (p) => path.resolve(p) === path.resolve(defaultSkillsDir),
    )
  ) {
    const dirSkills = loadSkillsFromPluginDir(defaultSkillsDir, plugin.name);
    skills.push(...dirSkills);
  }

  if (skills.length > 0) {
    pluginSkillRegistry.set(plugin.name, skills);
    logForDebugging(
      `[pluginSkills] Registered ${skills.length} skills from plugin '${plugin.name}'`,
    );
  }

  return skills;
}

/**
 * Deregister all skills for a given plugin.
 * Called when a plugin is disabled or removed.
 *
 * @param pluginName Name of the plugin to deregister skills for
 */
export function deregisterPluginSkills(pluginName: string): void {
  const removed = pluginSkillRegistry.get(pluginName);
  if (removed) {
    pluginSkillRegistry.delete(pluginName);
    logForDebugging(
      `[pluginSkills] Deregistered ${removed.length} skills from plugin '${pluginName}'`,
    );
  }
}

/**
 * Get all skills registered by all plugins.
 *
 * @returns Flat array of all plugin-registered skill commands
 */
export function getPluginSkills(): Command[] {
  const all: Command[] = [];
  for (const skills of pluginSkillRegistry.values()) {
    all.push(...skills);
  }
  return all;
}

/**
 * Get skills registered by a specific plugin.
 *
 * @param pluginName Name of the plugin
 * @returns Array of skill commands for that plugin, or empty array
 */
export function getPluginSkillsForPlugin(pluginName: string): Command[] {
  return pluginSkillRegistry.get(pluginName) ?? [];
}

/**
 * Register skills for all currently loaded plugins.
 * Called during startup after plugins have been loaded.
 *
 * @param plugins Array of all loaded plugins
 * @returns Total number of registered skill commands
 */
export function registerAllPluginSkills(plugins: LoadedPlugin[]): number {
  let total = 0;
  for (const plugin of plugins) {
    const skills = registerPluginSkills(plugin);
    total += skills.length;
  }
  logForDebugging(
    `[pluginSkills] Registered ${total} total skills across ${plugins.length} plugins`,
  );
  return total;
}

/**
 * Clear the entire plugin skill registry (for testing/reload).
 */
export function clearPluginSkills(): void {
  pluginSkillRegistry.clear();
}
