/**
 * PolicyEvaluator
 *
 * Evaluates security scan results against configurable policy thresholds.
 *
 * Flow:
 *   1. Load security-policy.yml (or use defaults)
 *   2. Read .pakalon-agents/phase-4/findings.json
 *   3. Read .pakalon-agents/phase-4/security-score.json
 *   4. Compare against threshold criteria
 *   5. Return { passed: boolean, reasons: string[] }
 *
 * If no security-policy.yml exists, DEFAULT_POLICY is used.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import logger from '@/utils/logger.js';
import type {
  PromotionPolicy,
  PolicyEvaluation,
  PolicyCheckResult,
} from './types.js';
import { DEFAULT_POLICY } from './types.js';

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function safeReadYaml<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = yaml.load(raw) as T;
    return parsed ?? null;
  } catch {
    return null;
  }
}

function mergePolicy(raw: Partial<PromotionPolicy> | null): PromotionPolicy {
  const criteria = raw?.promotion_criteria as
    | (Partial<PromotionPolicy['promotion_criteria']> & {
        max_critical_vulnerabilities?: number;
        max_high_vulnerabilities?: number;
        max_medium_vulnerabilities?: number;
      })
    | undefined;

  return {
    promotion_criteria: {
      ...DEFAULT_POLICY.promotion_criteria,
      ...criteria,
      max_critical: criteria?.max_critical ?? criteria?.max_critical_vulnerabilities ?? DEFAULT_POLICY.promotion_criteria.max_critical,
      max_high: criteria?.max_high ?? criteria?.max_high_vulnerabilities ?? DEFAULT_POLICY.promotion_criteria.max_high,
      max_medium: criteria?.max_medium ?? criteria?.max_medium_vulnerabilities ?? DEFAULT_POLICY.promotion_criteria.max_medium,
      min_security_score: criteria?.min_security_score ?? DEFAULT_POLICY.promotion_criteria.min_security_score,
      required_sast_coverage: criteria?.required_sast_coverage ?? DEFAULT_POLICY.promotion_criteria.required_sast_coverage,
      require_sbom: criteria?.require_sbom ?? DEFAULT_POLICY.promotion_criteria.require_sbom,
      require_dast: criteria?.require_dast ?? DEFAULT_POLICY.promotion_criteria.require_dast,
    },
    actions: {
      ...DEFAULT_POLICY.actions,
      ...(raw?.actions ?? {}),
    },
    sandbox: {
      ...DEFAULT_POLICY.sandbox!,
      ...(raw?.sandbox ?? {}),
    },
  };
}

function phase4Dirs(projectDir: string): string[] {
  return [
    path.join(projectDir, '.pakalon-agents', 'phase-4'),
    path.join(projectDir, '.pakalon-agents', 'ai-agents', 'phase-4'),
  ];
}

// ---------------------------------------------------------------------------
// Policy Evaluator
// ---------------------------------------------------------------------------

export class PolicyEvaluator {
  private policy: PromotionPolicy;

  constructor(policy?: PromotionPolicy) {
    this.policy = mergePolicy(policy ?? DEFAULT_POLICY);
  }

  /**
   * Load the promotion policy from a security-policy.yml file,
   * falling back to DEFAULT_POLICY if the file doesn't exist.
   */
  static async loadFromFile(policyPath: string): Promise<PolicyEvaluator> {
    const customPolicy = await safeReadYaml<PromotionPolicy>(policyPath);
    if (customPolicy) {
      logger.info(`[PolicyEvaluator] Loaded custom policy from ${policyPath}`);
      return new PolicyEvaluator(mergePolicy(customPolicy));
    }
    logger.info('[PolicyEvaluator] No custom policy found — using defaults');
    return new PolicyEvaluator(DEFAULT_POLICY);
  }

  /**
   * Evaluate security results against the policy.
   *
   * @param projectDir - The project directory containing .pakalon-agents/phase-4/
   * @returns PolicyEvaluation with pass/fail and reasons
   */
  async evaluate(projectDir: string): Promise<PolicyEvaluation> {
    const dirs = phase4Dirs(projectDir);
    const checks: PolicyCheckResult[] = [];

    // 1. Load the security score
    const scoreData = await this.readFirstJson<{
      score?: number;
      grade?: string;
      breakdown?: { critical?: number; high?: number; medium?: number; low?: number };
      scanResults?: Record<string, { issues?: number; error?: string; skipped?: boolean }>;
    }>(dirs, 'security-score.json');

    // 2. Load the findings
    const findingsData = await this.readFirstJson<{
      findings?: Array<{ severity?: string }>;
      criticalIssues?: number;
      highIssues?: number;
      mediumIssues?: number;
    } | Array<{ severity?: string }>>(dirs, 'findings.json');

    const findingsList = Array.isArray(findingsData)
      ? findingsData
      : findingsData?.findings ?? [];

    // Extract issue counts
    const criticalCount = scoreData?.breakdown?.critical ??
                          (!Array.isArray(findingsData) ? findingsData?.criticalIssues : undefined) ??
                          this.countBySeverity(findingsList, 'CRITICAL');
    const highCount = scoreData?.breakdown?.high ??
                      (!Array.isArray(findingsData) ? findingsData?.highIssues : undefined) ??
                      this.countBySeverity(findingsList, 'HIGH');
    const mediumCount = scoreData?.breakdown?.medium ??
                        (!Array.isArray(findingsData) ? findingsData?.mediumIssues : undefined) ??
                        this.countBySeverity(findingsList, 'MEDIUM');
    const securityScore = typeof scoreData?.score === 'number' ? scoreData.score : 0;

    // Check criteria
    const criteria = this.policy.promotion_criteria;

    checks.push({
      check: 'Security score generated',
      passed: Boolean(scoreData),
      expected: 'true',
      actual: scoreData ? 'true' : 'false',
      severity: 'error',
    });

    // Check critical issues
    checks.push({
      check: 'Critical vulnerabilities',
      passed: criticalCount <= criteria.max_critical,
      expected: `≤ ${criteria.max_critical}`,
      actual: criticalCount,
      severity: criticalCount > criteria.max_critical ? 'error' : 'warning',
    });

    // Check high issues
    checks.push({
      check: 'High vulnerabilities',
      passed: highCount <= criteria.max_high,
      expected: `≤ ${criteria.max_high}`,
      actual: highCount,
      severity: highCount > criteria.max_high ? 'error' : 'warning',
    });

    // Check medium issues
    checks.push({
      check: 'Medium vulnerabilities',
      passed: mediumCount <= criteria.max_medium,
      expected: `≤ ${criteria.max_medium}`,
      actual: mediumCount,
      severity: 'warning',
    });

    // Check security score
    checks.push({
      check: 'Security score minimum',
      passed: securityScore >= criteria.min_security_score,
      expected: `≥ ${criteria.min_security_score}`,
      actual: securityScore,
      severity: securityScore < criteria.min_security_score ? 'error' : 'warning',
    });

    // Check SBOM requirement
    if (criteria.require_sbom) {
      const sbomExists = await this.anyFileExists(dirs, 'sbom.json');
      checks.push({
        check: 'SBOM generated',
        passed: sbomExists,
        expected: 'true',
        actual: sbomExists ? 'true' : 'false',
        severity: 'error',
      });
    }

    // Check DAST requirement
    if (criteria.require_dast) {
      const dastResult = scoreData?.scanResults?.dast;
      const dastExists = await this.anyFileExists(dirs, 'zap-results.xml');
      const dastPerformed = dastExists || Boolean(dastResult && !dastResult.skipped && !dastResult.error);
      checks.push({
        check: 'DAST scan performed',
        passed: dastPerformed,
        expected: 'true',
        actual: dastPerformed ? 'true' : 'false',
        severity: 'error',
      });
    }

    if (criteria.required_sast_coverage > 0) {
      const sastResult = scoreData?.scanResults?.sast;
      const sastCoverage = sastResult && !sastResult.skipped && !sastResult.error ? 100 : 0;
      checks.push({
        check: 'SAST coverage',
        passed: sastCoverage >= criteria.required_sast_coverage,
        expected: `≥ ${criteria.required_sast_coverage}`,
        actual: sastCoverage,
        severity: sastCoverage >= criteria.required_sast_coverage ? 'warning' : 'error',
      });
    }

    // Determine overall result
    const failedChecks = checks.filter(c => !c.passed);
    const passed = failedChecks.length === 0;
    const reasons = failedChecks.map(
      c => `${c.check}: expected ${c.expected}, got ${c.actual}`,
    );

    logger.info(`[PolicyEvaluator] Evaluation result: ${passed ? 'PASSED' : 'FAILED'}`);
    if (!passed) {
      for (const reason of reasons) {
        logger.warn(`[PolicyEvaluator]  - ${reason}`);
      }
    }

    return {
      passed,
      score: securityScore,
      reasons,
      details: checks,
    };
  }

  /**
   * Write fix requests for policy failures into the project directory.
   */
  async writeFixRequests(projectDir: string, reasons: string[]): Promise<string> {
    const fixDir = path.join(projectDir, '.pakalon-agents', 'fix-requests');
    await fs.mkdir(fixDir, { recursive: true });

    const content = [
      '# Fix Requests — Policy Evaluation Failures',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      'The following policy checks failed during sandbox evaluation:',
      '',
      ...reasons.map(r => `- [ ] ${r}`),
      '',
      '---',
      '',
      '## Instructions',
      '',
      'These issues must be resolved before the application can be promoted.',
      `After fixing, the pipeline will re-loop to Phase ${this.policy.actions.loop_back_phase}.`,
      '',
    ].join('\n');

    const fixPath = path.join(fixDir, 'fix-requests.md');
    await fs.writeFile(fixPath, content, 'utf-8');
    logger.info(`[PolicyEvaluator] Fix requests written to ${fixPath}`);
    return fixPath;
  }

  /**
   * Generate a default security-policy.yml file.
   */
  static async generateDefaultPolicy(policyPath: string): Promise<void> {
    const dir = path.dirname(policyPath);
    await fs.mkdir(dir, { recursive: true });

    const content = [
      '# Pakalon Security Promotion Policy',
      '# Customize these thresholds to match your security requirements.',
      '',
      'promotion_criteria:',
      '  # Maximum allowed vulnerabilities by severity (per scan)',
      '  max_critical_vulnerabilities: 0    # Zero tolerance for critical',
      '  max_high_vulnerabilities: 2        # Allow up to 2 high-severity',
      '  max_medium_vulnerabilities: 10     # Allow up to 10 medium-severity',
      '  # Minimum security score (0-100, calculated from weighted issues)',
      '  min_security_score: 70',
      '  # Minimum required SAST coverage percentage',
      '  required_sast_coverage: 80',
      '  # Whether Dynamic Application Security Testing is required',
      '  require_dast: true',
      '  # Whether Software Bill of Materials generation is required',
      '  require_sbom: true',
      '',
      'actions:',
      '  # What to do when policy fails: loop_back | report_only | block',
      '  on_failure: loop_back',
      '  # Which phase to loop back to for fixes',
      '  loop_back_phase: 3',
      '  # Maximum number of loop iterations before blocking',
      '  max_loop_iterations: 3',
      '',
      'sandbox:',
      '  # Maximum runtime in minutes for the sandbox container',
      '  max_runtime_minutes: 30',
      '  # Maximum memory in MB for the sandbox container',
      '  max_memory_mb: 1024',
      '  # Maximum sandbox iterations per pipeline run',
      '  max_iterations: 5',
      '  # Automatically clean up sandbox after evaluation',
      '  auto_cleanup: true',
      '',
    ].join('\n');

    await fs.writeFile(policyPath, content, 'utf-8');
    logger.info(`[PolicyEvaluator] Default policy generated at ${policyPath}`);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private countBySeverity(findings: Array<{ severity?: string }>, severity: string): number {
    return findings.filter(f => f.severity?.toUpperCase() === severity).length;
  }

  private async readFirstJson<T>(directories: string[], fileName: string): Promise<T | null> {
    for (const dir of directories) {
      const value = await safeReadJson<T>(path.join(dir, fileName));
      if (value !== null) return value;
    }
    return null;
  }

  private async anyFileExists(directories: string[], fileName: string): Promise<boolean> {
    for (const dir of directories) {
      if (await this.fileExists(path.join(dir, fileName))) {
        return true;
      }
    }
    return false;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current policy configuration.
   */
  getPolicy(): PromotionPolicy {
    return this.policy;
  }
}

export default PolicyEvaluator;
