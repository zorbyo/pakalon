/**
 * Phase 4: Security subagent results emitter.
 *
 * Writes the whitebox_testing.xml and blackbox_testing.xml files
 * per the spec layout. Accepts the parsed findings from each of
 * the 5 security subagents and produces the canonical XML schema.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
	id: string;
	severity: Severity;
	tool: string; // semgrep, zap, bandit, ...
	file: string;
	line?: number;
	cwe?: string;
	description: string;
	remediation: string;
}

export interface SubagentReport {
	role: string; // SAST | DAST | CodeReview | CI-CD | Pentest
	startedAt: string;
	completedAt: string;
	status: "completed" | "failed";
	findings: Finding[];
}

export function severityRank(s: Severity): number {
	return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[s];
}

export function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Whitebox XML: one `<section>` per module, `<test>` per function
 * path, `<assert>` per invariant. Findings are nested under the
 * appropriate test.
 */
export function buildWhiteboxXml(reports: SubagentReport[], projectName: string): string {
	const findingsByTool = groupBy(
		reports.flatMap(r => r.findings),
		f => f.tool,
	);
	const sections: string[] = [];
	for (const [tool, findings] of findingsByTool) {
		const fileSet = new Set(findings.map(f => f.file));
		const sectionXml: string[] = [`<section name="${escapeXml(tool)}">`];
		for (const file of fileSet) {
			const fileFindings = findings.filter(f => f.file === file);
			sectionXml.push(`  <module name="${escapeXml(file)}">`);
			for (const f of fileFindings) {
				sectionXml.push(
					`    <test id="${escapeXml(f.id)}" severity="${f.severity}"${f.cwe ? ` cwe="${escapeXml(f.cwe)}"` : ""}>`,
				);
				if (typeof f.line === "number") {
					sectionXml.push(`      <location line="${f.line}"/>`);
				}
				sectionXml.push(`      <description>${escapeXml(f.description)}</description>`);
				sectionXml.push(`      <remediation>${escapeXml(f.remediation)}</remediation>`);
				sectionXml.push(`    </test>`);
			}
			sectionXml.push(`  </module>`);
		}
		sectionXml.push(`</section>`);
		sections.push(sectionXml.join("\n"));
	}
	return `<?xml version="1.0" encoding="UTF-8"?>
<whitebox_testing>
  <header>
    <project>${escapeXml(projectName)}</project>
    <date>${new Date().toISOString().slice(0, 10)}</date>
    <version>1.0</version>
  </header>
  <sections>
${sections.join("\n")}
  </sections>
</whitebox_testing>`;
}

/**
 * Blackbox XML: one `<user_stories>` block, `<story>` per US-001
 * acceptance criterion, `<scenario>` per scenario.
 */
export function buildBlackboxXml(reports: SubagentReport[], userStories: string[]): string {
	const storyBlocks = userStories.map((s, i) => {
		const id = `US-${String(i + 1).padStart(3, "0")}`;
		const scenarios = (s.match(/\b(Given|When|Then)[^\n]*/g) ?? []).map((sc, j) => {
			return `      <scenario id="${id}-SC${j + 1}">${escapeXml(sc.trim())}</scenario>`;
		});
		return [
			`  <story id="${id}" name="${escapeXml(s.slice(0, 60))}" status="pending">`,
			...scenarios,
			`  </story>`,
		].join("\n");
	});
	const totals = countBySeverity(reports.flatMap(r => r.findings));
	const summaryXml = Object.entries(totals)
		.map(([sev, n]) => `    <${sev}>${n}</${sev}>`)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<blackbox_testing>
  <header>
    <project>${escapeXml(reports[0]?.role ?? "Pakalon Project")}</project>
    <date>${new Date().toISOString().slice(0, 10)}</date>
    <version>1.0</version>
  </header>
  <summary>
${summaryXml}
  </summary>
  <user_stories>
${storyBlocks.join("\n")}
  </user_stories>
</blackbox_testing>`;
}

export function emitPhase4Files(
	phase4Dir: string,
	projectName: string,
	reports: SubagentReport[],
	userStories: string[],
): void {
	fs.mkdirSync(phase4Dir, { recursive: true });
	for (let i = 0; i < reports.length; i++) {
		const r = reports[i]!;
		const md = renderSubagentMd(r, i + 1);
		fs.writeFileSync(path.join(phase4Dir, `subagent-${i + 1}.md`), md, "utf-8");
	}
	fs.writeFileSync(path.join(phase4Dir, "whitebox_testing.xml"), buildWhiteboxXml(reports, projectName), "utf-8");
	fs.writeFileSync(path.join(phase4Dir, "blackbox_testing.xml"), buildBlackboxXml(reports, userStories), "utf-8");
	logger.info("Phase 4 emitted", { reports: reports.length });
}

function renderSubagentMd(r: SubagentReport, idx: number): string {
	const totals = countBySeverity(r.findings);
	const rows = r.findings
		.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
		.map(
			f =>
				`| ${f.id} | ${f.severity} | ${f.file}${typeof f.line === "number" ? `:${f.line}` : ""} | ${f.description} |`,
		)
		.join("\n");
	return [
		`# Phase 4: ${r.role} (subagent ${idx})`,
		``,
		`## Status: ${r.status}`,
		``,
		`Started: ${r.startedAt}`,
		`Completed: ${r.completedAt}`,
		``,
		`## Findings (${r.findings.length})`,
		``,
		`| ID | Severity | File | Description |`,
		`|----|----------|------|-------------|`,
		rows,
		``,
		`## Summary`,
		``,
		...Object.entries(totals).map(([k, v]) => `- ${k}: ${v}`),
		``,
		`## Recommendations`,
		``,
		...Array.from(new Set(r.findings.map(f => f.remediation))),
	].join("\n");
}

function groupBy<T, K>(arr: T[], fn: (t: T) => K): Map<K, T[]> {
	const m = new Map<K, T[]>();
	for (const t of arr) {
		const k = fn(t);
		const list = m.get(k) ?? [];
		list.push(t);
		m.set(k, list);
	}
	return m;
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
	const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
	for (const f of findings) c[f.severity]++;
	return c;
}
