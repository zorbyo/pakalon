/**
 * Phase 1 Generator Enhancements
 *
 * Provides validation and enhancement utilities for Phase 1 generated documents.
 * Ensures generated content meets quality standards and includes all required sections.
 *
 * Features:
 * - Document structure validation
 * - Required sections check
 * - Content quality scoring
 * - Enhancement suggestions
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  /** Is document valid */
  valid: boolean;
  /** Validation score (0-100) */
  score: number;
  /** Missing sections */
  missingSections: string[];
  /** Warnings */
  warnings: string[];
  /** Suggestions for improvement */
  suggestions: string[];
}

export interface DocumentRequirements {
  /** Required headings */
  requiredHeadings: string[];
  /** Minimum word count */
  minWordCount?: number;
  /** Maximum word count */
  maxWordCount?: number;
  /** Required patterns (regex) */
  requiredPatterns?: Array<{ pattern: RegExp; description: string }>;
}

// ---------------------------------------------------------------------------
// Document Requirements
// ---------------------------------------------------------------------------

const DOCUMENT_REQUIREMENTS: Record<string, DocumentRequirements> = {
  "design.md": {
    requiredHeadings: [
      "UI/UX Design Principles",
      "Color Scheme",
      "Typography",
      "Component Hierarchy",
      "Responsive Design",
      "Accessibility",
    ],
    minWordCount: 500,
  },
  "API_reference.md": {
    requiredHeadings: [
      "Base URL",
      "Authentication",
      "Endpoints",
      "Request",
      "Response",
      "Error",
    ],
    minWordCount: 800,
    requiredPatterns: [
      { pattern: /GET|POST|PUT|DELETE|PATCH/, description: "HTTP methods" },
      { pattern: /\{[^}]+\}/, description: "JSON examples" },
    ],
  },
  "Database_schema.md": {
    requiredHeadings: [
      "Tables",
      "Columns",
      "Primary Key",
      "Foreign Key",
      "Indexes",
    ],
    minWordCount: 500,
    requiredPatterns: [
      { pattern: /CREATE TABLE|create table/, description: "SQL CREATE TABLE" },
    ],
  },
  "user-stories.md": {
    requiredHeadings: [
      "User Stories",
      "Acceptance Criteria",
    ],
    minWordCount: 400,
    requiredPatterns: [
      { pattern: /As a.*I want.*so that/, description: "User story format" },
    ],
  },
  "plan.md": {
    requiredHeadings: [
      "Executive Summary",
      "Project Overview",
      "Goals",
      "Scope",
      "Technology Stack",
      "Architecture",
      "Timeline",
      "Risks",
    ],
    minWordCount: 1000,
  },
  "tasks.md": {
    requiredHeadings: [
      "Tasks",
      "Dependencies",
      "Priority",
    ],
    minWordCount: 500,
  },
  "prd.md": {
    requiredHeadings: [
      "Problem Statement",
      "Target Users",
      "Feature Requirements",
      "Non-Functional Requirements",
      "Success Metrics",
    ],
    minWordCount: 800,
  },
  "technical-spec.md": {
    requiredHeadings: [
      "System Architecture",
      "Technology Stack",
      "Data Flow",
      "Security",
      "Performance",
      "Scalability",
    ],
    minWordCount: 800,
  },
  "risk-assessment.md": {
    requiredHeadings: [
      "Technical Risks",
      "Security Risks",
      "Performance Risks",
      "Timeline Risks",
      "Mitigations",
    ],
    minWordCount: 500,
  },
  "competitive-analysis.md": {
    requiredHeadings: [
      "Similar Products",
      "Feature Comparison",
      "Strengths",
      "Weaknesses",
      "Differentiation",
    ],
    minWordCount: 600,
  },
  "constraints-and-tradeoffs.md": {
    requiredHeadings: [
      "Technical Constraints",
      "Budget Constraints",
      "Timeline Constraints",
      "Tradeoffs",
      "Rationale",
    ],
    minWordCount: 500,
  },
  "context-management.md": {
    requiredHeadings: [
      "Phase Budgets",
      "Handoff Files",
      "Memory Strategy",
      "Recovery Process",
    ],
    minWordCount: 400,
  },
};

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate document structure
 */
