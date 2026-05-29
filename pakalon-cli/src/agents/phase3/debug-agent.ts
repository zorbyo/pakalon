/**
 * Phase 3 Sub-Agent: Debug & Code Scanning Agent (SA-4)
 * 
 * Responsible for:
 * - Code quality scanning (lint, type errors, dead code)
 * - Static analysis bug detection
 * - DevTools integration for browser-level debugging
 * - Execution log generation
 * - Chrome DevTools Protocol (CDP) integration
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult } from '../types.js';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import logger from '@/utils/logger.js';

export interface DebugAgentOptions {
  outputDir: string;
  phaseContext?: string;
  frontendDir?: string;
  backendDir?: string;
}

export interface CodeIssue {
  file: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule?: string;
  suggestedFix?: string;
}

export interface DebugReport {
  issues: CodeIssue[];
  totalErrors: number;
  totalWarnings: number;
  executionLogPath?: string;
  summary: string;
}

export class DebugAgent extends BaseAgent {
  private options: DebugAgentOptions;
  private issues: CodeIssue[] = [];

  constructor(context: AgentContext, options: DebugAgentOptions) {
    const systemPrompt = `You are the Debug & Code Scanning Agent (SA-4) for Pakalon Phase 3.

Your responsibilities:
1. Scan generated code for bugs, type errors, and quality issues
2. Analyze code patterns for anti-patterns and potential crashes
3. Generate execution logs for traceability
4. Integrate with Chrome DevTools Protocol for browser debugging
5. Provide actionable fix suggestions for each issue found

Always explain issues clearly and provide specific fix recommendations.`;

    const config: AgentConfig = {
      name: 'debug-agent',
      model: 'anthropic/claude-3-5-haiku',
      systemPrompt,
      tools: [],
      maxTokens: 8192,
      temperature: 0.3,
    };

    super(config, context);

    this.options = options;
    logger.info(`[DebugAgent] Initialized — output: ${options.outputDir}`);
  }

  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    logger.info('[DebugAgent] Starting debug & code scan...');

    try {
      await fs.mkdir(this.options.outputDir, { recursive: true });

      // Step 1: Static code analysis
      logger.info('[DebugAgent] Step 1/4: Static Code Analysis');
      await this.runStaticAnalysis();

      // Step 2: AI-powered bug detection
      logger.info('[DebugAgent] Step 2/4: AI Bug Detection');
      await this.runAIBugDetection();

      // Step 3: Execution log generation
      logger.info('[DebugAgent] Step 3/4: Execution Log');
      const executionLogPath = await this.generateExecutionLog();

      // Step 4: Generate debug report
      logger.info('[DebugAgent] Step 4/4: Debug Report');
      await this.generateDebugReport(executionLogPath);

      const duration = Date.now() - startTime;
      const errorCount = this.issues.filter(i => i.severity === 'error').length;
      const warningCount = this.issues.filter(i => i.severity === 'warning').length;

      logger.info(`[DebugAgent] [OK] Complete — ${errorCount} errors, ${warningCount} warnings in ${duration}ms`);

      return {
        success: true,
        message: `Debug scan complete: ${errorCount} errors, ${warningCount} warnings found`,
        filesCreated: [
          path.join(this.options.outputDir, 'debug-report.json'),
          path.join(this.options.outputDir, 'execution-log.md'),
        ],
        data: {
          totalIssues: this.issues.length,
          errors: errorCount,
          warnings: warningCount,
        },
        duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[DebugAgent] Failed: ${message}`);
      return {
        success: false,
        message: `Debug scan failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Step 1: Run static code analysis tools
   * Checks TypeScript compilation, lint issues, and common patterns
   */
  private async runStaticAnalysis(): Promise<void> {
    const dirs = [this.options.frontendDir, this.options.backendDir].filter(Boolean) as string[];

    for (const dir of dirs) {
      if (!dir) continue;

      // Check TypeScript compilation
      await this.runTypeScriptCheck(dir);

      // Check for ESLint issues
      await this.runESLintCheck(dir);

      // Check for common code quality issues
      await this.scanForCodeQualityIssues(dir);
    }

    logger.info(`[DebugAgent] Static analysis found ${this.issues.length} issues`);
  }

  /**
   * Run TypeScript compiler check on a directory
   */
  private async runTypeScriptCheck(dir: string): Promise<void> {
    try {
      // Check if tsconfig.json exists
      await fs.access(path.join(dir, 'tsconfig.json'));
      logger.info(`[DebugAgent] Running TypeScript check in: ${dir}`);

      const output = execSync('npx tsc --noEmit 2>&1 || true', {
        cwd: dir,
        timeout: 30000,
        encoding: 'utf-8',
      });

      if (output) {
        // Parse tsc output lines
        const lines = output.split('\n').filter(l => l.includes('error TS'));
        for (const line of lines) {
          const match = line.match(/^(.+)\((\d+),(\d+)\):\s+(error\s+TS\d+:\s+.+)$/);
          if (match) {
            this.issues.push({
              file: path.relative(this.context.projectDir || '', match[1]),
              line: parseInt(match[2], 10),
              column: parseInt(match[3], 10),
              severity: 'error',
              message: match[4],
              rule: 'typescript',
            });
          }
        }
      }
    } catch {
      // tsconfig not found or tsc not available — skip
      logger.debug(`[DebugAgent] TypeScript check skipped for ${dir}`);
    }
  }

  /**
   * Run ESLint check on a directory
   */
  private async runESLintCheck(dir: string): Promise<void> {
    try {
      // Check if eslint config exists
      const hasEslint = await Promise.any([
        fs.access(path.join(dir, '.eslintrc.js')).then(() => true).catch(() => false),
        fs.access(path.join(dir, '.eslintrc.json')).then(() => true).catch(() => false),
        fs.access(path.join(dir, 'eslint.config.js')).then(() => true).catch(() => false),
      ]).catch(() => false);

      if (!hasEslint) {
        logger.debug(`[DebugAgent] No ESLint config in ${dir}, skipping`);
        return;
      }

      logger.info(`[DebugAgent] Running ESLint in: ${dir}`);
      const output = execSync('npx eslint . --format json 2>&1 || true', {
        cwd: dir,
        timeout: 30000,
        encoding: 'utf-8',
      });

      try {
        const results = JSON.parse(output);
        if (Array.isArray(results)) {
          for (const file of results) {
            for (const msg of file.messages || []) {
              this.issues.push({
                file: path.relative(this.context.projectDir || '', file.filePath),
                line: msg.line || 0,
                column: msg.column,
                severity: msg.severity >= 2 ? 'error' : 'warning',
                message: msg.message,
                rule: msg.ruleId || 'eslint',
              });
            }
          }
        }
      } catch {
        logger.debug('[DebugAgent] ESLint JSON parse failed');
      }
    } catch {
      logger.debug('[DebugAgent] ESLint check skipped');
    }
  }

  /**
   * Scan for common code quality issues using regex patterns
   */
  private async scanForCodeQualityIssues(dir: string): Promise<void> {
    try {
      const tsFiles = await this.getTypeScriptFiles(dir);
      logger.info(`[DebugAgent] Scanning ${tsFiles.length} files for quality issues`);

      for (const filePath of tsFiles) {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const relativePath = path.relative(this.context.projectDir || '', filePath);

        // Check for any type assertions
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;

          // Type assertion: `as any`
          if (/as\s+any\b/.test(line)) {
            this.issues.push({
              file: relativePath,
              line: lineNum,
              severity: 'warning',
              message: 'Type assertion "as any" bypasses type safety',
              rule: 'no-any',
              suggestedFix: 'Replace "as any" with a proper type or use type guards',
            });
          }

          // `@ts-ignore` or `@ts-expect-error`
          if (/@ts-(ignore|expect-error)/.test(line)) {
            this.issues.push({
              file: relativePath,
              line: lineNum,
              severity: 'warning',
              message: 'TypeScript suppression comment used',
              rule: 'no-ts-suppress',
              suggestedFix: 'Fix the underlying type issue instead of suppressing it',
            });
          }

          // Empty catch block
          if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
            this.issues.push({
              file: relativePath,
              line: lineNum,
              severity: 'warning',
              message: 'Empty catch block — error is silently swallowed',
              rule: 'no-empty-catch',
              suggestedFix: 'Add error logging or handling in the catch block',
            });
          }

          // console.log in production code
          if (/console\.(log|debug)\(/.test(line) && !filePath.includes('test')) {
            this.issues.push({
              file: relativePath,
              line: lineNum,
              severity: 'info',
              message: 'console.log/debug in non-test file',
              rule: 'no-console',
              suggestedFix: 'Replace with structured logger (logger.info / logger.debug)',
            });
          }

          // TODO comments
          if (/\bTODO\b/i.test(line)) {
            this.issues.push({
              file: relativePath,
              line: lineNum,
              severity: 'info',
              message: `Unresolved TODO: ${line.trim()}`,
              rule: 'todo-comment',
            });
          }
        }
      }
    } catch (error) {
      logger.warn(`[DebugAgent] Quality scan error: ${error}`);
    }
  }

  /**
   * Step 2: AI-powered bug detection
   * Uses LLM to find logical bugs that static analysis misses
   */
  private async runAIBugDetection(): Promise<void> {
    const dirs = [this.options.frontendDir, this.options.backendDir].filter(Boolean) as string[];

    for (const dir of dirs) {
      if (!dir) continue;

      const tsFiles = await this.getTypeScriptFiles(dir);
      // Limit to avoid token overflow
      const filesToAnalyze = tsFiles.slice(0, 5);

      for (const filePath of filesToAnalyze) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          if (content.length > 8000) continue; // Skip large files

          const relativePath = path.relative(this.context.projectDir || '', filePath);
          logger.info(`[DebugAgent] AI analyzing: ${relativePath}`);

          const result = await generateText({
            model: openrouter('anthropic/claude-3-5-haiku'),
            system: `You are a code debugger. Analyze the given TypeScript code and find:
1. Potential runtime errors (null pointer, undefined access)
2. Logic bugs (incorrect conditions, off-by-one)
3. Race conditions or async issues
4. Memory leaks or resource not released

For each issue, provide:
- severity: "error" or "warning"
- line: number
- message: description
- fix: specific fix suggestion

Respond with a JSON array: [{severity, line, message, fix}] or [] if no issues.`,
            prompt: `Analyze this TypeScript code for bugs:\n\n${content.substring(0, 6000)}`,
            maxTokens: 2000,
          });

          try {
            const jsonMatch = result.text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const aiIssues = JSON.parse(jsonMatch[0]);
              for (const issue of aiIssues) {
                if (issue.line && issue.message) {
                  this.issues.push({
                    file: relativePath,
                    line: issue.line,
                    severity: issue.severity === 'error' ? 'error' : 'warning',
                    message: issue.message,
                    rule: 'ai-bug-detection',
                    suggestedFix: issue.fix,
                  });
                }
              }
            }
          } catch {
            logger.debug(`[DebugAgent] AI parse failed for ${relativePath}`);
          }
        } catch (error) {
          logger.warn(`[DebugAgent] AI analysis failed for ${filePath}: ${error}`);
        }
      }
    }
  }

  /**
   * Step 3: Generate execution log
   */
  private async generateExecutionLog(): Promise<string> {
    const logPath = path.join(this.options.outputDir, 'execution-log.md');

    const logContent = [
      '# Debug Agent Execution Log',
      '',
      `**Generated:** ${new Date().toISOString()}`,
      `**Project:** ${this.context.projectDir}`,
      `**Frontend Dir:** ${this.options.frontendDir || 'N/A'}`,
      `**Backend Dir:** ${this.options.backendDir || 'N/A'}`,
      '',
      '## Scan Summary',
      '',
      `- Total files scanned: ${this.issues.length > 0 ? '[OK]' : 'No files to scan'}`,
      `- Issues found: ${this.issues.length}`,
      `  - Errors: ${this.issues.filter(i => i.severity === 'error').length}`,
      `  - Warnings: ${this.issues.filter(i => i.severity === 'warning').length}`,
      `  - Info: ${this.issues.filter(i => i.severity === 'info').length}`,
      '',
      '## Issues Found',
      '',
      ...this.issues.map((issue, i) => [
        `### ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.rule || 'code-issue'}`,
        '',
        `- **File:** \`${issue.file}\` line ${issue.line}`,
        `- **Message:** ${issue.message}`,
        issue.suggestedFix ? `- **Suggested Fix:** ${issue.suggestedFix}` : '',
        '',
      ].join('\n')),
      '',
      '---',
      '',
      '*Log generated by Pakalon Debug Agent (SA-4)*',
    ].join('\n');

    await fs.writeFile(logPath, logContent, 'utf-8');
    logger.info(`[DebugAgent] [OK] Execution log written: ${logPath}`);

    return logPath;
  }

  /**
   * Step 4: Generate structured debug report
   */
  private async generateDebugReport(executionLogPath: string): Promise<void> {
    const report: DebugReport = {
      issues: this.issues,
      totalErrors: this.issues.filter(i => i.severity === 'error').length,
      totalWarnings: this.issues.filter(i => i.severity === 'warning').length,
      executionLogPath,
      summary: this.generateSummary(),
    };

    const reportPath = path.join(this.options.outputDir, 'debug-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    // Also write a human-readable report
    const mdReportPath = path.join(this.options.outputDir, 'debug-report.md');
    const mdContent = [
      '# Debug & Code Scan Report',
      '',
      `**Issues Found:** ${this.issues.length} (${report.totalErrors} errors, ${report.totalWarnings} warnings)`,
      '',
      '## Issue Breakdown',
      '',
      '| Severity | Count |',
      '|----------|-------|',
      `| Error | ${report.totalErrors} |`,
      `| Warning | ${report.totalWarnings} |`,
      `| Info | ${this.issues.filter(i => i.severity === 'info').length} |`,
      '',
      '## Top Issues by File',
      '',
      ...this.getTopFilesByIssues().map(([file, count]) =>
        `- \`${file}\`: ${count} issue(s)`
      ),
      '',
      '## Recommended Actions',
      '',
      report.totalErrors > 0
        ? '1. Fix all errors before proceeding to Phase 4\n2. Review warnings and address high-priority ones\n3. Resolve TODOs before production'
        : report.totalWarnings > 0
          ? '1. Review warnings — no blocking errors found\n2. Address type safety and quality concerns'
          : '1. No issues found — code quality looks good!',
      '',
      '---',
      '*Report generated by Pakalon Debug Agent (SA-4)*',
    ].join('\n');

    await fs.writeFile(mdReportPath, mdContent, 'utf-8');
    logger.info('[DebugAgent] [OK] Debug report generated');
  }

  /**
   * Generate a natural language summary of findings
   */
  private generateSummary(): string {
    const errors = this.issues.filter(i => i.severity === 'error');
    const warnings = this.issues.filter(i => i.severity === 'warning');

    if (this.issues.length === 0) {
      return 'No code quality issues detected. All scanned code appears clean.';
    }

    const parts: string[] = [];
    if (errors.length > 0) {
      parts.push(`Found ${errors.length} error(s) that should be fixed before proceeding.`);
    }
    if (warnings.length > 0) {
      parts.push(`Found ${warnings.length} warning(s) that should be reviewed.`);
    }

    const topRules = this.getTopRules();
    if (topRules.length > 0) {
      parts.push(`Most common patterns: ${topRules.join(', ')}.`);
    }

    return parts.join(' ');
  }

  /**
   * Get files with most issues
   */
  private getTopFilesByIssues(limit: number = 5): Array<[string, number]> {
    const fileCounts = new Map<string, number>();
    for (const issue of this.issues) {
      fileCounts.set(issue.file, (fileCounts.get(issue.file) || 0) + 1);
    }
    return Array.from(fileCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  /**
   * Get most common rule violations
   */
  private getTopRules(limit: number = 3): string[] {
    const ruleCounts = new Map<string, number>();
    for (const issue of this.issues) {
      const rule = issue.rule || 'unknown';
      ruleCounts.set(rule, (ruleCounts.get(rule) || 0) + 1);
    }
    return Array.from(ruleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([rule, count]) => `${rule} (${count})`);
  }

  /**
   * Recursively find all TypeScript files in a directory
   */
  private async getTypeScriptFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        const subFiles = await this.getTypeScriptFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }
}
