/**
 * Skill Directory Loader
 *
 * Multi-source skill loading engine. Loads skills from:
 *   - Managed policy skills (/policy/.claude/skills/)
 *   - User skills (~/.claude/skills/, ~/.pakalon/skills/)
 *   - Project skills (.claude/skills/, .pakalon/skills/, .agents/skills/)
 *   - Additional directories (--add-dir flags)
 *   - Legacy /commands/ directories (skill.md / SKILL.md format)
 *   - Bundled skills (compiled into the CLI)
 *   - Plugin-registered skills
 *   - MCP-discovered skills
 *
 * Supports: deduplication (via realpath), conditional (path-filtered) skills,
 *           dynamic skill discovery (file-walk activation), namespaced skills.
 */

import { realpath } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ignore from "ignore";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";
import type { Command, PromptCommand } from "@/types-imported/command.js";
import type { ToolUseContext } from "@/tools/tool-types.js";
import type { SettingSource } from "@/utils/settings/constants.js";
import type { HooksSettings } from "@/utils/settings/settings.js";
import {
  parseFrontmatter,
  parseBooleanFrontmatter,
  parseShellFrontmatter,
  coerceDescriptionToString,
  type FrontmatterData,
  type FrontmatterShell,
} from "@/utils/frontmatterParser.js";
import {
  parseArgumentNames,
  parseSlashCommandToolsFromFrontmatter,
  extractDescriptionFromMarkdown,
  parseUserSpecifiedModel,
} from "@/utils/markdownConfigLoader.js";
import { EFFORT_LEVELS, type EffortLevel, parseEffortValue } from "@/utils/effort.js";
import { logForDebugging } from "@/utils/debug.js";
import { logError } from "@/utils/log.js";
import { isEnvTruthy } from "@/utils/envUtils.js";
import { registerMCPSkillBuilders } from "./mcpSkillBuilders.js";

// ============================================================================
// Types
// ============================================================================

export type LoadedFrom =
  | "commands_DEPRECATED"
  | "skills"
  | "plugin"
  | "managed"
  | "bundled"
  | "mcp";

// Internal type to track skill with its file path for deduplication
type SkillWithPath = {
  skill: Command;
  filePath: string;
};

// Signal type for event emission
type SignalListener = () => void;

function createSignal() {
  const listeners = new Set<SignalListener>();
  return {
    subscribe: (fn: SignalListener): (() => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit: () => {
      for (const fn of listeners) {
        try {
          fn();
        } catch (e) {
          logError(e as Error);
        }
      }
    },
  };
}

// ============================================================================
// Path Helpers
// ============================================================================

/** Returns a config directory path for a given source. */
export function getSkillsPath(
  source: SettingSource | "plugin",
  dir: "skills" | "commands",
): string {
  switch (source) {
    case "policySettings":
      return path.join(getManagedFilePath(), ".claude", dir);
    case "userSettings":
      return path.join(getClaudeConfigHomeDir(), dir);
    case "projectSettings":
      return `.claude/${dir}`;
    case "plugin":
      return "plugin";
    default:
      return "";
  }
}

/** Get the user's claude config home directory. */
function getClaudeConfigHomeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
    : path.join(os.homedir(), ".claude");
}

/** Get the managed (policy) file path. */
function getManagedFilePath(): string {
  return process.env.CLAUDE_MANAGED_DIR
    ? path.resolve(process.env.CLAUDE_MANAGED_DIR)
    : path.join(os.homedir(), ".config", "pakalon", "policy");
}

/** Walk up from cwd to home looking for subdirectories named `subdir`. */
function getProjectDirsUpToHome(subdir: string, cwd: string): string[] {
  const home = os.homedir();
  const dirs: string[] = [];
  let current = path.resolve(cwd);

  // Normalize trailing separator
  const normHome = home.endsWith(path.sep) ? home : home + path.sep;

  while (true) {
    const candidate = path.join(current, subdir);
    if (fs.existsSync(candidate)) {
      dirs.push(candidate);
    }
    // Stop when we reach home or root
    if (current === path.dirname(current)) break;
    if (current + path.sep === normHome) break;
    current = path.dirname(current);
  }

  return dirs;
}

