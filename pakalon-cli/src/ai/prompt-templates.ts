/**
 * Prompt Templates System — File-based reusable prompt templates.
 *
 * Supports Claude Code-style template management:
 * - Templates stored as .md files in .pakalon/templates/
 * - Variable interpolation with {{variable}} syntax
 * - Template discovery and listing
 * - Frontmatter metadata parsing (YAML-style)
 * - Nested template inclusion with {{>template_name}}
 * - Conditional sections with {{#if variable}}...{{/if}}
 *
 * Example template (.pakalon/templates/code-review.md):
 * ```yaml
 * ---
 * name: code-review
 * description: Review code changes and suggest improvements
 * version: 1.0
 * ---
 * Review the following {{type}} changes in {{file}}:
 *
 * {{#if focus}}
 * Focus area: {{focus}}
 * {{/if}}
 *
 * {{content}}
 * ```
 *
 * Usage:
 *   const template = findTemplate("code-review");
 *   if (template) {
 *     const result = renderTemplate(template, { file: "src/main.ts", type: "backend" });
 *     console.log(result.text);
 *   }
 */

import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateFrontmatter {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface PromptTemplate {
  /** Parsed frontmatter metadata */
  frontmatter: TemplateFrontmatter;
  /** Template body content (without frontmatter) */
  content: string;
  /** Raw file content (with frontmatter) */
  raw: string;
  /** Absolute path to template file */
  path: string;
  /** Template scope */
  scope: "project" | "personal" | "builtin";
}

export interface TemplateVariables {
  [key: string]: string | number | boolean | undefined | null;
}

export interface TemplateResult {
  /** Rendered template text */
  text: string;
  /** Name of the template used */
  usedTemplate: string;
  /** Variable names that were resolved */
  variables: string[];
  /** Any warnings during rendering (e.g., unresolved variables, circular includes) */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// State & Cache
// ─────────────────────────────────────────────────────────────────────────────

let _templateCache: PromptTemplate[] | null = null;

/**
 * Invalidate the template cache (call after modifying templates).
 */
export function reloadTemplates(): void {
  _templateCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Discovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discover templates in a given directory.
 */
function discoverTemplatesInDir(
  dir: string,
  scope: "project" | "personal" | "builtin",
): PromptTemplate[] {
  const templates: PromptTemplate[] = [];

  if (!fs.existsSync(dir)) return templates;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      const filePath = path.join(dir, entry.name);
      const parsed = parseTemplateFile(filePath, scope);
      if (parsed) {
        templates.push(parsed);
      }
    }
  } catch (err) {
    logger.warn("[Templates] Failed to discover templates", {
      dir,
      error: String(err),
    });
  }

  return templates;
}

/**
 * Parse a single template .md file.
 */
function parseTemplateFile(
  filePath: string,
  scope: "project" | "personal" | "builtin",
): PromptTemplate | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const fileName = path.basename(filePath, ".md");

    // Check for YAML frontmatter
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);

    let frontmatter: TemplateFrontmatter;
    let content: string;

    if (frontmatterMatch) {
      frontmatter = parseYamlFrontmatter(frontmatterMatch[1] ?? "", fileName);
      content = raw.slice(frontmatterMatch[0].length).trim();
    } else {
      // No frontmatter — use filename as name
      frontmatter = {
        name: fileName,
        description: `Prompt template: ${fileName}`,
      };
      content = raw.trim();
    }

    return {
      frontmatter,
      content,
      raw,
      path: filePath,
      scope,
    };
  } catch (err) {
    logger.warn("[Templates] Failed to parse template file", {
      filePath,
      error: String(err),
    });
    return null;
  }
}

/**
 * Simple YAML frontmatter parser.
 */
function parseYamlFrontmatter(
  yaml: string,
  fallbackName: string,
): TemplateFrontmatter {
  const result: Record<string, unknown> = {
    name: fallbackName,
    description: "",
  };

  const lines = yaml.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (true) {
      case value === "true":
        result[key] = true;
        break;
      case value === "false":
        result[key] = false;
        break;
      case value.startsWith("[") && value.endsWith("]"):
        result[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case Boolean(value):
        result[key] = value;
        break;
    }
  }

  return result as unknown as TemplateFrontmatter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get template directories based on scope.
 */
function getTemplateDirs(projectDir?: string): Array<{
  dir: string;
  scope: "project" | "personal" | "builtin";
}> {
  const dirs: Array<{ dir: string; scope: "project" | "personal" | "builtin" }> = [];

  // Project scope
  const project = projectDir ?? process.cwd();
  dirs.push({
    dir: path.join(project, ".pakalon", "templates"),
    scope: "project",
  });

  // Personal scope
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home) {
    dirs.push({
      dir: path.join(home, ".config", "pakalon", "templates"),
      scope: "personal",
    });
  }

  // Built-in scope (embedded templates in CLI package)
  const builtinDir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "templates",
  );
  if (fs.existsSync(builtinDir)) {
    dirs.push({
      dir: builtinDir,
      scope: "builtin",
    });
  }

  return dirs;
}

