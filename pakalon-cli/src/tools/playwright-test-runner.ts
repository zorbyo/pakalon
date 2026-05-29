import fs from "fs/promises";
import path from "path";

export type BrowserType = "chromium" | "firefox" | "webkit";

export interface TestScenario {
  name: string;
  steps: TestStep[];
  timeout?: number;
}

type StepWithTimeout = { timeout?: number };

export type TestStep =
  | ({ type: "navigate"; url: string } & StepWithTimeout)
  | ({ type: "click"; selector: string; waitAfter?: number } & StepWithTimeout)
  | ({ type: "type"; selector: string; value: string } & StepWithTimeout)
  | ({ type: "select"; selector: string; value: string } & StepWithTimeout)
  | ({ type: "screenshot"; name: string } & StepWithTimeout)
  | ({ type: "assert-text"; selector: string; expected: string } & StepWithTimeout)
  | ({ type: "assert-url"; expected: string } & StepWithTimeout)
  | ({ type: "assert-element"; selector: string } & StepWithTimeout)
  | ({ type: "wait"; ms: number } & StepWithTimeout)
  | ({ type: "wait-for-selector"; selector: string; state?: "visible" | "hidden" | "attached" } & StepWithTimeout)
  | ({ type: "evaluate"; code: string; storeAs?: string } & StepWithTimeout);

export interface TestResult {
  scenarioName: string;
  success: boolean;
  error?: string;
  steps: Array<{
    step: TestStep;
    success: boolean;
    error?: string;
    duration: number;
  }>;
  screenshots: string[];
  consoleLogs: string[];
  networkRequests: number;
  duration: number;
}

export interface TestRunOptions {
  targetUrl: string;
  scenarios: TestScenario[];
  browserType?: BrowserType;
  headless?: boolean;
  viewport?: { width: number; height: number };
  outputDir?: string;
  timeout?: number;
  recordNetwork?: boolean;
}

export interface TestRunReport {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
  summary: string;
  outputDir: string;
}

type PlaywrightModule = {
  chromium?: { launch(options?: { headless?: boolean; args?: string[] }): Promise<any> };
  firefox?: { launch(options?: { headless?: boolean; args?: string[] }): Promise<any> };
  webkit?: { launch(options?: { headless?: boolean; args?: string[] }): Promise<any> };
};

type BrowserLike = {
  newContext(options?: {
    viewport?: { width: number; height: number };
    recordHar?: { path: string; mode?: "minimal" | "full" };
  }): Promise<any>;
  close(): Promise<void>;
  isConnected?: () => boolean;
};

