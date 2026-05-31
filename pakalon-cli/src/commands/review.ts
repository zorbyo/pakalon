import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../commands.js'
import { isUltrareviewEnabled } from './review/ultrareviewEnabled.js'
import type { SecurityFinding } from '@/deepsec/core/types.js';
import { scanForVulnerabilities, generateReport } from '@/deepsec/scanner/index.js';
import logger from '@/utils/logger.js';
import * as path from 'path';
import { execSync } from 'child_process';

// Legal wants the explicit surface name plus a docs link visible before the
// user triggers, so the description carries "Claude Code on the web" + URL.
const CCR_TERMS_URL = 'https://code.claude.com/docs/en/claude-code-on-the-web'

// ---------------------------------------------------------------------------
// Types for P0-P3 Review System
// ---------------------------------------------------------------------------

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type Verdict = 'correct' | 'incorrect';

export interface ReviewFinding {
  id: string;
  priority: Priority;
  confidence: number; // 0-1
  category: 'bug' | 'security' | 'performance' | 'style' | 'architecture' | 'test' | 'docs';
  title: string;
  description: string;
  file?: string;
  line?: number;
  suggestion?: string;
  source: string;
}

export interface ReviewReport {
  verdict: Verdict;
  summary: string;
  findings: ReviewFinding[];
  stats: {
    filesReviewed: number;
    linesChanged: number;
    p0Count: number;
    p1Count: number;
    p2Count: number;
    p3Count: number;
    averageConfidence: number;
  };
  reviewers: string[];
  duration: number;
}

// ---------------------------------------------------------------------------
// Git Operations
// ---------------------------------------------------------------------------

