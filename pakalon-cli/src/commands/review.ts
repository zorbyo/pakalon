import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../commands.js'
import { isUltrareviewEnabled } from './review/ultrareviewEnabled.js'
import type { SecurityFinding } from '@/deepsec/core/types.js';
import { scanForVulnerabilities, generateReport } from '@/deepsec/scanner/index.js';
import logger from '@/utils/logger.js';
import * as path from 'path';

// Legal wants the explicit surface name plus a docs link visible before the
// user triggers, so the description carries "Claude Code on the web" + URL.
const CCR_TERMS_URL = 'https://code.claude.com/docs/en/claude-code-on-the-web'

const LOCAL_REVIEW_PROMPT = (args: string) => `
      You are an expert code reviewer. Follow these steps:

      1. If no PR number is provided in the args, run \`gh pr list\` to show open PRs
      2. If a PR number is provided, run \`gh pr view <number>\` to get PR details
      3. Run \`gh pr diff <number>\` to get the diff
      4. Analyze the changes and provide a thorough code review that includes:
         - Overview of what the PR does
         - Analysis of code quality and style
         - Specific suggestions for improvements
         - Any potential issues or risks

      Keep your review concise but thorough. Focus on:
      - Code correctness
      - Following project conventions
      - Performance implications
      - Test coverage
      - Security considerations

      Format your review with clear sections and bullet points.

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
