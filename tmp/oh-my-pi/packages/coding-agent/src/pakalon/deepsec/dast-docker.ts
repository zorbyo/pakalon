/**
 * DAST (Dynamic Application Security Testing) Docker Orchestration
 *
 * Spins up security testing containers and runs:
 * - OWASP ZAP (web app scanner)
 * - Nikto (web server scanner)
 * - sqlmap (SQL injection testing)
 * - Wapiti (web vulnerability scanner)
 * - XSStrike (XSS detection)
 *
 * All tools run as Docker containers for isolation and reproducibility.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface DASTConfig {
	targetUrl: string;
	outputDir: string;
	containers: {
		zap?: boolean;
		nikto?: boolean;
		sqlmap?: boolean;
		wapiti?: boolean;
		xsstrike?: boolean;
	};
	timeout?: number;
}

export interface DASTResult {
	tool: string;
	status: "completed" | "failed" | "timeout";
	findings: DASTFinding[];
	rawOutput?: string;
	duration: number;
}

export interface DASTFinding {
	severity: "critical" | "high" | "medium" | "low" | "info";
	category: string;
	title: string;
	description: string;
	url?: string;
	parameter?: string;
	evidence?: string;
	remediation: string;
}

export class DASTScanner {
	private config: DASTConfig;
	private activeContainers: string[] = [];

	constructor(config: DASTConfig) {
		this.config = {
			timeout: 300, // 5 minutes default
			...config,
		};
	}

	/**
	 * Run all enabled DAST tools in parallel
	 */
	async scan(): Promise<DASTResult[]> {
		logger.info("DAST: Starting dynamic security scan", { targetUrl: this.config.targetUrl });

		// Ensure output directory exists
		fs.mkdirSync(this.config.outputDir, { recursive: true });

		// Pull Docker images first
		await this.pullImages();

		// Run enabled scanners in parallel
		const scanners: Promise<DASTResult>[] = [];

		if (this.config.containers.zap) {
			scanners.push(this.runZAP());
		}
		if (this.config.containers.nikto) {
			scanners.push(this.runNikto());
		}
		if (this.config.containers.sqlmap) {
			scanners.push(this.runSQLMap());
		}
		if (this.config.containers.wapiti) {
			scanners.push(this.runWapiti());
		}
		if (this.config.containers.xsstrike) {
			scanners.push(this.runXSStrike());
		}

		const results = await Promise.allSettled(scanners);
		const completed = results
			.filter(r => r.status === "fulfilled")
			.map(r => (r as PromiseFulfilledResult<DASTResult>).value);

		// Cleanup containers
		await this.cleanup();

		logger.info("DAST: Scan completed", {
			tools: completed.length,
			findings: completed.reduce((a, r) => a + r.findings.length, 0),
		});

		return completed;
	}

	/**
	 * Pull Docker images for all enabled scanners
	 */
	private async pullImages(): Promise<void> {
		const images = [
			this.config.containers.zap ? "owasp/zap2docker-stable" : null,
			this.config.containers.nikto ? "sullo/nikto" : null,
			this.config.containers.sqlmap ? "paoloo/sqlmap" : null,
			this.config.containers.wapiti ? "wapiti-scanner/wapiti" : null,
			this.config.containers.xsstrike ? "s0md3v/xsstrike" : null,
		].filter(Boolean) as string[];

		await Promise.all(
			images.map(image =>
				this.runDockerCommand(["pull", image]).catch(err => logger.warn(`DAST: Failed to pull ${image}`, { err })),
			),
		);
	}

	/**
	 * Run OWASP ZAP baseline scan
	 */
	private async runZAP(): Promise<DASTResult> {
		const startTime = Date.now();
		const outputFile = path.join(this.config.outputDir, "zap-report.json");

		try {
			// Run ZAP baseline scan
			const args = [
				"run",
				"--rm",
				"-v",
				`${this.config.outputDir}:/zap/wrk`,
				"owasp/zap2docker-stable",
				"zap-baseline.py",
				"-t",
				this.config.targetUrl,
				"-J",
				"zap-report.json",
				"-r",
				"zap-report.html",
				"--hook",
				"/zap/wrk",
			];

			await this.runDockerCommand(args, this.config.timeout);

			// Parse results
			const reportPath = path.join(this.config.outputDir, "zap-report.json");
			const findings = this.parseZAPReport(reportPath);

			return {
				tool: "OWASP ZAP",
				status: "completed",
				findings,
				rawOutput: fs.readFileSync(reportPath, "utf-8"),
				duration: Date.now() - startTime,
			};
		} catch (error) {
			return {
				tool: "OWASP ZAP",
				status: "failed",
				findings: [],
				duration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Run Nikto web server scanner
	 */
	private async runNikto(): Promise<DASTResult> {
		const startTime = Date.now();
		const outputFile = path.join(this.config.outputDir, "nikto-output.txt");

		try {
			const args = [
				"run",
				"--rm",
				"-v",
				`${this.config.outputDir}:/output`,
				"sullo/nikto",
				"-h",
				this.config.targetUrl,
				"-o",
				"/output/nikto-output.txt",
				"-Format",
				"txt",
			];

			await this.runDockerCommand(args, this.config.timeout);

			// Parse results
			const findings = this.parseNiktoOutput(outputFile);

			return {
				tool: "Nikto",
				status: "completed",
				findings,
				rawOutput: fs.readFileSync(outputFile, "utf-8"),
				duration: Date.now() - startTime,
			};
		} catch (error) {
			return {
				tool: "Nikto",
				status: "failed",
				findings: [],
				duration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Run sqlmap for SQL injection testing
	 */
	private async runSQLMap(): Promise<DASTResult> {
		const startTime = Date.now();
		const outputFile = path.join(this.config.outputDir, "sqlmap-report.json");

		try {
			// Basic SQL injection scan
			const args = [
				"run",
				"--rm",
				"-v",
				`${this.config.outputDir}:/output`,
				"paoloo/sqlmap",
				"-u",
				this.config.targetUrl,
				"--batch",
				"--output-dir=/output",
				"--format=json",
			];

			await this.runDockerCommand(args, this.config.timeout);

			// Find the generated report
			const reportPath = this.findLatestFile(this.config.outputDir, "sqlmap-*.json");
			const findings = reportPath ? this.parseSQLMapReport(reportPath) : [];

			return {
				tool: "sqlmap",
				status: "completed",
				findings,
				rawOutput: reportPath ? fs.readFileSync(reportPath, "utf-8") : "",
				duration: Date.now() - startTime,
			};
		} catch (error) {
			return {
				tool: "sqlmap",
				status: "failed",
				findings: [],
				duration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Run Wapiti web vulnerability scanner
	 */
	private async runWapiti(): Promise<DASTResult> {
		const startTime = Date.now();
		const outputFile = path.join(this.config.outputDir, "wapiti-report.json");

		try {
			const args = [
				"run",
				"--rm",
				"-v",
				`${this.config.outputDir}:/output`,
				"wapiti-scanner/wapiti",
				"-u",
				this.config.targetUrl,
				"-f",
				"json",
				"-o",
				"/output/wapiti-report.json",
			];

			await this.runDockerCommand(args, this.config.timeout);

			const findings = this.parseWapitiReport(outputFile);

			return {
				tool: "Wapiti",
				status: "completed",
				findings,
				rawOutput: fs.readFileSync(outputFile, "utf-8"),
				duration: Date.now() - startTime,
			};
		} catch (error) {
			return {
				tool: "Wapiti",
				status: "failed",
				findings: [],
				duration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Run XSStrike for XSS detection
	 */
	private async runXSStrike(): Promise<DASTResult> {
		const startTime = Date.now();
		const outputFile = path.join(this.config.outputDir, "xsstrike-output.txt");

		try {
			const args = [
				"run",
				"--rm",
				"-v",
				`${this.config.outputDir}:/output`,
				"s0md3v/xsstrike",
				"-u",
				this.config.targetUrl,
				"--output",
				"/output/xsstrike-output.txt",
			];

			await this.runDockerCommand(args, this.config.timeout);

			const findings = this.parseXSStrikeOutput(outputFile);

			return {
				tool: "XSStrike",
				status: "completed",
				findings,
				rawOutput: fs.readFileSync(outputFile, "utf-8"),
				duration: Date.now() - startTime,
			};
		} catch (error) {
			return {
				tool: "XSStrike",
				status: "failed",
				findings: [],
				duration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Cleanup Docker containers
	 */
	private async cleanup(): Promise<void> {
		for (const container of this.activeContainers) {
			await this.runDockerCommand(["rm", "-f", container]).catch(() => {});
		}
		this.activeContainers = [];
	}

	/**
	 * Execute Docker command
	 */
	private runDockerCommand(args: string[], timeout?: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const fullArgs = ["docker", ...args];
			logger.info("DAST: Running Docker command", { command: `${fullArgs.slice(0, 3).join(" ")}...` });

			const child = spawn("docker", args, {
				stdio: ["pipe", "pipe", "pipe"],
				timeout: (timeout || this.config.timeout || 300) * 1000,
			});

			let stdout = "";
			let stderr = "";

			child.stdout.on("data", data => {
				stdout += data.toString();
			});

			child.stderr.on("data", data => {
				stderr += data.toString();
			});

			child.on("close", code => {
				if (code === 0 || code === 130) {
					// 130 = SIGINT (normal for some scanners)
					resolve();
				} else {
					logger.warn("DAST: Docker command failed", { code, stderr: stderr.slice(0, 500) });
					// Don't reject - some scanners return non-zero on findings
					resolve();
				}
			});

			child.on("error", err => {
				logger.error("DAST: Docker command error", { err });
				reject(err);
			});
		});
	}

	// ═══════════════════════════════════════════════════════════════════════════════
	// Report Parsers
	// ═══════════════════════════════════════════════════════════════════════════════

	private parseZAPReport(filePath: string): DASTFinding[] {
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			const report = JSON.parse(raw);

			const findings: DASTFinding[] = [];

			if (report.alerts) {
				for (const alert of report.alerts) {
					findings.push({
						severity: this.normalizeSeverity(alert.risk),
						category: alert.alert || "Unknown",
						title: alert.alert,
						description: alert.description || "",
						url: alert.url,
						parameter: alert.param,
						evidence: alert.evidence,
						remediation: alert.solution || "Review and fix the identified vulnerability",
					});
				}
			}

			return findings;
		} catch {
			return [];
		}
	}

	private parseNiktoOutput(filePath: string): DASTFinding[] {
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const findings: DASTFinding[] = [];

			const lines = content.split("\n");
			for (const line of lines) {
				// Parse Nikto output format: "+ Target: ..." or "+ OSVDB-XXXX: ..."
				if (line.includes("OSVDB") || (line.includes("+ ") && line.includes(":"))) {
					findings.push({
						severity: "medium",
						category: "Server Misconfiguration",
						title: line.trim().slice(0, 100),
						description: line.trim(),
						remediation: "Review server configuration and apply security best practices",
					});
				}
			}

			return findings;
		} catch {
			return [];
		}
	}

	private parseSQLMapReport(filePath: string): DASTFinding[] {
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			const report = JSON.parse(raw);

			const findings: DASTFinding[] = [];

			if (report.data && Array.isArray(report.data)) {
				for (const db of report.data) {
					if (db.vulnerabilities) {
						for (const vuln of db.vulnerabilities) {
							findings.push({
								severity: "critical",
								category: "SQL Injection",
								title: `SQL Injection in ${db.url || "unknown"}`,
								description: vuln.data || "SQL injection vulnerability detected",
								url: db.url,
								parameter: vuln.parameter,
								remediation: "Use parameterized queries or prepared statements",
							});
						}
					}
				}
			}

			return findings;
		} catch {
			return [];
		}
	}

	private parseWapitiReport(filePath: string): DASTFinding[] {
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			// Wapiti JSON format varies; implement best-effort parser
			const report = JSON.parse(raw);

			const findings: DASTFinding[] = [];

			// Adapt to actual Wapiti report structure
			if (report.vulnerabilities) {
				for (const vuln of report.vulnerabilities) {
					findings.push({
						severity: this.normalizeSeverity(vuln.level),
						category: vuln.category || "Unknown",
						title: vuln.name || vuln.title || "Wapiti finding",
						description: vuln.description || "",
						url: vuln.url,
						parameter: vuln.parameter,
						remediation: vuln.solution || "Review and fix the vulnerability",
					});
				}
			}

			return findings;
		} catch {
			return [];
		}
	}

	private parseXSStrikeOutput(filePath: string): DASTFinding[] {
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const findings: DASTFinding[] = [];

			// XSStrike outputs findings with specific patterns
			const lines = content.split("\n");
			for (const line of lines) {
				if (line.includes("XSS") || line.includes("payload")) {
					findings.push({
						severity: "high",
						category: "Cross-Site Scripting (XSS)",
						title: line.trim().slice(0, 100),
						description: line.trim(),
						remediation: "Sanitize user input and use proper output encoding",
					});
				}
			}

			return findings;
		} catch {
			return [];
		}
	}

	private normalizeSeverity(severity: string): DASTFinding["severity"] {
		const normalized = severity.toLowerCase();
		if (normalized.includes("critical")) return "critical";
		if (normalized.includes("high")) return "high";
		if (normalized.includes("medium")) return "medium";
		if (normalized.includes("low")) return "low";
		return "info";
	}

	private findLatestFile(dir: string, pattern: string): string | null {
		try {
			const files = fs.readdirSync(dir);
			const matches = files.filter(f => new RegExp(pattern.replace("*", ".*")).test(f));
			if (matches.length === 0) return null;
			return path.join(dir, matches.sort().reverse()[0]!);
		} catch {
			return null;
		}
	}
}

/**
 * Convenience function to run a full DAST scan
 */
export async function runDASTScan(config: DASTConfig): Promise<DASTResult[]> {
	const scanner = new DASTScanner(config);
	return scanner.scan();
}
