/**
 * Auditor Loop
 *
 * Provides continuous improvement loop for code auditing.
 * Supports:
 * - Maximum iteration limit (default: 10)
 * - Progress tracking
 * - Report generation
 * - Automatic re-run on failures
 */

import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditorConfig {
  /** Maximum iterations */
  maxIterations: number;
  /** Stop on success */
  stopOnSuccess: boolean;
  /** Timeout per iteration (ms) */
  iterationTimeout: number;
  /** Enable detailed logging */
  verbose: boolean;
}

export interface AuditorIteration {
  /** Iteration number */
  number: number;
  /** Start time */
  startTime: Date;
  /** End time */
  endTime?: Date;
  /** Duration (ms) */
  duration?: number;
  /** Status */
  status: 'running' | 'completed' | 'failed' | 'timeout';
  /** Issues found */
  issuesFound: number;
  /** Issues fixed */
  issuesFixed: number;
  /** Report */
  report?: string;
  /** Error message */
  error?: string;
}

export interface AuditorResult {
  /** Total iterations */
  totalIterations: number;
  /** Successful iterations */
  successfulIterations: number;
  /** Failed iterations */
  failedIterations: number;
  /** Total issues found */
  totalIssuesFound: number;
  /** Total issues fixed */
  totalIssuesFixed: number;
  /** Remaining issues */
  remainingIssues: number;
  /** All iterations */
  iterations: AuditorIteration[];
  /** Final report */
  finalReport: string;
  /** Success */
  success: boolean;
}

export type AuditorCallback = (iteration: AuditorIteration) => Promise<{
  issuesFound: number;
  issuesFixed: number;
  report: string;
  success: boolean;
}>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const defaultConfig: AuditorConfig = {
  maxIterations: 10,
  stopOnSuccess: true,
  iterationTimeout: 300_000, // 5 minutes
  verbose: false,
};

let isRunning = false;
let currentIteration = 0;

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Run the auditor loop
 */
export async function runAuditorLoop(
  callback: AuditorCallback,
  config?: Partial<AuditorConfig>,
): Promise<AuditorResult> {
  if (isRunning) {
    throw new Error('Auditor loop is already running');
  }

  isRunning = true;
  currentIteration = 0;

  const fullConfig = { ...defaultConfig, ...config };
  const iterations: AuditorIteration[] = [];

  logger.info(`[auditor] Starting loop (max: ${fullConfig.maxIterations} iterations)`);

  try {
    while (currentIteration < fullConfig.maxIterations) {
      currentIteration++;

      const iteration: AuditorIteration = {
        number: currentIteration,
        startTime: new Date(),
        status: 'running',
        issuesFound: 0,
        issuesFixed: 0,
      };

      logger.info(`[auditor] Iteration ${currentIteration}/${fullConfig.maxIterations}`);

      try {
        // Run callback with timeout
        const result = await Promise.race([
          callback(iteration),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Iteration timeout')), fullConfig.iterationTimeout);
          }),
        ]);

        iteration.issuesFound = result.issuesFound;
        iteration.issuesFixed = result.issuesFixed;
        iteration.report = result.report;
        iteration.status = result.success ? 'completed' : 'failed';

        if (fullConfig.verbose) {
          logger.info(`[auditor] Iteration ${currentIteration}: ${result.issuesFound} found, ${result.issuesFixed} fixed`);
        }
      } catch (error) {
        iteration.status = error instanceof Error && error.message === 'Iteration timeout' ? 'timeout' : 'failed';
        iteration.error = error instanceof Error ? error.message : String(error);
        logger.error(`[auditor] Iteration ${currentIteration} failed: ${iteration.error}`);
      }

      iteration.endTime = new Date();
      iteration.duration = iteration.endTime.getTime() - iteration.startTime.getTime();
      iterations.push(iteration);

      // Check if we should stop
      if (fullConfig.stopOnSuccess && iteration.issuesFound === 0) {
        logger.info(`[auditor] No issues found, stopping loop`);
        break;
      }

      if (iteration.status === 'failed' || iteration.status === 'timeout') {
        logger.warn(`[auditor] Iteration ${currentIteration} failed, continuing...`);
      }
    }

    // Calculate totals
    const totalIssuesFound = iterations.reduce((sum, i) => sum + i.issuesFound, 0);
    const totalIssuesFixed = iterations.reduce((sum, i) => sum + i.issuesFixed, 0);
    const successfulIterations = iterations.filter((i) => i.status === 'completed').length;
    const failedIterations = iterations.filter((i) => i.status === 'failed' || i.status === 'timeout').length;

    const result: AuditorResult = {
      totalIterations: iterations.length,
      successfulIterations,
      failedIterations,
      totalIssuesFound,
      totalIssuesFixed,
      remainingIssues: totalIssuesFound - totalIssuesFixed,
      iterations,
      finalReport: generateFinalReport(iterations),
      success: totalIssuesFound === 0 || totalIssuesFixed >= totalIssuesFound,
    };

    logger.info(`[auditor] Loop completed: ${result.totalIterations} iterations, ${result.remainingIssues} remaining issues`);

    return result;
  } finally {
    isRunning = false;
    currentIteration = 0;
  }
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

/**
 * Generate final report
 */
function generateFinalReport(iterations: AuditorIteration[]): string {
  const lines: string[] = [
    '# Auditor Loop Report',
    '',
    `## Summary`,
    `- Total iterations: ${iterations.length}`,
    `- Successful: ${iterations.filter((i) => i.status === 'completed').length}`,
    `- Failed: ${iterations.filter((i) => i.status === 'failed').length}`,
    `- Timeout: ${iterations.filter((i) => i.status === 'timeout').length}`,
    '',
    `## Issues`,
    `- Total found: ${iterations.reduce((sum, i) => sum + i.issuesFound, 0)}`,
    `- Total fixed: ${iterations.reduce((sum, i) => sum + i.issuesFixed, 0)}`,
    `- Remaining: ${iterations.reduce((sum, i) => sum + i.issuesFound, 0) - iterations.reduce((sum, i) => sum + i.issuesFixed, 0)}`,
    '',
    '## Iterations',
  ];

  for (const iteration of iterations) {
    lines.push('');
    lines.push(`### Iteration ${iteration.number}`);
    lines.push(`- Status: ${iteration.status}`);
    lines.push(`- Duration: ${iteration.duration ?? 0}ms`);
    lines.push(`- Issues found: ${iteration.issuesFound}`);
    lines.push(`- Issues fixed: ${iteration.issuesFixed}`);

    if (iteration.error) {
      lines.push(`- Error: ${iteration.error}`);
    }

    if (iteration.report) {
      lines.push('');
      lines.push('**Report:**');
      lines.push(iteration.report);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Check if auditor loop is running
 */
export function isAuditorRunning(): boolean {
  return isRunning;
}

/**
 * Get current iteration number
 */
export function getCurrentIteration(): number {
  return currentIteration;
}

/**
 * Get default config
 */
export function getDefaultConfig(): AuditorConfig {
  return { ...defaultConfig };
}
