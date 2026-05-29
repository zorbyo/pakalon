import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  getEmbeddedSkillRoots,
  getVendoredEverythingSkillRoots,
} from "@/utils/claude-imports.js";

export type SkillCatalogSource = "project" | "global" | "embedded" | "vendored";

export interface SkillCatalogEntry {
  name: string;
  description: string;
  source: SkillCatalogSource;
  path: string;
  rootDir: string;
  content?: string;
  frontmatter: Record<string, unknown>;
  keywords: string[];
  triggers: string[];
}

interface SkillRoot {
  rootDir: string;
  source: SkillCatalogSource;
  priority: number;
}

interface SkillCatalogOptions {
  includeContent?: boolean;
  projectDir?: string;
  sources?: SkillCatalogSource[];
}

function parseFrontmatter(markdown: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: {}, body: normalized };
  }

  try {
    const parsed = yaml.load(match[1] ?? "");
    return {
      frontmatter: parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {},
      body: normalized.slice(match[0].length),
    };
  } catch {
    return { frontmatter: {}, body: normalized.slice(match[0].length) };
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function extractDescriptionFromBody(body: string, fallback: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const heading = lines.find((line) => line.startsWith("# "));
  if (heading) {
    return heading.replace(/^#\s+/, "").trim();
  }

  const prose = lines.find((line) => !line.startsWith("#"));
  return prose ?? fallback;
}

function buildSkillRoots(projectDir: string, sources?: SkillCatalogSource[]): SkillRoot[] {
  const sourceFilter = sources ? new Set(sources) : null;
  const roots: SkillRoot[] = [
    {
      rootDir: path.join(projectDir, ".pakalon", "skills"),
      source: "project",
      priority: 400,
    },
    {
      rootDir: path.join(projectDir, ".claude", "skills"),
      source: "project",
      priority: 390,
    },
    {
      rootDir: path.join(projectDir, ".agents", "skills"),
      source: "project",
      priority: 380,
    },
    {
      rootDir: path.join(projectDir, ".pakalon-agents", "skills"),
      source: "project",
      priority: 370,
    },
    {
      rootDir: path.join(os.homedir(), ".agents", "skills"),
      source: "global",
      priority: 300,
    },
    {
      rootDir: path.join(os.homedir(), ".claude", "skills"),
      source: "global",
      priority: 290,
    },
    {
      rootDir: path.join(os.homedir(), ".pakalon", "skills"),
      source: "global",
      priority: 280,
    },
    ...getEmbeddedSkillRoots().map((rootDir) => ({
      rootDir,
      source: "embedded" as const,
      priority: 200,
    })),
    ...getVendoredEverythingSkillRoots().map((rootDir) => ({
      rootDir,
      source: "vendored" as const,
      priority: 100,
    })),
  ];

  return roots.filter((root, index, all) =>
    (!sourceFilter || sourceFilter.has(root.source)) &&
    fs.existsSync(root.rootDir) &&
    all.findIndex((candidate) => candidate.rootDir === root.rootDir) === index
  );
}

function readSkillEntry(
  skillDir: string,
  root: SkillRoot,
  includeContent: boolean,
): SkillCatalogEntry | null {
  const skillFile = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(skillFile, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    const nameFromFrontmatter = typeof frontmatter.name === "string"
      ? frontmatter.name.trim()
      : "";
    const skillName = nameFromFrontmatter || path.basename(skillDir);
    const descriptionFromFrontmatter = typeof frontmatter.description === "string"
      ? frontmatter.description.trim()
      : "";

    return {
      name: skillName,
      description: descriptionFromFrontmatter || extractDescriptionFromBody(body, skillName),
      source: root.source,
      path: skillFile,
      rootDir: root.rootDir,
      ...(includeContent ? { content } : {}),
      frontmatter,
      keywords: normalizeStringArray(frontmatter.keywords),
      triggers: normalizeStringArray(frontmatter.triggers),
    };
  } catch {
    return null;
  }
}

export function discoverSkillCatalog(options?: {
  includeContent?: boolean;
  projectDir?: string;
  sources?: SkillCatalogSource[];
}): SkillCatalogEntry[] {
  const projectDir = path.resolve(options?.projectDir ?? process.cwd());
  const includeContent = options?.includeContent ?? false;
  const roots = buildSkillRoots(projectDir, options?.sources);
  const deduped = new Map<string, { entry: SkillCatalogEntry; priority: number }>();

  for (const root of roots) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root.rootDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const skill = readSkillEntry(path.join(root.rootDir, entry.name), root, includeContent);
      if (!skill) {
        continue;
      }

      const existing = deduped.get(skill.name);
      if (!existing || root.priority > existing.priority) {
        deduped.set(skill.name, { entry: skill, priority: root.priority });
      }
    }
  }

  return Array.from(deduped.values())
    .map((value) => value.entry)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function findSkillCatalogEntry(
  skillName: string,
  options?: SkillCatalogOptions,
): SkillCatalogEntry | null {
  const entries = discoverSkillCatalog({
    includeContent: options?.includeContent ?? true,
    projectDir: options?.projectDir,
    sources: options?.sources,
  });
  const needle = skillName.trim().toLowerCase();
  return (
    entries.find((entry) => entry.name.toLowerCase() === needle) ??
    entries.find((entry) =>
      entry.name.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle) ||
      entry.keywords.some((keyword) => keyword.toLowerCase().includes(needle)) ||
      entry.triggers.some((trigger) => trigger.toLowerCase().includes(needle))
    ) ??
    null
  );
}

export function searchSkillCatalog(
  query: string,
  options?: SkillCatalogOptions,
): SkillCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return discoverSkillCatalog(options);
  }

  const entries = discoverSkillCatalog({
    includeContent: options?.includeContent ?? true,
    projectDir: options?.projectDir,
    sources: options?.sources,
  });

  return entries.filter((entry) => {
    if (entry.name.toLowerCase().includes(needle)) return true;
    if (entry.description.toLowerCase().includes(needle)) return true;
    if (entry.keywords.some((keyword) => keyword.toLowerCase().includes(needle))) return true;
    if (entry.triggers.some((trigger) => trigger.toLowerCase().includes(needle))) return true;
    return (entry.content ?? "").toLowerCase().includes(needle);
  });
}
