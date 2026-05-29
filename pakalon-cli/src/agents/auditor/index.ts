import * as fs from 'fs/promises';
import * as path from 'path';

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult } from '../types.js';
import { collectProjectTree } from '../../pipeline/session.js';
import {
  calculateComplianceScore,
  collectAuditorArtifacts,
  runRequirementChecks,
  summarizeFindings,
  type Finding,
} from './checks.js';
import logger from '@/utils/logger.js';

export interface AuditorConfig {
  projectDir: string;
  maxIterations: number;
  readOnly: boolean;
  autoRemediate: boolean; // NEW: Enable auto-remediation loop
  onProgress?: (iteration: number, findings: Finding[], remediated?: string[]) => void;
  onComplete?: (result: AuditorResult) => void;
}

export interface RemediationAction {
  finding: Finding;
  action: string;
  status: 'pending' | 'applied' | 'failed';
  error?: string;
}

export interface AuditorResult {
  success: boolean;
  iterations: number;
  complianceScore: number;
  findings: Finding[];
  filesReviewed: string[];
  recommendations: string[];
}

export { type Finding } from './checks.js';

class AuditorBaseAgent extends BaseAgent {
  constructor(context: AgentContext) {
    const config: AgentConfig = {
      name: 'auditor',
      model: context.apiKey ? 'anthropic/claude-3-5-haiku' : 'anthropic/claude-3-5-haiku',
      systemPrompt: 'You are a read-only autonomous auditor. Never modify files. Return concise compliance observations.',
      tools: [],
      maxTokens: 4096,
      temperature: 0.1,
    };

    super(config, context);
  }
}

async function writeReport(projectDir: string, result: AuditorResult, remediated: string[] = []): Promise<string> {
  const reportDir = path.join(projectDir, '.pakalon-agents', 'ai-agents', 'phase-3');
  await fs.mkdir(reportDir, { recursive: true });

  const report = [
    '# Auditor Report',
    '',
    `- Success: ${result.success ? 'yes' : 'no'}`,
    `- Iterations: ${result.iterations}`,
    `- Compliance score: ${result.complianceScore}%`,
    `- Files reviewed: ${result.filesReviewed.length}`,
    `- Issues remediated: ${remediated.length}`,
    '',
    remediated.length > 0 ? '## Remediated Issues' : '',
    remediated.length > 0 ? remediated.map((item) => `- ${item}`).join('\n') : '',
    '',
    '## Remaining Findings',
    result.findings.length ? summarizeFindings(result.findings) : '- None',
    '',
    '## Recommendations',
    result.recommendations.length ? result.recommendations.map((item) => `- ${item}`).join('\n') : '- None',
    '',
    '---',
    `*Report generated at ${new Date().toISOString()}*`,
  ].join('\n');

  const reportPath = path.join(reportDir, 'auditor-report.md');
  await fs.writeFile(reportPath, report, 'utf8');
  return reportPath;
}

export class AuditorAgent extends AuditorBaseAgent {
  private readonly auditorConfig: AuditorConfig;
  private remediationHistory: RemediationAction[] = [];

  constructor(context: AgentContext, config: Partial<AuditorConfig> = {}) {
    super(context);
    this.auditorConfig = {
      projectDir: config.projectDir ?? context.projectDir ?? process.cwd(),
      maxIterations: config.maxIterations ?? 10,
      readOnly: config.readOnly ?? true,
      autoRemediate: config.autoRemediate ?? false, // Default to false for safety
      onProgress: config.onProgress,
      onComplete: config.onComplete,
    };
  }

  /**
   * Generate remediation instructions for a finding
   */
  private generateRemediationPrompt(finding: Finding): string {
    const basePrompt = `Fix the following issue in the codebase:

Issue: ${finding.description}
Category: ${finding.category}
Severity: ${finding.severity}
${finding.file ? `File: ${finding.file}` : ''}
${finding.line ? `Line: ${finding.line}` : ''}
${finding.requirement ? `\nRequirement: ${finding.requirement}` : ''}

Instructions:
1. Analyze the issue and understand what needs to be fixed
2. Make targeted, surgical changes to fix only this issue
3. Do NOT make unrelated changes
4. After fixing, verify the fix is correct

Please fix this issue now.`;

    // Add specific guidance based on category
    switch (finding.category) {
      case 'structure':
        return basePrompt + `\n\nThis is a missing directory or file. Create the necessary structure.`;
      case 'phase-1':
      case 'phase-2':
      case 'phase-3':
        return basePrompt + `\n\nThis is a missing phase artifact. Run the appropriate phase to generate it.`;
      case 'security':
        return basePrompt + `\n\nThis is a security issue. Fix it with security best practices.`;
      default:
        return basePrompt;
    }
  }

