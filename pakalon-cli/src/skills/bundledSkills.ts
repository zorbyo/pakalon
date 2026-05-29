/**
 * Bundled Skills Registry
 *
 * Manages skills that ship with the CLI binary. Bundled skills are registered
 * programmatically at startup via registerBundledSkill(), unlike file-based
 * skills which are loaded from disk directories.
 *
 * Bundled skills can optionally include reference files that are extracted
 * to a temporary directory on first invocation, giving the model access to
 * supporting scripts/templates via Read/Grep.
 */

import { constants as fsConstants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep as pathSep } from "node:path";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";
import type { Command } from "@/types-imported/command.js";
import type { ToolUseContext } from "@/tools/tool-types.js";
import type { HooksSettings } from "@/utils/settings/settings.js";
import { logForDebugging } from "@/utils/debug.js";
import { getEmbeddedSkillRoots } from "@/utils/claude-imports.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Definition for a bundled skill that ships with the CLI.
 * These are registered programmatically at startup.
 */
export type BundledSkillDefinition = {
  name: string;
  description: string;
  aliases?: string[];
  whenToUse?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  isEnabled?: () => boolean;
  hooks?: HooksSettings;
  context?: "inline" | "fork";
  agent?: string;
  /**
   * Additional reference files to extract to disk on first invocation.
   * Keys are relative paths (forward slashes), values are content.
   * When set, the skill prompt is prefixed with a "Base directory for this
   * skill: <dir>" line so the model can Read/Grep these files on demand.
   */
  files?: Record<string, string>;
  getPromptForCommand: (
    args: string,
    context: ToolUseContext,
  ) => Promise<ContentBlockParam[]>;
};

// ============================================================================
// Registry
// ============================================================================

const bundledSkills: Command[] = [];

/**
 * Register a bundled skill that will be available to the model.
 * Call this at module initialization or in an init function.
 */
export function registerBundledSkill(
  definition: BundledSkillDefinition,
): void {
  const { files } = definition;

  let skillRoot: string | undefined;
  let getPromptForCommand = definition.getPromptForCommand;

  // If the skill has reference files, extract them lazily on first invocation
  if (files && Object.keys(files).length > 0) {
    skillRoot = getBundledSkillExtractDir(definition.name);
    let extractionPromise: Promise<string | null> | undefined;
    const inner = definition.getPromptForCommand;
    getPromptForCommand = async (
      args: string,
      ctx: ToolUseContext,
    ): Promise<ContentBlockParam[]> => {
      extractionPromise ??= extractBundledSkillFiles(definition.name, files);
      const extractedDir = await extractionPromise;
      const blocks = await inner(args, ctx);
      if (extractedDir === null) return blocks;
      return prependBaseDir(blocks, extractedDir);
    };
  }

  const command: Command = {
    type: "prompt",
    name: definition.name,
    description: definition.description,
    aliases: definition.aliases,
    hasUserSpecifiedDescription: true,
    allowedTools: definition.allowedTools ?? [],
    argumentHint: definition.argumentHint,
    whenToUse: definition.whenToUse,
    model: definition.model,
    disableModelInvocation: definition.disableModelInvocation ?? false,
    userInvocable: definition.userInvocable ?? true,
    contentLength: 0, // Not applicable for bundled skills
    source: "bundled",
    loadedFrom: "bundled",
    hooks: definition.hooks,
    skillRoot,
    context: definition.context,
    agent: definition.agent,
    isEnabled: definition.isEnabled,
    isHidden: !(definition.userInvocable ?? true),
    progressMessage: "running",
    userFacingName: () => definition.name,
    getPromptForCommand,
  };
  bundledSkills.push(command);
}

/**
 * Get all registered bundled skills.
 * Returns a copy to prevent external mutation.
 */
export function getBundledSkills(): Command[] {
  return [...bundledSkills].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Clear bundled skills registry (for testing).
 */
export function clearBundledSkills(): void {
  bundledSkills.length = 0;
}

// ============================================================================
// Reference File Extraction
// ============================================================================

/**
 * Deterministic extraction directory for a bundled skill's reference files.
 */
export function getBundledSkillExtractDir(skillName: string): string {
  return join(getBundledSkillsRoot(), skillName);
}

/**
 * Get the root directory under which bundled skill reference files are extracted.
 */
function getBundledSkillsRoot(): string {
  // Use the first embedded skill root, or fall back to a temp directory
  const embedded = getEmbeddedSkillRoots();
  if (embedded.length > 0) {
    return join(embedded[0] ?? ".pakalon", ".bundled-skills");
  }
  return join(".pakalon", ".bundled-skills");
}

/**
 * Extract a bundled skill's reference files to disk so the model can
 * Read/Grep them on demand. Called lazily on first skill invocation.
 *
 * Returns the directory written to, or null if write failed (skill
 * continues to work, just without the base-directory prefix).
 */
async function extractBundledSkillFiles(
  skillName: string,
  files: Record<string, string>,
): Promise<string | null> {
  const dir = getBundledSkillExtractDir(skillName);
  try {
    await writeSkillFiles(dir, files);
    return dir;
  } catch (e) {
    logForDebugging(
      `Failed to extract bundled skill '${skillName}' to ${dir}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

async function writeSkillFiles(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  // Group by parent dir so we mkdir each subtree once, then write
  const byParent = new Map<string, [string, string][]>();
  for (const [relPath, content] of Object.entries(files)) {
    const target = resolveSkillFilePath(dir, relPath);
    const parent = dirname(target);
    const entry: [string, string] = [target, content];
    const group = byParent.get(parent);
    if (group) group.push(entry);
    else byParent.set(parent, [entry]);
  }
  await Promise.all(
    [...byParent].map(async ([parent, entries]) => {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await Promise.all(entries.map(([p, c]) => safeWriteFile(p, c)));
    }),
  );
}

// SAFE_WRITE_FLAGS: O_NOFOLLOW | O_CREAT | O_EXCL (platform-appropriate)
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const SAFE_WRITE_FLAGS =
  process.platform === "win32"
    ? "wx"
    : fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      O_NOFOLLOW;

async function safeWriteFile(p: string, content: string): Promise<void> {
  const fh = await open(p, SAFE_WRITE_FLAGS, 0o600);
  try {
    await fh.writeFile(content, "utf8");
  } finally {
    await fh.close();
  }
}

/** Normalize and validate a skill-relative path; throws on traversal. */
function resolveSkillFilePath(baseDir: string, relPath: string): string {
  const normalized = normalize(relPath);
  if (
    isAbsolute(normalized) ||
    normalized.split(pathSep).includes("..") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`bundled skill file path escapes skill dir: ${relPath}`);
  }
  return join(baseDir, normalized);
}

function prependBaseDir(
  blocks: ContentBlockParam[],
  baseDir: string,
): ContentBlockParam[] {
  const prefix = `Base directory for this skill: ${baseDir}\n\n`;
  if (blocks.length > 0 && blocks[0]!.type === "text") {
    return [
      { type: "text", text: prefix + blocks[0]!.text },
      ...blocks.slice(1),
    ];
  }
  return [{ type: "text", text: prefix }, ...blocks];
}
