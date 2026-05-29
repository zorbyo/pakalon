import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import yaml from "js-yaml";

import {
  getEmbeddedCommandRoots,
  getVendoredEverythingCommandRoots,
} from "@/utils/claude-imports.js";

export type CommandCatalogSource = "embedded" | "vendored";

export interface CommandCatalogEntry {
  name: string;
  description: string;
  source: CommandCatalogSource;
  path: string;
  rootDir: string;
  frontmatter: Record<string, unknown>;
  content?: string;
  allowedTools: string[];
  argumentHint?: string;
}

export interface CommandImportResult {
  imported: string[];
  skipped: string[];
  errors: Array<{ name: string; reason: string }>;
  targetDir: string;
}

interface CommandRoot {
  rootDir: string;
  source: CommandCatalogSource;
  priority: number;
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

function extractDescription(body: string, fallback: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const prose = lines.find((line) => !line.startsWith("#"));
  return prose ?? fallback;
}

function getCommandRoots(): CommandRoot[] {
  return [
    ...getEmbeddedCommandRoots().map((rootDir) => ({
      rootDir,
      source: "embedded" as const,
      priority: 200,
    })),
    ...getVendoredEverythingCommandRoots().map((rootDir) => ({
      rootDir,
      source: "vendored" as const,
      priority: 100,
    })),
  ].filter((root, index, all) =>
    fs.existsSync(root.rootDir) &&
    all.findIndex((candidate) => candidate.rootDir === root.rootDir) === index
  );
}

function readCommandEntry(
  filePath: string,
  root: CommandRoot,
  includeContent: boolean,
): CommandCatalogEntry | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    const rawName = typeof frontmatter.name === "string"
      ? frontmatter.name.trim()
      : path.basename(filePath, path.extname(filePath));
    const name = rawName.replace(/^\//, "");
    const description = typeof frontmatter.description === "string"
      ? frontmatter.description.trim()
      : extractDescription(body, name);

    return {
      name,
      description,
      source: root.source,
      path: filePath,
      rootDir: root.rootDir,
      frontmatter,
      ...(includeContent ? { content } : {}),
      allowedTools: normalizeStringArray(frontmatter.allowed_tools ?? frontmatter["allowed-tools"]),
      argumentHint: typeof frontmatter.argument_hint === "string"
        ? frontmatter.argument_hint
        : typeof frontmatter["argument-hint"] === "string"
          ? String(frontmatter["argument-hint"])
          : undefined,
    };
  } catch {
    return null;
  }
}

export function discoverCommandCatalog(options?: {
  includeContent?: boolean;
}): CommandCatalogEntry[] {
  const includeContent = options?.includeContent ?? false;
  const deduped = new Map<string, { entry: CommandCatalogEntry; priority: number }>();

  for (const root of getCommandRoots()) {
    for (const fileName of fs.readdirSync(root.rootDir)) {
      if (!fileName.toLowerCase().endsWith(".md")) {
        continue;
      }

      const entry = readCommandEntry(
        path.join(root.rootDir, fileName),
        root,
        includeContent,
      );
      if (!entry) {
        continue;
      }

      const existing = deduped.get(entry.name);
      if (!existing || root.priority > existing.priority) {
        deduped.set(entry.name, { entry, priority: root.priority });
      }
    }
  }

  return Array.from(deduped.values())
    .map((value) => value.entry)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function findCommandCatalogEntry(
  commandName: string,
  options?: { includeContent?: boolean },
): CommandCatalogEntry | null {
  const needle = commandName.trim().toLowerCase().replace(/^\//, "");
  const entries = discoverCommandCatalog({
    includeContent: options?.includeContent ?? true,
  });

  return (
    entries.find((entry) => entry.name.toLowerCase() === needle) ??
    entries.find((entry) =>
      entry.name.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle) ||
      entry.allowedTools.some((tool) => tool.toLowerCase().includes(needle))
    ) ??
    null
  );
}

export function searchCommandCatalog(
  query: string,
  options?: { includeContent?: boolean },
): CommandCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return discoverCommandCatalog(options);
  }

  return discoverCommandCatalog({
    includeContent: options?.includeContent ?? true,
  }).filter((entry) =>
    entry.name.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    entry.allowedTools.some((tool) => tool.toLowerCase().includes(needle)) ||
    (entry.content ?? "").toLowerCase().includes(needle)
  );
}

export function getCommandImportTargetDir(
  scope: "global" | "project",
  cwd = process.cwd(),
): string {
  if (scope === "global") {
    return path.join(
      os.homedir(),
      ".claude",
      "commands",
    );
  }

  return path.join(cwd, ".claude", "commands");
}

export async function importCatalogCommands(options?: {
  names?: string[];
  query?: string;
  scope?: "global" | "project";
  cwd?: string;
}): Promise<CommandImportResult> {
  const scope = options?.scope ?? "project";
  const cwd = path.resolve(options?.cwd ?? process.cwd());
  const targetDir = getCommandImportTargetDir(scope, cwd);
  const requestedNames = new Set(
    (options?.names ?? [])
      .map((name) => name.trim().replace(/^\//, ""))
      .filter(Boolean),
  );
  const candidates = searchCommandCatalog(options?.query ?? "", { includeContent: true });
  const selected = requestedNames.size > 0
    ? candidates.filter((entry) => requestedNames.has(entry.name))
    : candidates;

  fs.mkdirSync(targetDir, { recursive: true });

  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ name: string; reason: string }> = [];

  for (const entry of selected) {
    if (!entry.content) {
      errors.push({ name: entry.name, reason: "Command content unavailable" });
      continue;
    }

    const targetPath = path.join(targetDir, `${entry.name}.md`);
    if (fs.existsSync(targetPath)) {
      const existing = fs.readFileSync(targetPath, "utf-8");
      if (existing === entry.content) {
        skipped.push(entry.name);
        continue;
      }
    }

    fs.writeFileSync(targetPath, entry.content, "utf-8");
    imported.push(entry.name);
  }

  if (requestedNames.size > 0) {
    for (const name of requestedNames) {
      if (!selected.some((entry) => entry.name === name)) {
        errors.push({ name, reason: "Command not found" });
      }
    }
  }

  return {
    imported,
    skipped,
    errors,
    targetDir,
  };
}