// ============================================================================
// Token estimation
// ============================================================================

/** Rough token estimation (word-count based). */
function roughTokenCountEstimation(text: string): number {
  if (!text) return 0;
  // ~1.3 tokens per word on average for English
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

/** Estimates token count for a skill based on frontmatter only. */
export function estimateSkillFrontmatterTokens(skill: Command): number {
  if (skill.type !== "prompt") return 0;
  const frontmatterText = [skill.name, skill.description, skill.whenToUse]
    .filter(Boolean)
    .join(" ");
  return roughTokenCountEstimation(frontmatterText);
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Gets a unique identifier for a file by resolving symlinks to a canonical path.
 * Returns null if the file doesn't exist or can't be resolved.
 */
async function getFileIdentity(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath);
  } catch {
    return null;
  }
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

/**
 * Parse and validate hooks from frontmatter.
 * Returns undefined if hooks are not defined or invalid.
 */
function parseHooksFromFrontmatter(
  frontmatter: FrontmatterData,
  skillName: string,
): HooksSettings | undefined {
  if (!frontmatter.hooks) return undefined;
  // Basic validation — check it's an object with known hook keys
  const hooks = frontmatter.hooks as Record<string, unknown>;
  const validKeys = [
    "beforeModel",
    "afterModel",
    "onFunctionCall",
    "onToolCall",
    "onMaxTokens",
    "onError",
    "onCompletion",
  ];
  const hasValidKey = validKeys.some((k) => Array.isArray(hooks[k]));
  if (!hasValidKey) {
    logForDebugging(
      `Invalid hooks in skill '${skillName}': no recognized hook arrays found`,
    );
    return undefined;
  }
  return hooks as unknown as HooksSettings;
}

/**
 * Parse paths frontmatter from a skill (gitignore-style path patterns).
 * Returns undefined if no paths are specified or if all patterns are match-all.
 */
function parseSkillPaths(frontmatter: FrontmatterData): string[] | undefined {
  if (!frontmatter.paths) return undefined;

  const raw = frontmatter.paths;
  const patterns: string[] = [];
  if (typeof raw === "string") {
    patterns.push(...raw.split(",").map((p: string) => p.trim()));
  } else if (Array.isArray(raw)) {
    patterns.push(...raw.map((p: unknown) => String(p).trim()));
  }

  const cleaned = patterns
    .map((p: string) => (p.endsWith("/**") ? p.slice(0, -3) : p))
    .filter((p: string) => p.length > 0);

  if (cleaned.length === 0 || cleaned.every((p: string) => p === "**")) {
    return undefined;
  }

  return cleaned;
}

/**
 * Parses all skill frontmatter fields shared between file-based and MCP skill loading.
 */
export function parseSkillFrontmatterFields(
  frontmatter: FrontmatterData,
  markdownContent: string,
  resolvedName: string,
  descriptionFallbackLabel: "Skill" | "Custom command" = "Skill",
): {
  displayName: string | undefined;
  description: string;
  hasUserSpecifiedDescription: boolean;
  allowedTools: string[];
  argumentHint: string | undefined;
  argumentNames: string[];
  whenToUse: string | undefined;
  version: string | undefined;
  model: string | undefined;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  hooks: HooksSettings | undefined;
  executionContext: "fork" | undefined;
  agent: string | undefined;
  effort: number | undefined;
  shell: FrontmatterShell | undefined;
} {
  const validatedDescription = coerceDescriptionToString(
    frontmatter.description,
    resolvedName,
  );
  const description =
    validatedDescription ??
    extractDescriptionFromMarkdown(markdownContent, descriptionFallbackLabel);

  const userInvocable =
    frontmatter["user-invocable"] === undefined
      ? true
      : (parseBooleanFrontmatter(frontmatter["user-invocable"]) ?? true);

  const model =
    frontmatter.model === "inherit"
      ? undefined
      : frontmatter.model
        ? parseUserSpecifiedModel(String(frontmatter.model))
        : undefined;

  const effortRaw = frontmatter.effort;
  const effort =
    effortRaw !== undefined ? parseEffortValue(effortRaw) : undefined;
  if (effortRaw !== undefined && effort === undefined) {
    logForDebugging(
      `Skill ${resolvedName} has invalid effort '${effortRaw}'. Valid options: ${EFFORT_LEVELS.join(", ")} or an integer`,
    );
  }

  return {
    displayName:
      frontmatter.name != null ? String(frontmatter.name) : undefined,
    description,
    hasUserSpecifiedDescription: validatedDescription !== null,
    allowedTools: parseSlashCommandToolsFromFrontmatter(
      frontmatter["allowed-tools"],
    ) ?? [],
    argumentHint:
      frontmatter["argument-hint"] != null
        ? String(frontmatter["argument-hint"])
        : undefined,
    argumentNames: parseArgumentNames(
      frontmatter.arguments as string | string[] | undefined,
    ),
    whenToUse: frontmatter.when_to_use as string | undefined,
    version: frontmatter.version as string | undefined,
    model,
    disableModelInvocation:
      parseBooleanFrontmatter(frontmatter["disable-model-invocation"]) ??
      false,
    userInvocable,
    hooks: parseHooksFromFrontmatter(frontmatter, resolvedName),
    executionContext: frontmatter.context === "fork" ? "fork" : undefined,
    agent: frontmatter.agent as string | undefined,
    effort,
    shell: parseShellFrontmatter(frontmatter.shell, resolvedName),
  };
}

// ============================================================================
// Command Creation
// ============================================================================

export function createSkillCommand({
  skillName,
  displayName,
  description,
  hasUserSpecifiedDescription,
  markdownContent,
  allowedTools,
  argumentHint,
  argumentNames,
  whenToUse,
  version,
  model,
  disableModelInvocation,
  userInvocable,
  source,
  baseDir,
  loadedFrom,
  hooks,
  executionContext,
  agent,
  paths,
  effort,
  shell,
}: {
  skillName: string;
  displayName: string | undefined;
  description: string;
  hasUserSpecifiedDescription: boolean;
  markdownContent: string;
  allowedTools: string[];
  argumentHint: string | undefined;
  argumentNames: string[];
  whenToUse: string | undefined;
  version: string | undefined;
  model: string | undefined;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  source: SettingSource | "builtin" | "mcp" | "plugin" | "bundled";
  baseDir: string | undefined;
  loadedFrom: LoadedFrom;
  hooks: HooksSettings | undefined;
  executionContext: "inline" | "fork" | undefined;
  agent: string | undefined;
  paths: string[] | undefined;
  effort: number | undefined;
  shell: FrontmatterShell | undefined;
}): Command {
  return {
    type: "prompt",
    name: skillName,
    description,
    hasUserSpecifiedDescription,
    allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    argumentHint,
    argNames: argumentNames.length > 0 ? argumentNames : undefined,
    whenToUse,
    version,
    model,
    disableModelInvocation,
    userInvocable,
    context: executionContext,
    agent,
    effort,
    paths,
    contentLength: markdownContent.length,
    isHidden: !userInvocable,
    source,
    loadedFrom,
    hooks,
    skillRoot: baseDir,
    progressMessage: "running",
    userFacingName: () => displayName || skillName,
    getPromptForCommand: async (
      args: string,
      toolUseContext: ToolUseContext,
    ): Promise<ContentBlockParam[]> => {
      let finalContent = baseDir
        ? `Base directory for this skill: ${baseDir}\n\n${markdownContent}`
        : markdownContent;

      // Substitute arguments
      if (args && argumentNames.length > 0) {
        for (let i = 0; i < argumentNames.length; i++) {
          const argName = argumentNames[i];
          const argValue = args.split(/\s+/)[i] || "";
          const regex = new RegExp(`\\$\\{${argName}\\}`, "g");
          finalContent = finalContent.replace(regex, argValue);
        }
      }

      // Replace ${CLAUDE_SKILL_DIR} with skill's base directory
      if (baseDir) {
        const skillDir =
          process.platform === "win32"
            ? baseDir.replace(/\\/g, "/")
            : baseDir;
        finalContent = finalContent.replace(
          /\$\{CLAUDE_SKILL_DIR\}/g,
          skillDir,
        );
      }

      // Replace ${CLAUDE_SESSION_ID} with the current session ID
      // (falls back to a random ID if not available)
      const sessionId =
        (toolUseContext as unknown as { dynamicSkillDirTriggers?: Set<string> })
          ?.dynamicSkillDirTriggers?.size?.toString() || "unknown";
      finalContent = finalContent.replace(
        /\$\{CLAUDE_SESSION_ID\}/g,
        sessionId,
      );

      return [{ type: "text", text: finalContent }];
    },
  } satisfies Command;
}

// ============================================================================
// Skills Directory Loader
// ============================================================================

/**
 * Loads skills from a /skills/ directory path.
 * Only supports directory format: skill-name/SKILL.md
 */
function loadSkillsFromSkillsDir(
  basePath: string,
  source: SettingSource,
): SkillWithPath[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(basePath, { withFileTypes: true });
  } catch (e: unknown) {
    const nodeErr = e as NodeJS.ErrnoException;
    if (nodeErr.code !== "ENOENT" && nodeErr.code !== "EACCES") {
      logError(e as Error);
    }
    return [];
  }

  const results: SkillWithPath[] = [];

  for (const entry of entries) {
    try {
      // Only support directory format: skill-name/SKILL.md
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const skillDirPath = path.join(basePath, entry.name);
      const skillFilePath = path.join(skillDirPath, "SKILL.md");

      let content: string;
      try {
        content = fs.readFileSync(skillFilePath, { encoding: "utf-8" });
      } catch (e: unknown) {
        const nodeErr = e as NodeJS.ErrnoException;
        if (nodeErr.code !== "ENOENT") {
          logForDebugging(
            `[skills] failed to read ${skillFilePath}: ${e}`,
          );
        }
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
      const skillPaths = parseSkillPaths(frontmatter);

      results.push({
        skill: createSkillCommand({
          ...parsed,
          skillName,
          markdownContent,
          source,
          baseDir: skillDirPath,
          loadedFrom: "skills",
          paths: skillPaths,
        }),
        filePath: skillFilePath,
      });
    } catch (error) {
      logError(error);
    }
  }

  return results;
}

// ============================================================================
// Legacy /commands/ Loader
// ============================================================================

/**
 * Loads skills from legacy /commands/ directories.
 * Supports both directory format (SKILL.md) and single .md file format.
 */
function loadSkillsFromCommandsDir(
  cwd: string,
): SkillWithPath[] {
  const commandsDirs = getProjectDirsUpToHome("commands", cwd);
  const skills: SkillWithPath[] = [];

  for (const commandsDir of commandsDirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(commandsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      try {
        // Support both directory format (SKILL.md) and single .md files
        let filePath: string;
        let content: string;
        let cmdName: string;
        let skillDirectory: string | undefined;

        if (entry.isDirectory() || entry.isSymbolicLink()) {
          const dirPath = path.join(commandsDir, entry.name);
          const skillFilePath = path.join(dirPath, "SKILL.md");
          try {
            content = fs.readFileSync(skillFilePath, { encoding: "utf-8" });
            filePath = skillFilePath;
            cmdName = entry.name;
            skillDirectory = dirPath;
          } catch {
            continue;
          }
        } else if (entry.name.endsWith(".md")) {
          filePath = path.join(commandsDir, entry.name);
          try {
            content = fs.readFileSync(filePath, { encoding: "utf-8" });
          } catch {
            continue;
          }
          cmdName = entry.name.replace(/\.md$/, "");
        } else {
          continue;
        }

        const { frontmatter, content: markdownContent } = parseFrontmatter(
          content,
          filePath,
        );
        const parsed = parseSkillFrontmatterFields(
          frontmatter,
          markdownContent,
          cmdName,
          "Custom command",
        );

        skills.push({
          skill: createSkillCommand({
            ...parsed,
            skillName: cmdName,
            displayName: undefined,
            markdownContent,
            source: "projectSettings",
            baseDir: skillDirectory,
            loadedFrom: "commands_DEPRECATED",
            paths: undefined,
          }),
          filePath,
        });
      } catch (error) {
        logError(error);
      }
    }
  }

  return skills;
}

// ============================================================================
// Main Skill Loading
// ============================================================================

// Cached skill loading
let skillsCache: Command[] | null = null;

// --- Dynamic skill discovery state ---
const dynamicSkillDirs = new Set<string>();
const dynamicSkills = new Map<string, Command>();

// --- Conditional skills (path-filtered) ---
const conditionalSkills = new Map<string, Command>();
const activatedConditionalSkillNames = new Set<string>();

// Signal fired when dynamic skills are loaded
const skillsLoaded = createSignal();

/**
 * Register a callback to be invoked when dynamic skills are loaded.
 * Returns an unsubscribe function.
 */
export function onDynamicSkillsLoaded(callback: () => void): () => void {
  return skillsLoaded.subscribe(() => {
    try {
      callback();
    } catch (error) {
      logError(error as Error);
    }
  });
}

/** Check if bare mode is active. */
function isBareMode(): boolean {
  return isEnvTruthy(process.env.PAKALON_BARE_MODE);
}

/** Check if a SettingSource is enabled. */
function isSettingSourceEnabled(source: SettingSource): boolean {
  if (source === "policySettings") {
    return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_POLICY_SKILLS);
  }
  if (source === "userSettings") {
    return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_USER_SKILLS);
  }
  if (source === "projectSettings") {
    return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_PROJECT_SKILLS);
  }
  return true;
}

