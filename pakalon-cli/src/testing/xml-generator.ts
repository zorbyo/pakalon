/**
 * Blackbox/Whitebox Testing XML Export
 * Generates XML test reports from test results
 */

export interface TestCase {
  id: string;
  name: string;
  description?: string;
  type: "blackbox" | "whitebox" | "unit" | "integration" | "e2e";
  status: "passed" | "failed" | "skipped" | "error";
  duration?: number;
  error?: string;
  codeCoverage?: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
}

export interface TestSuite {
  id: string;
  name: string;
  description?: string;
  tests: TestCase[];
  timestamp: string;
}

export interface TestReport {
  suites: TestSuite[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    duration?: number;
  };
}

export function generateJUnitXML(report: TestReport): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<testsuites>');

  const total = report.summary;
  lines.push(`  <testsuite name="All Tests" tests="${total.total}" failures="${total.failed}" errors="${total.errors}" skipped="${total.skipped}" time="${total.duration ?? 0}">`);

  for (const suite of report.suites) {
    lines.push(`    <testsuite name="${escapeXML(suite.name)}" tests="${suite.tests.length}" time="${suite.tests.reduce((acc, t) => acc + (t.duration ?? 0), 0)}">`);

    for (const test of suite.tests) {
      const testTime = test.duration ?? 0;
      const failureElement = test.status === "failed" || test.status === "error"
        ? `>\n        <failure message="${escapeXML(test.error ?? "Test failed")}"/>\n      </testcase`
        : ">";

      lines.push(`      <testcase name="${escapeXML(test.name)}" classname="${escapeXML(suite.name)}" time="${testTime}">`);
      lines.push(`      ${failureElement}`);
    }

    lines.push(`    </testsuite>`);
  }

  lines.push(`  </testsuite>`);
  lines.push(`</testsuites>`);

  return lines.join("\n");
}

export function generateTestNGXML(report: TestReport): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<suite name="Test Suite">');

  for (const suite of report.suites) {
    lines.push(`  <test name="${escapeXML(suite.name)}">`);
    lines.push(`    <classes>`);

    for (const test of suite.tests) {
      const status = test.status === "passed" ? "PASS" : test.status === "skipped" ? "SKIP" : "FAIL";
      lines.push(`      <class name="${escapeXML(test.name)}" status="${status}">`);
      lines.push(`        <methods>`);
      lines.push(`          <method signature="${escapeXML(test.name)}" name="${escapeXML(test.name)}">`);
      lines.push(`            <run>${test.status}</run>`);
      lines.push(`          </method>`);
      lines.push(`        </methods>`);
      lines.push(`      </class>`);
    }

    lines.push(`    </classes>`);
    lines.push(`  </test>`);
  }

  lines.push(`</suite>`);
  return lines.join("\n");
}

export function generateCoverageXML(report: TestReport): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<coverage>');

  for (const suite of report.suites) {
    lines.push(`  <package name="${escapeXML(suite.name)}">`);

    for (const test of suite.tests) {
      if (test.codeCoverage) {
        const cov = test.codeCoverage;
        lines.push(`    <file name="${escapeXML(test.id)}">`);
        lines.push(`      <line num="1" type="stmt" count="${cov.statements}" />`);
        lines.push(`      <line num="1" type="method" count="${cov.functions}" />`);
        lines.push(`      <line num="1" type="branch" count="${cov.branches}" />`);
        lines.push(`    </file>`);
      }
    }

    lines.push(`  </package>`);
  }

  lines.push(`</coverage>`);
  return lines.join("\n");
}

export function generateCloverXML(report: TestReport): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<coverage generated="' + new Date().toISOString() + '">');
  lines.push(`  <project timestamp="${Date.now()}">`);
  lines.push(`    <metrics packages="${report.suites.length}" files="${report.suites.length}" classes="${report.summary.total}" methods="${report.summary.total}" coveredmethods="${report.summary.passed}" elements="${report.summary.total}" coveredelements="${report.summary.passed}" />`);

  for (const suite of report.suites) {
    lines.push(`    <package name="${escapeXML(suite.name)}">`);
    lines.push(`      <metrics package="${escapeXML(suite.name)}" files="${suite.tests.length}" classes="${suite.tests.length}" methods="${suite.tests.length}" />`);

    for (const test of suite.tests) {
      lines.push(`      <file name="${escapeXML(test.id)}" path="${escapeXML(test.id)}">`);
      lines.push(`        <metrics file="${escapeXML(test.id)}" classes="${test.status === "passed" ? 1 : 0}" methods="${test.status === "passed" ? 1 : 0}" />`);
      lines.push(`        <line num="1" type="stmt" count="${test.status === "passed" ? 1 : 0}" />`);
      lines.push(`      </file>`);
    }

    lines.push(`    </package>`);
  }

  lines.push(`  </project>`);
  lines.push(`</coverage>`);
  return lines.join("\n");
}

export function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function writeTestReportXML(report: TestReport, outputPath: string, format: "junit" | "testng" | "coverage" | "clover" = "junit"): string {
  let xml: string;

  switch (format) {
    case "testng":
      xml = generateTestNGXML(report);
      break;
    case "coverage":
      xml = generateCoverageXML(report);
      break;
    case "clover":
      xml = generateCloverXML(report);
      break;
    case "junit":
    default:
      xml = generateJUnitXML(report);
  }

  return xml;
}

export function createTestSuiteFromVitest(results: any): TestSuite {
  const tests: TestCase[] = [];

  for (const [file, data] of Object.entries(results)) {
    const fileData = data as any;
    for (const test of fileData?.tests ?? []) {
      tests.push({
        id: test.id ?? `${file}_${test.name}`,
        name: test.name,
        type: test.type ?? "unit",
        status: test.status === "pass" ? "passed" : test.status === "skip" ? "skipped" : "failed",
        duration: test.duration,
        error: test.error,
      });
    }
  }

  return {
    id: "vitest",
    name: "Vitest Suite",
    tests,
    timestamp: new Date().toISOString(),
  };
}

export function createTestSuiteFromJest(results: any): TestSuite {
  const tests: TestCase[] = [];

  for (const test of results?.testResults ?? []) {
    for (const assertion of test.assertionResults ?? []) {
      tests.push({
        id: assertion.fullName ?? assertion.title,
        name: assertion.title,
        type: "unit",
        status: assertion.status === "passed" ? "passed" : assertion.status === "skipped" ? "skipped" : "failed",
        duration: assertion.duration,
        error: assertion.failureMessages?.[0],
      });
    }
  }

  return {
    id: "jest",
    name: "Jest Suite",
    tests,
    timestamp: new Date().toISOString(),
  };
}

export { generateJUnitXML as default };