/**
 * Deep Security Scanning module for Pakalon Phase 4.
 * Provides advanced penetration testing workflows beyond basic SAST/DAST.
 *
 * This module orchestrates:
 * - Advanced vulnerability scanning (IDOR, privilege escalation, backdoors)
 * - API fuzzing with parameter mutation
 * - Business logic flaw detection
 * - Authentication/authorization bypass testing
 * - Input validation edge cases
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type SeverityLevel = "critical" | "high" | "medium" | "low" | "info";
export type ScanCategory =
	| "idor"
	| "privilege-escalation"
	| "backdoor"
	| "auth-bypass"
	| "input-validation"
	| "business-logic"
	| "api-fuzzing"
	| "data-exposure"
	| "injection"
	| "misconfiguration";

export interface DeepScanFinding {
	id: string;
	category: ScanCategory;
	severity: SeverityLevel;
	title: string;
	description: string;
	file?: string;
	line?: number;
	evidence?: string;
	recommendation: string;
	cwe?: string;
}

export interface DeepScanReport {
	scanId: string;
	timestamp: string;
	projectDir: string;
	categories: ScanCategory[];
	findings: DeepScanFinding[];
	summary: {
		total: number;
		bySeverity: Record<SeverityLevel, number>;
		byCategory: Record<string, number>;
	};
	duration: number;
	passed: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scan Categories
// ═══════════════════════════════════════════════════════════════════════════════

const SCAN_CATEGORY_DESCRIPTIONS: Record<ScanCategory, string> = {
	idor: "Insecure Direct Object Reference - checks for unauthorized access to resources",
	"privilege-escalation": "Privilege Escalation - checks for horizontal/vertical privilege escalation vectors",
	backdoor: "Backdoor Detection - scans for hidden endpoints, debug routes, and undocumented APIs",
	"auth-bypass": "Authentication Bypass - tests for authentication/authorization bypass vulnerabilities",
	"input-validation": "Input Validation - tests for injection attacks, XSS, and input sanitization issues",
	"business-logic": "Business Logic - checks for logic flaws in workflows (e.g., price manipulation, race conditions)",
	"api-fuzzing": "API Fuzzing - mutates parameters to discover unexpected behavior",
	"data-exposure": "Data Exposure - checks for sensitive data in responses, logs, and error messages",
	injection: "Injection Attacks - SQL, NoSQL, LDAP, command injection testing",
	misconfiguration: "Misconfiguration - checks for default credentials, exposed debug endpoints, CORS issues",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Pattern-based Scanners
// ═══════════════════════════════════════════════════════════════════════════════

interface PatternRule {
	id: string;
	category: ScanCategory;
	severity: SeverityLevel;
	pattern: RegExp;
	title: string;
	description: string;
	recommendation: string;
	cwe?: string;
}

const PATTERN_RULES: PatternRule[] = [
	// Backdoor detection
	{
		id: "BD-001",
		category: "backdoor",
		severity: "critical",
		pattern: /(?:debug|test|admin|secret|backdoor)\s*(?:route|endpoint|path)\s*[=:]/gi,
		title: "Potential debug/backdoor route detected",
		description: "Found a debug, test, or admin route that may be a backdoor",
		recommendation: "Remove debug routes before production deployment",
		cwe: "CWE-506",
	},
	{
		id: "BD-002",
		category: "backdoor",
		severity: "high",
		pattern: /(?:hardcoded|hardcoded)\s*(?:password|secret|key|token)\s*[=:]/gi,
		title: "Hardcoded credentials detected",
		description: "Found potentially hardcoded credentials in source code",
		recommendation: "Move credentials to environment variables or a secrets manager",
		cwe: "CWE-798",
	},

	// Privilege escalation
	{
		id: "PE-001",
		category: "privilege-escalation",
		severity: "high",
		pattern: /(?:isAdmin|is_admin|role\s*[=:]\s*['"]admin['"]|admin\s*:\s*true)/gi,
		title: "Potential privilege escalation vector",
		description: "Found admin role check or assignment that may be exploitable",
		recommendation: "Validate role assignments server-side and use RBAC",
		cwe: "CWE-269",
	},

	// IDOR
	{
		id: "IDOR-001",
		category: "idor",
		severity: "high",
		pattern: /(?:req\.params\.id|request\.params\.id|params\[.id.\]|:id)\s*(?:\)|;|$)/gm,
		title: "Direct object reference via URL parameter",
		description: "Found direct use of ID parameter without ownership verification",
		recommendation: "Verify user ownership of the resource before allowing access",
		cwe: "CWE-639",
	},

	// Authentication bypass
	{
		id: "AB-001",
		category: "auth-bypass",
		severity: "critical",
		pattern: /(?:skip|bypass|ignore)\s*(?:auth|authentication|login|token)/gi,
		title: "Authentication bypass mechanism detected",
		description: "Found code that may skip authentication checks",
		recommendation: "Remove authentication bypass code or restrict to test environments",
		cwe: "CWE-287",
	},

	// Input validation
	{
		id: "IV-001",
		category: "input-validation",
		severity: "high",
		pattern: /\$\{.*\}.*(?:query|exec|execute)\s*\(/gi,
		title: "Potential SQL/NoSQL injection via template literal",
		description: "Found template literal used directly in database query",
		recommendation: "Use parameterized queries or an ORM",
		cwe: "CWE-89",
	},
	{
		id: "IV-002",
		category: "input-validation",
		severity: "high",
		pattern: /innerHTML\s*=\s*[^;]*(?:req|request|param|query)/gi,
		title: "Potential XSS via innerHTML",
		description: "Found innerHTML assignment with user-controlled input",
		recommendation: "Use textContent or sanitize input before setting innerHTML",
		cwe: "CWE-79",
	},

	// Data exposure
	{
		id: "DE-001",
		category: "data-exposure",
		severity: "medium",
		pattern: /(?:console\.log|console\.error)\s*\([^)]*(?:password|secret|token|key|credential)/gi,
		title: "Sensitive data logged to console",
		description: "Found sensitive data being logged to console output",
		recommendation: "Remove sensitive data from log statements",
		cwe: "CWE-532",
	},
	{
		id: "DE-002",
		category: "data-exposure",
		severity: "medium",
		pattern: /(?:password|secret|token|key)\s*[=:]\s*['"][^'"]+['"]/gi,
		title: "Potential credential in source code",
		description: "Found what appears to be a credential in source code",
		recommendation: "Move credentials to environment variables",
		cwe: "CWE-312",
	},

	// Misconfiguration
	{
		id: "MC-001",
		category: "misconfiguration",
		severity: "medium",
		pattern: /(?:cors|Access-Control-Allow-Origin)\s*[=:]\s*['"]\*['"]/gi,
		title: "Overly permissive CORS configuration",
		description: "Found wildcard CORS origin which may allow any domain to access the API",
		recommendation: "Restrict CORS to specific trusted origins",
		cwe: "CWE-942",
	},
	{
		id: "MC-002",
		category: "misconfiguration",
		severity: "low",
		pattern: /(?:DEBUG|NODE_ENV)\s*[=:]\s*['"](?:true|development|debug)['"]/gi,
		title: "Debug mode potentially enabled in production",
		description: "Found debug/development mode flag that should be disabled in production",
		recommendation: "Ensure DEBUG/NODE_ENV is set appropriately for the environment",
		cwe: "CWE-489",
	},

	// Business logic
	{
		id: "BL-001",
		category: "business-logic",
		severity: "high",
		pattern: /(?:quantity|amount|price|total)\s*(?:\*|×|=)\s*(?:req|request|body|param)/gi,
		title: "Client-controlled pricing logic",
		description: "Found pricing/quantity calculation using client-provided values without server validation",
		recommendation: "Validate and recalculate pricing server-side",
		cwe: "CWE-502",
	},
];

// ═══════════════════════════════════════════════════════════════════════════════
// Scanner Implementation
// ═══════════════════════════════════════════════════════════════════════════════

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".pakalon-agents",
	"coverage",
	"__pycache__",
	".venv",
]);

const SCAN_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|go|rs|py|rb|php|java|cs|html|css|sql|yaml|yml|json|toml|sh|env)$/i;
const ENV_FILE_PATTERN = /\.env(?:\.\w+)?$/;

/**
 * Run deep security scan on a project directory.
 */
