/**
 * Security scanning tool.
 *
 * Handles SAST (Semgrep), DAST (OWASP ZAP), dependency scanning,
 * and container security analysis during Phase 4.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { SecurityTool } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface ScanResult {
	tool: SecurityTool;
	success: boolean;
	findings: SecurityFinding[];
	summary: string;
	duration_ms: number;
	raw_output?: string;
}

export interface SecurityFinding {
	id: string;
	severity: "critical" | "high" | "medium" | "low" | "info";
	category: string;
	title: string;
	description: string;
	file?: string;
	line?: number;
	cwe?: string;
	remediation?: string;
}

export interface ContainerScanResult {
	image: string;
	vulnerabilities: SecurityFinding[];
	passed: boolean;
}

// ============================================================================
// Security Scanner
// ============================================================================

export class SecurityScanner {
	private projectPath: string;
	private timeout_ms: number;

	constructor(projectPath: string, timeoutMs = 120_000) {
		this.projectPath = projectPath;
		this.timeout_ms = timeoutMs;
	}

	// ------------------------------------------------------------------
	// Semgrep (SAST)
	// ------------------------------------------------------------------

	async runSemgrep(languages?: string[]): Promise<ScanResult> {
		const start = Date.now();
		const langFlag = languages?.length
			? `--config "auto" --include-lang ${languages.join(",")}`
			: "--config auto --config p/default";

		try {
			const result = await this.exec(`semgrep scan --json ${langFlag} --timeout ${this.timeout_ms / 1000} .`);

			const findings = this.parseSemgrepOutput(result);

			return {
				tool: "semgrep",
				success: true,
				findings,
				summary: `Semgrep found ${findings.length} issues`,
				duration_ms: Date.now() - start,
				raw_output: result,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				tool: "semgrep",
				success: false,
				findings: [],
				summary: `Semgrep failed: ${msg}`,
				duration_ms: Date.now() - start,
				raw_output: msg,
			};
		}
	}

	// ------------------------------------------------------------------
	// OWASP ZAP (DAST)
	// ------------------------------------------------------------------

	async runZapScan(targetUrl: string): Promise<ScanResult> {
		const start = Date.now();

		try {
			// Quick scan
			const result = await this.exec(
				`zap-cli quick-scan --self-contained --start-options "-config api.disablekey=true" -r "${targetUrl}"`,
			);

			const findings = this.parseZapOutput(result);

			return {
				tool: "owasp_zap",
				success: true,
				findings,
				summary: `OWASP ZAP found ${findings.length} issues`,
				duration_ms: Date.now() - start,
				raw_output: result,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				tool: "owasp_zap",
				success: false,
				findings: [],
				summary: `OWASP ZAP failed: ${msg}`,
				duration_ms: Date.now() - start,
				raw_output: msg,
			};
		}
	}

	// ------------------------------------------------------------------
	// Nikto (Web Scanner)
	// ------------------------------------------------------------------

	async runNikto(targetUrl: string): Promise<ScanResult> {
		const start = Date.now();

		try {
			const result = await this.exec(`nikto -h ${targetUrl} -Format json -output /dev/stdout`);

			const findings = this.parseNiktoOutput(result);

			return {
				tool: "nikto",
				success: true,
				findings,
				summary: `Nikto found ${findings.length} issues`,
				duration_ms: Date.now() - start,
				raw_output: result,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				tool: "nikto",
				success: false,
				findings: [],
				summary: `Nikto failed: ${msg}`,
				duration_ms: Date.now() - start,
				raw_output: msg,
			};
		}
	}

	// ------------------------------------------------------------------
	// SQLMap (SQL Injection)
	// ------------------------------------------------------------------

	async runSqlmap(targetUrl: string): Promise<ScanResult> {
		const start = Date.now();

		try {
			const result = await this.exec(
				`sqlmap -u "${targetUrl}" --batch --level=1 --risk=1 --output-dir=/tmp/sqlmap-out`,
			);

			const findings = this.parseSqlmapOutput(result);

			return {
				tool: "sqlmap",
				success: true,
				findings,
				summary: `SQLMap found ${findings.length} issues`,
				duration_ms: Date.now() - start,
				raw_output: result,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				tool: "sqlmap",
				success: false,
				findings: [],
				summary: `SQLMap failed: ${msg}`,
				duration_ms: Date.now() - start,
				raw_output: msg,
			};
		}
	}

	// ------------------------------------------------------------------
	// npm audit (Dependencies)
	// ------------------------------------------------------------------

	async runNpmAudit(): Promise<ScanResult> {
		const start = Date.now();

		try {
			const result = await this.exec("npm audit --json");
			const findings = this.parseNpmAuditOutput(result);

			return {
				tool: "semgrep", // Reuse enum; this is dependency scanning
				success: true,
				findings,
				summary: `npm audit found ${findings.length} issues`,
				duration_ms: Date.now() - start,
				raw_output: result,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				tool: "semgrep",
				success: false,
				findings: [],
				summary: `npm audit failed: ${msg}`,
				duration_ms: Date.now() - start,
				raw_output: msg,
			};
		}
	}

	// ------------------------------------------------------------------
	// Container scanning (Trivy)
	// ------------------------------------------------------------------

	async runTrivyScan(imageName: string): Promise<ContainerScanResult> {
		try {
			const result = await this.exec(`trivy image --format json ${imageName}`);
			const parsed = JSON.parse(result);
			const vulns = (parsed.Results ?? []).flatMap(
				(r: {
					Vulnerabilities?: Array<{
						Severity: string;
						Title: string;
						Description: string;
						VulnerabilityID: string;
					}>;
				}) =>
					(r.Vulnerabilities ?? []).map(v => ({
						id: v.VulnerabilityID,
						severity: v.Severity.toLowerCase() as SecurityFinding["severity"],
						category: "container-vulnerability",
						title: v.Title,
						description: v.Description,
					})),
			);

			return {
				image: imageName,
				vulnerabilities: vulns,
				passed: vulns.filter(v => v.severity === "critical" || v.severity === "high").length === 0,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(`Trivy scan failed: ${msg}`);
			return {
				image: imageName,
				vulnerabilities: [],
				passed: false,
			};
		}
	}

	// ------------------------------------------------------------------
	// Run all tools
	// ------------------------------------------------------------------

	async runAll(languages?: string[], targetUrl?: string): Promise<ScanResult[]> {
		const results: ScanResult[] = [];

		// Always run Semgrep
		results.push(await this.runSemgrep(languages));

		// Always run npm audit
		results.push(await this.runNpmAudit());

		// If target URL provided, run DAST tools
		if (targetUrl) {
			results.push(await this.runZapScan(targetUrl));
			results.push(await this.runNikto(targetUrl));
			results.push(await this.runSqlmap(targetUrl));
		}

		return results;
	}

	// ------------------------------------------------------------------
	// Internal helpers
	// ------------------------------------------------------------------

	private async exec(cmd: string): Promise<string> {
		const { exec } = await import("node:child_process");
		return new Promise((resolve, reject) => {
			exec(cmd, { cwd: this.projectPath, timeout: this.timeout_ms }, (err, stdout, stderr) => {
				if (err && !stdout) {
					reject(err);
				} else {
					resolve(stdout || stderr);
				}
			});
		});
	}

	private parseSemgrepOutput(raw: string): SecurityFinding[] {
		try {
			const data = JSON.parse(raw);
			return (data.results ?? []).map(
				(r: {
					check_id: string;
					extra: { severity: string; message: string; metadata?: { cwe?: string[] } };
					path?: string;
					start?: { line: number };
				}) => ({
					id: r.check_id,
					severity: r.extra.severity?.toLowerCase() ?? "info",
					category: "sast",
					title: r.check_id,
					description: r.extra.message,
					file: r.path,
					line: r.start?.line,
					cwe: r.extra.metadata?.cwe?.[0],
				}),
			);
		} catch {
			return [];
		}
	}

	private parseZapOutput(raw: string): SecurityFinding[] {
		const findings: SecurityFinding[] = [];
		const lines = raw.split("\n");

		for (const line of lines) {
			if (line.includes("[ medium ]") || line.includes("[ high ]") || line.includes("[ low ]")) {
				const severity = line.includes("[ high ]") ? "high" : line.includes("[ medium ]") ? "medium" : "low";
				findings.push({
					id: `zap-${findings.length}`,
					severity,
					category: "dast",
					title: line.trim(),
					description: line.trim(),
				});
			}
		}

		return findings;
	}

	private parseNiktoOutput(raw: string): SecurityFinding[] {
		const findings: SecurityFinding[] = [];
		try {
			const data = JSON.parse(raw);
			for (const host of data.host ?? []) {
				for (const vuln of host.vulnerabilities ?? []) {
					findings.push({
						id: `nikto-${vuln.id ?? findings.length}`,
						severity: "medium",
						category: "web-scanner",
						title: vuln.msg ?? "Nikto finding",
						description: vuln.msg ?? "",
						osvdb: vuln.OSVDB,
					});
				}
			}
		} catch {
			// Not JSON, parse text
			const lines = raw.split("\n");
			for (const line of lines) {
				if (line.startsWith("+ ")) {
					findings.push({
						id: `nikto-${findings.length}`,
						severity: "medium",
						category: "web-scanner",
						title: line.slice(2),
						description: line.slice(2),
					});
				}
			}
		}
		return findings;
	}

	private parseSqlmapOutput(raw: string): SecurityFinding[] {
		const findings: SecurityFinding[] = [];
		if (raw.includes("is vulnerable")) {
			findings.push({
				id: "sqlmap-1",
				severity: "critical",
				category: "sql-injection",
				title: "SQL Injection vulnerability found",
				description: raw.slice(0, 500),
			});
		}
		return findings;
	}

	private parseNpmAuditOutput(raw: string): SecurityFinding[] {
		try {
			const data = JSON.parse(raw);
			const findings: SecurityFinding[] = [];

			for (const [name, info] of Object.entries(data.vulnerabilities ?? {})) {
				const vuln = info as { severity: string; via?: Array<{ title: string; url: string }>; range: string };
				findings.push({
					id: `npm-${name}`,
					severity: vuln.severity as SecurityFinding["severity"],
					category: "dependency",
					title: `Vulnerable dependency: ${name}`,
					description: `${name}@${vuln.range} — ${(vuln.via ?? []).map(v => (typeof v === "string" ? v : v.title)).join(", ")}`,
				});
			}

			return findings;
		} catch {
			return [];
		}
	}
}

// ============================================================================
// Security Report Builder
// ============================================================================

export function buildSecurityReport(results: ScanResult[]): string {
	const lines = [
		"# Security Scan Report",
		"",
		`Scan Date: ${new Date().toISOString()}`,
		`Tools Run: ${results.length}`,
		"",
	];

	let totalFindings = 0;
	let critical = 0;
	let high = 0;

	for (const result of results) {
		lines.push(`## ${result.tool}`);
		lines.push(`Status: ${result.success ? "✅ Success" : "❌ Failed"}`);
		lines.push(`Duration: ${(result.duration_ms / 1000).toFixed(1)}s`);
		lines.push(`Findings: ${result.findings.length}`);

		if (!result.success) {
			lines.push(`Error: ${result.summary}`);
		}

		for (const finding of result.findings) {
			totalFindings++;
			if (finding.severity === "critical") critical++;
			if (finding.severity === "high") high++;

			lines.push(
				`- [${finding.severity.toUpperCase()}] ${finding.title}`,
				`  ${finding.description}`,
				finding.file ? `  File: ${finding.file}:${finding.line ?? "?"}` : "",
				finding.remediation ? `  Remediation: ${finding.remediation}` : "",
			);
		}

		lines.push("");
	}

	lines.push(
		"## Summary",
		`- Total Findings: ${totalFindings}`,
		`- Critical: ${critical}`,
		`- High: ${high}`,
		`- Verdict: ${critical > 0 ? "❌ FAIL (critical issues found)" : high > 0 ? "⚠️ WARNING (high issues found)" : "✅ PASS"}`,
	);

	return lines.join("\n");
}

// ============================================================================
// Prompt Builder
// ============================================================================

export function buildSecurityScanPrompt(): string {
	return `You are the Pakalon Security Scanner Agent. Your task is to run comprehensive security analysis on the project.

## Available Tools
1. **Semgrep (SAST)**: Static analysis for code vulnerabilities
2. **OWASP ZAP (DAST)**: Dynamic analysis for web applications
3. **Nikto**: Web server scanner
4. **SQLMap**: SQL injection testing
5. **npm audit**: Dependency vulnerability scanning
6. **Trivy**: Container image scanning

## Tasks
1. Run all applicable security tools on the project
2. Collect and deduplicate findings
3. Prioritize by severity (critical > high > medium > low)
4. Generate a comprehensive security report
5. Save the report to \`.pakalon-agents/ai-agents/phase-4/security-report.md\`

## Execution
- Run Semgrep and npm audit for all projects
- Run ZAP/Nikto/SQLMap only if a target URL is available
- Run Trivy only if Docker images are built

## Output
Save findings to the security report with:
- Tool used
- Severity level
- File location
- Description
- Suggested remediation`;
}