/** Check if skills are restricted to plugin-only loading. */
function isRestrictedToPluginOnly(_domain: string): boolean {
  // Plugin-only restriction not yet implemented in pakalon-cli
  return false;
}

/**
 * Loads all skills from multiple sources.
 *
 * Skills from /skills/ directories:
 *   - Only support directory format: skill-name/SKILL.md
 *   - Default to user-invocable: true
 *
 * Skills from legacy /commands/ directories:
 *   - Support both directory format (SKILL.md) and single .md file format
 *   - Default to user-invocable: true
 *
 * @param cwd Current working directory for project directory traversal
 */
export function getSkillDirCommands(cwd: string): Command[] {
  // Return cached if available
  if (skillsCache !== null) {
    return skillsCache;
  }

  const userSkillsDir = path.join(getClaudeConfigHomeDir(), "skills");
  const managedSkillsDir = path.join(getManagedFilePath(), ".claude", "skills");
  const projectSkillsDirs = getProjectDirsUpToHome(
    path.join(".claude", "skills"),
    cwd,
  );
  // Also check .pakalon/skills and .agents/skills
  const pakalonSkillsDirs = getProjectDirsUpToHome(
    path.join(".pakalon", "skills"),
    cwd,
  );
  const agentSkillsDirs = getProjectDirsUpToHome(
    path.join(".agents", "skills"),
    cwd,
  );
  const allProjectDirs = [
    ...new Set([...projectSkillsDirs, ...pakalonSkillsDirs, ...agentSkillsDirs]),
  ];

  logForDebugging(
    `Loading skills from: managed=${managedSkillsDir}, user=${userSkillsDir}, project=[${allProjectDirs.join(", ")}]`,
  );

  const skillsLocked = isRestrictedToPluginOnly("skills");
  const projectEnabled = isSettingSourceEnabled("projectSettings") && !skillsLocked;

  // --bare mode: skip auto-discovery, skip legacy commands
  if (isBareMode()) {
    skillsCache = [];
    return skillsCache;
  }

  // Load from /skills/ directories and legacy /commands/
  const managedSkills = isSettingSourceEnabled("policySettings")
    ? loadSkillsFromSkillsDir(managedSkillsDir, "policySettings")
    : [];

  const userSkills =
    isSettingSourceEnabled("userSettings") && !skillsLocked
      ? loadSkillsFromSkillsDir(userSkillsDir, "userSettings")
      : [];

  const projectSkills = projectEnabled
    ? allProjectDirs.flatMap((dir) =>
        loadSkillsFromSkillsDir(dir as string, "projectSettings"),
      )
    : [];

  const legacyCommands = skillsLocked
    ? []
    : loadSkillsFromCommandsDir(cwd);

  // Combine all skills
  const allSkillsWithPaths: SkillWithPath[] = [
    ...managedSkills,
    ...userSkills,
    ...projectSkills,
    ...legacyCommands,
  ];

  // Deduplicate by resolved path (handles symlinks and duplicate parent directories)
  const fileIds = allSkillsWithPaths.map(({ filePath }) => filePath);
  // Use synchronous realpath attempt
  const seenFileIds = new Map<string, SettingSource | "builtin" | "mcp" | "plugin" | "bundled">();
  const deduplicatedSkills: Command[] = [];

  for (let i = 0; i < allSkillsWithPaths.length; i++) {
    const entry = allSkillsWithPaths[i];
    if (!entry || entry.skill.type !== "prompt") continue;
    const { skill } = entry;
    const filePath = fileIds[i];
    if (!filePath) {
      deduplicatedSkills.push(skill);
      continue;
    }
    // Try to resolve realpath, fall back to absolute path
    let fileId: string;
    try {
      fileId = fs.realpathSync(filePath);
    } catch {
      fileId = path.resolve(filePath);
    }

    const existingSource = seenFileIds.get(fileId);
    if (existingSource !== undefined) {
      logForDebugging(
        `Skipping duplicate skill '${skill.name}' from ${skill.source} (same file already loaded from ${existingSource})`,
      );
      continue;
    }

    seenFileIds.set(fileId, skill.source);
    deduplicatedSkills.push(skill);
  }

  const duplicatesRemoved = allSkillsWithPaths.length - deduplicatedSkills.length;
  if (duplicatesRemoved > 0) {
    logForDebugging(`Deduplicated ${duplicatesRemoved} skills (same file)`);
  }

  // Separate conditional skills (with paths frontmatter) from unconditional ones
  const unconditionalSkills: Command[] = [];
  const newConditionalSkills: Command[] = [];

  for (const skill of deduplicatedSkills) {
    if (
      skill.type === "prompt" &&
      skill.paths &&
      skill.paths.length > 0 &&
      !activatedConditionalSkillNames.has(skill.name)
    ) {
      newConditionalSkills.push(skill);
    } else {
      unconditionalSkills.push(skill);
    }
  }

  // Store conditional skills for later activation
  for (const skill of newConditionalSkills) {
    conditionalSkills.set(skill.name, skill);
  }

  if (newConditionalSkills.length > 0) {
    logForDebugging(
      `[skills] ${newConditionalSkills.length} conditional skills stored (activated when matching files are touched)`,
    );
  }

  logForDebugging(
    `Loaded ${deduplicatedSkills.length} unique skills (${unconditionalSkills.length} unconditional, ${newConditionalSkills.length} conditional, managed: ${managedSkills.length}, user: ${userSkills.length}, project: ${projectSkills.length}, legacy commands: ${legacyCommands.length})`,
  );

  skillsCache = unconditionalSkills;
  return skillsCache;
}

