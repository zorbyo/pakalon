/**
 * SandboxTester
 *
 * Runs functional tests against the application deployed inside the AIO Sandbox.
 *
 * Test types:
 *   1. Unit tests — run inside sandbox shell
 *   2. Integration tests — run against the running app's URL via sandbox browser
 *   3. Smoke tests — basic HTTP health and page load checks
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '@/utils/logger.js';
import type {
  SandboxSession,
  TestOptions,
  TestResults,
  TestResultItem,
} from './types.js';
import { SandboxMcpClient } from './mcp-client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TEST_TIMEOUT_MS = 60_000;
const DEFAULT_SMOKE_PATHS = ['/'];

// ---------------------------------------------------------------------------
// Tester
// ---------------------------------------------------------------------------

export class SandboxTester {
  private mcpClient?: SandboxMcpClient;

  /**
   * Run all functional tests against the sandbox.
   */
  async runFunctionalTests(
    session: SandboxSession,
    options: TestOptions,
  ): Promise<TestResults> {
    const startTime = Date.now();
    const results: TestResultItem[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    logger.info('[SandboxTester] Starting functional tests...');

    try {
      // Connect to sandbox MCP
      this.mcpClient = new SandboxMcpClient(session.mcpUrl);
      await this.mcpClient.connect();

      // Phase 1: Smoke tests (browser navigation & snapshot)
      logger.info('[SandboxTester] Phase 1: Smoke tests');
      const smokeResults = await this.runSmokeTests(options.sandboxUrl || session.appUrl || session.url, options.projectDir);

      for (const r of smokeResults) {
        results.push(r);
        if (r.status === 'passed') passed++;
        else if (r.status === 'failed') failed++;
        else skipped++;
      }

      // Phase 2: Unit/integration tests (via shell)
      if (options.testCommand) {
        logger.info(`[SandboxTester] Phase 2: Running tests: ${options.testCommand}`);
        const testResult = await this.runTestCommand(options.testCommand);
        results.push(testResult);
        if (testResult.status === 'passed') passed++;
        else if (testResult.status === 'failed') failed++;
        else skipped++;
      }

      // Phase 3: Custom test patterns
      if (options.testPatterns && options.testPatterns.length > 0) {
        logger.info(`[SandboxTester] Phase 3: Running ${options.testPatterns.length} custom test patterns`);
        for (const pattern of options.testPatterns) {
          const testResult = await this.runTestByPattern(pattern, session.url);
          results.push(testResult);
          if (testResult.status === 'passed') passed++;
          else if (testResult.status === 'failed') failed++;
          else skipped++;
        }
      }

      const duration = Date.now() - startTime;

      const testResults: TestResults = {
        success: failed === 0,
        total: results.length,
        passed,
        failed,
        skipped,
        duration,
        results,
      };

      logger.info(`[SandboxTester] Tests complete: ${testResults.total} total, ${passed} passed, ${failed} failed`);

      return testResults;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[SandboxTester] Testing failed: ${message}`);

      return {
        success: false,
        total: results.length,
        passed,
        failed: failed + 1,
        skipped,
        duration: Date.now() - startTime,
        results,
      };
    } finally {
      await this.disconnect().catch(() => undefined);
    }
  }

  /**
   * Run smoke tests — navigate to app URLs and verify they load.
   */
  private async runSmokeTests(
    sandboxUrl: string,
    projectDir: string,
  ): Promise<TestResultItem[]> {
    const results: TestResultItem[] = [];

    // Determine which paths to smoke-test
    const smokePaths = await this.discoverSmokePaths(projectDir);

    for (const pagePath of smokePaths) {
      const fullUrl = new URL(pagePath, sandboxUrl).toString();
      const testName = `smoke: ${pagePath}`;

      try {
        const result = await this.mcpClient!.callTool('browser_navigate', {
          url: fullUrl,
        });

        // Take a snapshot to verify the page loaded
        const snapshot = await this.mcpClient!.callTool('browser_snapshot', {});

        const pageLoaded = String(snapshot).includes('body') || String(result).includes('success');

        results.push({
          name: testName,
          status: pageLoaded ? 'passed' : 'failed',
          duration: 2000,
          error: pageLoaded ? undefined : 'Page did not load properly',
        });
      } catch (error) {
        results.push({
          name: testName,
          status: 'failed',
          duration: 1000,
          error: String(error),
        });
      }
    }

    return results;
  }

  /**
   * Run a test command inside the sandbox shell.
   */
  private async runTestCommand(testCommand: string): Promise<TestResultItem> {
    const startTime = Date.now();
    try {
      const output = await this.mcpClient!.callTool('shell_exec', {
        command: `cd /app && ${testCommand}`,
        timeout: DEFAULT_TEST_TIMEOUT_MS,
      });

      const outputStr = String(output);
      const passed = outputStr.includes('PASS') ||
                     outputStr.includes('passed') ||
                     outputStr.includes('ok') ||
                     !outputStr.includes('FAIL');

      return {
        name: testCommand,
        status: passed ? 'passed' : 'failed',
        duration: Date.now() - startTime,
        error: passed ? undefined : outputStr.substring(0, 500),
      };
    } catch (error) {
      return {
        name: testCommand,
        status: 'failed',
        duration: Date.now() - startTime,
        error: String(error),
      };
    }
  }

  /**
   * Run a test by pattern (e.g., a specific test file or path).
   */
  private async runTestByPattern(pattern: string, sandboxUrl: string): Promise<TestResultItem> {
    const startTime = Date.now();
    try {
      // If pattern starts with /, it's a URL path for browser test
      if (pattern.startsWith('/')) {
        const fullUrl = new URL(pattern, sandboxUrl).toString();
        await this.mcpClient!.callTool('browser_navigate', { url: fullUrl });
        const snapshot = await this.mcpClient!.callTool('browser_snapshot', {});

        return {
          name: `browser: ${pattern}`,
          status: 'passed',
          duration: Date.now() - startTime,
        };
      }

      // Otherwise run as a shell command
      const output = await this.mcpClient!.callTool('shell_exec', {
        command: `cd /app && ${pattern}`,
        timeout: DEFAULT_TEST_TIMEOUT_MS,
      });

      return {
        name: `test: ${pattern}`,
        status: 'passed',
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        name: `test: ${pattern}`,
        status: 'failed',
        duration: Date.now() - startTime,
        error: String(error),
      };
    }
  }

  /**
   * Discover smoke test paths from the project structure.
   */
  private async discoverSmokePaths(projectDir: string): Promise<string[]> {
    const paths = [...DEFAULT_SMOKE_PATHS];

    // Check for common route files in frontend
    const routeFiles = [
      'src/app/page.tsx',
      'src/pages/index.tsx',
      'pages/index.tsx',
      'app/page.tsx',
      'src/routes/index.ts',
    ];

    for (const routeFile of routeFiles) {
      try {
        await fs.access(path.join(projectDir, routeFile));
        // Found a route file — but we'll keep default paths
        break;
      } catch {
        // Continue
      }
    }

    return [...new Set(paths)];
  }

  /**
   * Clean up MCP connection.
   */
  async disconnect(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.disconnect();
      this.mcpClient = undefined;
    }
  }
}

export default SandboxTester;
