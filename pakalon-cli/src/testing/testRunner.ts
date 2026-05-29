/**
 * Test Runner - Executes and validates XML test definitions
 * Parses XML test files and runs test cases against the application
 */

import * as path from "path";
import * as fs from "fs/promises";
import type {
  TestCase,
  TestStatus,
  TestRunnerConfig,
  TestRunnerResult,
  TestSuiteResult,
  TestCaseResult,
  TestSummary,
  TestMetadata,
} from "./testTypes.js";

interface ParsedTestSuite {
  id: string;
  name: string;
  type: string;
  description: string;
  tests: ParsedTestCase[];
}

interface ParsedTestCase {
  id: string;
  name: string;
  severity: string;
  status: string;
  component?: string;
  userStory?: string;
  codePath?: string;
  description: string;
  preconditions: string[];
  steps: string[];
  expectedResults: string[];
  tags: string[];
  error?: string;
}

interface ParsedXml {
  metadata: TestMetadata;
  suites: ParsedTestSuite[];
  summary: TestSummary;
}

export class TestRunner {
  private config: TestRunnerConfig;

  constructor(config: TestRunnerConfig) {
    this.config = config;
  }

  public async run(): Promise<TestRunnerResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    const whiteboxContent = await this.loadXmlFile(this.config.whiteboxXmlPath);
    const blackboxContent = await this.loadXmlFile(this.config.blackboxXmlPath);

    const whiteboxParsed = this.parseXml(whiteboxContent);
    const blackboxParsed = this.parseXml(blackboxContent);

    const whiteboxResults = await this.runSuites(whiteboxParsed.suites, "whitebox");
    const blackboxResults = await this.runSuites(blackboxParsed.suites, "blackbox");

    const summary = this.calculateResultsSummary([...whiteboxResults, ...blackboxResults]);