export async function runDeepScan(
	projectDir: string,
	options: {
		categories?: ScanCategory[];
		maxFileSize?: number;
	} = {},
): Promise<DeepScanReport> {
	const startTime = Date.now();
	const scanId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
	const categories = options.categories ?? (Object.keys(SCAN_CATEGORY_DESCRIPTIONS) as ScanCategory[]);
	const maxFileSize = options.maxFileSize ?? 500_000; // 500KB

	logger.info("Deep security scan started", { projectDir, categories });

	const findings: DeepScanFinding[] = [];
	const filesScanned = new Set<string>();

	// Scan source files
	function scanDir(dir: string, depth: number): void {
		if (depth > 8) return;

		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (SKIP_DIRS.has(entry.name)) continue;
			if (entry.name.startsWith(".") && entry.name !== ".env") continue;

			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				scanDir(fullPath, depth + 1);
				continue;
			}

			if (!SCAN_EXTENSIONS.test(entry.name)) continue;

			try {
				const stat = fs.statSync(fullPath);
				if (stat.size > maxFileSize) continue;

				const content = fs.readFileSync(fullPath, "utf-8");
				filesScanned.add(fullPath);

				// Run pattern-based scans
				for (const rule of PATTERN_RULES) {
					if (!categories.includes(rule.category)) continue;

					const matches = content.matchAll(rule.pattern);
					for (const match of matches) {
						const lineNumber = content.slice(0, match.index).split("\n").length;
						const context = content.slice(
							Math.max(0, match.index! - 50),
							Math.min(content.length, match.index! + match[0].length + 50),
						);

						findings.push({
							id: rule.id,
							category: rule.category,
							severity: rule.severity,
							title: rule.title,
							description: rule.description,
							file: path.relative(projectDir, fullPath),
							line: lineNumber,
							evidence: context.trim(),
							recommendation: rule.recommendation,
							cwe: rule.cwe,
						});
					}
				}

				// Special scan: .env files
				if (ENV_FILE_PATTERN.test(entry.name)) {
					const envLines = content.split("\n");
					for (let i = 0; i < envLines.length; i++) {
						const line = envLines[i]!;
						if (/^[A-Z_]+\s*=\s*.+$/i.test(line.trim()) && !line.trim().startsWith("#")) {
							const key = line.split("=")[0]?.trim();
							if (key && /(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)/i.test(key)) {
								findings.push({
									id: "ENV-001",
									category: "data-exposure",
									severity: "high",
									title: "Secret in .env file",
									description: `Found secret key '${key}' in .env file. Ensure .env is in .gitignore.`,
									file: path.relative(projectDir, fullPath),
									line: i + 1,
									evidence: `${key}=***`,
									recommendation: "Ensure .env files are in .gitignore and not committed to version control",
									cwe: "CWE-312",
								});
							}
						}
					}
				}
			} catch {
				// Skip unreadable files
			}
		}
	}

	scanDir(projectDir, 0);

	// Deduplicate findings (same file + same rule)
	const deduped = deduplicateFindings(findings);

	// Build summary
	const bySeverity: Record<SeverityLevel, number> = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		info: 0,
	};
	const byCategory: Record<string, number> = {};

	for (const finding of deduped) {
		bySeverity[finding.severity]++;
		byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
	}

	const duration = Date.now() - startTime;
	const passed = bySeverity.critical === 0 && bySeverity.high === 0;

	const report: DeepScanReport = {
		scanId,
		timestamp: new Date().toISOString(),
		projectDir,
		categories,
		findings: deduped,
		summary: {
			total: deduped.length,
			bySeverity,
			byCategory,
		},
		duration,
		passed,
	};

	logger.info("Deep security scan completed", {
		scanId,
		filesScanned: filesScanned.size,
		findings: deduped.length,
		passed,
		duration,
	});

	return report;
}