/**
 * Get all available templates with proper scope resolution
 * (project > personal > builtin — project overrides).
 */
export function getAllTemplates(projectDir?: string): PromptTemplate[] {
  if (_templateCache) return _templateCache;

  const templateDirs = getTemplateDirs(projectDir);
  const templatesMap = new Map<string, PromptTemplate>();

  for (const { dir, scope } of templateDirs) {
    const discovered = discoverTemplatesInDir(dir, scope);
    for (const template of discovered) {
      // Later scopes override earlier ones (project overrides personal)
      const existing = templatesMap.get(template.frontmatter.name);
      if (
        !existing ||
        getScopePriority(template.scope) > getScopePriority(existing.scope)
      ) {
        templatesMap.set(template.frontmatter.name, template);
      }
    }
  }

  _templateCache = Array.from(templatesMap.values());
  return _templateCache;
}

function getScopePriority(
  scope: "project" | "personal" | "builtin",
): number {
  switch (scope) {
    case "project":
      return 3;
    case "personal":
      return 2;
    case "builtin":
      return 1;
  }
}

/**
 * Find a specific template by name.
 */
export function findTemplate(
  name: string,
  projectDir?: string,
): PromptTemplate | undefined {
  const templates = getAllTemplates(projectDir);
  return templates.find(
    (t) =>
      t.frontmatter.name === name ||
      t.frontmatter.name.toLowerCase() === name.toLowerCase(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a template with the given variables.
 *
 * Supports:
 * - `{{variable}}` — simple variable substitution
 * - `{{#if variable}}...{{/if}}` — conditional blocks
 * - `{{>template_name}}` — nested template inclusion
 *
 * Unresolved variables are left as-is (no error).
 */
export function renderTemplate(
  template: PromptTemplate,
  variables: TemplateVariables = {},
): TemplateResult {
  const warnings: string[] = [];
  const resolvedVars = new Set<string>();
  const visitedIncludes = new Set<string>();

  const text = renderString(
    template.content,
    variables,
    resolvedVars,
    warnings,
    visitedIncludes,
    undefined,
  );

  // Collect unresolved variables
  const unresolvedPattern = /\{\{([^}>#!/]+)\}\}/g;
  let unresolvedMatch: RegExpExecArray | null;
  while ((unresolvedMatch = unresolvedPattern.exec(text)) !== null) {
    const varName = unresolvedMatch[1]?.trim();
    if (varName && !resolvedVars.has(varName)) {
      warnings.push(`Unresolved variable: ${varName}`);
    }
  }

  return {
    text,
    usedTemplate: template.frontmatter.name,
    variables: [...resolvedVars],
    warnings,
  };
}

/**
 * Render a raw template string with variables (no file loading).
 */
export function renderTemplateString(
  template: string,
  variables: TemplateVariables = {},
): string {
  const resolvedVars = new Set<string>();
  const warnings: string[] = [];
  const visitedIncludes = new Set<string>();

  return renderString(
    template,
    variables,
    resolvedVars,
    warnings,
    visitedIncludes,
    undefined,
  );
}

/**
 * Core string rendering engine.
 */
function renderString(
  text: string,
  variables: TemplateVariables,
  resolvedVars: Set<string>,
  warnings: string[],
  visitedIncludes: Set<string>,
  maxDepth: number | undefined,
  depth = 0,
): string {
  if (maxDepth !== undefined && depth > maxDepth) {
    warnings.push("Max template include depth exceeded");
    return text;
  }

  // Process conditional blocks first
  let result = processConditionals(text, variables, resolvedVars, warnings);

  // Process nested template includes
  result = processIncludes(
    result,
    variables,
    resolvedVars,
    warnings,
    visitedIncludes,
    maxDepth,
    depth,
  );

  // Process variable substitution last
  result = result.replace(/\{\{([^}>#!/][^}]*)\}\}/g, (_match, varExpr: string) => {
    const varName = varExpr.trim();
    const value = resolveVariable(varName, variables);

    if (value !== undefined && value !== null) {
      resolvedVars.add(varName);
      return String(value);
    }

    // Leave unresolved
    return _match;
  });

  return result;
}

/**
 * Process {{#if variable}}...{{/if}} blocks.
 */
function processConditionals(
  text: string,
  variables: TemplateVariables,
  resolvedVars: Set<string>,
  warnings: string[],
): string {
  return text.replace(
    /\{\{#if\s+(\S+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, blockContent: string) => {
      const value = resolveVariable(varName.trim(), variables);

      if (value !== undefined && value !== null && value !== false && value !== "") {
        resolvedVars.add(varName.trim());
        // Recursively process nested conditionals in the block
        return processConditionals(blockContent, variables, resolvedVars, warnings);
      }

      return "";
    },
  );
}

/**
 * Process {{>template_name}} nested includes.
 */
function processIncludes(
  text: string,
  variables: TemplateVariables,
  resolvedVars: Set<string>,
  warnings: string[],
  visitedIncludes: Set<string>,
  maxDepth: number | undefined,
  depth: number,
): string {
  return text.replace(/\{\{>(\S+)\}\}/g, (_match, templateName: string) => {
    const name = templateName.trim();

    // Circular detection
    if (visitedIncludes.has(name)) {
      warnings.push(`Circular include detected: ${name}`);
      return `[Circular include: ${name}]`;
    }

    const included = findTemplate(name);
    if (!included) {
      warnings.push(`Template not found: ${name}`);
      return `[Template not found: ${name}]`;
    }

    visitedIncludes.add(name);

    const rendered = renderString(
      included.content,
      variables,
      resolvedVars,
      warnings,
      visitedIncludes,
      maxDepth,
      depth + 1,
    );

    visitedIncludes.delete(name);
    return rendered;
  });
}

/**
 * Resolve a variable from template variables or environment.
 * Resolution order: direct value → frontmatter field → environment variable
 */
function resolveVariable(
  name: string,
  variables: TemplateVariables,
): string | number | boolean | undefined | null {
  // Check direct variables
  if (name in variables) {
    return variables[name];
  }

  // Check environment variables
  const envValue = process.env[name];
  if (envValue !== undefined) {
    return envValue;
  }

  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new template file on disk.
 *
 * @param name - Template name (used as filename)
 * @param content - Template body content
 * @param frontmatter - Optional frontmatter fields
 * @param projectDir - Project directory (for project-scoped templates)
 * @returns The created template
 */
export async function createTemplate(
  name: string,
  content: string,
  frontmatter?: Partial<TemplateFrontmatter>,
  projectDir?: string,
): Promise<PromptTemplate> {
  const dir = path.join(
    projectDir ?? process.cwd(),
    ".pakalon",
    "templates",
  );

  await fs.promises.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${name}.md`);

  // Build frontmatter
  const fm: TemplateFrontmatter = {
    name,
    description: frontmatter?.description ?? `Template: ${name}`,
    version: frontmatter?.version ?? "1.0",
    ...frontmatter,
  };

  const frontmatterYaml = Object.entries(fm)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
      return `${k}: ${v}`;
    })
    .join("\n");

  const fileContent = `---\n${frontmatterYaml}\n---\n\n${content}`;
  await fs.promises.writeFile(filePath, fileContent, "utf-8");

  reloadTemplates();

  return {
    frontmatter: fm,
    content,
    raw: fileContent,
    path: filePath,
    scope: "project",
  };
}

/**
 * Delete a template file from disk.
 *
 * @param name - Template name to delete
 * @param projectDir - Project directory
 * @returns Whether the template was found and deleted
 */
export async function deleteTemplate(
  name: string,
  projectDir?: string,
): Promise<boolean> {
  const templates = getAllTemplates(projectDir);
  const template = templates.find(
    (t) =>
      t.frontmatter.name === name &&
      t.scope === "project", // Only delete project-scoped
  );

  if (!template) return false;

  try {
    await fs.promises.unlink(template.path);
    reloadTemplates();
    return true;
  } catch (err) {
    logger.warn("[Templates] Failed to delete template", {
      name,
      error: String(err),
    });
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all available template names.
 */
export function getTemplateNames(projectDir?: string): string[] {
  return getAllTemplates(projectDir).map((t) => t.frontmatter.name);
}

/**
 * Get templates formatted as a display string.
 */
export function formatTemplatesList(projectDir?: string): string {
  const templates = getAllTemplates(projectDir);
  if (templates.length === 0) return "No templates found.";

  const lines: string[] = ["Available Templates:", ""];
  for (const template of templates) {
    const scopeTag =
      template.scope === "project"
        ? "[project]"
        : template.scope === "personal"
          ? "[personal]"
          : "[builtin]";
    lines.push(`  ${template.frontmatter.name} ${scopeTag}`);
    lines.push(`    ${template.frontmatter.description}`);
    if (template.frontmatter.tags?.length) {
      lines.push(`    Tags: ${template.frontmatter.tags.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
