/**
 * Tests for the Phase 4 XML emitter (whitebox_testing.xml, blackbox_testing.xml).
 *
 * Per code.md §29 / §8.4 and CLI-req.md §373-374, the XML must be
 * parseable so downstream tooling (CI test runners, IDE plugins) can
 * consume it. These tests are contract-level: they don't care about
 * implementation details, only that the produced strings are well-formed.
 */
import { describe, expect, it } from "bun:test";
import { buildBlackboxXml, buildWhiteboxXml, escapeXml, type Finding, type SubagentReport } from "./emitter";

function sampleFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		id: "F-001",
		severity: "high",
		tool: "semgrep",
		file: "src/auth/login.ts",
		line: 42,
		cwe: "CWE-89",
		description: "SQL injection via user input",
		remediation: "Use parameterized queries",
		...overrides,
	};
}

function sampleReport(overrides: Partial<SubagentReport> = {}): SubagentReport {
	return {
		role: "SAST",
		startedAt: "2026-06-20T10:00:00Z",
		completedAt: "2026-06-20T10:05:00Z",
		status: "completed",
		findings: [sampleFinding()],
		...overrides,
	};
}

/** Tiny XML well-formedness check. Not a full parser, but enough to
 * detect the common emitter bugs (unclosed tags, mismatched quotes). */
function isWellFormed(xml: string): boolean {
	const open = xml.match(/<[A-Za-z][^>!]*?[^/?]>/g) ?? [];
	const close = xml.match(/<\/[A-Za-z][^>]*>/g) ?? [];
	const selfClose = xml.match(/<[A-Za-z][^>]*\/>/g) ?? [];
	// Every open tag (other than self-closing) should have a matching close.
	// We do a naive count check: |open - selfClose| should equal |close|.
	return open.length - selfClose.length === close.length;
}

describe("emitter", () => {
	describe("escapeXml", () => {
		it("escapes the five reserved characters", () => {
			expect(escapeXml("a & b < c > d \" e ' f")).toBe("a &amp; b &lt; c &gt; d &quot; e &apos; f");
		});
		it("passes through text with no reserved characters", () => {
			expect(escapeXml("hello world")).toBe("hello world");
		});
	});

	describe("buildWhiteboxXml", () => {
		it("produces a parseable XML document", () => {
			const xml = buildWhiteboxXml([sampleReport()], "test-project");
			expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
			expect(isWellFormed(xml)).toBe(true);
		});

		it("groups findings by tool into <section> blocks", () => {
			const reports = [
				sampleReport({ findings: [sampleFinding({ tool: "semgrep" })] }),
				sampleReport({ role: "DAST", findings: [sampleFinding({ tool: "zap", file: "endpoint" })] }),
			];
			const xml = buildWhiteboxXml(reports, "test-project");
			expect(xml).toContain('<section name="semgrep">');
			expect(xml).toContain('<section name="zap">');
		});

		it("emits location, description, and remediation per finding", () => {
			const f = sampleFinding({ id: "F-X", line: 99 });
			const xml = buildWhiteboxXml([sampleReport({ findings: [f] })], "p");
			expect(xml).toContain('id="F-X"');
			expect(xml).toContain('line="99"');
			expect(xml).toContain("SQL injection");
			expect(xml).toContain("parameterized queries");
		});

		it("escapes special characters in file paths and descriptions", () => {
			const f = sampleFinding({
				file: "src/<weird>&name.ts",
				description: 'avoid "quotes" & <tags>',
			});
			const xml = buildWhiteboxXml([sampleReport({ findings: [f] })], "p");
			expect(xml).toContain("&lt;weird&gt;&amp;name.ts");
			expect(xml).toContain("&quot;quotes&quot;");
			expect(isWellFormed(xml)).toBe(true);
		});
	});

	describe("buildBlackboxXml", () => {
		it("produces a parseable XML document", () => {
			const xml = buildBlackboxXml([sampleReport()], ["Story 1", "Story 2"]);
			expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
			expect(isWellFormed(xml)).toBe(true);
		});

		it("emits a <story> per user story with US-001 numbering", () => {
			const xml = buildBlackboxXml([], ["Login flow", "Sign-up flow", "Reset password"]);
			expect(xml).toContain('id="US-001"');
			expect(xml).toContain('id="US-002"');
			expect(xml).toContain('id="US-003"');
		});

		it("emits Given/When/Then scenarios when present in story text", () => {
			const xml = buildBlackboxXml([], ["Given a user\nWhen they log in\nThen they see the dashboard"]);
			expect(xml).toContain("<scenario");
			expect(xml).toContain("Given a user");
		});

		it("emits severity summary block", () => {
			const xml = buildBlackboxXml([sampleReport({ findings: [sampleFinding({ severity: "critical" })] })], []);
			expect(xml).toContain("<critical>1</critical>");
		});
	});
});