    return {
      success: summary.failed === 0 && summary.error === 0,
      whiteboxResults,
      blackboxResults,
      summary,
      duration: Date.now() - startTime,
      errors,
    };
  }

  public async validateXml(xmlPath: string): Promise<{ valid: boolean; errors: string[] }> {
    const content = await this.loadXmlFile(xmlPath);
    const errors: string[] = [];

    if (!content.trim().startsWith("<?xml")) {
      errors.push("Missing XML declaration");
    }

    if (!content.includes("encoding=")) {
      errors.push("Missing encoding declaration");
    }

    const hasRootTag =
      content.includes("<whitebox-tests") || content.includes("<blackbox-tests");
    if (!hasRootTag) {
      errors.push("Missing root element (whitebox-tests or blackbox-tests)");
    }

    if (!content.includes("schemaVersion=")) {
      errors.push("Missing schemaVersion attribute");
    }

    if (!content.includes("<metadata>")) {
      errors.push("Missing metadata section");
    }

    if (!content.includes("<summary>")) {
      errors.push("Missing summary section");
    }

    const testTags = this.extractTagCount(content, "<test ");
    if (testTags === 0) {
      errors.push("No test cases found");
    }

    const unclosedTags = this.findUnclosedTags(content);
    if (unclosedTags.length > 0) {
      errors.push(`Unclosed tags: ${unclosedTags.join(", ")}`);
    }

    return { valid: errors.length === 0, errors };
  }

  private async loadXmlFile(xmlPath: string): Promise<string> {
    try {
      return await fs.readFile(xmlPath, "utf8");
    } catch (error) {
      throw new Error(`Failed to load XML file: ${xmlPath} - ${error}`);
    }
  }

  private parseXml(content: string): ParsedXml {
    const suites: ParsedTestSuite[] = [];
    const metadata: TestMetadata = {
      timestamp: "",
      project: "",
      phase: 4,
      generator: "",
      schemaVersion: "1.0",
    };
    const summary: TestSummary = {
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      error: 0,
      duration: 0,
      criticalFailures: 0,
      highFailures: 0,
    };

    const metadataMatch = content.match(/<metadata>([\s\S]*?)<\/metadata>/);
    if (metadataMatch && metadataMatch[1]) {
      const metaContent = metadataMatch[1];
      const ts = metaContent.match(/<timestamp>(.*?)<\/timestamp>/);
      const proj = metaContent.match(/<project>(.*?)<\/project>/);
      const phase = metaContent.match(/<phase>(.*?)<\/phase>/);
      const gen = metaContent.match(/<generator>(.*?)<\/generator>/);
      const schema = metaContent.match(/<schemaVersion>(.*?)<\/schemaVersion>/);

      if (ts && ts[1]) metadata.timestamp = ts[1];
      if (proj && proj[1]) metadata.project = proj[1];
      if (phase && phase[1]) metadata.phase = parseInt(phase[1], 10);
      if (gen && gen[1]) metadata.generator = gen[1];
      if (schema && schema[1]) metadata.schemaVersion = schema[1] as "1.0";
    }

    const suiteRegex = /<test-suite([^>]*?)>([\s\S]*?)<\/test-suite>/g;
    let suiteMatch: RegExpExecArray | null;
    while ((suiteMatch = suiteRegex.exec(content)) !== null) {
      const attrs = suiteMatch[1] ?? "";
      const body = suiteMatch[2] ?? "";

      const id = this.extractAttr(attrs, "id") || "";
      const name = this.extractAttr(attrs, "name") || "";
      const type = this.extractAttr(attrs, "type") || "";
      const descMatch = body.match(/<description>(.*?)<\/description>/);
      const description = descMatch && descMatch[1] ? descMatch[1] : "";

      const tests: ParsedTestCase[] = [];
      const testRegex = /<test([^>]*?)>([\s\S]*?)<\/test>/g;
      let testMatch: RegExpExecArray | null;
      while ((testMatch = testRegex.exec(body)) !== null) {
        const testAttrs = testMatch[1] ?? "";
        const testBody = testMatch[2] ?? "";
        tests.push(this.parseTestCase(testAttrs, testBody));
      }

      const subsectionRegex = /<subsection[^>]*?>([\s\S]*?)<\/subsection>/g;
      let subsectionMatch: RegExpExecArray | null;
      while ((subsectionMatch = subsectionRegex.exec(body)) !== null) {
        const subsectionBody = subsectionMatch[1] ?? "";
        const subTestRegex = /<test([^>]*?)>([\s\S]*?)<\/test>/g;
        let subTestMatch: RegExpExecArray | null;
        while ((subTestMatch = subTestRegex.exec(subsectionBody)) !== null) {
          const subTestAttrs = subTestMatch[1] ?? "";
          const subTestBody = subTestMatch[2] ?? "";
          tests.push(this.parseTestCase(subTestAttrs, subTestBody));
        }
      }

      suites.push({ id, name, type, description, tests });
    }

    const summaryMatch = content.match(/<summary>([\s\S]*?)<\/summary>/);
    if (summaryMatch && summaryMatch[1]) {
      const summaryContent = summaryMatch[1];
      const extract = (tag: string) => {
        const match = summaryContent.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
        return match && match[1] ? parseInt(match[1], 10) : 0;
      };

      summary.totalTests = extract("totalTests");
      summary.passed = extract("passed");
      summary.failed = extract("failed");
      summary.skipped = extract("skipped");
      summary.pending = extract("pending");
      summary.error = extract("error");
      summary.criticalFailures = extract("criticalFailures");
      summary.highFailures = extract("highFailures");
    }

    return { metadata, suites, summary };
  }

  private parseTestCase(attrs: string, body: string): ParsedTestCase {
    const testCase: ParsedTestCase = {
      id: this.extractAttr(attrs, "id") || "",
      name: this.extractAttr(attrs, "name") || "",
      severity: this.extractAttr(attrs, "severity") || "medium",
      status: this.extractAttr(attrs, "status") || "pending",
      component: this.extractAttr(attrs, "component"),
      userStory: this.extractAttr(attrs, "userStory"),
      codePath: this.extractAttr(attrs, "codePath"),
      description: "",
      preconditions: [],
      steps: [],
      expectedResults: [],
      tags: [],
    };

    const descMatch = body.match(/<description>(.*?)<\/description>/);
    if (descMatch && descMatch[1]) testCase.description = descMatch[1];

    const errorMatch = body.match(/<error>(.*?)<\/error>/);
    if (errorMatch && errorMatch[1]) testCase.error = errorMatch[1];

    testCase.preconditions = this.extractList(body, "condition");
    testCase.steps = this.extractList(body, "step");
    testCase.expectedResults = this.extractList(body, "result");
    testCase.tags = this.extractList(body, "tag");

    return testCase;
  }

  private async runSuites(
    suites: ParsedTestSuite[],
    suiteType: string,
  ): Promise<TestSuiteResult[]> {
    const results: TestSuiteResult[] = [];

    for (const suite of suites) {
      const suiteStartTime = Date.now();
      const testResults: TestCaseResult[] = [];

      for (const testCase of suite.tests) {
        const testResult = await this.runTestCase(testCase);
        testResults.push(testResult);
      }

      results.push({
        suiteId: suite.id,
        suiteName: suite.name,
        results: testResults,
        duration: Date.now() - suiteStartTime,
      });
    }

    return results;
  }

  private async runTestCase(testCase: ParsedTestCase): Promise<TestCaseResult> {
    const startTime = Date.now();
    let status: TestStatus = testCase.status as TestStatus;
    let error: string | undefined;

    if (status === "pending") {
      status = "skipped";
    }

    if (testCase.error && status === "failed") {
      error = testCase.error;
    }

    if (testCase.codePath && status !== "skipped") {
      try {
        const fullPath = path.isAbsolute(testCase.codePath)
          ? testCase.codePath
          : path.join(this.config.projectDir, testCase.codePath);

        const exists = await fs
          .access(fullPath)
          .then(() => true)
          .catch(() => false);

        if (!exists && testCase.severity === "critical") {
          status = "error";
          error = `Code path not found: ${fullPath}`;
        }
      } catch {
        // File check failed, keep current status
      }
    }

    return {
      testId: testCase.id,
      testName: testCase.name,
      status,
      duration: Date.now() - startTime,
      error,
      evidence: error ? [error] : undefined,
    };
  }

  private calculateResultsSummary(suiteResults: TestSuiteResult[]): TestSummary {
    const summary: TestSummary = {
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      error: 0,
      duration: 0,
      criticalFailures: 0,
      highFailures: 0,
    };

    for (const suite of suiteResults) {
      for (const result of suite.results) {
        summary.totalTests++;
        summary.duration += result.duration || 0;

        switch (result.status) {
          case "passed":
            summary.passed++;
            break;
          case "failed":
            summary.failed++;
            break;
          case "skipped":
            summary.skipped++;
            break;
          case "pending":
            summary.pending++;
            break;
          case "error":
            summary.error++;
            break;
        }
      }
    }

    return summary;
  }

  private extractAttr(attrs: string, name: string): string | undefined {
    const regex = new RegExp(`${name}="([^"]*)"`);
    const match = attrs.match(regex);
    return match ? match[1] : undefined;
  }

  private extractList(content: string, tagName: string): string[] {
    const items: string[] = [];
    const regex = new RegExp(`<${tagName}[^>]*?>(.*?)</${tagName}>`, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) items.push(match[1]);
    }
    return items;
  }

  private extractTagCount(content: string, tagPattern: string): number {
    const regex = new RegExp(tagPattern, "g");
    const matches = content.match(regex);
    return matches ? matches.length : 0;
  }

  private findUnclosedTags(content: string): string[] {
    const unclosed: string[] = [];
    const tagRegex = /<([a-zA-Z][\w-]*)[^>]*\/?>/g;
    const closingTagRegex = /<\/([a-zA-Z][\w-]*)>/g;

    const openTags = new Map<string, number>();
    const closeTags = new Map<string, number>();

    const selfClosingTags = new Set([
      "br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr",
    ]);

    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1];
      if (!tag) continue;
      if (selfClosingTags.has(tag.toLowerCase())) continue;
      if (match[0].endsWith("/>")) continue;
      if (["metadata", "test", "summary"].includes(tag)) continue;
      openTags.set(tag, (openTags.get(tag) || 0) + 1);
    }

    while ((match = closingTagRegex.exec(content)) !== null) {
      const tag = match[1];
      if (!tag) continue;
      closeTags.set(tag, (closeTags.get(tag) || 0) + 1);
    }

    for (const entry of Array.from(openTags.entries())) {
      const tag = entry[0];
      const openCount = entry[1];
      const closeCount = closeTags.get(tag) || 0;
      if (openCount > closeCount) {
        unclosed.push(tag);
      }
    }

    return unclosed;
  }
}

export async function runTests(config: TestRunnerConfig): Promise<TestRunnerResult> {
  const runner = new TestRunner(config);
  return runner.run();
}

export async function validateTestFiles(
  whiteboxPath: string,
  blackboxPath: string,
): Promise<{ whitebox: { valid: boolean; errors: string[] }; blackbox: { valid: boolean; errors: string[] } }> {
  const runner = new TestRunner({
    projectDir: process.cwd(),
    outputDir: path.dirname(whiteboxPath),
    whiteboxXmlPath: whiteboxPath,
    blackboxXmlPath: blackboxPath,
  });

  const [whitebox, blackbox] = await Promise.all([
    runner.validateXml(whiteboxPath),
    runner.validateXml(blackboxPath),
  ]);

  return { whitebox, blackbox };
}
