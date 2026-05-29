/**
 * Skill Diagnostics System — Validate, diagnose, and track skill definitions.
 *
 * Provides comprehensive validation for skill SKILL.md files:
 * - Naming validation (alphanumeric, hyphens, no spaces)
 * - Frontmatter validation (required fields, types)
 * - Content validation (non-empty body, proper structure)
 * - Change detection (SHA-256 hashing for modification tracking)
 * - Provenance tracking (source, version, installation method)
 *
 * Port from Pi's skills.ts diagnostic patterns.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import yaml from "js-yaml";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SkillDiagnosticSeverity = "error" | "warning" | "info";

export interface SkillDiagnostic {
  /** Severity level */
  severity: SkillDiagnosticSeverity;
  /** Diagnostic code for programmatic handling */
  code: string;
  /** Human-readable message */
  message: string;
  /** File path where the issue was found */
  filePath?: string;
  /** Line number (1-indexed) if applicable */
  line?: number;
  /** Suggested fix */
  fix?: string;
}

export interface SkillValidationResult {
  /** Whether the skill is valid (no errors) */
  valid: boolean;
  /** All diagnostics found */
  diagnostics: SkillDiagnostic[];
  /** Parsed frontmatter (if valid) */
  frontmatter?: Record<string, unknown>;
  /** Skill body content */
  body?: string;
  /** SHA-256 hash of the file content */
  contentHash: string;
}

export interface SkillChangeDetection {
  /** Skill name */
  name: string;
  /** File path */
  filePath: string;
  /** Previous content hash */
  previousHash: string | null;
  /** Current content hash */
  currentHash: string;
  /** Whether the skill has changed */
  changed: boolean;
  /** When the change was detected */
  detectedAt: Date;
}

export interface SkillProvenance {
  /** Skill name */
  name: string;
  /** Source type */
  source: "project" | "global" | "embedded" | "vendored" | "npm" | "git" | "url";
  /** Source path or URL */
  sourcePath: string;
  /** Version if available */
  version?: string;
  /** Git commit hash if from git */
  gitCommit?: string;
  /** npm package name if from npm */
  npmPackage?: string;
  /** Installation timestamp */
  installedAt?: Date;
  /** Last verified timestamp */
  lastVerifiedAt?: Date;
  /** Content hash at installation */
  installedHash?: string;
}