export function clearSkillCaches(): void {
  skillsCache = null;
  conditionalSkills.clear();
  activatedConditionalSkillNames.clear();
}

// Backward-compatible aliases
export { getSkillDirCommands as getCommandDirCommands };
export { clearSkillCaches as clearCommandCaches };

// ============================================================================
// Dynamic Skill Discovery
// ============================================================================

/**
 * Discovers skill directories by walking up from file paths to cwd.
 * Only discovers directories below cwd (cwd-level skills are loaded at startup).
 */
export async function discoverSkillDirsForPaths(
  filePaths: string[],
  cwd: string,
): Promise<string[]> {
  const resolvedCwd = cwd.endsWith(path.sep) ? cwd.slice(0, -1) : cwd;
  const newDirs: string[] = [];

  for (const filePath of filePaths) {
    let currentDir = path.dirname(filePath);

    // Walk up to cwd but NOT including cwd itself
    const cwdPrefix = resolvedCwd + path.sep;
    while (currentDir.startsWith(cwdPrefix)) {
      const skillDir = path.join(currentDir, ".claude", "skills");

      if (!dynamicSkillDirs.has(skillDir)) {
        dynamicSkillDirs.add(skillDir);
        try {
          fs.statSync(skillDir);
          newDirs.push(skillDir);
        } catch {
          // Directory doesn't exist — already recorded above
        }
      }

      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
  }

  // Sort by path depth (deepest first)
  return newDirs.sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length,
  );
}

