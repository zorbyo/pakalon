import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  discoverSkillCatalog,
  searchSkillCatalog,
  type SkillCatalogEntry,
} from "@/skills/catalog.js";

export interface SkillImportResult {
  imported: string[];
  skipped: string[];
  errors: Array<{ name: string; reason: string }>;
  targetDir: string;
}

function getSkillImportTargetDir(
  scope: "global" | "project",
  cwd = process.cwd(),
): string {
  if (scope === "global") {
    return path.join(os.homedir(), ".agents", "skills");
  }

  return path.join(cwd, ".pakalon", "skills");
}

function getSkillSourceDir(entry: SkillCatalogEntry): string {
  return path.dirname(entry.path);
}

function areDirectoriesEquivalent(leftDir: string, rightDir: string): boolean {
  if (!fs.existsSync(leftDir) || !fs.existsSync(rightDir)) {
    return false;
  }

  const leftFiles = fs.readdirSync(leftDir, { recursive: true }).sort();
  const rightFiles = fs.readdirSync(rightDir, { recursive: true }).sort();
  if (leftFiles.length !== rightFiles.length) {
    return false;
  }

  for (let index = 0; index < leftFiles.length; index += 1) {
    if (leftFiles[index] !== rightFiles[index]) {
      return false;
    }

    const relativePath = String(leftFiles[index]);
    const leftPath = path.join(leftDir, relativePath);
    const rightPath = path.join(rightDir, relativePath);
    const leftStat = fs.statSync(leftPath);
    const rightStat = fs.statSync(rightPath);

    if (leftStat.isDirectory() !== rightStat.isDirectory()) {
      return false;
    }

    if (leftStat.isFile()) {
      if (fs.readFileSync(leftPath, "utf-8") !== fs.readFileSync(rightPath, "utf-8")) {
        return false;
      }
    }
  }

  return true;
}

export function listImportableVendoredSkills(query?: string): SkillCatalogEntry[] {
  const entries = query
    ? searchSkillCatalog(query, { includeContent: false, sources: ["vendored"] })
    : discoverSkillCatalog({ includeContent: false, sources: ["vendored"] });
  return entries;
}

export async function importVendoredSkills(options?: {
  names?: string[];
  query?: string;
  scope?: "global" | "project";
  cwd?: string;
}): Promise<SkillImportResult> {
  const scope = options?.scope ?? "project";
  const cwd = path.resolve(options?.cwd ?? process.cwd());
  const targetDir = getSkillImportTargetDir(scope, cwd);
  const requestedNames = new Set(
    (options?.names ?? [])
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const candidates = listImportableVendoredSkills(options?.query);
  const selected = requestedNames.size > 0
    ? candidates.filter((entry) => requestedNames.has(entry.name))
    : candidates;

  fs.mkdirSync(targetDir, { recursive: true });

  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ name: string; reason: string }> = [];

  for (const entry of selected) {
    const sourceDir = getSkillSourceDir(entry);
    const destinationDir = path.join(targetDir, path.basename(sourceDir));

    if (!fs.existsSync(sourceDir)) {
      errors.push({ name: entry.name, reason: "Source skill directory not found" });
      continue;
    }

    if (fs.existsSync(destinationDir)) {
      if (areDirectoriesEquivalent(sourceDir, destinationDir)) {
        skipped.push(entry.name);
        continue;
      }

      errors.push({
        name: entry.name,
        reason: `Target already exists with different contents: ${destinationDir}`,
      });
      continue;
    }

    fs.cpSync(sourceDir, destinationDir, { recursive: true });
    imported.push(entry.name);
  }

  if (requestedNames.size > 0) {
    for (const name of requestedNames) {
      if (!selected.some((entry) => entry.name === name)) {
        errors.push({ name, reason: "Skill not found" });
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
