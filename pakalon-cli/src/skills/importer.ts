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

// ---------------------------------------------------------------------------
// External Tool Format Importers
// ---------------------------------------------------------------------------

export interface ExternalRule {
  name: string;
  content: string;
  source: string;
  scope?: string;
}

/**
 * Import Cursor MDC rules (.cursorrules files)
 */
export function importCursorRules(projectPath?: string): ExternalRule[] {
  const rules: ExternalRule[] = [];
  const targetPath = projectPath ?? process.cwd();
  
  // Look for .cursorrules files
  const cursorRulesFiles = [
    path.join(targetPath, '.cursorrules'),
    path.join(targetPath, '.cursor', 'rules'),
    path.join(os.homedir(), '.cursor', 'rules'),
  ];
  
  for (const filePath of cursorRulesFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        rules.push({
          name: path.basename(filePath),
          content,
          source: 'cursor',
          scope: filePath.startsWith(targetPath) ? 'project' : 'global',
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
  
  return rules;
}

/**
 * Import Cline rules (.clinerules files)
 */
export function importClineRules(projectPath?: string): ExternalRule[] {
  const rules: ExternalRule[] = [];
  const targetPath = projectPath ?? process.cwd();
  
  // Look for .clinerules files
  const clinerulesFiles = [
    path.join(targetPath, '.clinerules'),
    path.join(targetPath, '.cline', 'rules'),
    path.join(os.homedir(), '.cline', 'rules'),
  ];
  
  for (const filePath of clinerulesFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        rules.push({
          name: path.basename(filePath),
          content,
          source: 'cline',
          scope: filePath.startsWith(targetPath) ? 'project' : 'global',
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
  
  return rules;
}

/**
 * Import Codex AGENTS.md rules
 */
export function importCodexRules(projectPath?: string): ExternalRule[] {
  const rules: ExternalRule[] = [];
  const targetPath = projectPath ?? process.cwd();
  
  // Look for AGENTS.md files
  const agentsFiles = [
    path.join(targetPath, 'AGENTS.md'),
    path.join(targetPath, '.codex', 'AGENTS.md'),
    path.join(os.homedir(), '.codex', 'AGENTS.md'),
  ];
  
  for (const filePath of agentsFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        rules.push({
          name: path.basename(filePath),
          content,
          source: 'codex',
          scope: filePath.startsWith(targetPath) ? 'project' : 'global',
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
  
  return rules;
}

/**
 * Import Copilot applyTo rules
 */
export function importCopilotRules(projectPath?: string): ExternalRule[] {
  const rules: ExternalRule[] = [];
  const targetPath = projectPath ?? process.cwd();
  
  // Look for .github/copilot-instructions.md files
  const copilotFiles = [
    path.join(targetPath, '.github', 'copilot-instructions.md'),
    path.join(targetPath, '.copilot', 'instructions.md'),
    path.join(os.homedir(), '.copilot', 'instructions.md'),
  ];
  
  for (const filePath of copilotFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        rules.push({
          name: path.basename(filePath),
          content,
          source: 'copilot',
          scope: filePath.startsWith(targetPath) ? 'project' : 'global',
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
  
  return rules;
}

/**
 * Import rules from all supported external tools
 */
export function importAllExternalRules(projectPath?: string): ExternalRule[] {
  const rules: ExternalRule[] = [];
  
  rules.push(...importCursorRules(projectPath));
  rules.push(...importClineRules(projectPath));
  rules.push(...importCodexRules(projectPath));
  rules.push(...importCopilotRules(projectPath));
  
  return rules;
}

/**
 * Convert external rules to skill format
 */
export function convertExternalRulesToSkills(rules: ExternalRule[]): string {
  let output = '# External Rules Import\n\n';
  
  for (const rule of rules) {
    output += `## ${rule.name} (${rule.source})\n\n`;
    output += `**Source:** ${rule.source}\n`;
    output += `**Scope:** ${rule.scope || 'unknown'}\n\n`;
    output += rule.content;
    output += '\n\n---\n\n';
  }
  
  return output;
}

// ---------------------------------------------------------------------------
// Skill Import
// ---------------------------------------------------------------------------

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