/**
 * Loads skills from the given directories and merges them into the dynamic skills map.
 * Skills from directories closer to the file (deeper paths) take precedence.
 */
export async function addSkillDirectories(dirs: string[]): Promise<void> {
  if (
    !isSettingSourceEnabled("projectSettings") ||
    isRestrictedToPluginOnly("skills")
  ) {
    logForDebugging(
      "[skills] Dynamic skill discovery skipped: projectSettings disabled or plugin-only policy",
    );
    return;
  }
  if (dirs.length === 0) return;

  const previousSkillNamesForLogging = new Set(dynamicSkills.keys());

  // Load skills from all directories
  const loadedSkills = dirs.map((dir) =>
    loadSkillsFromSkillsDir(dir, "projectSettings"),
  );

  // Process in reverse order (shallower first) so deeper paths override
  for (let i = loadedSkills.length - 1; i >= 0; i--) {
    for (const { skill } of loadedSkills[i] ?? []) {
      if (skill.type === "prompt") {
        dynamicSkills.set(skill.name, skill);
      }
    }
  }

  const newSkillCount = loadedSkills.flat().length;
  if (newSkillCount > 0) {
    const addedSkills = [...dynamicSkills.keys()].filter(
      (n) => !previousSkillNamesForLogging.has(n),
    );
    logForDebugging(
      `[skills] Dynamically discovered ${newSkillCount} skills from ${dirs.length} directories`,
    );
    if (addedSkills.length > 0) {
      logForDebugging(
        `[skills] Added skills: ${addedSkills.join(", ")}`,
      );
    }
  }

  // Notify listeners that skills were loaded
  skillsLoaded.emit();
}