export interface SkillDiagnosticsOptions {
  /** Project directory */
  projectDir?: string;
  /** Whether to include content in results */
  includeContent?: boolean;
  /** Whether to track changes */
  trackChanges?: boolean;
  /** Custom naming rules */
  namingRules?: {
    /** Allowed characters regex */
    pattern?: RegExp;
    /** Maximum length */
    maxLength?: number;
    /** Required prefix */
    prefix?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_NAMING_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const MAX_SKILL_NAME_LENGTH = 64;
const REQUIRED_FRONTMATTER_FIELDS = ["name", "description"];
const VALID_SEVERITY_LEVELS = ["error", "warning", "info"];

// ─────────────────────────────────────────────────────────────────────────────
// Naming Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a skill name against naming rules.
 */
export function validateSkillName(
  name: string,
  options?: SkillDiagnosticsOptions
): SkillDiagnostic[] {
  const diagnostics: SkillDiagnostic[] = [];
  const rules = options?.namingRules ?? {};
  const pattern = rules.pattern ?? DEFAULT_NAMING_PATTERN;
  const maxLength = rules.maxLength ?? MAX_SKILL_NAME_LENGTH;
  const prefix = rules.prefix;

  // Check for empty name
  if (!name || name.trim().length === 0) {
    diagnostics.push({
      severity: "error",
      code: "SKILL_NAME_EMPTY",
      message: "Skill name cannot be empty",
      fix: "Provide a non-empty name in the frontmatter",
    });
    return diagnostics;
  }

  // Check for spaces
  if (/\s/.test(name)) {
    diagnostics.push({
      severity: "error",
      code: "SKILL_NAME_SPACES",
      message: "Skill name cannot contain spaces",
      fix: "Use hyphens (-) instead of spaces",
    });
  }

  // Check for uppercase
  if (/[A-Z]/.test(name)) {
    diagnostics.push({
      severity: "warning",
      code: "SKILL_NAME_UPPERCASE",
      message: "Skill name contains uppercase characters",
      fix: "Use lowercase characters for consistency",
    });
  }

  // Check length
  if (name.length > maxLength) {
    diagnostics.push({
      severity: "error",
      code: "SKILL_NAME_TOO_LONG",
      message: `Skill name exceeds maximum length of ${maxLength} characters`,
      fix: "Shorten the skill name",
    });
  }

  // Check pattern
  if (!pattern.test(name)) {
    diagnostics.push({
      severity: "error",
      code: "SKILL_NAME_INVALID_CHARS",
      message: `Skill name "${name}" does not match required pattern`,
      fix: "Use only lowercase alphanumeric characters and hyphens",
    });
  }

  // Check prefix requirement
  if (prefix && !name.startsWith(prefix)) {
    diagnostics.push({
      severity: "warning",
      code: "SKILL_NAME_MISSING_PREFIX",
      message: `Skill name should start with "${prefix}"`,
      fix: `Add "${prefix}" prefix to the skill name`,
    });
  }

  // Check for reserved names
  const reservedNames = ["index", "main", "default", "test", "spec", "type"];
  if (reservedNames.includes(name.toLowerCase())) {
    diagnostics.push({
      severity: "warning",
      code: "SKILL_NAME_RESERVED",
      message: `Skill name "${name}" is a reserved word`,
      fix: "Use a more descriptive name",
    });
  }

  return diagnostics;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate skill frontmatter against requirements.
 */
export function validateFrontmatter(
  frontmatter: Record<string, unknown>,
  filePath?: string
): SkillDiagnostic[] {
  const diagnostics: SkillDiagnostic[] = [];

  // Check required fields
  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    if (!(field in frontmatter) || frontmatter[field] === undefined || frontmatter[field] === null) {
      diagnostics.push({
        severity: "error",
        code: `FRONTMATTER_MISSING_${field.toUpperCase()}`,
        message: `Required frontmatter field "${field}" is missing`,
        filePath,
        fix: `Add "${field}: <value>" to the frontmatter`,
      });
    }
  }

  // Validate name field type
  if ("name" in frontmatter && typeof frontmatter.name !== "string") {
    diagnostics.push({
      severity: "error",
      code: "FRONTMATTER_NAME_TYPE",
      message: 'Frontmatter "name" field must be a string',
      filePath,
      fix: 'Use: name: "skill-name"',
    });
  }

  // Validate description field type
  if ("description" in frontmatter && typeof frontmatter.description !== "string") {
    diagnostics.push({
      severity: "error",
      code: "FRONTMATTER_DESCRIPTION_TYPE",
      message: 'Frontmatter "description" field must be a string',
      filePath,
      fix: 'Use: description: "A brief description"',
    });
  }

  // Validate version format if present
  if ("version" in frontmatter) {
    const version = frontmatter.version;
    if (typeof version === "string" && !/^\d+\.\d+\.\d+/.test(version)) {
      diagnostics.push({
        severity: "warning",
        code: "FRONTMATTER_VERSION_FORMAT",
        message: `Version "${version}" does not follow semver format`,
        filePath,
        fix: "Use semver format: 1.0.0",
      });
    }
  }

  // Validate tags array if present
  if ("tags" in frontmatter) {
    const tags = frontmatter.tags;
    if (!Array.isArray(tags)) {
      diagnostics.push({
        severity: "error",
        code: "FRONTMATTER_TAGS_TYPE",
        message: 'Frontmatter "tags" field must be an array',
        filePath,
        fix: "Use: tags: [tag1, tag2]",
      });
    } else {
      for (const tag of tags) {
        if (typeof tag !== "string") {
          diagnostics.push({
            severity: "error",
            code: "FRONTMATTER_TAG_TYPE",
            message: `Tag "${tag}" must be a string`,
            filePath,
            fix: "Use string values in tags array",
          });
        }
      }
    }
  }

  // Validate triggers array if present
  if ("triggers" in frontmatter) {
    const triggers = frontmatter.triggers;
    if (!Array.isArray(triggers)) {
      diagnostics.push({
        severity: "error",
        code: "FRONTMATTER_TRIGGERS_TYPE",
        message: 'Frontmatter "triggers" field must be an array',
        filePath,
        fix: "Use: triggers: [trigger1, trigger2]",
      });
    }
  }

  return diagnostics;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate skill content body.
 */
export function validateContent(
  content: string,
  filePath?: string
): SkillDiagnostic[] {
  const diagnostics: SkillDiagnostic[] = [];

  // Check for empty content
  if (!content || content.trim().length === 0) {
    diagnostics.push({
      severity: "error",
      code: "CONTENT_EMPTY",
      message: "Skill content body is empty",
      filePath,
      fix: "Add instructions after the frontmatter",
    });
    return diagnostics;
  }

  // Check for minimum length
  if (content.trim().length < 50) {
    diagnostics.push({
      severity: "warning",
      code: "CONTENT_TOO_SHORT",
      message: "Skill content is very short (less than 50 characters)",
      filePath,
      fix: "Add more detailed instructions",
    });
  }

  // Check for heading structure
  const lines = content.split("\n");
  const hasHeading = lines.some((line) => line.startsWith("# "));
  if (!hasHeading) {
    diagnostics.push({
      severity: "info",
      code: "CONTENT_NO_HEADING",
      message: "Skill content does not have a heading",
      filePath,
      fix: "Add a heading: # Skill Name",
    });
  }

  // Check for excessive blank lines
  const blankLineCount = lines.filter((line) => line.trim() === "").length;
  if (blankLineCount > lines.length * 0.3) {
    diagnostics.push({
      severity: "info",
      code: "CONTENT_EXCESS_BLANK_LINES",
      message: "Skill content has many blank lines",
      filePath,
      fix: "Remove unnecessary blank lines",
    });
  }

  // Check for potential issues with markdown
  const unclosedCodeBlocks = (content.match(/```/g) ?? []).length % 2;
  if (unclosedCodeBlocks !== 0) {
    diagnostics.push({
      severity: "warning",
      code: "CONTENT_UNCLOSED_CODE_BLOCK",
      message: "Skill content has unclosed code blocks",
      filePath,
      fix: "Ensure all code blocks are properly closed",
    });
  }

  return diagnostics;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate a SKILL.md file.
 */
export function validateSkillFile(
  filePath: string,
  options?: SkillDiagnosticsOptions
): SkillValidationResult {
  const diagnostics: SkillDiagnostic[] = [];
  let frontmatter: Record<string, unknown> | undefined;
  let body: string | undefined;

  // Read file
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    return {
      valid: false,
      diagnostics: [
        {
          severity: "error",
          code: "FILE_READ_ERROR",
          message: `Failed to read file: ${error}`,
          filePath,
          fix: "Check file permissions and path",
        },
      ],
      contentHash: "",
    };
  }

  // Calculate content hash
  const contentHash = crypto.createHash("sha256").update(raw).digest("hex");

  // Parse frontmatter
  const normalized = raw.replace(/^\uFEFF/, "");
  const frontmatterMatch = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (frontmatterMatch) {
    try {
      frontmatter = yaml.load(frontmatterMatch[1] ?? "") as Record<string, unknown>;
      body = normalized.slice(frontmatterMatch[0].length).trim();
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "FRONTMATTER_PARSE_ERROR",
        message: `Failed to parse frontmatter: ${error}`,
        filePath,
        fix: "Check YAML syntax in frontmatter",
      });
    }
  } else {
    diagnostics.push({
      severity: "warning",
      code: "NO_FRONTMATTER",
      message: "Skill file has no frontmatter",
      filePath,
      fix: "Add frontmatter: ---\\nname: skill-name\\ndescription: ...\\n---",
    });
    body = normalized.trim();
  }

  // Validate frontmatter
  if (frontmatter) {
    diagnostics.push(...validateFrontmatter(frontmatter, filePath));

    // Validate skill name if present
    if (typeof frontmatter.name === "string") {
      diagnostics.push(...validateSkillName(frontmatter.name, options));
    }
  }

  // Validate content
  if (body) {
    diagnostics.push(...validateContent(body, filePath));
  }

  return {
    valid: !diagnostics.some((d) => d.severity === "error"),
    diagnostics,
    frontmatter,
    body,
    contentHash,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Change Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory store for tracking skill hashes.
 */
const skillHashStore = new Map<string, string>();

/**
 * Detect if a skill file has changed since last check.
 */
export function detectSkillChange(
  filePath: string,
  currentHash?: string
): SkillChangeDetection {
  const name = path.basename(path.dirname(filePath));
  
  // Calculate current hash if not provided
  let hash = currentHash;
  if (!hash) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      hash = crypto.createHash("sha256").update(content).digest("hex");
    } catch {
      hash = "";
    }
  }

  const previousHash = skillHashStore.get(filePath) ?? null;
  const changed = previousHash !== null && previousHash !== hash;

  // Update store
  skillHashStore.set(filePath, hash);

  return {
    name,
    filePath,
    previousHash,
    currentHash: hash,
    changed,
    detectedAt: new Date(),
  };
}

/**
 * Get all tracked skill hashes.
 */
export function getTrackedSkillHashes(): Map<string, string> {
  return new Map(skillHashStore);
}

/**
 * Clear the skill hash store.
 */
export function clearSkillHashStore(): void {
  skillHashStore.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Provenance Tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory store for skill provenance.
 */
const provenanceStore = new Map<string, SkillProvenance>();

/**
 * Record skill provenance information.
 */
export function recordSkillProvenance(provenance: SkillProvenance): void {
  provenanceStore.set(provenance.name, provenance);
  logger.debug("[SkillDiagnostics] Recorded provenance", {
    name: provenance.name,
    source: provenance.source,
  });
}

/**
 * Get provenance for a skill.
 */
export function getSkillProvenance(name: string): SkillProvenance | undefined {
  return provenanceStore.get(name);
}

/**
 * Get all tracked provenance.
 */
export function getAllSkillProvenance(): SkillProvenance[] {
  return Array.from(provenanceStore.values());
}

/**
 * Update skill verification timestamp.
 */
export function verifySkillProvenance(name: string): void {
  const provenance = provenanceStore.get(name);
  if (provenance) {
    provenance.lastVerifiedAt = new Date();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics Report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a formatted diagnostics report for a skill.
 */
export function formatDiagnosticsReport(
  result: SkillValidationResult,
  filePath: string
): string {
  const lines: string[] = [];
  lines.push(`Skill Diagnostics: ${path.basename(path.dirname(filePath))}`);
  lines.push("─".repeat(50));
  
  if (result.valid) {
    lines.push("✅ Skill is valid");
  } else {
    lines.push("❌ Skill has errors");
  }
  
  lines.push(`Content Hash: ${result.contentHash.slice(0, 12)}...`);
  lines.push("");

  if (result.diagnostics.length === 0) {
    lines.push("No diagnostics found.");
  } else {
    for (const diag of result.diagnostics) {
      const icon = diag.severity === "error" ? "❌" : diag.severity === "warning" ? "⚠️" : "ℹ️";
      lines.push(`${icon} [${diag.code}] ${diag.message}`);
      if (diag.fix) {
        lines.push(`   Fix: ${diag.fix}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Run diagnostics on all skills in a directory.
 */
export function runSkillDiagnostics(
  skillsDir: string,
  options?: SkillDiagnosticsOptions
): Map<string, SkillValidationResult> {
  const results = new Map<string, SkillValidationResult>();

  if (!fs.existsSync(skillsDir)) {
    return results;
  }

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const skillDir = path.join(skillsDir, entry.name);
      const skillFile = path.join(skillDir, "SKILL.md");

      if (fs.existsSync(skillFile)) {
        const result = validateSkillFile(skillFile, options);
        results.set(entry.name, result);

        // Track changes if enabled
        if (options?.trackChanges) {
          const change = detectSkillChange(skillFile, result.contentHash);
          if (change.changed) {
            logger.info("[SkillDiagnostics] Skill changed", {
              name: change.name,
              previousHash: change.previousHash?.slice(0, 12),
              currentHash: change.currentHash.slice(0, 12),
            });
          }
        }
      }
    }
  } catch (error) {
    logger.error("[SkillDiagnostics] Failed to scan skills directory", {
      skillsDir,
      error: String(error),
    });
  }

  return results;
}