  /**
   * Apply remediation for a single finding
   * NOTE: This is a simplified implementation - in production, you'd want to use actual agent execution
   */
  private async applyRemediation(finding: Finding): Promise<boolean> {
    const projectDir = this.auditorConfig.projectDir;
    
    try {
      logger.info(`[Auditor] Attempting to remediate: ${finding.description}`);
      
      // For missing directories, try to create them
      if (finding.category === 'structure' && finding.file) {
        const fullPath = path.join(projectDir, finding.file);
        await fs.mkdir(fullPath, { recursive: true });
        logger.info(`[Auditor] Created directory: ${finding.file}`);
        return true;
      }
      
      // For missing phase files, we can't auto-create meaningful content
      // Log that this needs manual intervention
      logger.info(`[Auditor] Cannot auto-remediate ${finding.category} - requires phase execution`);
      return false;
      
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[Auditor] Failed to remediate: ${errMsg}`);
      this.remediationHistory.push({
        finding,
        action: 'apply',
        status: 'failed',
        error: errMsg,
      });
      return false;
    }
  }

  async execute(): Promise<AgentResult> {
    const start = Date.now();
    const projectDir = path.resolve(this.auditorConfig.projectDir);
    const filesReviewed = collectProjectTree(projectDir, 1500);
    const artifacts = await collectAuditorArtifacts(projectDir);

    let latestFindings = await runRequirementChecks({
      projectDir,
      tree: filesReviewed,
      artifactText: artifacts,
    });

    let iterations = 0;
    const recommendations = new Set<string>();
    const allRemediated: string[] = [];

    // Iterative remediation loop
    while (iterations < this.auditorConfig.maxIterations) {
      iterations += 1;
      logger.info(`[Auditor] Iteration ${iterations}/${this.auditorConfig.maxIterations}`);
      
      // Report current state
      this.auditorConfig.onProgress?.(iterations, latestFindings, allRemediated);

      // Collect recommendations from current findings
      for (const finding of latestFindings) {
        recommendations.add(finding.requirement ?? finding.description);
      }

      // Exit conditions
      if (!latestFindings.length) {
        logger.info('[Auditor] No more findings - exiting loop');
        break;
      }

      // If read-only or auto-remediate is disabled, only do one iteration
      if (this.auditorConfig.readOnly || !this.auditorConfig.autoRemediate) {
        logger.info('[Auditor] Read-only mode - single iteration only');
        break;
      }

      // Auto-remediation: try to fix each finding
      logger.info(`[Auditor] Auto-remediation enabled - attempting to fix ${latestFindings.length} findings`);
      
      const fixedFindings: string[] = [];
      const remainingFindings: Finding[] = [];

      for (const finding of latestFindings) {
        const remediated = await this.applyRemediation(finding);
        
        if (remediated) {
          fixedFindings.push(finding.description);
          allRemediated.push(finding.description);
          this.remediationHistory.push({
            finding,
            action: 'apply',
            status: 'applied',
          });
        } else {
          remainingFindings.push(finding);
        }
      }

      logger.info(`[Auditor] Remediated: ${fixedFindings.length} issues, remaining: ${remainingFindings.length}`);

      // Re-run checks to see if issues are fixed
      if (fixedFindings.length > 0) {
        const newTree = collectProjectTree(projectDir, 1500);
        const newArtifacts = await collectAuditorArtifacts(projectDir);
        latestFindings = await runRequirementChecks({
          projectDir,
          tree: newTree,
          artifactText: newArtifacts,
        });
        
        // Filter to only show remaining (not yet fixed) findings
        latestFindings = latestFindings.filter(f => f.status === 'open');
      }

      // If no progress made in this iteration, exit to avoid infinite loop
      if (fixedFindings.length === 0 && remainingFindings.length > 0) {
        logger.warn('[Auditor] No progress made in this iteration - exiting loop');
        break;
      }
    }

    const complianceScore = calculateComplianceScore(latestFindings);
    
    const result: AuditorResult = {
      success: latestFindings.length === 0,
      iterations,
      complianceScore,
      findings: latestFindings,
      filesReviewed,
      recommendations: [...recommendations],
    };

    const reportPath = await writeReport(projectDir, result, allRemediated);
    logger.info(`[Auditor] Report written to ${reportPath}`);
    this.auditorConfig.onComplete?.(result);

    return {
      success: result.success,
      message: `Auditor completed with ${result.complianceScore}% compliance after ${iterations} iteration(s). ${allRemediated.length} issues remediated.`,
      duration: Date.now() - start,
      data: {
        complianceScore: result.complianceScore,
        iterations: result.iterations,
        findings: result.findings.length,
        remediated: allRemediated.length,
        reportPath,
      },
};
  }
}

export async function runAuditor(projectDir: string, options: Partial<AuditorConfig> = {}): Promise<AuditorResult> {
  // Determine if we should auto-remediate based on permission mode
  // If readOnly is false, use auto-accept mode and enable auto-remediation by default.
  const autoRemediate = options.autoRemediate ?? (options.readOnly === false);
  
  const context: AgentContext = {
    agentId: 'auditor',
    agentName: 'auditor',
    agentType: 'auditor',
    projectDir,
    permissionMode: options.readOnly === false ? 'auto-accept' : 'plan',
    tools: [],
    disallowedTools: options.readOnly !== false ? ['write', 'delete', 'shell'] : [],
    background: false,
    isolation: 'remote',
  };

  const agent = new AuditorAgent(context, { 
    projectDir, 
    ...options,
    autoRemediate,
  });
  const result = await agent.execute();
  const filesReviewed = collectProjectTree(projectDir, 1500);
  const findings = await runRequirementChecks({ projectDir, tree: filesReviewed });
  return {
    success: result.success,
    iterations: Number(result.data?.iterations ?? 0),
    complianceScore: Number(result.data?.complianceScore ?? 0),
    findings,
    filesReviewed,
    recommendations: findings.map((finding) => finding.requirement ?? finding.description),
  };
}
