/**
 * Phase 4 Agent: Security Scanning
 * Enterprise-grade security implementation
 * 
 * Features:
 * - SAST (Static Application Security Testing)
 * - DAST (Dynamic Application Security Testing)
 * - Dependency vulnerability scanning
 * - Secret detection
 * - Security report generation
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult, Phase4State } from '../types.js';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { getToolsForAI } from '@/tools/registry-new.js';
import { SecurityBrowserAgent } from './browser-agent.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import { spawn } from 'child_process';
import logger from '@/utils/logger.js';
import { scanForVulnerabilities } from '@/deepsec/scanner/index.js';
import type { SecurityFinding as DeepsecFinding } from '@/deepsec/core/types.js';
import { generateSBOM } from './sbom-generator.js';
import { runComplianceCheck } from './compliance-checker.js';
import { runPenetrationTest } from './pentest-automation.js';
import { startRuntimeMonitoring } from './runtime-monitor.js';
import { generateBlackboxXml, generateWhiteboxXml } from './xml-test-generator.js';
import { loadSandboxState, isSandboxUsableStatus, PAKALON_SANDBOX_NETWORK } from '@/sandbox/index.js';
import { runPlaywrightTests } from '../../tools/playwright-test-runner.js';
import { generateSecurityReport as generateSecurityReportArtifacts, type SecurityFinding as ReportSecurityFinding } from '../../security/index.js';

type Phase4ExecutionOptions = {
  continuousMonitoring?: boolean;
};

export interface SecurityFinding {
  tool: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  file: string;
  line?: number;
  message: string;
  rule?: string;
}

export interface SecurityPatchResult {
  patchesApplied: string[];
  codeChanges: Map<string, string>;
}

const PHASE4_SYSTEM_PROMPT = `You are the Phase 4 Security Agent for Pakalon.

Your responsibilities:
1. Run SAST scans (Semgrep, Deepsec)
2. Run DAST scans (OWASP ZAP)
3. Check dependencies for vulnerabilities
4. Detect secrets and credentials
5. Generate security report with recommendations

You must use natural language. Explain security issues clearly.`;

type ScanParser = (content: string) => void;

type Phase4RuntimeState = Omit<Phase4State, 'projectDir' | 'userPrompt' | 'securityIssues'> & {
  userPrompt: string;
  projectDir: string;
  securityIssues: SecurityFinding[];
  discoveredEndpoints?: string[];
};

interface ScanCommandOptions {
  command: string;
  outputFile: string;
  parser: ScanParser;
  scanName: string;
}

interface SecurityHeadersReport {
  target_url?: string;
  final_url?: string;
  status?: string;
  status_code?: number;
  missing_headers?: string[];
  present_headers?: Record<string, string>;
  warnings?: string[];
  recommendations?: string[];
}

export class Phase4Agent extends BaseAgent {
  private state: Phase4RuntimeState;
  private outputDir: string;
  private iteration = 0;
  private runtimeMonitorHandle: { stop(): Promise<void> } | null = null;
  private executionOptions: Phase4ExecutionOptions;
  private generatedXmlFiles: string[] = [];
  /** Whether the AIO Sandbox is active, enabling shared-network DAST scanning */
  private sandboxActive = false;
  
  constructor(context: AgentContext) {
    const projectDir = context.projectDir ?? process.cwd();
    const userPrompt = context.userPrompt ?? '';
    const config: AgentConfig = {
      name: 'phase4-security',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt: PHASE4_SYSTEM_PROMPT,
      tools: getToolsForAI(),
      maxTokens: 8192,
      temperature: 0.3, // Low temperature for security analysis
      onFeedback: (feedback) => {
        logger.warn(`[Phase4] Feedback emitted for ${feedback.source}: ${feedback.summary}`);
      },
    };
    
    super(config, context);
    this.executionOptions = {
      continuousMonitoring: context.continuousMonitoring,
    };
    
    this.state = {
      userPrompt,
      projectDir,
      securityIssues: [] as SecurityFinding[],
      scanResults: new Map(),
    };
    
    this.outputDir = path.join(projectDir, '.pakalon-agents', 'phase-4');
    
    logger.info(`[Phase4] Initialized for project: ${projectDir}`);
  }
  
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    
    try {
      logger.info('[Phase4] ========================================');
      logger.info('[Phase4] Starting Phase 4: Security Scanning');
      logger.info('[Phase4] ========================================');
      
      await fs.mkdir(this.outputDir, { recursive: true });

      // Check if a sandbox was provisioned in Phase 3
      // If so, point DAST tools at the sandbox URL instead of the default localhost
      const sandboxState = await loadSandboxState(this.state.projectDir);
      if (sandboxState && isSandboxUsableStatus(sandboxState.status)) {
        const sandboxTargetUrl = sandboxState.appUrl ?? sandboxState.url;
        logger.info(`[Phase4] Sandbox detected at ${sandboxTargetUrl} — pointing DAST tools at sandbox`);
        this.state.targetUrl = sandboxTargetUrl;
        this.sandboxActive = true;
        // Set environment variables for DAST tools
        process.env.SECURITY_TARGET_URL = sandboxTargetUrl;
        process.env.SECURITY_TARGET_HOST = new URL(sandboxTargetUrl).hostname;
      }

      if (this.executionOptions.continuousMonitoring) {
        const targetUrl = await this.resolveTargetUrl();
        if (targetUrl) {
          this.runtimeMonitorHandle = await startRuntimeMonitoring(targetUrl, 5 * 60 * 1000);
          logger.info('[Phase4] Continuous monitoring enabled');
        }
      }
      
      // Step 1: SAST scanning
      logger.info('[Phase4] Step 1/5: SAST Scanning');
      await this.runSASTScan();
      
      // Step 2: Dependency scanning
      logger.info('[Phase4] Step 2/5: Dependency Scanning');
      await this.runDependencyScan();
      
      // Step 3: Secret detection
      logger.info('[Phase4] Step 3/5: Secret Detection');
      await this.runSecretDetection();
      
      // Step 4: DAST scanning
      logger.info('[Phase4] Step 4/5: DAST Scanning');
      await this.runDASTScan();

      // Step 5: SBOM generation
      logger.info('[Phase4] Step 5/10: SBOM Generation');
      await this.runSBOMGeneration();

      // Step 6: Compliance checking
      logger.info('[Phase4] Step 6/10: Compliance Checking');
      await this.runComplianceChecking();

      // Step 7: Penetration testing automation
      logger.info('[Phase4] Step 7/10: Penetration Testing Automation');
      await this.runPenetrationTesting();

      // Step 8: SonarQube scan
      logger.info('[Phase4] Step 8/10: SonarQube Scan');
      await this.runSonarQubeScan();

      // Step 9: ESLint security scan
      logger.info('[Phase4] Step 9/10: ESLint Security Scan');
      await this.runESLintSecurityScan();

      // Step 10: Security scoring & callback loop
      logger.info('[Phase4] Step 10/10: Security Scoring & Callback Loop');
      const securityScore = await this.runSecurityScoring();
      
      // Step 8: Code Review (SA-3)
      logger.info('[Phase4] Step 8/10: Code Review Agent');
      const codeReviewResult = await this.runCodeReviewAgent();
      
      // Step 9: CI/CD Review (SA-4) 
      logger.info('[Phase4] Step 9/10: CI/CD Pipeline Review Agent');
      const cicdReviewResult = await this.runCICDReviewAgent();
      
      // Step 10: Security Best Practices (SA-5)
      logger.info('[Phase4] Step 10/10: Security Best Practices Agent');
      const bestPracticesResult = await this.runSecurityBestPracticesAgent();
      
      // Generate final security report
      logger.info('[Phase4] Generating testing XML artifacts');
      await this.generateTestingXmlFiles();

      await this.generateFindingsJson();
      await this.generateSecurityReport();

      if (this.runtimeMonitorHandle) {
        await this.runtimeMonitorHandle.stop();
        this.runtimeMonitorHandle = null;
      }
      
      const duration = Date.now() - startTime;
      const criticalIssues = this.state.securityIssues.filter(i => i.severity === 'CRITICAL').length;
      const highIssues = this.state.securityIssues.filter(i => i.severity === 'HIGH').length;
      const codeReviewFindings = (codeReviewResult?.data as any)?.findingCount ?? 0;
      const cicdFindings = (cicdReviewResult?.data as any)?.findingCount ?? 0;
      const bpFindings = (bestPracticesResult?.data as any)?.failCount ?? 0;

      if (criticalIssues > 0 || highIssues > 0) {
        this.config.onFeedback?.({
          source: 'phase4',
          criticalIssues,
          highIssues,
          issues: [...this.state.securityIssues],
          summary: `${criticalIssues} critical and ${highIssues} high security issues require attention`,
        });
      }
      
      logger.info('[Phase4] ========================================');
      logger.info(`[Phase4] Phase 4 Completed Successfully in ${(duration / 1000).toFixed(1)}s`);
      logger.info(`[Phase4] SAST/DAST Issues: ${this.state.securityIssues.length} (${criticalIssues} critical, ${highIssues} high)`);
      logger.info(`[Phase4] Code Review Findings: ${codeReviewFindings}`);
      logger.info(`[Phase4] CI/CD Review Findings: ${cicdFindings}`);
      logger.info(`[Phase4] Best Practices Failed: ${bpFindings}`);
      logger.info(`[Phase4] Security Score: ${securityScore}/100`);
      logger.info('[Phase4] ========================================');
      
      return {
        success: true,
        message: `Phase 4 completed. Security score: ${securityScore}/100. SAST/DAST: ${this.state.securityIssues.length}, Code Review: ${codeReviewFindings}, CI/CD: ${cicdFindings}, Best Practices: ${bpFindings}`,
        data: {
          totalIssues: this.state.securityIssues.length,
          criticalIssues,
          highIssues,
          securityScore,
          codeReviewFindings,
          cicdFindings,
          bestPracticesFailures: bpFindings,
          xmlFiles: [...this.generatedXmlFiles],
        },
        filesCreated: [...this.generatedXmlFiles],
        duration,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Phase4] Phase 4 failed: ${message}`);
      
      return {
        success: false,
        message: `Phase 4 failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Calculate security score and run callback loop
   * Score: 0-100 based on severity-weighted issues
   * Callback loop: auto-fix critical issues if below threshold
   */
  private async runSecurityScoring(): Promise<number> {
    // Calculate weighted security score
    const score = this.calculateSecurityScore();
    
    // Generate security score card
    await this.generateScoreCard(score);
    
    // Callback loop: if score is low and not YOLO, attempt fixes
    if (score < 60 && !this.context.isYolo) {
      const callbackIterations = 2;
      for (let i = 0; i < callbackIterations; i++) {
        const currentScore = this.calculateSecurityScore();
        if (currentScore >= 80) {
          logger.info(`[Phase4] Score ${currentScore}/100 meets threshold — skipping callback loop`);
          break;
        }
        
        logger.info(`[Phase4] Callback iteration ${i + 1}/${callbackIterations} — score: ${currentScore}/100`);
        
        // Get critical issues to auto-fix
        const criticalFindings = this.state.securityIssues.filter(
          f => f.severity === 'CRITICAL' || f.severity === 'HIGH'
        );
        
        if (criticalFindings.length === 0) {
          logger.info('[Phase4] No critical/high issues to fix — ending callback loop');
          break;
        }
        
        // Apply automated patches
        const patchResult = await this.applyPatches(criticalFindings);
        if (patchResult.patchesApplied.length > 0) {
          logger.info(`[Phase4] Applied ${patchResult.patchesApplied.length} patches:`);
          patchResult.patchesApplied.forEach(p => logger.info(`  - ${p}`));
          
          // Re-scan to verify fixes
          logger.info('[Phase4] Re-scanning after patches...');
          this.state.securityIssues = [];
          await this.runSASTScan();
          await this.runDependencyScan();
          await this.runSecretDetection();
          await this.runESLintSecurityScan();
          
          const newScore = this.calculateSecurityScore();
          logger.info(`[Phase4] Score after callback: ${newScore}/100`);
          
          // Update score card
          await this.generateScoreCard(newScore);
        } else {
          logger.info('[Phase4] No auto-fixable issues — ending callback loop');
          break;
        }
      }
    }
    
    return this.calculateSecurityScore();
  }

  private async safeReadJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  
  /**
   * Calculate weighted security score (0-100)
   * - CRITICAL: -30 points each
   * - HIGH: -15 points each
   * - MEDIUM: -5 points each
   * - LOW: -2 points each
   */
  private calculateSecurityScore(): number {
    let score = 100;
    
    for (const issue of this.state.securityIssues) {
      switch (issue.severity) {
        case 'CRITICAL':
          score -= 30;
          break;
        case 'HIGH':
          score -= 15;
          break;
        case 'MEDIUM':
          score -= 5;
          break;
        case 'LOW':
          score -= 2;
          break;
      }
    }
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate security score card JSON
   */
  private async generateScoreCard(score: number): Promise<void> {
    const criticalCount = this.state.securityIssues.filter(i => i.severity === 'CRITICAL').length;
    const highCount = this.state.securityIssues.filter(i => i.severity === 'HIGH').length;
    const mediumCount = this.state.securityIssues.filter(i => i.severity === 'MEDIUM').length;
    const lowCount = this.state.securityIssues.filter(i => i.severity === 'LOW').length;
    
    const grade: string = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
    
    const scoreCard = {
      score,
      grade,
      passed: score >= 60,
      breakdown: {
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        low: lowCount,
        total: this.state.securityIssues.length,
      },
      scanResults: Object.fromEntries(this.state.scanResults),
      timestamp: new Date().toISOString(),
      recommendations: [
        criticalCount > 0 ? 'Fix all critical issues immediately' : null,
        highCount > 0 ? 'Address high-severity vulnerabilities' : null,
        score < 70 ? 'Run security review before deployment' : null,
        score >= 80 ? 'Security posture is acceptable' : null,
        score >= 95 ? 'Excellent security posture' : null,
      ].filter(Boolean),
    };
    
    await fs.writeFile(
      path.join(this.outputDir, 'security-score.json'),
      JSON.stringify(scoreCard, null, 2)
    );
    
    // Update the security report with the score
    const reportPath = path.join(this.outputDir, 'security-report.md');
    const scoreSection = [
      '',
      '## Security Score Card',
      '',
      `**Score:** ${score}/100 (Grade: ${grade})`,
      `**Status:** ${score >= 60 ? '[OK] PASSED' : '[X] FAILED'}`,
      '',
      '### Breakdown',
      `- Critical: ${criticalCount}`,
      `- High: ${highCount}`,
      `- Medium: ${mediumCount}`,
      `- Low: ${lowCount}`,
      '',
      '### Recommendations',
      ...scoreCard.recommendations.map(r => `- ${r}`),
      '',
    ].join('\n');
    
    await fs.appendFile(reportPath, scoreSection);
    
    logger.info(`[Phase4] Security score: ${score}/100 (Grade: ${grade})`);
  }

  /**
   * Run SA-3 Code Review Agent — reviews source code for quality and security
   */
  private async runCodeReviewAgent(): Promise<AgentResult | null> {
    try {
      const { CodeReviewAgent } = await import('./code-review-agent.js');

      const agent = new CodeReviewAgent(this.context, {
        outputDir: path.join(this.outputDir, 'code-review'),
        projectDir: this.state.projectDir,
        scanDirs: [
          path.join(this.state.projectDir, 'src'),
        ],
        phaseContext: `Found ${this.state.securityIssues.length} security issues from scanning`,
      });

      const result = await agent.execute();
      logger.info(`[Phase4] [OK] Code Review Agent: ${result.message}`);
      this.state.scanResults.set('code-review', {
        issues: Number(result.data?.findingCount ?? 0),
        error: result.success ? undefined : result.message,
      });
      return result;
    } catch (error) {
      logger.warn(`[Phase4] Code Review Agent failed: ${error}`);
      return null;
    }
  }

  /**
   * Run SA-4 CI/CD Review Agent — reviews pipeline configuration
   */
  private async runCICDReviewAgent(): Promise<AgentResult | null> {
    try {
      const { CICDReviewAgent } = await import('./cicd-review-agent.js');

      const agent = new CICDReviewAgent(this.context, {
        outputDir: path.join(this.outputDir, 'cicd-review'),
        projectDir: this.state.projectDir,
        phaseContext: 'CI/CD pipeline security review',
      });

      const result = await agent.execute();
      logger.info(`[Phase4] [OK] CI/CD Review Agent: ${result.message}`);
      this.state.scanResults.set('cicd-review', {
        issues: Number(result.data?.findingCount ?? 0),
        error: result.success ? undefined : result.message,
      });
      return result;
    } catch (error) {
      logger.warn(`[Phase4] CI/CD Review Agent failed: ${error}`);
      return null;
    }
  }

  /**
   * Run SA-5 Security Best Practices Agent — assesses security posture
   */
  private async runSecurityBestPracticesAgent(): Promise<AgentResult | null> {
    try {
      const { SecurityBestPracticesAgent } = await import('./security-best-practices-agent.js');

      // Collect related findings from other scans for correlation
      const relatedFindings = this.state.securityIssues.map(i => ({
        severity: i.severity,
        category: i.tool,
        title: i.message,
      }));

      const agent = new SecurityBestPracticesAgent(this.context, {
        outputDir: path.join(this.outputDir, 'best-practices'),
        projectDir: this.state.projectDir,
        relatedFindings,
        phaseContext: 'Security best practices assessment',
      });

      const result = await agent.execute();
      logger.info(`[Phase4] [OK] Security Best Practices Agent: ${result.message}`);
      this.state.scanResults.set('best-practices', {
        issues: Number(result.data?.failCount ?? 0),
        error: result.success ? undefined : result.message,
      });
      return result;
    } catch (error) {
      logger.warn(`[Phase4] Security Best Practices Agent failed: ${error}`);
      return null;
    }
  }

  private async runSASTScan(): Promise<void> {
    try {
      logger.info('[Phase4] Running SAST scans (Semgrep, Deepsec)...');
      
      // Run Semgrep for TypeScript/JavaScript
      logger.info('[Phase4] Running Semgrep...');
      const semgrepResult = await this.runCommand(
        `docker run --rm -v "${this.state.projectDir}:/src" returntocorp/semgrep semgrep --config=auto --json /src || exit 0`
      );
      
      // Parse Semgrep output
      if (semgrepResult && semgrepResult.includes('{')) {
        try {
          const results = JSON.parse(semgrepResult);
          if (results.results) {
            for (const issue of results.results) {
              this.state.securityIssues.push({
                tool: 'semgrep',
                severity: this.mapSemgrepSeverity(issue.extra?.severity),
                file: issue.path,
                line: issue.start?.line,
                message: issue.extra?.message || 'Security issue detected',
                rule: issue.check_id,
              });
            }
          }
        } catch (error) {
          logger.warn('[Phase4] Failed to parse Semgrep output');
        }
      }
      
      // Run Deepsec regex-based vulnerability scan
      logger.info('[Phase4] Running Deepsec security scan...');
      try {
        const deepsecFindings = await scanForVulnerabilities(this.state.projectDir);
        if (deepsecFindings && deepsecFindings.length > 0) {
          logger.info(`[Phase4] Deepsec found ${deepsecFindings.length} security issues`);
          for (const finding of deepsecFindings) {
            this.state.securityIssues.push({
              tool: 'deepsec',
              severity: this.normalizeSeverity(finding.severity),
              file: finding.file || 'unknown',
              line: finding.line,
              message: finding.message || 'Security issue detected',
              rule: finding.rule || 'deepsec-rule',
            });
          }
        }
      } catch (deepsecError) {
        logger.warn(`[Phase4] Deepsec scan failed: ${deepsecError}`);
      }
      
      const issueCount = this.state.securityIssues.filter(i => i.tool === 'semgrep').length;
      const deepsecCount = this.state.securityIssues.filter(i => i.tool === 'deepsec').length;
      logger.info(`[Phase4] Semgrep: ${issueCount} issues found`);
      logger.info(`[Phase4] Deepsec: ${deepsecCount} issues found`);
      
      this.state.scanResults.set('sast', { issues: issueCount + deepsecCount });
      
    } catch (error) {
      logger.warn(`[Phase4] SAST scan failed: ${error}`);
      this.state.scanResults.set('sast', { issues: 0, error: String(error) });
    }
  }

  private async runSBOMGeneration(): Promise<void> {
    try {
      const format = (this.context.userPrompt?.toLowerCase().includes('spdx') ? 'spdx' : 'cyclonedx') as 'cyclonedx' | 'spdx';
      const sbom = await generateSBOM(this.state.projectDir, format);
      this.state.scanResults.set('sbom', { issues: 0 });
      logger.info(`[Phase4] SBOM generated: ${sbom.components.length} components (${format})`);
    } catch (error) {
      logger.warn(`[Phase4] SBOM generation failed: ${error}`);
      this.state.scanResults.set('sbom', { issues: 0, error: String(error) });
    }
  }

  private async runComplianceChecking(): Promise<void> {
    try {
      const report = await runComplianceCheck(this.state.projectDir, ['SOC2', 'GDPR']);
      this.state.scanResults.set('compliance', { issues: report.findings.filter((finding) => finding.status === 'fail').length });
      logger.info(`[Phase4] Compliance score: ${report.score}/100`);
    } catch (error) {
      logger.warn(`[Phase4] Compliance check failed: ${error}`);
      this.state.scanResults.set('compliance', { issues: 0, error: String(error) });
    }
  }

  private async runPenetrationTesting(): Promise<void> {
    try {
      const targetUrl = await this.resolveTargetUrl();
      if (!targetUrl) {
        logger.warn('[Phase4] No target URL discovered for penetration testing');
        this.state.scanResults.set('pentest', { issues: 0, skipped: true });
        return;
      }

      const report = await runPenetrationTest(targetUrl, this.state.projectDir);
      this.state.scanResults.set('pentest', { issues: report.findings.length });
      logger.info(`[Phase4] Penetration test completed: ${report.findings.length} findings`);
    } catch (error) {
      logger.warn(`[Phase4] Penetration test failed: ${error}`);
      this.state.scanResults.set('pentest', { issues: 0, error: String(error) });
    }
  }
  
  private async runDependencyScan(): Promise<void> {
    try {
      logger.info('[Phase4] Running dependency vulnerability scan...');
      
      // Run npm audit
      const auditResult = await this.runCommand('npm audit --json || exit 0');
      
      if (auditResult && auditResult.includes('{')) {
        try {
          const results = JSON.parse(auditResult);
          const vulnerabilities = results.vulnerabilities || {};
          
          for (const [pkg, vulnData] of Object.entries(vulnerabilities)) {
            const vulnInfo = vulnData as any;
            this.state.securityIssues.push({
              tool: 'npm-audit',
              severity: this.normalizeSeverity(vulnInfo.severity ?? 'MEDIUM'),
              file: 'package.json',
              message: `Vulnerability in ${pkg}: ${vulnInfo.via?.[0]?.title || 'Dependency issue'}`,
              rule: 'dependency-vulnerability',
            });
          }
        } catch (error) {
          logger.warn('[Phase4] Failed to parse npm audit output');
        }
      }
      
      const issueCount = this.state.securityIssues.filter(i => i.tool === 'npm-audit').length;
      logger.info(`[Phase4] [OK] Dependency scan complete: ${issueCount} vulnerabilities found`);
      
      this.state.scanResults.set('dependencies', { issues: issueCount });
      
    } catch (error) {
      logger.warn(`[Phase4] Dependency scan failed: ${error}`);
      this.state.scanResults.set('dependencies', { issues: 0, error: String(error) });
    }
  }
  
  private async runSecretDetection(): Promise<void> {
    try {
      logger.info('[Phase4] Running secret detection (gitleaks)...');
      
      // Run gitleaks
      const gitleaksResult = await this.runCommand(
        `docker run --rm -v "${this.state.projectDir}:/src" zricethezav/gitleaks:latest detect --source=/src --report-format=json --report-path=/dev/stdout --no-git || exit 0`
      );
      
      if (gitleaksResult && gitleaksResult.includes('{')) {
        try {
          const results = JSON.parse(gitleaksResult);
          if (Array.isArray(results)) {
            for (const secret of results) {
              this.state.securityIssues.push({
                tool: 'gitleaks',
                severity: 'CRITICAL',
                file: secret.File,
                line: secret.StartLine,
                message: `Secret detected: ${secret.Description}`,
                rule: secret.RuleID,
              });
            }
          }
        } catch (error) {
          logger.warn('[Phase4] Failed to parse gitleaks output');
        }
      }
      
      const issueCount = this.state.securityIssues.filter(i => i.tool === 'gitleaks').length;
      logger.info(`[Phase4] [OK] Secret detection complete: ${issueCount} secrets found`);
      
      this.state.scanResults.set('secrets', { issues: issueCount });
      
    } catch (error) {
      logger.warn(`[Phase4] Secret detection failed: ${error}`);
      this.state.scanResults.set('secrets', { issues: 0, error: String(error) });
    }
  }
  
  private async runDASTScan(): Promise<void> {
    try {
      logger.info('[Phase4] Running DAST scans (OWASP ZAP, Nikto, sqlmap, Wapiti)...');

      const targetUrl = await this.resolveTargetUrl();
      if (!targetUrl) {
        logger.warn('[Phase4] No target URL discovered for DAST scan');
        this.state.scanResults.set('dast', { issues: 0, skipped: true });
        return;
      }

      // When sandbox is active, use the shared Docker network so DAST containers
      // can reach the sandbox directly by container name (more reliable than
      // host.docker.internal DNS on all platforms).
      const useSandboxNetwork = this.sandboxActive;
      const dockerNetworkArgs = useSandboxNetwork
        ? `--network ${PAKALON_SANDBOX_NETWORK}`
        : '--add-host host.docker.internal:host-gateway';

      // Resolve the target URL that DAST tools will scan.
      // On the shared network, the sandbox container is reachable as 'pakalon-sandbox:{appPort}'.
      let dockerTargetUrl: string;
      let targetHost: string;
      if (useSandboxNetwork) {
        try {
          const parsed = new URL(targetUrl);
          // Replace the hostname/host with the sandbox network alias
          dockerTargetUrl = `http://pakalon-sandbox:${parsed.port || '3000'}${parsed.pathname}${parsed.search}`;
          targetHost = 'pakalon-sandbox';
        } catch {
          dockerTargetUrl = this.toDockerReachableUrl(targetUrl);
          targetHost = process.env.SECURITY_TARGET_HOST || new URL(dockerTargetUrl).hostname;
        }
      } else {
        dockerTargetUrl = this.toDockerReachableUrl(targetUrl);
        targetHost = process.env.SECURITY_TARGET_HOST || new URL(dockerTargetUrl).hostname;
      }

      const scans: ScanCommandOptions[] = [
        {
          scanName: 'zap',
          command: `docker run --rm ${dockerNetworkArgs} -v "${this.state.projectDir}:/src" -v "${this.outputDir}:/output" zaproxy/zap-stable zap.sh -cmd -quickurl "${dockerTargetUrl}" -quickout /output/zap-results.xml`,
          outputFile: path.join(this.outputDir, 'zap-results.xml'),
          parser: (content) => this.parseZapXml(content),
        },
        {
          scanName: 'nikto',
          command: `docker run --rm ${dockerNetworkArgs} -v "${this.state.projectDir}:/src" threatbox/nikto nikto -h "${targetHost}" -Format xml -output /src/.pakalon/nikto-results.xml`,
          outputFile: path.join(this.state.projectDir, '.pakalon', 'nikto-results.xml'),
          parser: (content) => this.parseNiktoXml(content),
        },
        {
          scanName: 'sqlmap',
          command: `docker run --rm ${dockerNetworkArgs} -v "${this.state.projectDir}:/src" projectdiscovery/sqlmap-api sqlmap -u "${dockerTargetUrl}" --batch --output-dir=/src/.pakalon/sqlmap`,
          outputFile: path.join(this.state.projectDir, '.pakalon', 'sqlmap', 'output.json'),
          parser: (content) => this.parseJsonScanResults(content, 'sqlmap'),
        },
        {
          scanName: 'wapiti',
          command: `docker run --rm ${dockerNetworkArgs} -v "${this.state.projectDir}:/src" hackerspacekrk/wapiti wapiti -u "${dockerTargetUrl}" -f json -o /src/.pakalon/wapiti-results.json`,
          outputFile: path.join(this.state.projectDir, '.pakalon', 'wapiti-results.json'),
          parser: (content) => this.parseJsonScanResults(content, 'wapiti'),
        },
      ];

      for (const scan of scans) {
        logger.info(`[Phase4] Running ${scan.scanName}...`);
        const output = await this.runCommand(scan.command);
        await this.safeParseScanOutput(scan.outputFile, output, scan.parser, scan.scanName);
      }

      const browserTargets = this.getBrowserDASTTargets(targetUrl);
      if (browserTargets.length > 0) {
        logger.info(`[Phase4] Running browser-based DAST scan across ${browserTargets.length} target(s)...`);
        const browserAgent = new SecurityBrowserAgent(this.context);
        let browserIssueCount = 0;

        for (const endpoint of browserTargets) {
          const browserFindings = await browserAgent.scanForVulnerabilities(endpoint);
          browserIssueCount += browserFindings.length;

          for (const finding of browserFindings) {
            this.state.securityIssues.push({
              tool: `browser-${finding.type}`,
              severity: finding.severity as SecurityFinding['severity'],
              file: finding.url,
              message: finding.description,
              rule: finding.remediation,
            });
          }
        }

        this.state.scanResults.set('browser-dast', { issues: browserIssueCount });
      }

      const issues = this.state.securityIssues.filter((issue) => ['zap', 'nikto', 'sqlmap', 'wapiti', 'xsstrike', 'browser-xss', 'browser-sql', 'browser-csrf', 'browser-idor', 'browser-auth', 'browser-ssl', 'browser-headers', 'browser-other'].includes(issue.tool)).length;
      this.state.scanResults.set('dast', { issues });

      const headersReport = await this.parseSecurityHeadersReport();
      if (headersReport) {
        this.integrateSecurityHeadersFindings(headersReport);
      }

      // TODO: run Playwright smoke tests as part of Phase 4 browser-based validation.
      await this.runPlaywrightSmokeTests(targetUrl);
    } catch (error) {
      logger.warn(`[Phase4] DAST scan failed: ${error}`);
      this.state.scanResults.set('dast', { issues: 0, error: String(error) });
    }
  }

  public setIteration(iteration: number): void {
    this.iteration = iteration;
  }

  public async getStructuredFindings(): Promise<SecurityFinding[]> {
    this.resetState();
    await this.execute();
    return [...this.state.securityIssues];
  }

  public async applyPatches(findings: SecurityFinding[]): Promise<SecurityPatchResult> {
    const patchesApplied: string[] = [];
    const codeChanges = new Map<string, string>();
    const grouped = new Map<string, SecurityFinding[]>();

    for (const finding of findings) {
      const list = grouped.get(finding.file) ?? [];
      list.push(finding);
      grouped.set(finding.file, list);
    }

    for (const [file, fileFindings] of grouped.entries()) {
      const absolute = path.isAbsolute(file) ? file : path.join(this.state.projectDir, file);
      const current = await fs.readFile(absolute).then((buf) => buf.toString('utf8')).catch(() => null);
      if (!current) continue;

      let updated = current;
      const patches: string[] = [];

      for (const finding of fileFindings) {
        const patch = this.applyKnownPatch(updated, finding);
        if (!patch.applied) continue;
        updated = patch.content;
        if (patch.description) patches.push(patch.description);
      }

      if (updated !== current) {
        await fs.writeFile(absolute, updated, 'utf8');
        codeChanges.set(file, updated);
        patchesApplied.push(...patches);
      }
    }

    const depPatches = await this.patchDependencies(codeChanges);
    patchesApplied.push(...depPatches);

    return { patchesApplied, codeChanges };
  }

  private resetState(): void {
    this.state = {
      userPrompt: this.context.userPrompt ?? '',
      projectDir: this.context.projectDir ?? process.cwd(),
      securityIssues: [] as SecurityFinding[],
      scanResults: new Map(),
      targetUrl: this.context.targetUrl,
    };
  }

  private applyKnownPatch(content: string, finding: SecurityFinding): { content: string; applied: boolean; description?: string } {
    const severity = finding.severity;
    const line = finding.line ? content.split(/\r?\n/)[finding.line - 1] ?? '' : '';

    if (severity === 'CRITICAL' && /secret|token|password|key/i.test(finding.message)) {
      const match = line.match(/^(\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]{8,})\3\s*;?\s*$/);
      if (match) {
        const [, indent, identifier] = match;
        if (!indent || !identifier) {
          return { content, applied: false };
        }
        const envKey = identifier.replace(/[^a-zA-Z0-9]+/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/__+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
        const next = content.split(/\r?\n/);
        next[(finding.line ?? 1) - 1] = `${indent}const ${identifier} = process.env.${envKey} ?? \"\";`;
        return { content: next.join('\n'), applied: true, description: `${finding.file}: moved ${identifier} to env ${envKey}` };
      }
    }

    if (/eval/i.test(finding.message) || /eval/i.test(finding.rule || '')) {
      const next = content.split(/\r?\n/);
      if (line.includes('eval(')) {
        next[(finding.line ?? 1) - 1] = line.replace(/eval\s*\((.*)\)/, 'JSON.parse($1)');
        return { content: next.join('\n'), applied: true, description: `${finding.file}: replaced eval with JSON.parse` };
      }
    }

    if (/xss|innerhtml/i.test(finding.message) || /innerHTML/.test(line)) {
      if (line.includes('.innerHTML')) {
        const next = content.split(/\r?\n/);
        next[(finding.line ?? 1) - 1] = line.replace(/\.innerHTML\s*=/, '.textContent =');
        return { content: next.join('\n'), applied: true, description: `${finding.file}: replaced innerHTML with textContent` };
      }
    }

    if (/sql|injection/i.test(finding.message) || /sql/i.test(finding.rule || '')) {
      if (/\$\{[^}]+\}/.test(line)) {
        const next = content.split(/\r?\n/);
        next[(finding.line ?? 1) - 1] = line.replace(/`([^`]*)\$\{([^}]+)\}([^`]*)`/, '"$1?$3"');
        return { content: next.join('\n'), applied: true, description: `${finding.file}: parameterized SQL interpolation` };
      }
    }

    return { content, applied: false };
  }

  private async patchDependencies(codeChanges: Map<string, string>): Promise<string[]> {
    const packageJsonPath = path.join(this.state.projectDir, 'package.json');
    const lockPath = path.join(this.state.projectDir, 'package-lock.json');
    const raw = await fs.readFile(packageJsonPath, 'utf8').catch(() => '');
    if (!raw) return [];

    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try { parsed = JSON.parse(raw); } catch { return []; }
    const lockRaw = await fs.readFile(lockPath, 'utf8').catch(() => '');
    let lock: any = null;
    if (lockRaw) {
      try { lock = JSON.parse(lockRaw); } catch { lock = null; }
    }

    const next = JSON.parse(JSON.stringify(parsed)) as typeof parsed;
    const patches: string[] = [];
    const resolveVersion = (name: string) => {
      const pkg = lock?.packages?.[`node_modules/${name}`]?.version;
      return pkg || lock?.dependencies?.[name]?.version || undefined;
    };

    for (const deps of [next.dependencies, next.devDependencies]) {
      if (!deps) continue;
      for (const [name, version] of Object.entries(deps)) {
        if (version !== '*' && version.toLowerCase() !== 'latest') continue;
        const resolved = resolveVersion(name);
        if (!resolved) continue;
        deps[name] = resolved;
        patches.push(`package.json: pinned ${name} from ${version} to ${resolved}`);
      }
    }

    if (patches.length) {
      const serialized = `${JSON.stringify(next, null, 2)}\n`;
      await fs.writeFile(packageJsonPath, serialized, 'utf8');
      codeChanges.set(packageJsonPath, serialized);
    }

    return patches;
  }

  private async runSonarQubeScan(): Promise<void> {
    try {
      logger.info('[Phase4] Running SonarQube scan...');
      const output = await this.runCommand(
        `docker run --rm -v "${this.state.projectDir}:/src" sonarqube:community sonar-scanner -Dsonar.projectBaseDir=/src -Dsonar.sources=. -Dsonar.host.url=http://host.docker.internal:9000 -Dsonar.login=dummy`
      );
      await this.safeParseScanOutput(path.join(this.outputDir, 'sonarqube-results.json'), output, (content) => this.parseJsonScanResults(content, 'sonarqube'), 'sonarqube');
      this.state.scanResults.set('sonarqube', { issues: this.state.securityIssues.filter((i) => i.tool === 'sonarqube').length });
    } catch (error) {
      logger.warn(`[Phase4] SonarQube scan failed: ${error}`);
      this.state.scanResults.set('sonarqube', { issues: 0, error: String(error) });
    }
  }

  private async runESLintSecurityScan(): Promise<void> {
    try {
      logger.info('[Phase4] Running ESLint security scan...');
      const output = await this.runCommand(
        `docker run --rm -v "${this.state.projectDir}:/src" -w /src node:20 sh -lc "npm exec --yes eslint . --ext .js,.jsx,.ts,.tsx --plugin security --rule 'security/detect-object-injection:error' --format json --output-file /src/.pakalon/eslint-security-results.json"`
      );
      await this.safeParseScanOutput(path.join(this.state.projectDir, '.pakalon', 'eslint-security-results.json'), output, (content) => this.parseEslintJson(content), 'eslint-security');
      this.state.scanResults.set('eslint-security', { issues: this.state.securityIssues.filter((i) => i.tool === 'eslint-security').length });
    } catch (error) {
      logger.warn(`[Phase4] ESLint security scan failed: ${error}`);
      this.state.scanResults.set('eslint-security', { issues: 0, error: String(error) });
    }
  }
  
  private async runCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [], { shell: true, cwd: this.state.projectDir });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        resolve(stdout || stderr);
      });
      
      child.on('error', (error) => {
        resolve('');
      });
    });
  }

  private async safeParseScanOutput(outputFile: string, stdout: string, parser: ScanParser, scanName: string): Promise<void> {
    try {
      const content = await fs.readFile(outputFile, 'utf8').catch(() => stdout);
      if (!content.trim()) {
        return;
      }
      parser(content);
    } catch (error) {
      logger.warn(`[Phase4] Failed to parse ${scanName} output: ${error}`);
    }
  }

  private parseJsonScanResults(content: string, tool: string): void {
    try {
      const data = JSON.parse(content);
      const entries = Array.isArray(data) ? data : Array.isArray(data?.issues) ? data.issues : Array.isArray(data?.vulnerabilities) ? data.vulnerabilities : [];

      for (const entry of entries) {
        const severity = String(entry.severity || entry.Severity || entry.level || entry.risk || 'medium').toUpperCase();
        this.state.securityIssues.push({
          tool,
          severity: this.normalizeSeverity(severity),
          file: entry.file || entry.path || entry.url || 'unknown',
          line: entry.line || entry.lineNumber,
          message: entry.message || entry.description || entry.name || `${tool} issue detected`,
          rule: entry.rule || entry.id || entry.type,
        });
      }
    } catch (error) {
      logger.warn(`[Phase4] Failed to parse JSON output for ${tool}: ${error}`);
    }
  }

  private parseEslintJson(content: string): void {
    try {
      const data = JSON.parse(content);
      for (const file of Array.isArray(data) ? data : []) {
        for (const message of file.messages || []) {
          this.state.securityIssues.push({
            tool: 'eslint-security',
            severity: this.normalizeSeverity(message.severity >= 2 ? 'HIGH' : 'MEDIUM'),
            file: file.filePath || 'unknown',
            line: message.line,
            message: message.message || 'ESLint security issue detected',
            rule: message.ruleId || 'eslint-security',
          });
        }
      }
    } catch (error) {
      logger.warn(`[Phase4] Failed to parse ESLint JSON output: ${error}`);
    }
  }

  private parseZapXml(content: string): void {
    this.parseFindingXml(content, 'zap', /<alertitem>[\s\S]*?<riskdesc>(.*?)<\/riskdesc>[\s\S]*?<desc>(.*?)<\/desc>[\s\S]*?<uri>(.*?)<\/uri>[\s\S]*?<param>(.*?)<\/param>[\s\S]*?<pluginid>(.*?)<\/pluginid>/gi);
  }

  private parseNiktoXml(content: string): void {
    this.parseFindingXml(content, 'nikto', /<item>[\s\S]*?<osvdbid>(.*?)<\/osvdbid>[\s\S]*?<description>(.*?)<\/description>[\s\S]*?<uri>(.*?)<\/uri>[\s\S]*?<severity>(.*?)<\/severity>/gi);
  }

  private async resolveTargetUrl(): Promise<string | null> {
    const candidates = [
      this.context.targetUrl,
      this.state.targetUrl,
      process.env.SECURITY_TARGET_URL,
      process.env.PAKALON_TEST_URL,
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      try {
        const discovered = await this.discoverEndpoints(candidate);
        if (discovered.length > 0) {
          this.state.discoveredEndpoints = discovered;
        } else {
          this.state.discoveredEndpoints = [candidate];
        }
        return candidate;
      } catch {
        continue;
      }
    }

    return null;
  }

  private toDockerReachableUrl(targetUrl: string): string {
    try {
      const parsed = new URL(targetUrl);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
        parsed.hostname = 'host.docker.internal';
      }
      return parsed.toString();
    } catch {
      return targetUrl;
    }
  }

  private async discoverEndpoints(targetUrl: string): Promise<string[]> {
    const discovered = new Set<string>();
    const specUrls = [
      new URL('/openapi.json', targetUrl).toString(),
      new URL('/swagger.json', targetUrl).toString(),
      new URL('/api-docs', targetUrl).toString(),
    ];

    for (const specUrl of specUrls) {
      const spec = await this.fetchSpec(specUrl);
      if (!spec) continue;
      for (const endpoint of this.extractEndpointsFromSpec(spec)) discovered.add(endpoint);
    }

    if (discovered.size === 0) {
      const crawled = await this.crawlEndpoints(targetUrl);
      for (const endpoint of crawled) discovered.add(endpoint);
    }

    return [...discovered];
  }

  private async fetchSpec(specUrl: string): Promise<unknown | null> {
    try {
      const response = await fetch(specUrl, { headers: { accept: 'application/json, application/yaml, text/yaml, text/plain' } });
      if (!response.ok) return null;
      const text = await response.text();
      if (!text.trim()) return null;
      try { return JSON.parse(text); } catch {
        try {
          const yaml = await import('js-yaml');
          return yaml.load(text);
        } catch {
          return null;
        }
      }
    } catch {
      return null;
    }
  }

  private extractEndpointsFromSpec(spec: unknown): string[] {
    if (!spec || typeof spec !== 'object') return [];
    const openapi = spec as { paths?: Record<string, Record<string, unknown>>; servers?: Array<{ url?: string }> };
    const base = openapi.servers?.[0]?.url ?? '';
    const endpoints: string[] = [];

    for (const [route, methods] of Object.entries(openapi.paths ?? {})) {
      for (const method of Object.keys(methods)) {
        endpoints.push(`${method.toUpperCase()} ${base}${route}`);
      }
    }

    return endpoints;
  }

  private async crawlEndpoints(targetUrl: string): Promise<string[]> {
    const endpoints = new Set<string>();
    try {
      const response = await fetch(targetUrl);
      const html = await response.text();
      const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => match[1]!).filter(Boolean);
      for (const href of hrefs.slice(0, 100)) {
        try {
          endpoints.add(new URL(href, targetUrl).toString());
        } catch {
          continue;
        }
      }
    } catch {
      // best effort only
    }
    return [...endpoints];
  }

  private getBrowserDASTTargets(targetUrl: string): string[] {
    const seeds = [targetUrl, ...(this.state.discoveredEndpoints ?? [])];
    const targets = new Set<string>();

    for (const seed of seeds) {
      const normalized = seed.trim();
      if (!normalized) continue;
      const urlPart = normalized.includes(' ') ? normalized.split(/\s+/).slice(-1)[0] ?? normalized : normalized;
      try {
        targets.add(new URL(urlPart, targetUrl).toString());
      } catch {
        continue;
      }
    }

    return [...targets];
  }

  private async parseSecurityHeadersReport(): Promise<SecurityHeadersReport | null> {
    const reportPath = path.join(this.state.projectDir, '.pakalon', 'security-headers-results.json');
    try {
      const raw = await fs.readFile(reportPath, 'utf8');
      return JSON.parse(raw) as SecurityHeadersReport;
    } catch {
      return null;
    }
  }

  private integrateSecurityHeadersFindings(report: SecurityHeadersReport): void {
    const missingHeaders = report.missing_headers ?? [];
    const grade = this.calculateSecurityHeaderGrade(missingHeaders.length, report.warnings ?? []);

    for (const header of missingHeaders) {
      this.state.securityIssues.push({
        tool: 'security-headers',
        severity: header === 'content-security-policy' || header === 'strict-transport-security' ? 'HIGH' : 'MEDIUM',
        file: report.final_url ?? report.target_url ?? 'unknown',
        message: `Missing security header: ${header}`,
        rule: 'security-header',
      });
    }

    this.state.scanResults.set('security-headers', { issues: missingHeaders.length });
    this.state.scanResults.set('security-headers-grade', { issues: grade === 'A+' ? 0 : 1 });
  }

  private calculateSecurityHeaderGrade(missingCount: number, warnings: string[]): string {
    const penalty = missingCount * 15 + warnings.length * 5;
    const score = Math.max(0, 100 - penalty);
    if (score >= 98) return 'A+';
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  private parseFindingXml(content: string, tool: string, pattern: RegExp): void {
    for (const match of content.matchAll(pattern)) {
      const [, severityRaw, messageRaw, fileRaw, lineRaw, ruleRaw] = match;
      this.state.securityIssues.push({
        tool,
        severity: this.normalizeSeverity(String(severityRaw || 'medium')),
        file: String(fileRaw || 'unknown'),
        line: lineRaw ? Number(lineRaw) : undefined,
        message: String(messageRaw || `${tool} issue detected`),
        rule: String(ruleRaw || tool),
      });
    }
  }

  private normalizeSeverity(severity: string): SecurityFinding['severity'] {
    const value = severity.toUpperCase();
    if (value.includes('CRIT')) return 'CRITICAL';
    if (value.includes('HIGH') || value.includes('ERROR')) return 'HIGH';
    if (value.includes('MED') || value.includes('WARN')) return 'MEDIUM';
    return 'LOW';
  }
  
  private mapSemgrepSeverity(severity?: string): SecurityFinding['severity'] {
    const severityMap: Record<string, SecurityFinding['severity']> = {
      'ERROR': 'HIGH',
      'WARNING': 'MEDIUM',
      'INFO': 'LOW',
    };
    return severityMap[severity?.toUpperCase() || ''] || 'MEDIUM';
  }
  
  private async generateTestingXmlFiles(): Promise<void> {
    try {
      const targetUrl = await this.resolveTargetUrl();
      const sourceFiles = await this.collectWhiteboxSourceFiles();
      const blackboxResult = await generateBlackboxXml(targetUrl ?? this.state.projectDir, this.state.projectDir);
      const whiteboxResult = await generateWhiteboxXml(this.state.projectDir, sourceFiles);

      this.generatedXmlFiles = [blackboxResult.filePath, whiteboxResult.filePath];
      logger.info('[Phase4] Testing XML files generated:');
      logger.info(`[Phase4]   - ${blackboxResult.filePath}`);
      logger.info(`[Phase4]   - ${whiteboxResult.filePath}`);
    } catch (error) {
      logger.warn(`[Phase4] XML generation failed: ${error}`);
      this.generatedXmlFiles = [];
    }
  }

  private async generateFindingsJson(): Promise<void> {
    const criticalIssues = this.state.securityIssues.filter(i => i.severity === 'CRITICAL').length;
    const highIssues = this.state.securityIssues.filter(i => i.severity === 'HIGH').length;
    const mediumIssues = this.state.securityIssues.filter(i => i.severity === 'MEDIUM').length;
    const lowIssues = this.state.securityIssues.filter(i => i.severity === 'LOW').length;

    const findingsDocument = {
      generatedAt: new Date().toISOString(),
      targetUrl: this.state.targetUrl ?? process.env.SECURITY_TARGET_URL,
      totalIssues: this.state.securityIssues.length,
      criticalIssues,
      highIssues,
      mediumIssues,
      lowIssues,
      scanResults: Object.fromEntries(this.state.scanResults),
      findings: this.state.securityIssues,
    };

    await fs.writeFile(
      path.join(this.outputDir, 'findings.json'),
      JSON.stringify(findingsDocument, null, 2),
      'utf8',
    );
    logger.info('[Phase4] findings.json generated');
  }
  
  private async generateSecurityReport(): Promise<void> {
    // TODO: persist the structured report artifacts alongside the legacy markdown summary.
    await this.generateStructuredSecurityReport();

    const doc = `# Phase 4: Security Scanning Report

## Scan Results
${Array.from(this.state.scanResults.entries())
  .map(([scan, result]) => `- ${scan}: ${result.issues} issues found`)
  .join('\n')}

## Total Issues: ${this.state.securityIssues.length}

## Recommendations
1. Fix all critical issues before deployment
2. Address high-severity issues
3. Review medium-severity issues
4. Keep dependencies up to date

## Next Steps
- Phase 5: Deployment
`;
    
    await fs.writeFile(path.join(this.outputDir, 'security-report.md'), doc);
    logger.info('[Phase4] Security report generated');
  }

  private async generateStructuredSecurityReport(): Promise<void> {
    const findings: ReportSecurityFinding[] = this.state.securityIssues.map((finding, index) => ({
      id: `${finding.tool}-${index + 1}`,
      title: finding.message,
      description: finding.message,
      severity: (finding.severity || 'medium').toLowerCase() as ReportSecurityFinding['severity'],
      category: this.mapReportCategory(finding.tool),
      file: finding.file,
      line: finding.line,
      recommendation: finding.rule,
      firstSeen: new Date().toISOString(),
      status: 'open',
    }));

    await generateSecurityReportArtifacts(findings, undefined, {
      outputDir: path.join(this.outputDir, 'reports'),
      title: 'Phase 4 Security Scanning Report',
    });
  }

  private mapReportCategory(tool: string): ReportSecurityFinding['category'] {
    if (tool.includes('gitleaks') || tool.includes('secret')) return 'secrets';
    if (tool.includes('npm') || tool.includes('dependency')) return 'dependency';
    if (tool.includes('zap') || tool.includes('nikto') || tool.includes('sqlmap') || tool.includes('wapiti') || tool.includes('browser')) return 'dast';
    if (tool.includes('sonar') || tool.includes('eslint') || tool.includes('semgrep') || tool.includes('deepsec')) return 'sast';
    return 'code-review';
  }

  private async runPlaywrightSmokeTests(targetUrl: string): Promise<void> {
    try {
      const report = await runPlaywrightTests({
        targetUrl,
        browserType: 'chromium',
        headless: true,
        recordNetwork: true,
        outputDir: path.join(this.outputDir, 'playwright-tests'),
        scenarios: [
          {
            name: 'phase4-smoke',
            steps: [
              { type: 'navigate', url: targetUrl },
              { type: 'wait-for-selector', selector: 'body', state: 'visible' },
              { type: 'screenshot', name: 'home' },
            ],
          },
        ],
      });

      this.state.scanResults.set('playwright-tests', { issues: report.failed });
      logger.info(`[Phase4] Playwright smoke tests complete: ${report.passed}/${report.total} passed`);
    } catch (error) {
      logger.warn(`[Phase4] Playwright smoke tests failed: ${error}`);
      this.state.scanResults.set('playwright-tests', { issues: 0, error: String(error) });
    }
  }

  private async collectWhiteboxSourceFiles(): Promise<string[]> {
    const roots = [path.join(this.state.projectDir, 'src')];
    const files: string[] = [];
    const include = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml']);

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.pakalon')) continue;
          await walk(fullPath);
          continue;
        }
        if (include.has(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath);
        }
      }
    };

    for (const root of roots) {
      await walk(root);
    }

    const extras = [
      path.join(this.state.projectDir, 'package.json'),
      path.join(this.state.projectDir, 'tsconfig.json'),
      path.join(this.state.projectDir, 'tsconfig.runtime.json'),
    ];

    for (const file of extras) {
      if (await fs.stat(file).then(() => true).catch(() => false)) {
        files.push(file);
      }
    }

    return [...new Set(files)];
  }
}
