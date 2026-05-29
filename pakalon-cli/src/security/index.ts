/**
 * Security Module — Central export for security features.
 *
 * Exports:
 * - Permission Rules Engine
 * - Rate/Budget Limits
 * - Prompt Injection Protection
 * - Skill Diagnostics
 * - Skill Provenance
 */

// Permission Rules Engine
export {
  PermissionRulesEngine,
  getPermissionRulesEngine,
  resetPermissionRulesEngine,
  initializePermissionRules,
  createDefaultRules,
  type PermissionRule,
  type PermissionAction,
  type PermissionSource,
  type PermissionScope,
  type PermissionRequest,
  type PermissionDecision,
  type DenialRecord,
  type DenialStats,
} from "./permission-rules.js";

// Rate/Budget Limits
export {
  RateLimiter,
  BudgetTracker,
  getRateLimiter,
  getBudgetTracker,
  resetRateBudget,
  initializeRateBudget,
  type RateLimitConfig,
  type BudgetConfig,
  type RateLimitResult,
  type BudgetResult,
  type RateLimitStats,
  type BudgetStats,
} from "./rate-budget.js";

// Prompt Injection Protection
export {
  InjectionProtection,
  getInjectionProtection,
  resetInjectionProtection,
  initializeInjectionProtection,
  checkForInjection,
  sanitizeIfInjection,
  isInputSafe,
  type InjectionDetection,
  type InjectionPattern,
  type InjectionType,
  type InjectionSeverity,
  type InjectionProtectionConfig,
  type InjectionStats,
} from "./injection-protection.js";

// Skill Diagnostics (from skills module)
export {
  validateSkillFile,
  validateSkillName,
  validateFrontmatter,
  validateContent,
  detectSkillChange,
  runSkillDiagnostics,
  formatDiagnosticsReport,
  type SkillValidationResult,
  type SkillDiagnostic,
  type SkillDiagnosticSeverity,
  type SkillChangeDetection,
} from "../skills/skill-diagnostics.js";

// Skill Provenance (from skills module)
export {
  ProvenanceStore,
  getProvenanceStore,
  resetProvenanceStore,
  detectSkillSource,
  calculateFileHash,
  calculateStringHash,
  recordSkillInstallation,
  verifySkillIntegrity,
  type SkillProvenance,
  type SkillSource,
  type TrustLevel,
  type ProvenanceHistory,
  type ProvenanceEntry,
  type ProvenanceStats,
} from "../skills/skill-provenance.js";

// Legacy exports
export * from "./report-generator.js";