/**
 * Gets all dynamically discovered skills.
 * These are skills discovered from file paths during the session.
 */
export function getDynamicSkills(): Command[] {
  return Array.from(dynamicSkills.values());
}

/**
 * Activates conditional skills (skills with paths frontmatter) whose path
 * patterns match the given file paths. Activated skills are added to the
 * dynamic skills map, making them available to the model.
 */
export function activateConditionalSkillsForPaths(
  filePaths: string[],
  cwd: string,
): string[] {
  if (conditionalSkills.size === 0) return [];

  const activated: string[] = [];

  for (const [name, skill] of conditionalSkills) {
    if (skill.type !== "prompt" || !skill.paths || skill.paths.length === 0) {
      continue;
    }

    const skillIgnore = ignore().add(skill.paths);
    for (const filePath of filePaths) {
      const relativePath = path.isAbsolute(filePath)
        ? path.relative(cwd, filePath)
        : filePath;

      if (
        !relativePath ||
        relativePath.startsWith("..") ||
        path.isAbsolute(relativePath)
      ) {
        continue;
      }

      if (skillIgnore.ignores(relativePath)) {
        dynamicSkills.set(name, skill);
        conditionalSkills.delete(name);
        activatedConditionalSkillNames.add(name);
        activated.push(name);
        logForDebugging(
          `[skills] Activated conditional skill '${name}' (matched path: ${relativePath})`,
        );
        break;
      }
    }
  }

  if (activated.length > 0) {
    logForDebugging(
      `[skills] Activated ${activated.length} conditional skills: ${activated.join(", ")}`,
    );
    skillsLoaded.emit();
  }

  return activated;
}

/** Gets the number of pending conditional skills (for testing/debugging). */
export function getConditionalSkillCount(): number {
  return conditionalSkills.size;
}

/** Clears dynamic skill state (for testing). */
export function clearDynamicSkills(): void {
  dynamicSkillDirs.clear();
  dynamicSkills.clear();
  conditionalSkills.clear();
  activatedConditionalSkillNames.clear();
}

// ============================================================================
// MCP Skill Builder Registration
// ============================================================================

// Register MCP skill builders so mcpSkillBuilders.ts can use them
registerMCPSkillBuilders({
  createSkillCommand,
  parseSkillFrontmatterFields,
});
