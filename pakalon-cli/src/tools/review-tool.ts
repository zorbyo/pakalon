/**
 * Review Tool
 * 
 * Structured code review findings with priorities.
 * Based on OMP's review tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import * as path from 'path';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type FindingPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface ReviewFinding {
  priority: FindingPriority;
  file: string;
  line?: number;
  column?: number;
  message: string;
  category: 'bug' | 'security' | 'performance' | 'style' | 'documentation' | 'test';
  suggestion?: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  summary: string;
  verdict: 'approve' | 'request-changes' | 'comment';
}

// ============================================================================
// Review Manager
// ============================================================================

class ReviewManager {
  private findings: Map<string, ReviewFinding[]> = new Map();

  /**
   * Add a finding
   */
  addFinding(finding: ReviewFinding): void {
    const fileFindings = this.findings.get(finding.file) || [];
    fileFindings.push(finding);
    this.findings.set(finding.file, fileFindings);
  }

  /**
   * Get findings for a file
   */
  getFileFindings(filePath: string): ReviewFinding[] {
    return this.findings.get(filePath) || [];
  }

  /**
   * Get all findings
   */
  getAllFindings(): ReviewFinding[] {
    const allFindings: ReviewFinding[] = [];
    for (const findings of this.findings.values()) {
      allFindings.push(...findings);
    }
    return allFindings;
  }

  /**
   * Generate review result
   */
  generateReview(): ReviewResult {
    const findings = this.getAllFindings();
    
    // Sort by priority
    const priorityOrder: Record<FindingPriority, number> = {
      P0: 0, P1: 1, P2: 2, P3: 3,
    };
    findings.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Determine verdict
    const hasP0 = findings.some(f => f.priority === 'P0');
    const hasP1 = findings.some(f => f.priority === 'P1');
    
    let verdict: ReviewResult['verdict'];
    if (hasP0) {
      verdict = 'request-changes';
    } else if (hasP1) {
      verdict = 'request-changes';
    } else if (findings.length > 0) {
      verdict = 'comment';
    } else {
      verdict = 'approve';
    }

    // Generate summary
    const summary = this.generateSummary(findings);

    return { findings, summary, verdict };
  }

  /**
   * Generate summary
   */
  private generateSummary(findings: ReviewFinding[]): string {
    if (findings.length === 0) {
      return 'No issues found. Code looks good!';
    }

    const byPriority = {
      P0: findings.filter(f => f.priority === 'P0').length,
      P1: findings.filter(f => f.priority === 'P1').length,
      P2: findings.filter(f => f.priority === 'P2').length,
      P3: findings.filter(f => f.priority === 'P3').length,
    };

    const byCategory = {
      bug: findings.filter(f => f.category === 'bug').length,
      security: findings.filter(f => f.category === 'security').length,
      performance: findings.filter(f => f.category === 'performance').length,
      style: findings.filter(f => f.category === 'style').length,
      documentation: findings.filter(f => f.category === 'documentation').length,
      test: findings.filter(f => f.category === 'test').length,
    };

    let summary = `Found ${findings.length} issues:\n`;
    summary += `- P0 (Critical): ${byPriority.P0}\n`;
    summary += `- P1 (High): ${byPriority.P1}\n`;
    summary += `- P2 (Medium): ${byPriority.P2}\n`;
    summary += `- P3 (Low): ${byPriority.P3}\n\n`;
    
    summary += `By category:\n`;
    if (byCategory.bug > 0) summary += `- Bugs: ${byCategory.bug}\n`;
    if (byCategory.security > 0) summary += `- Security: ${byCategory.security}\n`;
    if (byCategory.performance > 0) summary += `- Performance: ${byCategory.performance}\n`;
    if (byCategory.style > 0) summary += `- Style: ${byCategory.style}\n`;
    if (byCategory.documentation > 0) summary += `- Documentation: ${byCategory.documentation}\n`;
    if (byCategory.test > 0) summary += `- Tests: ${byCategory.test}\n`;

    return summary;
  }

  /**
   * Clear findings
   */
  clear(): void {
    this.findings.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: ReviewManager | null = null;

function getReviewManager(): ReviewManager {
  if (!managerInstance) {
    managerInstance = new ReviewManager();
  }
  return managerInstance;
}

// ============================================================================
// Review Tool
// ============================================================================

const reviewInputSchema = z.object({
  action: z.enum(['add', 'summary', 'clear']).describe('Review action'),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('Finding priority'),
  file: z.string().optional().describe('File path'),
  line: z.number().optional().describe('Line number'),
  column: z.number().optional().describe('Column number'),
  message: z.string().optional().describe('Finding message'),
  category: z.enum(['bug', 'security', 'performance', 'style', 'documentation', 'test']).optional().describe('Finding category'),
  suggestion: z.string().optional().describe('Suggested fix'),
});

export const reviewTool = buildTool({
  name: 'review',
  description: 'Report structured code review findings with priorities.',
  inputSchema: reviewInputSchema,
  isReadOnly: false,
  isConcurrencySafe: true,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { action, priority, file, line, column, message, category, suggestion } = args;
    
    try {
      const manager = getReviewManager();
      
      switch (action) {
        case 'add': {
          if (!priority || !file || !message || !category) {
            return { data: 'priority, file, message, and category are required for add action' };
          }
          
          manager.addFinding({
            priority,
            file,
            line,
            column,
            message,
            category,
            suggestion,
          });
          
          return { data: `Finding added: ${priority} - ${message}` };
        }
        
        case 'summary': {
          const review = manager.generateReview();
          return { data: review.summary };
        }
        
        case 'clear': {
          manager.clear();
          return { data: 'Review findings cleared' };
        }
        
        default:
          return { data: `Unknown action: ${action}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(message);
      logger.error('[review] Tool failed', { error: message });
      return { data: `Review tool failed: ${message}` };
    }
  },
  
  userFacingName: () => 'Review',
  
  renderToolUseMessage: (input) => {
    const action = typeof input.action === 'string' ? input.action : 'unknown';
    return `Review: ${action}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
