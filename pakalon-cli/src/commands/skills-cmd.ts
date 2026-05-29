/**
 * Skills command backed by real skill directories.
 */
import type { CommandContext, CommandResult } from "./types.js";
import {
  discoverSkillCatalog,
  findSkillCatalogEntry,
  searchSkillCatalog,
  type SkillCatalogSource,
} from "@/skills/catalog.js";
import { summarizeVendoredEverythingAssets } from "@/utils/claude-imports.js";
import logger from "@/utils/logger.js";
import fs from "fs";
import path from "path";
import { type SkillCatalogEntry } from "@/skills/catalog.js";

export type SkillCategory =
  | "development"
  | "testing"
  | "documentation"
  | "devops"
  | "database"
  | "security"
  | "ai"
  | "utility"
  | "language"
  | "framework"
  | "other";

export interface SkillDefinition {
  name: string;
  description: string;
  version?: string;
  author?: string;
  keywords?: string[];
  category?: SkillCategory;
  triggers?: string[];
  tools?: string[];
  prompts?: string[];
  enabled: boolean;
  source: "project" | "global" | "embedded" | "vendored";
  path?: string;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  version: string;
  downloads?: number;
  rating?: number;
  installed: boolean;
  source?: SkillCatalogSource;
  path?: string;
}

const loadedSkills: Map<string, SkillDefinition> = new Map();
const disabledSkills: Set<string> = new Set();

function normalizeCategory(value: unknown): SkillCategory {
  if (typeof value !== "string") {
    return "other";
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "development":
    case "testing":
    case "documentation":
    case "devops":
    case "database":
    case "security":
    case "ai":
    case "utility":
    case "language":
    case "framework":
      return normalized;
    default:
      return "other";
  }
}

function toSkillDefinition(entry: ReturnType<typeof discoverSkillCatalog>[number]): SkillDefinition {
  return {
    name: entry.name,
    description: entry.description,
    version: typeof entry.frontmatter.version === "string" ? entry.frontmatter.version : undefined,
    author: typeof entry.frontmatter.author === "string" ? entry.frontmatter.author : undefined,
    keywords: entry.keywords,
    category: normalizeCategory(entry.frontmatter.category),
    triggers: entry.triggers,
    tools: Array.isArray(entry.frontmatter["allowed-tools"])
      ? entry.frontmatter["allowed-tools"].filter((item): item is string => typeof item === "string")
      : undefined,
    prompts: undefined,
    enabled: !disabledSkills.has(entry.name),
    source: entry.source,
    path: entry.path,
  };
}

function refreshSkillCache(): SkillDefinition[] {
  const discovered = discoverSkillCatalog({ includeContent: false }).map(toSkillDefinition);
  loadedSkills.clear();
  for (const skill of discovered) {
    loadedSkills.set(skill.name, skill);
  }
  return discovered;
}

function sourceLabel(source: SkillDefinition["source"]): string {
  switch (source) {
    case "project":
      return "project";
    case "global":
      return "global";
    case "embedded":
      return "embedded";
    case "vendored":
      return "vendored";
  }
}