type PageLike = {
  goto(url: string, options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle"; timeout?: number }): Promise<unknown>;
  url(): string;
  locator(selector: string): any;
  waitForTimeout(timeout: number): Promise<void>;
  waitForSelector(
    selector: string,
    options?: { state?: "hidden" | "visible" | "attached" | "detached"; timeout?: number },
  ): Promise<unknown>;
  screenshot(options?: { path?: string; fullPage?: boolean; type?: "png" | "jpeg" }): Promise<Buffer>;
  evaluate<T>(pageFunction: (arg?: any) => T, arg?: any): Promise<T>;
  title(): Promise<string>;
  close(): Promise<void>;
  on?(event: string, handler: (...args: any[]) => void): void;
};

type PageConsoleMessage = { type(): string; text(): string };
type PageRequest = { method(): string; url(): string; resourceType?: () => string };

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const REPORT_FILENAME = "playwright-test-report.json";
const SUMMARY_FILENAME = "playwright-test-summary.txt";
let activeRunTimeout = DEFAULT_TIMEOUT;
let activeRecordNetwork = false;

function safeName(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("__")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "item";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

function normalizeBrowserType(browserType?: BrowserType): BrowserType {
  return browserType ?? "chromium";
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return new URL(url, baseUrl).toString();
  }
}

function resolveExpectedUrl(expected: string, baseUrl: string): string {
  try {
    return new URL(expected).toString();
  } catch {
    return new URL(expected, baseUrl).toString();
  }
}

function stepTimeout(step: TestStep, scenarioTimeout: number | undefined, runTimeout: number | undefined): number {
  return (step as StepWithTimeout).timeout ?? scenarioTimeout ?? runTimeout ?? DEFAULT_TIMEOUT;
}

function remainingTimeout(deadline?: number): number | undefined {
  if (!deadline) return undefined;
  return Math.max(1, deadline - Date.now());
}

async function runWithTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function importPlaywright(): Promise<PlaywrightModule | null> {
  try {
    return (await import("playwright")) as PlaywrightModule;
  } catch {
    return null;
  }
}

async function launchBrowser(options: TestRunOptions): Promise<{ playwright: PlaywrightModule; browser: BrowserLike } | { error: string }> {
  const playwright = await importPlaywright();
  if (!playwright) return { error: "Playwright is not installed or could not be loaded." };

  const browserType = normalizeBrowserType(options.browserType);
  const launcher = playwright[browserType];
  if (!launcher?.launch) {
    return { error: `Playwright browser launcher not available: ${browserType}` };
  }

  try {
    const browser = (await launcher.launch({
      headless: options.headless ?? true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })) as BrowserLike;
    return { playwright, browser };
  } catch (error) {
    return { error: `Failed to launch ${browserType}: ${toErrorMessage(error)}` };
  }
}

function createConsoleLogger(target: string[]): (message: PageConsoleMessage) => void {
  return (message) => {
    try {
      target.push(`[${message.type()}] ${message.text()}`);
    } catch {
      target.push(`[console] ${String(message)}`);
    }
  };
}

function createNetworkLogger(target: string[]): (request: PageRequest) => void {
  return (request) => {
    try {
      const resourceType = typeof request.resourceType === "function" ? request.resourceType() : "request";
      target.push(`[${request.method()}] ${resourceType} ${request.url()}`);
    } catch {
      target.push(`[request] ${String(request)}`);
    }
  };
}

async function captureFailureScreenshot(
  page: PageLike,
  outputDir: string,
  scenarioName: string,
  label: string,
  screenshots: string[],
): Promise<void> {
  const fileName = `${safeName(scenarioName)}-${safeName(label)}-failure.png`;
  const filePath = path.join(outputDir, fileName);
  try {
    await page.screenshot({ path: filePath, fullPage: true, type: "png" });
    screenshots.push(filePath);
  } catch {
    // ignore screenshot errors during failure handling
  }
}

async function executeStep(
  page: PageLike,
  step: TestStep,
  context: {
    baseUrl: string;
    outputDir: string;
    scenarioName: string;
    screenshots: string[];
    variables: Record<string, unknown>;
    scenarioTimeout?: number;
    runTimeout?: number;
    deadline?: number;
  },
): Promise<void> {
  const timeout = Math.min(
    stepTimeout(step, context.scenarioTimeout, context.runTimeout),
    remainingTimeout(context.deadline) ?? Number.POSITIVE_INFINITY,
  );

  switch (step.type) {
    case "navigate": {
      await page.goto(resolveUrl(step.url, context.baseUrl), { waitUntil: "load", timeout });
      return;
    }
    case "click": {
      const locator = page.locator(step.selector);
      await locator.click({ timeout });
      if (step.waitAfter && step.waitAfter > 0) await page.waitForTimeout(step.waitAfter);
      return;
    }
    case "type": {
      const locator = page.locator(step.selector);
      await locator.fill(step.value, { timeout });
      return;
    }
    case "select": {
      const locator = page.locator(step.selector);
      await locator.selectOption(step.value, { timeout });
      return;
    }
    case "screenshot": {
      const filePath = path.join(context.outputDir, `${safeName(context.scenarioName)}-${safeName(step.name)}.png`);
      await page.screenshot({ path: filePath, fullPage: true, type: "png" });
      context.screenshots.push(filePath);
      return;
    }
    case "assert-text": {
      const actual = await page.evaluate((selector: string) => {
        const el = document.querySelector(selector);
        return el?.textContent?.trim() ?? "";
      }, step.selector);
      if (actual !== step.expected) {
        throw new Error(`Expected text "${step.expected}", got "${actual}"`);
      }
      return;
    }
    case "assert-url": {
      const current = page.url();
      const expected = resolveExpectedUrl(step.expected, context.baseUrl);
      if (current !== expected) {
        throw new Error(`Expected URL "${expected}", got "${current}"`);
      }
      return;
    }
    case "assert-element": {
      await page.waitForSelector(step.selector, { state: "attached", timeout });
      return;
    }
    case "wait": {
      await page.waitForTimeout(step.ms);
      return;
    }
    case "wait-for-selector": {
      await page.waitForSelector(step.selector, { state: step.state ?? "visible", timeout });
      return;
    }
    case "evaluate": {
      const result = await page.evaluate((code: string) => {
        // Intentionally use Function for browser-side expression execution.
        // The caller controls the test scenario and code content.
        // eslint-disable-next-line no-new-func
        return Function(`return (${code});`)();
      }, step.code);
      if (step.storeAs) {
        context.variables[step.storeAs] = result;
      }
      return;
    }
    default: {
      const exhaustive: never = step;
      throw new Error(`Unsupported step: ${(exhaustive as { type: string }).type}`);
    }
  }
}

export async function runSingleScenario(
  browser: any,
  scenario: TestScenario,
  options: { outputDir: string; baseUrl: string },
): Promise<TestResult> {
  const start = Date.now();
  const screenshots: string[] = [];
  const consoleLogs: string[] = [];
  const networkLogs: string[] = [];
  const steps: TestResult["steps"] = [];
  const variables: Record<string, unknown> = {};
  const runTimeout = activeRunTimeout;
  const deadline = Date.now() + (scenario.timeout ?? runTimeout);

  let page: PageLike | null = null;
  let context: any = null;

  try {
    context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
    page = (await context.newPage()) as PageLike;

    if (typeof page.on === "function") {
      page.on("console", createConsoleLogger(consoleLogs));
      if (activeRecordNetwork) {
        page.on("request", createNetworkLogger(networkLogs));
      }
    }

    for (const step of scenario.steps) {
      const stepStart = Date.now();
      try {
        await runWithTimeout(
          executeStep(page, step, {
          baseUrl: options.baseUrl,
          outputDir: options.outputDir,
          scenarioName: scenario.name,
          screenshots,
          variables,
          scenarioTimeout: scenario.timeout,
          runTimeout,
          deadline,
          }),
          stepTimeout(step, scenario.timeout, runTimeout),
          `Step timed out after ${stepTimeout(step, scenario.timeout, runTimeout)}ms`,
        );
        steps.push({ step, success: true, duration: Date.now() - stepStart });
      } catch (error) {
        const message = toErrorMessage(error);
        await captureFailureScreenshot(page, options.outputDir, scenario.name, `step-${steps.length + 1}`, screenshots);
        steps.push({ step, success: false, error: message, duration: Date.now() - stepStart });
        throw new Error(message);
      }
    }

    return {
      scenarioName: scenario.name,
      success: true,
      steps,
      screenshots,
      consoleLogs: activeRecordNetwork ? [...consoleLogs, ...networkLogs] : consoleLogs,
      networkRequests: networkLogs.length,
      duration: Date.now() - start,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    if (page) {
      await captureFailureScreenshot(page, options.outputDir, scenario.name, "scenario", screenshots);
    }

    return {
      scenarioName: scenario.name,
      success: false,
      error: message,
      steps: steps.length > 0 ? steps : scenario.steps.map((step) => ({ step, success: false, error: message, duration: 0 })),
      screenshots,
      consoleLogs: activeRecordNetwork ? [...consoleLogs, ...networkLogs] : consoleLogs,
      networkRequests: networkLogs.length,
      duration: Date.now() - start,
    };
  } finally {
    try {
      await context?.close?.();
    } catch {
      // ignore close errors
    }
  }
}

export async function runPlaywrightTests(options: TestRunOptions): Promise<TestRunReport> {
  const timestamp = new Date().toISOString();
  const outputDir = path.resolve(options.outputDir ?? path.join(process.cwd(), "playwright-test-results"));
  await ensureDir(outputDir);

  const launcher = await launchBrowser(options);
  if ("error" in launcher) {
    const failedResults: TestResult[] = options.scenarios.map((scenario) => ({
      scenarioName: scenario.name,
      success: false,
      error: launcher.error,
      steps: scenario.steps.map((step) => ({ step, success: false, error: launcher.error, duration: 0 })),
      screenshots: [],
      consoleLogs: [],
      networkRequests: 0,
      duration: 0,
    }));
    const report: TestRunReport = {
      timestamp,
      total: failedResults.length,
      passed: 0,
      failed: failedResults.length,
      results: failedResults,
      summary: launcher.error,
      outputDir,
    };
    await fs.writeFile(path.join(outputDir, REPORT_FILENAME), JSON.stringify(report, null, 2), "utf8");
    await fs.writeFile(path.join(outputDir, SUMMARY_FILENAME), generateTestSummary(report), "utf8");
    return report;
  }

  const { browser } = launcher;
  const results: TestResult[] = [];
  const previousTimeout = activeRunTimeout;
  const previousRecordNetwork = activeRecordNetwork;
  activeRunTimeout = options.timeout ?? DEFAULT_TIMEOUT;
  activeRecordNetwork = options.recordNetwork ?? false;

  try {
    for (const scenario of options.scenarios) {
      const result = await runSingleScenario(browser, scenario, {
        outputDir,
        baseUrl: options.targetUrl,
      } as { outputDir: string; baseUrl: string });
      results.push(result);
    }
  } finally {
    activeRunTimeout = previousTimeout;
    activeRecordNetwork = previousRecordNetwork;
    try {
      await browser.close();
    } catch {
      // ignore close errors
    }
  }

  const report: TestRunReport = {
    timestamp,
    total: results.length,
    passed: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    results,
    summary: "",
    outputDir,
  };
  report.summary = generateTestSummary(report);

  await fs.writeFile(path.join(outputDir, REPORT_FILENAME), JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(path.join(outputDir, SUMMARY_FILENAME), report.summary, "utf8");

  return report;
}

export function generateTestSummary(report: TestRunReport): string {
  const failures = report.results.filter((result) => !result.success);
  const parts = [`${report.passed}/${report.total} passed`, `${report.failed} failed`, `output: ${report.outputDir}`];
  if (failures.length > 0) {
    parts.push(`first failure: ${failures[0]?.scenarioName ?? "unknown"}`);
  }
  return parts.join(" | ");
}
