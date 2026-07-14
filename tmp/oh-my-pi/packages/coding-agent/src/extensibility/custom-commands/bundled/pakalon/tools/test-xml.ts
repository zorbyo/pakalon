// ============================================================================
// Types
// ============================================================================

export interface TestSuite {
	name: string;
	tests: TestCase[];
	timestamp: string;
	time_ms: number;
}

export interface TestCase {
	name: string;
	classname: string;
	status: "passed" | "failed" | "skipped" | "error";
	time_ms: number;
	message?: string;
	stdout?: string;
	stderr?: string;
}

export interface TestSummary {
	total: number;
	passed: number;
	failed: number;
	skipped: number;
	errors: number;
	time_ms: number;
}

// ============================================================================
// XML Generator
// ============================================================================

export function generateTestXML(suites: TestSuite[]): string {
	let totalTests = 0;
	let totalFailures = 0;
	let totalErrorsAcc = 0;
	let totalTime = 0;

	for (const suite of suites) {
		totalTests += suite.tests.length;
		totalFailures += suite.tests.filter(t => t.status === "failed").length;
		totalErrorsAcc += suite.tests.filter(t => t.status === "error").length;
		totalTime += suite.time_ms;
	}

	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<testsuites timestamp="${new Date().toISOString()}" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrorsAcc}" time="${(totalTime / 1000).toFixed(3)}">`,
	];

	for (const suite of suites) {
		const failures = suite.tests.filter(t => t.status === "failed").length;
		const errors = suite.tests.filter(t => t.status === "error").length;
		const skipped = suite.tests.filter(t => t.status === "skipped").length;

		lines.push(
			`  <testsuite name="${escapeXml(suite.name)}" tests="${suite.tests.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${(suite.time_ms / 1000).toFixed(3)}">`,
		);

		for (const test of suite.tests) {
			lines.push(
				`    <testcase name="${escapeXml(test.name)}" classname="${escapeXml(test.classname)}" time="${(test.time_ms / 1000).toFixed(3)}">`,
			);

			if (test.status === "failed") {
				lines.push(
					`      <failure message="${escapeXml(test.message ?? "Test failed")}">`,
					test.stdout ? `        <![CDATA[${test.stdout}]]>` : "",
					`      </failure>`,
				);
			} else if (test.status === "error") {
				lines.push(
					`      <error message="${escapeXml(test.message ?? "Test error")}">`,
					test.stderr ? `        <![CDATA[${test.stderr}]]>` : "",
					`      </error>`,
				);
			} else if (test.status === "skipped") {
				lines.push(`      <skipped message="${escapeXml(test.message ?? "Skipped")}"/>`);
			}

			if (test.stdout) {
				lines.push(`      <system-out><![CDATA[${test.stdout}]]></system-out>`);
			}
			if (test.stderr) {
				lines.push(`      <system-err><![CDATA[${test.stderr}]]></system-err>`);
			}

			lines.push(`    </testcase>`);
		}

		lines.push(`  </testsuite>`);
	}

	lines.push(`</testsuites>`);

	return lines.join("\n");
}

// ============================================================================
// Summary Generator
// ============================================================================

export function generateTestSummary(suites: TestSuite[]): TestSummary {
	let total = 0;
	let passed = 0;
	let failed = 0;
	let skipped = 0;
	let errors = 0;
	let time_ms = 0;

	for (const suite of suites) {
		for (const test of suite.tests) {
			total++;
			time_ms += test.time_ms;

			switch (test.status) {
				case "passed":
					passed++;
					break;
				case "failed":
					failed++;
					break;
				case "skipped":
					skipped++;
					break;
				case "error":
					errors++;
					break;
			}
		}
	}

	return { total, passed, failed, skipped, errors, time_ms };
}

// ============================================================================
// Report Builder
// ============================================================================

export function buildTestReport(suites: TestSuite[]): string {
	const summary = generateTestSummary(suites);

	const lines = [
		"# Test Report",
		"",
		`Generated: ${new Date().toISOString()}`,
		"",
		"## Summary",
		`- Total: ${summary.total}`,
		`- Passed: ${summary.passed}`,
		`- Failed: ${summary.failed}`,
		`- Skipped: ${summary.skipped}`,
		`- Errors: ${summary.errors}`,
		`- Time: ${(summary.time_ms / 1000).toFixed(2)}s`,
		"",
		"## Results",
		summary.failed === 0 && summary.errors === 0
			? "✅ **ALL TESTS PASSED**"
			: `❌ **${summary.failed + summary.errors} TESTS FAILED**`,
		"",
	];

	for (const suite of suites) {
		lines.push(`### ${suite.name}`);
		for (const test of suite.tests) {
			const icon =
				test.status === "passed" ? "✅" : test.status === "failed" ? "❌" : test.status === "skipped" ? "⏭️" : "💥";
			lines.push(`- ${icon} ${test.name} (${(test.time_ms / 1000).toFixed(3)}s)`);
			if (test.message && test.status !== "passed") {
				lines.push(`  - ${test.message}`);
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ============================================================================
// Helpers
// ============================================================================

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

// ============================================================================
// Prompt Builder
// ============================================================================

export function buildTestXMLPrompt(): string {
	return `You are the Pakalon Test Reporter Agent. Your task is to generate structured XML test results.

## Tasks
1. Read test output from the current phase
2. Parse test results into structured TestCase objects
3. Generate JUnit-compatible XML output
4. Save XML to \`.pakalon-agents/ai-agents/phase-4/test-results.xml\`
5. Generate a human-readable test report

## XML Format
Use standard JUnit XML format:
\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="..." tests="N" failures="N" errors="N" skipped="N" time="N">
    <testcase name="..." classname="..." time="N">
      <failure message="...">...</failure>
    </testcase>
  </testsuite>
</testsuites>
\`\`\`

## Output
Save both:
- \`test-results.xml\` — JUnit XML for CI/CD
- \`test-report.md\` — Human-readable summary`;
}
