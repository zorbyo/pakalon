/**
 * Phase 4 Subagent-3: Code Review Agent
 * Reviews generated source code for quality, security vulnerabilities, and best practices.
 * Performs static analysis on generated code files without executing them.
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult } from '../types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '@/utils/logger.js';

export interface CodeReviewConfig {
  outputDir: string;
  projectDir?: string;
  /** Directories to scan for code review */
  scanDirs?: string[];
  /** Phase context for informed review */
  phaseContext?: string;
}

export interface CodeReviewFinding {
  file: string;
  line?: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: 'security' | 'quality' | 'performance' | 'maintainability' | 'style' | 'potential_bug';
  title: string;
  description: string;
  recommendation: string;
}

const CODE_REVIEW_SYSTEM_PROMPT = `You are the Phase 4 Code Review Agent for Pakalon.

Your responsibilities:
1. Review generated source code for security vulnerabilities
2. Check code quality and adherence to best practices
3. Identify potential bugs and logic errors
4. Review error handling completeness
5. Check for hardcoded secrets in code
6. Review input validation and sanitization
7. Check type safety and null handling

Analyze code patterns for:
- Injection vulnerabilities (SQL, NoSQL, command)
- Broken authentication/authorization
- Sensitive data exposure
- XML/JSON parser security
- Insecure deserialization
- Missing or improper logging
- Race conditions
- Memory leaks (in Node.js: unclosed handles, listeners)
- Improper error handling exposing stack traces
- Hardcoded credentials, API keys, tokens`;

export class CodeReviewAgent extends BaseAgent {
  private findings: CodeReviewFinding[] = [];
  private outputDir: string;
  private projectDir: string;
  private scanDirs: string[];
  private phaseContext: string;

  constructor(context: AgentContext, config: CodeReviewConfig) {
    const agentConfig: AgentConfig = {
      name: 'phase4-code-review',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt: CODE_REVIEW_SYSTEM_PROMPT,
      tools: [],
      maxTokens: 8192,
      temperature: 0.3,
    };

    super(agentConfig, context);

    this.outputDir = config.outputDir;
    this.projectDir = config.projectDir ?? context.projectDir ?? process.cwd();
    this.scanDirs = config.scanDirs ?? [];
    this.phaseContext = config.phaseContext ?? '';
  }

  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      logger.info('[Phase4-CodeReview] Starting code review...');
      await fs.mkdir(this.outputDir, { recursive: true });

      // Step 1: Discover source files to review
      const sourceFiles = await this.discoverSourceFiles();
      logger.info(`[Phase4-CodeReview] Found ${sourceFiles.length} files to review`);

      // Step 2: Run static pattern analysis
      await this.runPatternAnalysis(sourceFiles);

      // Step 3: Check for hardcoded secrets
      await this.checkHardcodedSecrets(sourceFiles);

      // Step 4: Check error handling patterns
      await this.checkErrorHandling(sourceFiles);

      // Step 5: Generate review report
      await this.generateReport();

      const duration = Date.now() - startTime;
      logger.info(`[Phase4-CodeReview] Completed in ${(duration / 1000).toFixed(1)}s — ${this.findings.length} findings`);

      return {
        success: true,
        message: `Code review completed. Found ${this.findings.length} issues.`,
        filesCreated: [path.join(this.outputDir, 'code-review-report.md')],
        data: {
          findings: this.findings,
          totalFiles: sourceFiles.length,
          findingCount: this.findings.length,
        },
        duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Phase4-CodeReview] Failed: ${message}`);
      return {
        success: false,
        message: `Code review failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  private async discoverSourceFiles(): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb', '.php'];

