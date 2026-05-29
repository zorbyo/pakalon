/**
 * Skill Diagnostics/Validation — Name/description validation and system prompt integration.
 *
 * Implements Claude Code-compatible skill validation:
 * - Skill name validation (alphanumeric, no spaces, proper format)
 * - Skill description validation (non-empty, proper length)
 * - Skill provenance tracking (where skill came from)
 * - Skill diagnostics/warnings generation
 * - Skill auto-discovery for system prompt insertion
 *
 * Usage:
 *   const diagnostics = validateSkill(skill);
 *   if (diagnostics.length > 0) {
 *     console.log(diagnostics.map(d => `${d.severity}: ${d.message}`));
 *   }
 *
 *   const systemPrompt = formatSkillsForSystemPrompt(allSkills);
 *   // Inject systemPrompt into agent system message
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface SkillDiagnostic {
  /** Unique identifier for the diagnostic */
  code: string;
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Human-readable message */
  message: string;
  /** The skill name this diagnostic refers to */
  skillName: string;
  /** Optional suggestion for fixing */
  suggestion?: string;
}

export interface SkillValidationResult {
  /** Whether the skill passes all validations */
  valid: boolean;
  /** All diagnostics (errors, warnings, info) */
  diagnostics: SkillDiagnostic[];
  /** The validated skill name */
  name: string;
}

