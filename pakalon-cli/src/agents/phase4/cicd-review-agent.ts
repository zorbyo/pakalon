/**
 * Phase 4 Subagent-4: CI/CD Pipeline Review Agent
 * Reviews CI/CD configuration files for security weaknesses and best practices.
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult } from '../types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '@/utils/logger.js';

export interface CICDReviewConfig {
  outputDir: string;
  projectDir: string;
  phaseContext?: string;
}

export interface CICDReviewFinding {
  file: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: 'secrets' | 'permissions' | 'dependencies' | 'caching' | 'testing' | 'deployment' | 'compliance';
  title: string;
  description: string;
  recommendation: string;
}

const CICD_REVIEW_SYSTEM_PROMPT = `You are the Phase 4 CI/CD Pipeline Review Agent for Pakalon.

Your responsibilities:
1. Review GitHub Actions workflows for security best practices
2. Check for hardcoded secrets in pipeline configurations
3. Verify proper permission scoping
4. Check dependency caching strategies
5. Review deployment scripts for safety
6. Verify test coverage requirements
7. Check for proper artifact handling`;

export class CICDReviewAgent extends BaseAgent {
  private findings: CICDReviewFinding[] = [];
  private outputDir: string;
  private projectDir: string;
  private phaseContext: string;

  constructor(context: AgentContext, config: CICDReviewConfig) {
    const agentConfig: AgentConfig = {
      name: 'phase4-cicd-review',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt: CICD_REVIEW_SYSTEM_PROMPT,
      tools: [],
      maxTokens: 8192,
      temperature: 0.3,
    };

    super(agentConfig, context);

    this.outputDir = config.outputDir;
    this.projectDir = config.projectDir;
    this.phaseContext = config.phaseContext ?? '';
  }

  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      logger.info('[Phase4-CICDReview] Starting CI/CD pipeline review...');
      await fs.mkdir(this.outputDir, { recursive: true });

      // Step 1: Discover CI/CD configuration files
      const configFiles = await this.discoverConfigFiles();
      logger.info(`[Phase4-CICDReview] Found ${configFiles.length} CI/CD configuration files`);

      // Step 2: Review each configuration file
      for (const file of configFiles) {
        await this.reviewCICDConfig(file);
      }

      // Step 3: Check Docker configurations
      await this.checkDockerConfigs();

      // Step 4: Generate report
      await this.generateReport();

      const duration = Date.now() - startTime;
      logger.info(`[Phase4-CICDReview] Completed in ${(duration / 1000).toFixed(1)}s — ${this.findings.length} findings`);

      return {
        success: true,
        message: `CI/CD review completed. Found ${this.findings.length} issues.`,
        filesCreated: [path.join(this.outputDir, 'cicd-review-report.md')],
        data: {
          findings: this.findings,
          findingCount: this.findings.length,
        },
        duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Phase4-CICDReview] Failed: ${message}`);
      return {
        success: false,
        message: `CI/CD review failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  private async discoverConfigFiles(): Promise<string[]> {
    const files: string[] = [];
    const patterns = [
      path.join(this.projectDir, '.github', 'workflows', '*.yml'),
      path.join(this.projectDir, '.github', 'workflows', '*.yaml'),
      path.join(this.projectDir, '.gitlab-ci.yml'),
      path.join(this.projectDir, 'Jenkinsfile'),
      path.join(this.projectDir, '.circleci', 'config.yml'),
      path.join(this.projectDir, 'azure-pipelines.yml'),
      path.join(this.projectDir, 'bitbucket-pipelines.yml'),
    ];

    for (const pattern of patterns) {
      try {
        // Use glob-style pattern matching
        const dir = path.dirname(pattern);
        const globPattern = path.basename(pattern);
        const entries = await fs.readdir(dir).catch(() => [] as string[]);
        for (const entry of entries) {
          if (entry === globPattern || entry.endsWith('.yml') || entry.endsWith('.yaml')) {
            const fullPath = path.join(dir, entry);
            if (!files.includes(fullPath)) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Directory doesn't exist — skip
      }
    }

    return files;
  }

  private async reviewCICDConfig(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const relativePath = path.relative(this.projectDir, filePath);

      // Check for hardcoded secrets
      const secretVars = content.match(/\$\{\{?\s*secrets\.\w+\s*\}?\}/g);
      if (!secretVars) {
        this.findings.push({
          file: relativePath,
          severity: 'HIGH',
          category: 'secrets',
          title: 'No GitHub Secrets references found',
          description: 'CI/CD pipeline does not use GitHub Secrets for sensitive values',
          recommendation: 'Use \${{ secrets.MY_SECRET }} syntax for all sensitive values',
        });
      }

      // Check for hardcoded credentials in YAML values
      const credPatterns = [
        /password:\s*['"][^'"]+['"]/gi,
        /api_key:\s*['"][^'"]+['"]/gi,
        /token:\s*['"][^'"]+['"]/gi,
        /secret:\s*['"][^'"]+['"]/gi,
      ];

      for (const pattern of credPatterns) {
        const match = content.match(pattern);
        if (match) {
          this.findings.push({
            file: relativePath,
            severity: 'CRITICAL',
            category: 'secrets',
            title: 'Hardcoded credential in CI/CD config',
            description: `Found potential hardcoded credential: ${match[0].substring(0, 50)}...`,
            recommendation: 'Move to GitHub Secrets and reference via \${{ secrets.NAME }}',
          });
          break;
        }
      }

      // Check for write-all permissions
      if (content.includes('permissions: write-all') || content.includes('permissions: write')) {
        this.findings.push({
          file: relativePath,
          severity: 'MEDIUM',
          category: 'permissions',
          title: 'Overly permissive workflow permissions',
          description: 'Workflow uses write-all or broadly scoped permissions',
          recommendation: 'Restrict to least-privilege: permissions: contents: read, issues: write, etc.',
        });
      }

      // Check for missing workflow_dispatch trigger
      if (content.includes('on:') && !content.includes('workflow_dispatch')) {
        this.findings.push({
          file: relativePath,
          severity: 'LOW',
          category: 'deployment',
          title: 'Missing manual trigger',
          description: 'Workflow lacks workflow_dispatch trigger for manual runs',
          recommendation: 'Add workflow_dispatch to on: trigger list for manual invocation',
        });
      }

      // Check for self-hosted runner usage
      if (content.includes('self-hosted') || content.includes('self_hosted')) {
        this.findings.push({
          file: relativePath,
          severity: 'MEDIUM',
          category: 'compliance',
          title: 'Self-hosted runner detected',
          description: 'Pipeline uses self-hosted runners which require additional security hardening',
          recommendation: 'Ensure self-hosted runners are properly isolated and have recent security patches',
        });
      }

      // Check for npm/npx usage without audit
      if (content.includes('npm install') || content.includes('npm ci')) {
        if (!content.includes('npm audit') && !content.includes('npm_config_audit')) {
          this.findings.push({
            file: relativePath,
            severity: 'MEDIUM',
            category: 'dependencies',
            title: 'Missing npm audit step',
            description: 'Pipeline installs npm dependencies but does not run npm audit',
            recommendation: 'Add: run: npm audit --audit-level=moderate after npm ci',
          });
        }
      }

      // Check for pinning action versions
      const actionUses = content.match(/uses:\s+\S+@\S+/g) || [];
      const unpinnedActions = actionUses.filter(u => /@main|@master|@latest/.test(u));
      if (unpinnedActions.length > 0) {
        this.findings.push({
          file: relativePath,
          severity: 'HIGH',
          category: 'dependencies',
          title: 'Unpinned GitHub Action versions',
          description: `Found ${unpinnedActions.length} action(s) using floating tags (@main/@master/@latest)`,
          recommendation: 'Pin actions to specific commit SHAs or semantic version tags (e.g., @v4 instead of @main)',
        });
      }

      // Check for missing cache steps
      if (content.includes('npm ci') || content.includes('npm install')) {
        if (!content.includes('cache:') && !content.includes('cache-key')) {
          this.findings.push({
            file: relativePath,
            severity: 'LOW',
            category: 'caching',
            title: 'Missing dependency caching',
            description: 'npm install/ci without caching will be slower on each run',
            recommendation: 'Add: cache: npm or use actions/cache for node_modules',
          });
        }
      }

    } catch (error) {
      logger.warn(`[Phase4-CICDReview] Could not read ${filePath}: ${error}`);
    }
  }

  private async checkDockerConfigs(): Promise<void> {
    const dockerFiles = [
      path.join(this.projectDir, 'Dockerfile'),
      path.join(this.projectDir, 'docker-compose.yml'),
      path.join(this.projectDir, 'docker-compose.yaml'),
    ];

    for (const df of dockerFiles) {
      try {
        const content = await fs.readFile(df, 'utf-8');
        const relativePath = path.relative(this.projectDir, df);

        // Check for root user in Dockerfile
        if (df.endsWith('Dockerfile') && !content.includes('USER ') && !content.includes('useradd')) {
          this.findings.push({
            file: relativePath,
            severity: 'MEDIUM',
            category: 'compliance',
            title: 'Container running as root',
            description: 'Dockerfile does not switch to a non-root user',
            recommendation: 'Add a USER directive: RUN adduser -D appuser && USER appuser',
          });
        }

        // Check for latest tag
        const latestMatches = content.match(/:\blatest\b/g);
        if (latestMatches) {
          this.findings.push({
            file: relativePath,
            severity: 'LOW',
            category: 'deployment',
            title: 'Use of :latest tag',
            description: `Found ${latestMatches.length} reference(s) to :latest image tag`,
            recommendation: 'Pin to specific version tags for reproducible builds',
          });
        }
      } catch {
        // File doesn't exist — skip
      }
    }
  }

  private async generateReport(): Promise<void> {
    const severityCount = {
      CRITICAL: this.findings.filter(f => f.severity === 'CRITICAL').length,
      HIGH: this.findings.filter(f => f.severity === 'HIGH').length,
      MEDIUM: this.findings.filter(f => f.severity === 'MEDIUM').length,
      LOW: this.findings.filter(f => f.severity === 'LOW').length,
      INFO: this.findings.filter(f => f.severity === 'INFO').length,
    };

    const report = `# CI/CD Pipeline Review Report

## Summary

| Metric | Count |
|--------|-------|
| Total Findings | ${this.findings.length} |
| Critical | ${severityCount.CRITICAL} |
| High | ${severityCount.HIGH} |
| Medium | ${severityCount.MEDIUM} |
| Low | ${severityCount.LOW} |
| Info | ${severityCount.INFO} |

## Findings

${this.findings.map(f => `
### [${f.severity}] ${f.title}
- **File**: ${f.file}
- **Category**: ${f.category}
- **Description**: ${f.description}
- **Recommendation**: ${f.recommendation}
`).join('\n')}

## CI/CD Best Practices Checklist

- [ ] Secrets managed via \${{ secrets.NAME }}
- [ ] Action versions pinned to SHAs or tags
- [ ] Least-privilege permissions configured
- [ ] Dependency caching enabled
- [ ] Manual trigger available (workflow_dispatch)
- [ ] Code scanning/SAST in pipeline
- [ ] Docker running as non-root user

---

*Report generated by Pakalon Phase 4 CI/CD Review Agent*
`;

    await fs.writeFile(path.join(this.outputDir, 'cicd-review-report.md'), report, 'utf-8');
    logger.info('[Phase4-CICDReview] [OK] CI/CD review report generated');
  }
}