function formatSkillList(skills: SkillDefinition[], showDisabled = true): string {
  const visible = showDisabled ? skills : skills.filter((skill) => skill.enabled);
  if (visible.length === 0) {
    return "No skills discovered.";
  }

  const lines: string[] = [];
  const groups = new Map<SkillDefinition["source"], SkillDefinition[]>();

  for (const skill of visible) {
    const group = groups.get(skill.source) ?? [];
    group.push(skill);
    groups.set(skill.source, group);
  }

  let globalIndex = 0;
  for (const source of ["project", "global", "embedded", "vendored"] as const) {
    const group = groups.get(source);
    if (!group || group.length === 0) {
      continue;
    }

    lines.push(`${sourceLabel(source)} skills`);
    lines.push("-".repeat(32));
    for (const skill of group.sort((left, right) => left.name.localeCompare(right.name))) {
      globalIndex++;
      const state = skill.enabled ? "enabled" : "disabled";
      lines.push(`${globalIndex}. ${skill.name} [${state}]`);
      lines.push(`   ${skill.description}`);
      if (skill.path) {
        lines.push(`   path: ${skill.path}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function formatSkillInfo(skill: SkillDefinition): string {
  const lines: string[] = [
    skill.name,
    "=".repeat(skill.name.length),
    skill.description,
    "",
    `source: ${sourceLabel(skill.source)}`,
    `status: ${skill.enabled ? "enabled" : "disabled"}`,
  ];

  if (skill.category) lines.push(`category: ${skill.category}`);
  if (skill.version) lines.push(`version: ${skill.version}`);
  if (skill.author) lines.push(`author: ${skill.author}`);
  if (skill.path) lines.push(`path: ${skill.path}`);
  if (skill.triggers?.length) lines.push(`triggers: ${skill.triggers.join(", ")}`);
  if (skill.keywords?.length) lines.push(`keywords: ${skill.keywords.join(", ")}`);
  if (skill.tools?.length) lines.push(`allowed tools: ${skill.tools.join(", ")}`);

  return lines.join("\n");
}

function formatSearchResults(query: string, results: SkillSearchResult[]): string {
  if (results.length === 0) {
    return `No skills found matching: ${query}`;
  }

  const lines: string[] = [
    `Search results for: ${query}`,
    "-".repeat(40),
  ];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    lines.push(`${i + 1}. ${result.name} [${result.source ?? "unknown"}]`);
    lines.push(`   ${result.description}`);
    if (result.path) {
      lines.push(`   path: ${result.path}`);
    }
  }

  return lines.join("\n");
}

export async function discoverAllSkills(): Promise<SkillDefinition[]> {
  return refreshSkillCache();
}

export async function enableSkill(name: string): Promise<boolean> {
  refreshSkillCache();
  if (!loadedSkills.has(name)) {
    return false;
  }

  disabledSkills.delete(name);
  const skill = loadedSkills.get(name);
  if (skill) {
    skill.enabled = true;
  }
  logger.info(`[skills] enabled ${name}`);
  return true;
}

export async function disableSkill(name: string): Promise<boolean> {
  refreshSkillCache();
  if (!loadedSkills.has(name)) {
    return false;
  }

  disabledSkills.add(name);
  const skill = loadedSkills.get(name);
  if (skill) {
    skill.enabled = false;
  }
  logger.info(`[skills] disabled ${name}`);
  return true;
}

export function getSkill(name: string): SkillDefinition | undefined {
  refreshSkillCache();
  return loadedSkills.get(name);
}

export function getActiveSkills(): SkillDefinition[] {
  return refreshSkillCache().filter((skill) => skill.enabled);
}

export function getSkillByTrigger(trigger: string): SkillDefinition | undefined {
  const needle = trigger.toLowerCase();
  return refreshSkillCache().find((skill) => {
    if (!skill.enabled) return false;
    return (
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle) ||
      skill.triggers?.some((item) => item.toLowerCase().includes(needle)) ||
      skill.keywords?.some((item) => item.toLowerCase().includes(needle))
    );
  });
}

export async function searchSkills(query: string): Promise<SkillSearchResult[]> {
  return searchSkillCatalog(query, { includeContent: true }).map((entry) => ({
    name: entry.name,
    description: entry.description,
    version: typeof entry.frontmatter.version === "string" ? entry.frontmatter.version : "unknown",
    installed: true,
    source: entry.source,
    path: entry.path,
  }));
}

export async function installSkill(name: string): Promise<{ success: boolean; message: string }> {
  const vendored = findSkillCatalogEntry(name, { includeContent: false });
  if (!vendored) {
    return {
      success: false,
      message: `Skill not found: ${name}`,
    };
  }

  return {
    success: false,
    message: `Skill "${vendored.name}" is already available from ${vendored.source}. Direct install/copy is not implemented in this migration slice.`,
  };
}

export async function uninstallSkill(name: string): Promise<{ success: boolean; message: string }> {
  if (!loadedSkills.has(name) && !findSkillCatalogEntry(name, { includeContent: false })) {
    return { success: false, message: `Skill not found: ${name}` };
  }

  return {
    success: false,
    message: `Uninstall is not implemented for imported skills in this migration slice.`,
  };
}

export function isCreateSkillSelection(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return (
    trimmed === "0" ||
    trimmed === "new" ||
    trimmed === "create" ||
    trimmed === "create skill" ||
    trimmed === "new skill"
  );
}

export function slugifySkillName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `skill-${Date.now()}`;
}

export function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function parseSkillCreationInput(input: string): {
  name: string;
  description: string;
} {
  const trimmed = input.trim();
  const match = trimmed.match(/^(.+?)(?:\s+-\s+|\s+:\s+)(.+)$/);
  const name = (match?.[1] ?? trimmed).trim();
  const description =
    (match?.[2] ?? `Use this skill when the user asks for ${name}.`).trim();
  return { name, description };
}

export function buildSkillTemplate(name: string, description: string): string {
  return `---
name: ${yamlString(name)}
description: ${yamlString(description)}
keywords: []
triggers: []
---

# ${name}

## When to Use

${description}

## Instructions

- Follow the user's prompt and apply this skill's domain-specific constraints.
- Ask for clarification only when the requested outcome is ambiguous or risky.
- Keep outputs concise and directly actionable.
`;
}

export function createProjectSkill(
  projectDir: string,
  rawInput: string,
): SkillCatalogEntry {
  const { name, description } = parseSkillCreationInput(rawInput);
  if (!name) {
    throw new Error("Skill name is required.");
  }

  const rootDir = path.join(projectDir, ".pakalon", "skills");
  const skillDir = path.join(rootDir, slugifySkillName(name));
  const skillPath = path.join(skillDir, "SKILL.md");
  fs.mkdirSync(skillDir, { recursive: true });
  if (!fs.existsSync(skillPath)) {
    fs.writeFileSync(skillPath, buildSkillTemplate(name, description), "utf-8");
  }

  const entry = findSkillCatalogEntry(name, {
    includeContent: true,
    projectDir,
    sources: ["project"],
  });
  if (entry) return entry;

  const content = fs.readFileSync(skillPath, "utf-8");
  return {
    name,
    description,
    source: "project",
    path: skillPath,
    rootDir,
    content,
    frontmatter: { name, description },
    keywords: [],
    triggers: [],
  };
}

export function resolveSkillChoice(
  input: string,
  choices: SkillCatalogEntry[],
): SkillCatalogEntry | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const numeric = Number.parseInt(trimmed, 10);
  if (Number.isInteger(numeric) && String(numeric) === trimmed) {
    return choices[numeric - 1] ?? null;
  }

  const needle = trimmed.toLowerCase();
  return (
    choices.find((skill) => skill.name.toLowerCase() === needle) ??
    choices.find((skill) => skill.name.toLowerCase().includes(needle)) ??
    choices.find((skill) => skill.description.toLowerCase().includes(needle)) ??
    null
  );
}

export function formatSkillChoices(skills: SkillCatalogEntry[]): string {
  if (skills.length === 0) {
    return [
      "**Available Skills (0)**",
      "",
      "  0. + Create a new skill",
      "",
      "Type `0` and press Enter to create a project skill.",
    ].join("\n");
  }

  const visible = skills.slice(0, 50);
  const rows = visible.map((skill, index) => {
    const location = skill.path ? `\n    ${skill.path}` : "";
    return `  ${index + 1}. ${skill.name} - ${skill.description}${location}`;
  });
  const hidden =
    skills.length > visible.length
      ? `\n\nShowing ${visible.length} of ${skills.length} skills. Type a more specific name to select a hidden skill.`
      : "";

  return [
    `**Available Skills (${skills.length})**`,
    "",
    "  0. + Create a new skill",
    "",
    ...rows,
    "",
    "Type `0`, a skill name, or a listed number and press Enter.",
    hidden,
  ]
    .filter(Boolean)
    .join("\n");
}

export const skillsCommand = {
  name: "skills",
  aliases: ["skill"],
  description: "List and manage discovered skills",
  usage: "/skills [list|enable|disable|search|info|sources] [name]",
  category: "mcp" as const,

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const action = args[0]?.toLowerCase() ?? "list";
    const skillName = args[1];
    const skillProjectDir = context.cwd ?? process.cwd();

    // 1. If in TUI interactive mode (indicated by TUI callbacks in context), intercept the behavior
    const hasTuiCallbacks = typeof context.setPendingSkillChoices === "function";

    if (hasTuiCallbacks) {
      const setPendingSkillChoices = context.setPendingSkillChoices as (choices: any) => void;
      const setPendingSkillCreate = context.setPendingSkillCreate as (val: boolean) => void;
      const activateSkillInstruction = context.activateSkillInstruction as (skill: any) => void;
      const setActiveSkillInstructions = context.setActiveSkillInstructions as (skills: any[]) => void;
      const activeSkillInstructions = (context.activeSkillInstructions as any[]) ?? [];
      const info = (msg: string) => {
        if (context.info) {
          (context.info as (m: string) => void)(msg);
        }
      };

      const allSkills = discoverSkillCatalog({
        includeContent: false,
        projectDir: skillProjectDir,
      });

      if (action === "list" || action === "ls") {
        setPendingSkillChoices(allSkills);
        setPendingSkillCreate(false);
        info(formatSkillChoices(allSkills));
        return { success: true };
      }

      if (action === "create" || action === "new") {
        const rawSkillInput = args.slice(1).join(" ").trim();
        if (!rawSkillInput) {
          setPendingSkillChoices(null);
          setPendingSkillCreate(true);
          info("Type the new skill name, optionally followed by ` - description`, or `cancel`.");
          return { success: true };
        }
        try {
          const createdSkill = createProjectSkill(skillProjectDir, rawSkillInput);
          activateSkillInstruction(createdSkill);
          info(
            `Created and activated skill **${createdSkill.name}**.\n\nInstruction file: \`${createdSkill.path}\``,
          );
          return { success: true };
        } catch (e: any) {
          info(`Could not create skill: ${e.message}`);
          return { success: false, message: `Could not create skill: ${e.message}` };
        }
      }

      if (action === "clear" || action === "reset") {
        setActiveSkillInstructions([]);
        setPendingSkillChoices(null);
        setPendingSkillCreate(false);
        info("Active skill instructions cleared.");
        return { success: true };
      }

      if (action === "active" || action === "status") {
        if (activeSkillInstructions.length === 0) {
          info("No skill instructions are active. Run `/skills` to choose one.");
          return { success: true };
        }
        info(
          [
            `**Active Skills (${activeSkillInstructions.length})**`,
            "",
            ...activeSkillInstructions.map(
              (skill, index) =>
                `  ${index + 1}. ${skill.name}\n     ${skill.path}`,
            ),
          ].join("\n"),
        );
        return { success: true };
      }

      if (action === "search") {
        const query = args.slice(1).join(" ").trim().toLowerCase();
        if (!query) {
          info("Usage: `/skills search <query>`");
          return { success: false, message: "Usage: `/skills search <query>`" };
        }
        const matches = allSkills.filter(
          (skill) =>
            skill.name.toLowerCase().includes(query) ||
            skill.description.toLowerCase().includes(query) ||
            skill.keywords.some((keyword) =>
              keyword.toLowerCase().includes(query),
            ) ||
            skill.triggers.some((trigger) =>
              trigger.toLowerCase().includes(query),
            ),
        );
        setPendingSkillChoices(matches);
        setPendingSkillCreate(false);
        info(formatSkillChoices(matches));
        return { success: true };
      }

      const requestedName =
        action === "load" || action === "use"
          ? args.slice(1).join(" ").trim()
          : args.join(" ").trim();

      if (!requestedName) {
        info("Usage: `/skills [list|load <name>|search <query>|active|clear]`");
        return { success: true };
      }

      const selectedSkill = findSkillCatalogEntry(requestedName, {
        includeContent: true,
        projectDir: skillProjectDir,
      });
      if (!selectedSkill) {
        setPendingSkillChoices(allSkills);
        setPendingSkillCreate(false);
        info(
          `Skill not found: ${requestedName}\n\n${formatSkillChoices(allSkills)}`,
        );
        return { success: false, message: `Skill not found: ${requestedName}` };
      }

      activateSkillInstruction(selectedSkill);
      return { success: true };
    }

    // 2. Headless/Standard mode: execute the legacy commands registry logic
    const skills = await discoverAllSkills();
    switch (action) {
      case "list":
      case "ls":
        return {
          success: true,
          message: formatSkillList(skills, !args.includes("--enabled")),
        };

      case "enable":
        if (!skillName) {
          return { success: false, message: "Skill name required: /skills enable <name>" };
        }
        return {
          success: await enableSkill(skillName),
          message: loadedSkills.has(skillName)
            ? `Enabled skill: ${skillName}`
            : `Skill not found: ${skillName}`,
        };

      case "disable":
        if (!skillName) {
          return { success: false, message: "Skill name required: /skills disable <name>" };
        }
        return {
          success: await disableSkill(skillName),
          message: loadedSkills.has(skillName)
            ? `Disabled skill: ${skillName}`
            : `Skill not found: ${skillName}`,
        };

      case "info":
        if (!skillName) {
          return { success: false, message: "Skill name required: /skills info <name>" };
        }
        const info = getSkill(skillName);
        return info
          ? { success: true, message: formatSkillInfo(info) }
          : { success: false, message: `Skill not found: ${skillName}` };

      case "search":
        {
          const query = args.slice(1).join(" ").trim();
          if (!query) {
            return { success: false, message: "Search query required: /skills search <query>" };
          }
          const results = await searchSkills(query);
          return {
            success: true,
            message: formatSearchResults(query, results),
          };
        }

      case "sources":
        {
          const summary = summarizeVendoredEverythingAssets();
          const lines = [
            "skills command sources",
            "--------------------",
            `vendored root: ${summary.root}`,
            ...summary.skillRoots.map((root) => `skill root: ${root}`),
            ...summary.pluginRoots.map((root) => `plugin root: ${root}`),
            ...summary.hookRoots.map((root) => `hook root: ${root}`),
            ...summary.manifestPaths.map((file) => `manifest: ${file}`),
            ...summary.mcpConfigPaths.map((file) => `mcp config: ${file}`),
          ];
          return {
            success: true,
            message: lines.join("\n"),
          };
        }

      case "install":
        if (!skillName) {
          return { success: false, message: "Skill name required: /skills install <name>" };
        }
        return await installSkill(skillName);

      case "uninstall":
      case "remove":
        if (!skillName) {
          return { success: false, message: "Skill name required: /skills uninstall <name>" };
        }
        return await uninstallSkill(skillName);

      case "create":
      case "new":
        {
          const rawSkillInput = args.slice(1).join(" ").trim();
          if (!rawSkillInput) {
            return { success: false, message: "Skill name and optional description required: /skills create <name> [- description]" };
          }
          try {
            const createdSkill = createProjectSkill(skillProjectDir, rawSkillInput);
            return {
              success: true,
              message: `Created skill **${createdSkill.name}**.\n\nInstruction file: \`${createdSkill.path}\``,
            };
          } catch (e: any) {
            return { success: false, message: `Could not create skill: ${e.message}` };
          }
        }

      default:
        // Attempt to load by name if action exists in catalog
        const found = findSkillCatalogEntry(action, {
          includeContent: true,
          projectDir: skillProjectDir,
        });
        if (found) {
          return {
            success: true,
            message: `Loaded skill: ${found.name}\n\nPath: ${found.path}`,
          };
        }
        return {
          success: false,
          message: `Unknown action: ${action}\nUsage: /skills [list|enable|disable|search|info|sources]`,
        };
    }
  },
};

export default {
  skillsCommand,
  discoverAllSkills,
  enableSkill,
  disableSkill,
  getSkill,
  getActiveSkills,
  getSkillByTrigger,
  searchSkills,
  installSkill,
  uninstallSkill,
  isCreateSkillSelection,
  slugifySkillName,
  yamlString,
  parseSkillCreationInput,
  buildSkillTemplate,
  createProjectSkill,
  resolveSkillChoice,
  formatSkillChoices,
};