export interface SkillProvenance {
  /** Where the skill was loaded from */
  source: "project" | "personal" | "enterprise" | "bundle" | "remote";
  /** URL or path of the source */
  sourcePath: string;
  /** When it was installed/last updated */
  installedAt?: Date;
  /** Version identifier */
  version?: string;
  /** Author information */
  author?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Constants
// ─────────────────────────────────────────────────────────────────────────────

const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$/;
const MAX_NAME_LENGTH = 50;
const MIN_NAME_LENGTH = 3;
const MAX_DESCRIPTION_LENGTH = 200;
const MIN_DESCRIPTION_LENGTH = 10;

const BLOCKED_NAMES = new Set([
  "help", "exit", "quit", "clear", "undo",
  "edit", "plan", "agent", "config",
  "install", "update", "remove", "list",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Validation Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a skill name.
 * Follows Claude Code conventions: lowercase, alphanumeric, hyphens/underscores allowed.
 */
export function validateSkillName(
  name: string,
): SkillDiagnostic[] {
  const diagnostics: SkillDiagnostic[] = [];

  if (!name || name.trim().length === 0) {
    diagnostics.push({
      code: "SKILL_NAME_EMPTY",
      severity: "error",
      message: "Skill name cannot be empty",
      skillName: name,
      suggestion: "Provide a name with at least 3 characters",
    });
    return diagnostics;
  }

  if (name.length < MIN_NAME_LENGTH) {
    diagnostics.push({
      code: "SKILL_NAME_TOO_SHORT",
      severity: "warning",
      message: `Skill name "${name}" is too short (min ${MIN_NAME_LENGTH} chars)`,
      skillName: name,
      suggestion: `Use a longer name (${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters)`,
    });
  }

  if (name.length > MAX_NAME_LENGTH) {
    diagnostics.push({
      code: "SKILL_NAME_TOO_LONG",
      severity: "error",
      message: `Skill name "${name}" is too long (max ${MAX_NAME_LENGTH} chars)`,
      skillName: name,
      suggestion: `Shorten the name to ${MAX_NAME_LENGTH} characters or less`,
    });
  }

  if (!SKILL_NAME_REGEX.test(name)) {
    diagnostics.push({
      code: "SKILL_NAME_INVALID_FORMAT",
      severity: "error",
      message: `Skill name "${name}" has invalid format`,
      skillName: name,
      suggestion: "Use lowercase letters, numbers, hyphens, and underscores only. Must start and end with alphanumeric.",
    });
  }

  if (BLOCKED_NAMES.has(name.toLowerCase())) {
    diagnostics.push({
      code: "SKILL_NAME_RESERVED",
      severity: "error",
      message: `Skill name "${name}" is reserved`,
      skillName: name,
      suggestion: `Choose a different name; "${name}" is a built-in command`,
    });
  }

  if (name.includes(" ")) {
    diagnostics.push({
      code: "SKILL_NAME_HAS_SPACES",
      severity: "error",
      message: `Skill name "${name}" contains spaces`,
      skillName: name,
      suggestion: "Use hyphens or underscores instead of spaces",
    });
  }

  if (/[A-Z]/.test(name)) {
    diagnostics.push({
      code: "SKILL_NAME_UPPERCASE",
      severity: "warning",
      message: `Skill name "${name}" contains uppercase characters`,
      skillName: name,
      suggestion: "Use lowercase letters for consistency",
    });
  }

  return diagnostics;
}

/**
 * Validate a skill description.
 */
export function validateSkillDescription(
  name: string,
  description: string,
): SkillDiagnostic[] {
  const diagnostics: SkillDiagnostic[] = [];

  if (!description || description.trim().length === 0) {
    diagnostics.push({
      code: "SKILL_DESC_EMPTY",
      severity: "warning",
      message: `Skill "${name}" has no description`,
      skillName: name,
      suggestion: "Add a brief description of what the skill does",
    });
    return diagnostics;
  }

  if (description.length < MIN_DESCRIPTION_LENGTH) {
    diagnostics.push({
      code: "SKILL_DESC_TOO_SHORT",
      severity: "info",
      message: `Skill "${name}" description is very short (${description.length} chars)`,
      skillName: name,
      suggestion: "Add more detail (aim for 20-200 characters)",
    });
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    diagnostics.push({
      code: "SKILL_DESC_TOO_LONG",
      severity: "warning",
      message: `Skill "${name}" description is very long (${description.length} chars)`,
      skillName: name,
      suggestion: `Keep descriptions under ${MAX_DESCRIPTION_LENGTH} characters`,
    });
  }

  return diagnostics;
}

/**
 * Run full validation on a skill.
 */
export function validateSkill(
  name: string,
  description: string,
): SkillValidationResult {
  const diagnostics: SkillDiagnostic[] = [
    ...validateSkillName(name),
    ...validateSkillDescription(name, description),
  ];

  return {
    valid: diagnostics.filter((d) => d.severity === "error").length === 0,
    diagnostics,
    name,
  };
}

/**
 * Validate all skills and return grouped diagnostics.
 */
export function validateAllSkills(
  skills: Array<{ frontmatter: { name: string; description: string } }>,
): SkillValidationResult[] {
  return skills.map((skill) =>
    validateSkill(skill.frontmatter.name, skill.frontmatter.description),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format all available skills for inclusion in the system prompt.
 *
 * This enables the model to know about and auto-invoke available skills.
 * Follows the Claude Code convention for skill system prompt formatting.
 *
 * @param skills - List of skill objects with frontmatter
 * @param includeDescriptions - Whether to include full descriptions (default: true)
 * @returns Formatted string for system prompt insertion
 */
export function formatSkillsForSystemPrompt(
  skills: Array<{ frontmatter: { name: string; description: string; disableModelInvocation?: boolean; userInvocable?: boolean } }>,
  includeDescriptions = true,
): string {
  if (skills.length === 0) return "";

  const lines: string[] = [
    "# Available Skills",
    "",
    "You have access to the following skills. Use `/skill-name` to invoke them:",
    "",
  ];

  // Filter to model-invocable skills only
  const invocable = skills.filter(
    (s) => !s.frontmatter.disableModelInvocation,
  );

  if (invocable.length === 0 && includeDescriptions) {
    lines.push("_No auto-invocable skills available._");
    lines.push("");
  }

  for (const skill of invocable) {
    const userInvocable = skill.frontmatter.userInvocable !== false;
    const modelInvokable = !skill.frontmatter.disableModelInvocation;

    const tags: string[] = [];
    if (userInvocable) tags.push("user");
    if (modelInvokable) tags.push("auto");

    lines.push(`- **/${skill.frontmatter.name}**${tags.length ? ` [${tags.join(", ")}]` : ""}`);

    if (includeDescriptions && skill.frontmatter.description) {
      lines.push(`  ${skill.frontmatter.description}`);
    }
  }

  lines.push("");
  lines.push("To invoke a skill, type `/skill-name` followed by optional arguments.");
  lines.push("Skills can also be auto-invoked by the model when relevant.");

  return lines.join("\n");
}

/**
 * Track skill provenance.
 */
export function trackSkillProvenance(
  name: string,
  source: SkillProvenance["source"],
  sourcePath: string,
  metadata?: { version?: string; author?: string },
): SkillProvenance {
  return {
    name,
    source,
    sourcePath,
    installedAt: new Date(),
    version: metadata?.version,
    author: metadata?.author,
  } as unknown as SkillProvenance;
}

/**
 * Generate a skill usage warning for duplicate or conflicting skills.
 */
export function detectSkillConflicts(
  skills: Array<{ frontmatter: { name: string; description: string }; scope: string }>,
): SkillDiagnostic[] {
  const diagnostics: SkillDiagnostic[] = [];
  const seen = new Map<string, string[]>();

  for (const skill of skills) {
    const existing = seen.get(skill.frontmatter.name) ?? [];
    existing.push(skill.scope);
    seen.set(skill.frontmatter.name, existing);
  }

  for (const [name, scopes] of seen) {
    if (scopes.length > 1) {
      diagnostics.push({
        code: "SKILL_NAME_CONFLICT",
        severity: "warning",
        message: `Skill "${name}" exists in multiple scopes: ${scopes.join(", ")}`,
        skillName: name,
        suggestion: "Higher-scope skills (enterprise > personal > project) take precedence",
      });
    }
  }

  return diagnostics;
}