    for (const dir of this.scanDirs) {
      try {
        const walkDir = async (currentDir: string): Promise<void> => {
          const entries = await fs.readdir(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
              await walkDir(fullPath);
            } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
              files.push(fullPath);
            }
          }
        };
        await walkDir(dir);
      } catch {
        logger.warn(`[Phase4-CodeReview] Could not scan directory: ${dir}`);
      }
    }

    return files;
  }

  private async runPatternAnalysis(files: string[]): Promise<void> {
    const securityPatterns: Array<{
      pattern: RegExp;
      severity: CodeReviewFinding['severity'];
      category: CodeReviewFinding['category'];
      title: string;
      recommendation: string;
    }> = [
      { pattern: /eval\s*\(/g, severity: 'HIGH', category: 'security', title: 'Use of eval()', recommendation: 'Replace eval() with safe alternatives like JSON.parse() or Function constructor only when necessary' },
      { pattern: /innerHTML\s*=/g, severity: 'HIGH', category: 'security', title: 'Direct innerHTML assignment', recommendation: 'Use textContent or DOMPurify sanitization instead of innerHTML' },
      { pattern: /process\.env\./g, severity: 'LOW', category: 'security', title: 'Environment variable access', recommendation: 'Ensure env vars are validated before use and not logged' },
      { pattern: /\.exec\s*\([^)]*\)/g, severity: 'MEDIUM', category: 'security', title: 'Shell command execution', recommendation: 'Validate and sanitize all shell command inputs; avoid if possible' },
      { pattern: /child_process/g, severity: 'MEDIUM', category: 'security', title: 'Child process usage', recommendation: 'Ensure proper input validation and timeout handling for child processes' },
      { pattern: /\.env\b/g, severity: 'INFO', category: 'security', title: '.env file reference', recommendation: 'Ensure .env is in .gitignore and not committed to repository' },
    ];

    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        const relativePath = path.relative(this.projectDir, file);

        // Check security patterns
        for (const sp of securityPatterns) {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            if (sp.pattern.test(line)) {
              sp.pattern.lastIndex = 0;
              this.findings.push({
                file: relativePath,
                line: i + 1,
                severity: sp.severity,
                category: sp.category,
                title: sp.title,
                description: `Found pattern match at line ${i + 1}: ${line.trim().substring(0, 100)}`,
                recommendation: sp.recommendation,
              });
            }
          }
        }

        // Check for TODO/FIXME/SECURITY comments left in code
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (/\/\/\s*(TODO|FIXME|HACK|XXX|SECURITY|WARNING)/.test(line)) {
            this.findings.push({
              file: relativePath,
              line: i + 1,
              severity: line.includes('SECURITY') ? 'HIGH' : 'MEDIUM',
              category: 'maintainability',
              title: `Unresolved ${line.match(/\/\/\s*(TODO|FIXME|HACK|XXX|SECURITY|WARNING)/)?.[1] || 'TODO'} comment`,
              description: `Found unresolved comment: ${line.trim().substring(0, 150)}`,
              recommendation: 'Resolve before deployment: address the issue or create a tracking ticket',
            });
          }
        }

        // Check for console.log in production code
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (/console\.(log|warn|error|debug)\s*\(/.test(line) && !file.includes('test') && !file.includes('spec')) {
            const isLogger = lines.some(l => l.includes('logger.') || l.includes('debugLog'));
            if (!isLogger) {
              this.findings.push({
                file: relativePath,
                line: i + 1,
                severity: 'LOW',
                category: 'quality',
                title: 'Console.log in production code',
                description: `Found console.${line.match(/console\.(\w+)/)?.[1] || 'log'}() call`,
                recommendation: 'Replace with structured logger (e.g., pino, winston) for production monitoring',
              });
              break; // One finding per file for this pattern
            }
          }
        }
      } catch {
        logger.warn(`[Phase4-CodeReview] Could not read file: ${file}`);
      }
    }
  }

  private async checkHardcodedSecrets(files: string[]): Promise<void> {
    const secretPatterns = [
      { pattern: /['"][A-Za-z0-9_]{20,}['"]\s*[,)]/g, severity: 'HIGH' as const, desc: 'Possible API key/token' },
      { pattern: /(?:api[_-]?key|apikey|secret|password|token|auth)[=:]\s*['"][^'"]{8,}['"]/gi, severity: 'CRITICAL' as const, desc: 'Hardcoded credential' },
      { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, severity: 'CRITICAL' as const, desc: 'Private key in source code' },
      { pattern: /mongodb(?:\+srv)?:\/\/[^@]+@/, severity: 'HIGH' as const, desc: 'Database connection string with credentials' },
    ];

    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const relativePath = path.relative(this.projectDir, file);

        // Skip test files and config templates
        if (file.includes('.example') || file.includes('sample')) continue;

        for (const sp of secretPatterns) {
          sp.pattern.lastIndex = 0;
          const matches = content.match(sp.pattern);
          if (matches) {
            this.findings.push({
              file: relativePath,
              severity: sp.severity,
              category: 'security',
              title: sp.desc,
              description: `Found potential secret in ${relativePath} (${matches.length} match${matches.length > 1 ? 'es' : ''})`,
              recommendation: 'Move secrets to environment variables or a secrets manager. Never commit secrets to version control.',
            });
            break;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  private async checkErrorHandling(files: string[]): Promise<void> {
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const relativePath = path.relative(this.projectDir, file);

        // Check for empty catch blocks
        const catchMatches = content.match(/catch\s*\([^)]*\)\s*\{\s*\}/g);
        if (catchMatches) {
          this.findings.push({
            file: relativePath,
            severity: 'HIGH',
            category: 'potential_bug',
            title: 'Empty catch block',
            description: `Found ${catchMatches.length} empty catch block(s) — errors are silently swallowed`,
            recommendation: 'Always handle or log errors in catch blocks. At minimum, log the error.',
          });
        }

        // Check for try without catch (only finally)
        const tryBlocks = content.match(/try\s*\{[\s\S]*?\}\s*(catch|finally)\s*\(/g);
        if (!tryBlocks && content.includes('try {')) {
          // More nuanced check: find try blocks
          const lines = content.split('\n');
          let inTry = false;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            if (/\btry\s*\{/.test(line)) inTry = true;
            if (inTry && /\}\s*catch\s*\(/.test(line)) inTry = false;
            if (inTry && /\}\s*(finally\s*\{|$)/.test(line)) {
              this.findings.push({
                file: relativePath,
                line: i + 1,
                severity: 'MEDIUM',
                category: 'potential_bug',
                title: 'Try block without catch',
                description: 'Try block may not have proper error handling',
                recommendation: 'Add a catch block or ensure errors are properly propagated',
              });
              inTry = false;
            }
          }
        }
      } catch {
        // Skip unreadable files
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

    const categoryCount: Record<string, number> = {};
    for (const f of this.findings) {
      categoryCount[f.category] = (categoryCount[f.category] || 0) + 1;
    }

    const report = `# Code Review Report

## Summary

| Metric | Count |
|--------|-------|
| Total Files Reviewed | ${this.findings.length > 0 ? 'Multiple' : '0'} |
| Total Findings | ${this.findings.length} |
| Critical | ${severityCount.CRITICAL} |
| High | ${severityCount.HIGH} |
| Medium | ${severityCount.MEDIUM} |
| Low | ${severityCount.LOW} |
| Info | ${severityCount.INFO} |

## Breakdown by Category

${Object.entries(categoryCount).map(([cat, count]) => `- **${cat}**: ${count}`).join('\n')}

## Findings

${this.findings.map(f => `
### [${f.severity}] ${f.title}
- **File**: ${f.file}${f.line ? `:${f.line}` : ''}
- **Category**: ${f.category}
- **Description**: ${f.description}
- **Recommendation**: ${f.recommendation}
`).join('\n')}

## Key Recommendations

${severityCount.CRITICAL > 0 ? '- **Fix critical issues immediately before proceeding**' : ''}
${severityCount.HIGH > 0 ? '- Address high-severity issues in the next development iteration' : ''}
${this.findings.filter(f => f.category === 'security').length > 0 ? '- Run a dedicated security audit for all code paths' : ''}
- Establish code review as part of the development workflow

---

*Report generated by Pakalon Phase 4 Code Review Agent*
`;

    await fs.writeFile(path.join(this.outputDir, 'code-review-report.md'), report, 'utf-8');
    logger.info('[Phase4-CodeReview] [OK] Code review report generated');
  }
}
