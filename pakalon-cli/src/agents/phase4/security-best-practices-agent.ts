/**
 * Phase 4 Subagent-5: Security Best Practices Agent
 * Reviews project configuration and code against OWASP Top 10 and security benchmarks.
 * Generates a security posture assessment with actionable recommendations.
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult } from '../types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '@/utils/logger.js';

export interface SecurityBestPracticesConfig {
  outputDir: string;
  projectDir: string;
  phaseContext?: string;
  /* Findings from other Phase 4 sub-agents for correlation */
  relatedFindings?: Array<{ severity: string; category: string; title: string }>;
}

export interface BestPracticeFinding {
  domain: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  check: string;
  status: 'pass' | 'fail' | 'not-applicable' | 'info';
  description: string;
  recommendation: string;
}

const SECURITY_BEST_PRACTICES_SYSTEM_PROMPT = `You are the Phase 4 Security Best Practices Agent for Pakalon.

Your responsibilities:
1. Assess project against OWASP Top 10 security risks
2. Check authentication and authorization patterns
3. Verify data protection and encryption practices
4. Review logging and monitoring setup
5. Assess dependency management practices
6. Check secure configuration defaults
7. Review session management`;

export class SecurityBestPracticesAgent extends BaseAgent {
  private findings: BestPracticeFinding[] = [];
  private outputDir: string;
  private projectDir: string;
  private phaseContext: string;
  private relatedFindings: Array<{ severity: string; category: string; title: string }>;

  constructor(context: AgentContext, config: SecurityBestPracticesConfig) {
    const agentConfig: AgentConfig = {
      name: 'phase4-security-best-practices',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt: SECURITY_BEST_PRACTICES_SYSTEM_PROMPT,
      tools: [],
      maxTokens: 8192,
      temperature: 0.3,
    };

    super(agentConfig, context);

    this.outputDir = config.outputDir;
    this.projectDir = config.projectDir;
    this.phaseContext = config.phaseContext ?? '';
    this.relatedFindings = config.relatedFindings ?? [];
  }

  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      logger.info('[Phase4-SecurityBestPractices] Starting security best practices assessment...');
      await fs.mkdir(this.outputDir, { recursive: true });

      // Run all security checks
      await this.checkAuthenticationPractices();
      await this.checkDataProtection();
      await this.checkDependencyManagement();
      await this.checkLoggingMonitoring();
      await this.checkSessionManagement();
      await this.checkSecureDefaults();
      await this.checkOWASPTop10();

      // Generate assessment report
      await this.generateReport();

      const duration = Date.now() - startTime;
      const passCount = this.findings.filter(f => f.status === 'pass').length;
      const failCount = this.findings.filter(f => f.status === 'fail').length;
      logger.info(`[Phase4-SecurityBestPractices] Completed in ${(duration / 1000).toFixed(1)}s — ${passCount} passed, ${failCount} failed`);

      return {
        success: true,
        message: `Security best practices assessment completed. ${passCount} passed, ${failCount} failed.`,
        filesCreated: [path.join(this.outputDir, 'security-best-practices-report.md')],
        data: {
          findings: this.findings,
          passCount,
          failCount,
          totalChecks: this.findings.length,
        },
        duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Phase4-SecurityBestPractices] Failed: ${message}`);
      return {
        success: false,
        message: `Security best practices assessment failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  private async checkAuthenticationPractices(): Promise<void> {
    // Check for auth middleware
    const authMiddlewareExists = await this.fileExists('src/middleware/auth*');
    const hasJWT = await this.fileContainsGlob('**/*.ts', /jwt|JWT|jsonwebtoken/);
    const hasRateLimit = await this.fileContainsGlob('**/*.ts', /rate.?limit|ratelimit/i);
    const hasPasswordHashing = await this.fileContainsGlob('**/*.ts', /bcrypt|argon2|scrypt|hashSync|hashAsync/);

    this.addFinding('authentication', hasJWT ? 'pass' : 'fail', 'JWT-based authentication', 'JWT authentication pattern');
    this.addFinding('authentication', hasRateLimit ? 'pass' : 'fail', 'Rate limiting on auth endpoints', 'Prevents brute force attacks');
    this.addFinding('authentication', authMiddlewareExists ? 'pass' : 'fail', 'Auth middleware for route protection', 'Centralized auth check');
    this.addFinding('authentication', hasPasswordHashing ? 'pass' : 'fail', 'Secure password hashing', 'Uses bcrypt/argon2/scrypt');
  }