export function validateDocument(
  filename: string,
  content: string
): ValidationResult {
  const requirements = DOCUMENT_REQUIREMENTS[filename];
  if (!requirements) {
    return {
      valid: true,
      score: 100,
      missingSections: [],
      warnings: [`No requirements defined for ${filename}`],
      suggestions: [],
    };
  }

  const result: ValidationResult = {
    valid: true,
    score: 100,
    missingSections: [],
    warnings: [],
    suggestions: [],
  };

  // Check required headings
  for (const heading of requirements.requiredHeadings) {
    const headingRegex = new RegExp(`#+\\s*${heading}`, "i");
    if (!headingRegex.test(content)) {
      result.missingSections.push(heading);
      result.score -= 10;
    }
  }

  // Check word count
  const wordCount = content.split(/\s+/).length;
  if (requirements.minWordCount && wordCount < requirements.minWordCount) {
    result.warnings.push(
      `Word count (${wordCount}) below minimum (${requirements.minWordCount})`
    );
    result.score -= 10;
  }
  if (requirements.maxWordCount && wordCount > requirements.maxWordCount) {
    result.warnings.push(
      `Word count (${wordCount}) above maximum (${requirements.maxWordCount})`
    );
    result.score -= 5;
  }

  // Check required patterns
  if (requirements.requiredPatterns) {
    for (const { pattern, description } of requirements.requiredPatterns) {
      if (!pattern.test(content)) {
        result.warnings.push(`Missing pattern: ${description}`);
        result.score -= 5;
      }
    }
  }

  // Generate suggestions
  if (result.missingSections.length > 0) {
    result.suggestions.push(
      `Add missing sections: ${result.missingSections.join(", ")}`
    );
  }
  if (wordCount < (requirements.minWordCount || 0) * 0.5) {
    result.suggestions.push("Document appears too short - consider expanding");
  }

  // Ensure score is within bounds
  result.score = Math.max(0, Math.min(100, result.score));
  result.valid = result.score >= 60;

  return result;
}

/**
 * Validate all Phase 1 documents
 */
export function validateAllDocuments(
  documents: Map<string, string>
): Map<string, ValidationResult> {
  const results = new Map<string, ValidationResult>();

  for (const [filename, content] of documents) {
    results.set(filename, validateDocument(filename, content));
  }

  return results;
}

/**
 * Get validation summary
 */
export function getValidationSummary(
  results: Map<string, ValidationResult>
): {
  totalDocuments: number;
  validDocuments: number;
  averageScore: number;
  allMissingSections: string[];
} {
  const entries = Array.from(results.values());
  const totalDocuments = entries.length;
  const validDocuments = entries.filter((r) => r.valid).length;
  const averageScore =
    entries.reduce((sum, r) => sum + r.score, 0) / totalDocuments;
  const allMissingSections = entries.flatMap((r) => r.missingSections);

  return {
    totalDocuments,
    validDocuments,
    averageScore,
    allMissingSections: [...new Set(allMissingSections)],
  };
}

/**
 * Log validation results
 */
export function logValidationResults(
  results: Map<string, ValidationResult>
): void {
  const summary = getValidationSummary(results);

  logger.info("[Validation] Phase 1 Document Validation Summary:");
  logger.info(
    `[Validation]   ${summary.validDocuments}/${summary.totalDocuments} documents valid`
  );
  logger.info(
    `[Validation]   Average score: ${summary.averageScore.toFixed(1)}%`
  );

  if (summary.allMissingSections.length > 0) {
    logger.warn(
      `[Validation]   Missing sections: ${summary.allMissingSections.join(", ")}`
    );
  }

  for (const [filename, result] of results) {
    const status = result.valid ? "✓" : "✗";
    logger.debug(
      `[Validation]   ${status} ${filename}: ${result.score}% (${result.missingSections.length} missing)`
    );
  }
}