function getGitDiff(options: { pr?: number; commit?: string; branch?: boolean } = {}): { diff: string; files: string[]; stats: string } {
  let diff = '';
  let files: string[] = [];
  let stats = '';

  if (options.pr) {
    try {
      diff = execSync(`gh pr diff ${options.pr}`, { encoding: 'utf-8' });
      stats = execSync(`gh pr diff ${options.pr} --stat`, { encoding: 'utf-8' });
      const fileLines = stats.split('\n').filter(l => l.includes('|'));
      files = fileLines.map(l => l.split('|')[0]!.trim()).filter(f => f);
    } catch (error) {
      throw new Error(`Failed to get PR diff: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (options.commit) {
    try {
      diff = execSync(`git diff ${options.commit}~1 ${options.commit}`, { encoding: 'utf-8' });
      stats = execSync(`git diff ${options.commit}~1 ${options.commit} --stat`, { encoding: 'utf-8' });
      const fileLines = stats.split('\n').filter(l => l.includes('|'));
      files = fileLines.map(l => l.split('|')[0]!.trim()).filter(f => f);
    } catch (error) {
      throw new Error(`Failed to get commit diff: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (options.branch) {
    try {
      diff = execSync('git diff main...HEAD', { encoding: 'utf-8' });
      stats = execSync('git diff main...HEAD --stat', { encoding: 'utf-8' });
      const fileLines = stats.split('\n').filter(l => l.includes('|'));
      files = fileLines.map(l => l.split('|')[0]!.trim()).filter(f => f);
    } catch (error) {
      throw new Error(`Failed to get branch diff: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    try {
      diff = execSync('git diff HEAD', { encoding: 'utf-8' });
      stats = execSync('git diff HEAD --stat', { encoding: 'utf-8' });
      const fileLines = stats.split('\n').filter(l => l.includes('|'));
      files = fileLines.map(l => l.split('|')[0]!.trim()).filter(f => f);
    } catch (error) {
      throw new Error(`Failed to get uncommitted diff: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { diff, files, stats };
}

// ---------------------------------------------------------------------------
// Reviewer Implementations
// ---------------------------------------------------------------------------

interface Reviewer {
  name: string;
  review: (diff: string, files: string[]) => Promise<ReviewFinding[]>;
}

const securityReviewer: Reviewer = {
  name: 'SecurityReviewer',
  async review(diff: string, files: string[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    
    const securityPatterns = [
      { pattern: /eval\s*\(/gi, title: 'Use of eval()', priority: 'P0' as Priority, confidence: 0.9 },
      { pattern: /exec\s*\(/gi, title: 'Use of exec()', priority: 'P0' as Priority, confidence: 0.85 },
      { pattern: /innerHTML\s*=/gi, title: 'Direct innerHTML assignment', priority: 'P1' as Priority, confidence: 0.8 },
      { pattern: /dangerouslySetInnerHTML/gi, title: 'dangerouslySetInnerHTML usage', priority: 'P1' as Priority, confidence: 0.75 },
      { pattern: /password\s*[:=]\s*['"]/gi, title: 'Hardcoded password', priority: 'P0' as Priority, confidence: 0.95 },
      { pattern: /api[_-]?key\s*[:=]\s*['"]/gi, title: 'Hardcoded API key', priority: 'P0' as Priority, confidence: 0.9 },
      { pattern: /secret\s*[:=]\s*['"]/gi, title: 'Hardcoded secret', priority: 'P0' as Priority, confidence: 0.9 },
      { pattern: /SELECT\s+\*\s+FROM/gi, title: 'SELECT * usage (potential data leak)', priority: 'P2' as Priority, confidence: 0.6 },
      { pattern: /document\.cookie/gi, title: 'Direct cookie access', priority: 'P1' as Priority, confidence: 0.7 },
      { pattern: /localStorage\.setItem/gi, title: 'localStorage usage (consider sessionStorage)', priority: 'P3' as Priority, confidence: 0.5 },
    ];

    for (const { pattern, title, priority, confidence } of securityPatterns) {
      const matches = diff.match(pattern);
      if (matches) {
        findings.push({
          id: `sec-${findings.length}`,
          priority,
          confidence,
          category: 'security',
          title,
          description: `Found ${matches.length} occurrence(s) of: ${title}`,
          source: 'SecurityReviewer',
        });
      }
    }

    return findings;
  },
};

const bugReviewer: Reviewer = {
  name: 'BugReviewer',
  async review(diff: string, files: string[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    
    const bugPatterns = [
      { pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g, title: 'Empty catch block', priority: 'P1' as Priority, confidence: 0.85 },
      { pattern: /===?\s*undefined/g, title: 'Loose equality check', priority: 'P2' as Priority, confidence: 0.6 },
      { pattern: /console\.log\(/g, title: 'Console.log in production code', priority: 'P3' as Priority, confidence: 0.7 },
      { pattern: /TODO|FIXME|HACK|XXX/gi, title: 'Unresolved TODO/FIXME', priority: 'P2' as Priority, confidence: 0.5 },
      { pattern: /null\s*\|\|\s*['"]/gi, title: 'Null coalescing with string default', priority: 'P3' as Priority, confidence: 0.4 },
    ];

    for (const { pattern, title, priority, confidence } of bugPatterns) {
      const matches = diff.match(pattern);
      if (matches) {
        findings.push({
          id: `bug-${findings.length}`,
          priority,
          confidence,
          category: 'bug',
          title,
          description: `Found ${matches.length} occurrence(s) of: ${title}`,
          source: 'BugReviewer',
        });
      }
    }

    return findings;
  },
};

const performanceReviewer: Reviewer = {
  name: 'PerformanceReviewer',
  async review(diff: string, files: string[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    
    const perfPatterns = [
      { pattern: /\.forEach\s*\(/g, title: 'Consider using for...of for performance', priority: 'P3' as Priority, confidence: 0.4 },
      { pattern: /new\s+RegExp\(/g, title: 'Dynamic RegExp creation (cache if reused)', priority: 'P2' as Priority, confidence: 0.5 },
      { pattern: /JSON\.parse\(JSON\.stringify\(/g, title: 'Deep clone via JSON (consider structuredClone)', priority: 'P2' as Priority, confidence: 0.6 },
      { pattern: /await\s+.*\n.*await\s+/g, title: 'Sequential awaits (consider Promise.all)', priority: 'P1' as Priority, confidence: 0.7 },
    ];

    for (const { pattern, title, priority, confidence } of perfPatterns) {
      const matches = diff.match(pattern);
      if (matches) {
        findings.push({
          id: `perf-${findings.length}`,
          priority,
          confidence,
          category: 'performance',
          title,
          description: `Found ${matches.length} occurrence(s) of: ${title}`,
          source: 'PerformanceReviewer',
        });
      }
    }

    return findings;
  },
};

const styleReviewer: Reviewer = {
  name: 'StyleReviewer',
  async review(diff: string, files: string[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    
    const stylePatterns = [
      { pattern: /var\s+/g, title: 'Use of var (prefer const/let)', priority: 'P3' as Priority, confidence: 0.8 },
      { pattern: /function\s+\w+\s*\([^)]*\)\s*\{/g, title: 'Consider arrow functions for consistency', priority: 'P3' as Priority, confidence: 0.3 },
      { pattern: /['"]([^'"]+)['"]\s*:\s*/g, title: 'Unquoted object key (check style guide)', priority: 'P3' as Priority, confidence: 0.4 },
    ];

    for (const { pattern, title, priority, confidence } of stylePatterns) {
      const matches = diff.match(pattern);
      if (matches) {
        findings.push({
          id: `style-${findings.length}`,
          priority,
          confidence,
          category: 'style',
          title,
          description: `Found ${matches.length} occurrence(s) of: ${title}`,
          source: 'StyleReviewer',
        });
      }
    }

    return findings;
  },
};

// ---------------------------------------------------------------------------
// Review Engine
// ---------------------------------------------------------------------------

export async function runReview(options: { pr?: number; commit?: string; branch?: boolean; focus?: string[] } = {}): Promise<ReviewReport> {
  const startTime = Date.now();
  
  const { diff, files, stats } = getGitDiff(options);
  
  if (!diff.trim()) {
    return {
      verdict: 'correct',
      summary: 'No changes to review.',
      findings: [],
      stats: {
        filesReviewed: 0,
        linesChanged: 0,
        p0Count: 0,
        p1Count: 0,
        p2Count: 0,
        p3Count: 0,
        averageConfidence: 0,
      },
      reviewers: [],
      duration: Date.now() - startTime,
    };
  }

  const addedLines = (diff.match(/^\+[^+]/gm) || []).length;
  const removedLines = (diff.match(/^-[^-]/gm) || []).length;
  const linesChanged = addedLines + removedLines;

  const reviewers: Reviewer[] = [];
  if (!options.focus || options.focus.includes('security')) {
    reviewers.push(securityReviewer);
  }
  if (!options.focus || options.focus.includes('bugs')) {
    reviewers.push(bugReviewer);
  }
  if (!options.focus || options.focus.includes('performance')) {
    reviewers.push(performanceReviewer);
  }
  if (!options.focus || options.focus.includes('style')) {
    reviewers.push(styleReviewer);
  }

  const reviewerPromises = reviewers.map(reviewer => reviewer.review(diff, files));
  const reviewerResults = await Promise.all(reviewerPromises);

  const allFindings: ReviewFinding[] = [];
  for (const findings of reviewerResults) {
    allFindings.push(...findings);
  }

  const priorityOrder: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  allFindings.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.confidence - a.confidence;
  });

  const p0Count = allFindings.filter(f => f.priority === 'P0').length;
  const p1Count = allFindings.filter(f => f.priority === 'P1').length;
  const p2Count = allFindings.filter(f => f.priority === 'P2').length;
  const p3Count = allFindings.filter(f => f.priority === 'P3').length;
  const averageConfidence = allFindings.length > 0
    ? allFindings.reduce((sum, f) => sum + f.confidence, 0) / allFindings.length
    : 0;

  const verdict: Verdict = p0Count > 0 || p1Count > 2 ? 'incorrect' : 'correct';

  let summary = `Reviewed ${files.length} file(s) with ${linesChanged} line(s) changed.\n`;
  if (allFindings.length === 0) {
    summary += 'No issues found. The change looks good!';
  } else {
    summary += `Found ${allFindings.length} issue(s): ${p0Count} P0, ${p1Count} P1, ${p2Count} P2, ${p3Count} P3.\n`;
    if (verdict === 'incorrect') {
      summary += 'VERDICT: Changes should NOT ship. Critical issues found.';
    } else {
      summary += 'VERDICT: Changes can ship, but consider addressing the issues.';
    }
  }

  return {
    verdict,
    summary,
    findings: allFindings,
    stats: {
      filesReviewed: files.length,
      linesChanged,
      p0Count,
      p1Count,
      p2Count,
      p3Count,
      averageConfidence,
    },
    reviewers: reviewers.map(r => r.name),
    duration: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatReviewReport(report: ReviewReport): string {
  const verdictEmoji = report.verdict === 'correct' ? '✅' : '❌';
  
  let output = `\n${verdictEmoji} REVIEW VERDICT: ${report.verdict.toUpperCase()}\n\n`;
  output += `${report.summary}\n\n`;
  
  if (report.findings.length > 0) {
    output += `FINDINGS:\n`;
    output += `${'─'.repeat(60)}\n`;
    
    for (const finding of report.findings) {
      const priorityEmoji = finding.priority === 'P0' ? '🔴' :
                           finding.priority === 'P1' ? '🟠' :
                           finding.priority === 'P2' ? '🟡' : '🟢';
      
      output += `\n${priorityEmoji} [${finding.priority}] ${finding.title}\n`;
      output += `   Category: ${finding.category} | Confidence: ${(finding.confidence * 100).toFixed(0)}% | Source: ${finding.source}\n`;
      output += `   ${finding.description}\n`;
      
      if (finding.file) {
        output += `   File: ${finding.file}${finding.line ? `:${finding.line}` : ''}\n`;
      }
      
      if (finding.suggestion) {
        output += `   Suggestion: ${finding.suggestion}\n`;
      }
    }
  }
  
  output += `\n${'─'.repeat(60)}\n`;
  output += `STATS: ${report.stats.filesReviewed} files, ${report.stats.linesChanged} lines changed\n`;
  output += `REVIEWERS: ${report.reviewers.join(', ')}\n`;
  output += `DURATION: ${(report.duration / 1000).toFixed(1)}s\n`;
  
  return output;
}

const LOCAL_REVIEW_PROMPT = (args: string) => `
      You are an expert code reviewer using the P0-P3 priority system.
      
      PRIORITY LEVELS:
      - P0 (Critical): Security vulnerabilities, data loss risks, crashes
      - P1 (High): Bugs, significant performance issues, broken functionality
      - P2 (Medium): Code smells, minor issues, potential improvements
      - P3 (Low): Style suggestions, minor improvements, nitpicks

      VERDICT RULES:
      - correct: No P0 issues AND at most 2 P1 issues
      - incorrect: Has P0 issues OR more than 2 P1 issues

      Follow these steps:

      1. If no PR number is provided in the args, run \`gh pr list\` to show open PRs
      2. If a PR number is provided, run \`gh pr view <number>\` to get PR details
      3. Run \`gh pr diff <number>\` to get the diff
      4. Analyze the changes and provide a structured review:
         
         ## Summary
         Brief overview of what the PR does.
         
         ## Findings
         For each issue found:
         - [Px] Title (Confidence: XX%)
           Category: bug/security/performance/style/architecture
           Description: What the issue is
           File: path/to/file.ts:line
           Suggestion: How to fix it
         
         ## Verdict
         VERDICT: correct | incorrect
         Reasoning: Why this verdict was chosen

      Focus on:
      - Code correctness
      - Security vulnerabilities
      - Performance implications
      - Test coverage
      - Following project conventions

      Format your review with clear sections and use the P0-P3 priority system consistently.

      PR number: ${args}
    `

const review: Command = {
  type: 'prompt',
  name: 'review',
  description: 'Review a pull request',
  progressMessage: 'reviewing pull request',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    return [{ type: 'text', text: LOCAL_REVIEW_PROMPT(args) }]
  },
}

// /ultrareview is the ONLY entry point to the remote bughunter path —
// /review stays purely local. local-jsx type renders the overage permission
// dialog when free reviews are exhausted.
const ultrareview: Command = {
  type: 'local-jsx',
  name: 'ultrareview',
  description: `~10–20 min · Finds and verifies bugs in your branch. Runs in Claude Code on the web. See ${CCR_TERMS_URL}`,
  isEnabled: () => isUltrareviewEnabled(),
  load: () => import('./review/ultrareviewCommand.js'),
}

// Deepsec security review command
export const securityReview: Command = {
  type: 'prompt',
  name: 'security-review',
  description: 'Run deepsec security vulnerability scan on the codebase',
  progressMessage: 'scanning for security vulnerabilities',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(_args: string): Promise<ContentBlockParam[]> {
    try {
      const projectDir = process.cwd();
      const findings = await scanForVulnerabilities(projectDir);

      if (findings.length === 0) {
        return [{ type: 'text', text: 'No security vulnerabilities found in the codebase.' }];
      }

      // Categorize findings
      const critical = findings.filter(f => f.severity === 'CRITICAL');
      const high = findings.filter(f => f.severity === 'HIGH');
      const medium = findings.filter(f => f.severity === 'MEDIUM');
      const low = findings.filter(f => f.severity === 'LOW');

      let reviewText = `# Security Review Results

Found ${findings.length} security issues in the codebase.

## Summary
- Critical: ${critical.length}
- High: ${high.length}
- Medium: ${medium.length}
- Low: ${low.length}

## Findings

`;

      for (const finding of findings) {
        reviewText += `### ${finding.title} (${finding.severity})
**File:** ${finding.file}\n`;
        if (finding.line) reviewText += `**Line:** ${finding.line}\n`;
        reviewText += `**Category:** ${finding.tool}\n`;
        reviewText += `**Description:** ${finding.message}\n`;
        if (finding.rule) reviewText += `**Rule:** ${finding.rule}\n`;
        if (finding.recommendation) reviewText += `**Recommendation:** ${finding.recommendation}\n`;
        reviewText += '\n';
      }

      reviewText += `## Recommendations

1. Address all CRITICAL and HIGH severity issues immediately
2. Review MEDIUM severity issues and prioritize based on risk
3. Consider LOW severity issues for future improvements
4. Implement automated security scanning in your CI/CD pipeline
5. Keep dependencies up to date

## Next Steps
- Run \`/security-review\` again after fixing issues
- Use \`/review\` for general code review
- Consider using ultrareview for comprehensive bug hunting`;

      return [{ type: 'text', text: reviewText }];
    } catch (error) {
      logger.error('Security review failed:', error);
      return [{ type: 'text', text: 'Security review failed. Please try again.' }];
    }
  },
}

export default review
export { ultrareview }