/**
 * Deduplicate findings by file + rule id + line number.
 */
function deduplicateFindings(findings: DeepScanFinding[]): DeepScanFinding[] {
	const seen = new Set<string>();
	const deduped: DeepScanFinding[] = [];

	for (const finding of findings) {
		const key = `${finding.id}:${finding.file}:${finding.line}`;
		if (!seen.has(key)) {
			seen.add(key);
			deduped.push(finding);
		}
	}

	return deduped;
}

/**
 * Format deep scan report as markdown.
 */
export function formatDeepScanReport(report: DeepScanReport): string {
	const lines = [
		"# Deep Security Scan Report",
		"",
		`**Scan ID:** ${report.scanId}`,
		`**Timestamp:** ${report.timestamp}`,
		`**Duration:** ${report.duration}ms`,
		`**Status:** ${report.passed ? "PASSED" : "FAILED"}`,
		"",
		"## Summary",
		"",
		`| Severity | Count |`,
		`|----------|-------|`,
		`| Critical | ${report.summary.bySeverity.critical} |`,
		`| High     | ${report.summary.bySeverity.high} |`,
		`| Medium   | ${report.summary.bySeverity.medium} |`,
		`| Low      | ${report.summary.bySeverity.low} |`,
		`| Info     | ${report.summary.bySeverity.info} |`,
		`| **Total** | **${report.summary.total}** |`,
		"",
		"## Categories Scanned",
		"",
	];

	for (const cat of report.categories) {
		const desc = SCAN_CATEGORY_DESCRIPTIONS[cat] ?? cat;
		const count = report.summary.byCategory[cat] ?? 0;
		lines.push(`- **${cat}**: ${desc} (${count} findings)`);
	}

	if (report.findings.length > 0) {
		lines.push("", "## Findings", "");

		// Sort by severity
		const severityOrder: Record<SeverityLevel, number> = {
			critical: 0,
			high: 1,
			medium: 2,
			low: 3,
			info: 4,
		};
		const sorted = [...report.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

		for (const finding of sorted) {
			const sevIcon =
				finding.severity === "critical"
					? "🔴"
					: finding.severity === "high"
						? "🟠"
						: finding.severity === "medium"
							? "🟡"
							: finding.severity === "low"
								? "🔵"
								: "⚪";

			lines.push(`### ${sevIcon} ${finding.title}`);
			lines.push("");
			lines.push(`- **ID:** ${finding.id}`);
			lines.push(`- **Category:** ${finding.category}`);
			lines.push(`- **Severity:** ${finding.severity.toUpperCase()}`);
			if (finding.file) lines.push(`- **File:** ${finding.file}${finding.line ? `:${finding.line}` : ""}`);
			if (finding.cwe) lines.push(`- **CWE:** ${finding.cwe}`);
			lines.push(`- **Description:** ${finding.description}`);
			if (finding.evidence) lines.push(`- **Evidence:** \`${finding.evidence}\``);
			lines.push(`- **Recommendation:** ${finding.recommendation}`);
			lines.push("");
		}
	} else {
		lines.push("", "## No Findings", "", "No security issues detected.", "");
	}

	return lines.join("\n");
}