  private async checkDataProtection(): Promise<void> {
    const hasHelmet = await this.fileContainsGlob('**/*.{ts,js}', /helmet|express-sslify/i);
    const hasCors = await this.fileContainsGlob('**/*.{ts,js}', /cors\s*\(/);
    const hasHttps = await this.fileContainsGlob('**/*.{ts,js}', /https|ssl|tls/i);

    this.addFinding('data-protection', hasHelmet ? 'pass' : 'fail', 'Security headers (Helmet/CSP)', 'Protection against XSS/clickjacking');
    this.addFinding('data-protection', hasCors ? 'pass' : 'fail', 'CORS configuration', 'Cross-origin resource sharing policy');
    this.addFinding('data-protection', hasHttps ? 'pass' : 'fail', 'HTTPS enforcement', 'TLS encryption in transit');
  }

  private async checkDependencyManagement(): Promise<void> {
    const hasPackageJson = await this.fileExists('package.json');
    let hasAuditScript = false;
    let hasLockfile = false;

    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(this.projectDir, 'package.json'), 'utf-8'));
        hasAuditScript = (pkg.scripts?.audit || pkg.scripts?.['npm-audit']) != null;
        hasLockfile = await this.fileExists('package-lock.json') || await this.fileExists('yarn.lock');
      } catch { /* ignore */ }
    }

    this.addFinding('dependencies', hasPackageJson ? 'pass' : 'fail', 'Package manifest present', 'Dependency tracking');
    this.addFinding('dependencies', hasLockfile ? 'pass' : 'fail', 'Lockfile committed', 'Ensures reproducible installs');
    this.addFinding('dependencies', hasAuditScript ? 'pass' : 'fail', 'npm audit configured', 'Vulnerability scanning');
  }

  private async checkLoggingMonitoring(): Promise<void> {
    const hasLogger = await this.fileContainsGlob('**/*.{ts,js}', /logger\.|log\.(info|error|warn)|pino|winston|debugLog/);
    const hasErrorTracking = await this.fileContainsGlob('**/*.{ts,js}', /sentry|datadog|newrelic|rollbar|bugsnag/i);
    const hasErrorMiddleware = await this.fileContainsGlob('**/*.{ts,js}', /error.?handler|error.?middleware|errorHandler/i);

    this.addFinding('logging', hasLogger ? 'pass' : 'fail', 'Structured logging', 'Log management and monitoring');
    this.addFinding('logging', hasErrorMiddleware ? 'pass' : 'fail', 'Error handling middleware', 'Centralized error handling');
    this.addFinding('logging', hasErrorTracking ? 'not-applicable' : 'info', 'Application monitoring', 'Optional: Sentry/Datadog integration');
  }

  private async checkSessionManagement(): Promise<void> {
    const hasSession = await this.fileContainsGlob('**/*.{ts,js}', /express-session|cookie-session|session\(/);
    const hasSecureCookies = await this.fileContainsGlob('**/*.{ts,js}', /httpOnly|secure:\s*true|sameSite/i);

    this.addFinding('session', hasSession ? 'pass' : 'not-applicable', 'Session management', 'Server-side session handling');
    this.addFinding('session', hasSecureCookies ? 'pass' : 'fail', 'Secure cookie flags', 'httpOnly, secure, sameSite flags');
  }

  private async checkSecureDefaults(): Promise<void> {
    const hasEnvExample = await this.fileExists('.env.example');
    const hasGitignore = await this.fileExists('.gitignore');
    const hasHelmetConfig = await this.fileContainsGlob('**/*.{ts,js}', /helmet\s*\(/);

    this.addFinding('secure-defaults', hasEnvExample ? 'pass' : 'fail', '.env.example provided', 'Template for required env vars');
    this.addFinding('secure-defaults', hasGitignore ? 'pass' : 'fail', '.gitignore present', 'Prevents accidental secret commits');
    this.addFinding('secure-defaults', hasHelmetConfig ? 'pass' : 'fail', 'Helmet security headers', 'Sets secure HTTP headers');
  }

  private async checkOWASPTop10(): Promise<void> {
    // Correlate with actual findings for OWASP coverage
    const owaspChecks: Array<{ id: string; name: string; finding: string }> = [
      { id: 'A01', name: 'Broken Access Control', finding: 'auth middleware, permission checks' },
      { id: 'A02', name: 'Cryptographic Failures', finding: 'HTTPS, encryption at rest' },
      { id: 'A03', name: 'Injection', finding: 'Input validation, parameterized queries' },
      { id: 'A04', name: 'Insecure Design', finding: 'Rate limiting, security by design' },
      { id: 'A05', name: 'Security Misconfiguration', finding: 'Helmet, CORS, secure defaults' },
      { id: 'A06', name: 'Vulnerable Components', finding: 'npm audit, dependency scanning' },
      { id: 'A07', name: 'Auth Failures', finding: 'JWT, session management' },
      { id: 'A08', name: 'Data Integrity Failures', finding: 'CI/CD pipeline security' },
      { id: 'A09', name: 'Logging Failures', finding: 'Structured logging, monitoring' },
      { id: 'A10', name: 'SSRF', finding: 'Input validation on URLs' },
    ];

    // Map related findings from other sub-agents to OWASP categories
    const relatedFindingsByDomain: Record<string, number> = {};
    for (const rf of this.relatedFindings) {
      const domain = rf.category || 'other';
      relatedFindingsByDomain[domain] = (relatedFindingsByDomain[domain] || 0) + 1;
    }

    for (const check of owaspChecks) {
      const hasRelatedFinding = Object.entries(relatedFindingsByDomain)
        .some(([domain, count]) => check.finding.includes(domain) && count > 0);

      this.addFinding(
        'owasp-top-10',
        hasRelatedFinding ? 'pass' : 'info',
        `${check.id}: ${check.name}`,
        check.finding
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private addFinding(domain: string, status: BestPracticeFinding['status'], check: string, description: string): void {
    const severityMap: Record<string, BestPracticeFinding['severity']> = {
      fail: 'HIGH',
      pass: 'INFO',
      'not-applicable': 'INFO',
      info: 'INFO',
    };

    this.findings.push({
      domain,
      severity: severityMap[status] || 'INFO',
      check,
      status,
      description,
      recommendation: status === 'fail'
        ? `Implement ${check.toLowerCase()} — ${description}`
        : status === 'pass'
          ? `${check} is properly configured`
          : `Review if ${check.toLowerCase()} is needed for your use case`,
    });
  }

  private async fileExists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.projectDir, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  private async fileContainsGlob(glob: string, pattern: RegExp): Promise<boolean> {
    try {
      const { glob: globModule } = await import('glob');
      const files = await globModule(glob, { cwd: this.projectDir, nodir: true });
      for (const file of files.slice(0, 20)) { // Check first 20 files
        try {
          const content = await fs.readFile(path.join(this.projectDir, file), 'utf-8');
          if (pattern.test(content)) return true;
        } catch { /* skip unreadable */ }
      }
    } catch { /* glob pattern error */ }
    return false;
  }

  private async generateReport(): Promise<void> {
    const passCount = this.findings.filter(f => f.status === 'pass').length;
    const failCount = this.findings.filter(f => f.status === 'fail').length;
    const naCount = this.findings.filter(f => f.status === 'not-applicable').length;

    const domainSummary: Record<string, { pass: number; fail: number }> = {};
    for (const f of this.findings) {
      if (!domainSummary[f.domain]) domainSummary[f.domain] = { pass: 0, fail: 0 };
      const summary = domainSummary[f.domain]!;
      if (f.status === 'pass') summary.pass++;
      if (f.status === 'fail') summary.fail++;
    }

    const score = this.findings.length > 0
      ? Math.round((passCount / (passCount + failCount)) * 100)
      : 0;

    const report = `# Security Best Practices Assessment

## Overall Score: ${score}%

| Metric | Count |
|--------|-------|
| [OK] Passed | ${passCount} |
| [X] Failed | ${failCount} |
| - N/A | ${naCount} |
| **Total** | ${this.findings.length} |

## Domain Summary

${Object.entries(domainSummary).map(([domain, counts]) =>
  `### ${domain}\n- [OK] Passed: ${counts.pass}\n- [X] Failed: ${counts.fail}`
).join('\n\n')}

## Detailed Findings

${this.findings.map(f => `
### [${f.status === 'pass' ? '[OK]' : f.status === 'fail' ? '[X]' : '-'}] ${f.check}
- **Domain**: ${f.domain}
- **Severity**: ${f.severity}
- **Description**: ${f.description}
- **Recommendation**: ${f.recommendation}
`).join('\n')}

## Top Recommendations

${failCount > 0 ? '### Critical Items to Address\n' + this.findings.filter(f => f.status === 'fail').map(f => `- ${f.check}: ${f.recommendation}`).join('\n') : 'All checks passed — excellent security posture!'}

---

*Report generated by Pakalon Phase 4 Security Best Practices Agent*
`;

    await fs.writeFile(path.join(this.outputDir, 'security-best-practices-report.md'), report, 'utf-8');
    logger.info('[Phase4-SecurityBestPractices] [OK] Security best practices report generated');
  }
}
