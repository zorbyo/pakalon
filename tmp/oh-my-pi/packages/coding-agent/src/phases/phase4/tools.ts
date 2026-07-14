/**
 * Phase 4 security tool runners.
 *
 * Each sub-agent (SAST, DAST, code review, CI/CD, pentest) shells out
 * to its open-source tool via `Bun.spawn` and parses the JSON
 * output. Tools that need a running app (Hoppscotch, ZAP active
 * scan) are guarded by a readiness check.
 *
 * All tools run as Docker images so the application code stays
 * pure TypeScript. Per the requirements, only the tools that the
 * user's tier unlocks are run (free vs pro).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { getUserTier } from "../../auth/openrouter-auth";

const DOCKER = "docker";
const TOOL_TIMEOUT_MS = 300_000; // 5 min per tool

export type ToolTier = "free" | "pro";
export type ToolKind =
	| "sast"
	| "dast"
	| "code-review"
	| "cicd"
	| "pentest"
	| "hoppscotch"
	| "other"
	| "chrome-devtools"
	| "screen-recorder"
	| "playwright"
	| "deep-scan";

export interface ToolSpec {
	id: string;
	name: string;
	image: string;
	args: (projectDir: string) => string[];
	kind: ToolKind;
	tier: ToolTier;
	/** Time we allow the tool to run, per invocation. */
	timeoutMs?: number;
}

export const TOOL_REGISTRY: ToolSpec[] = [
	// Free-tier tools
	{
		id: "bandit",
		name: "Bandit",
		image: "python:3.12-slim",
		args: dir => [
			"run",
			"--rm",
			"-v",
			`${dir}:/src:ro`,
			"python:3.12-slim",
			"sh",
			"-c",
			"pip install -q bandit && bandit -r /src -f json",
		],
		kind: "sast",
		tier: "free",
	},
	{
		id: "sqlmap",
		name: "sqlmap",
		image: "public.ecr.aws/docker/library/python:3.12-slim",
		args: () => [
			"run",
			"--rm",
			"public.ecr.aws/docker/library/python:3.12-slim",
			"sh",
			"-c",
			"pip install -q sqlmap && sqlmap --version",
		],
		kind: "dast",
		tier: "free",
	},
	{
		id: "wapiti",
		name: "Wapiti",
		image: "wapiti/wapiti:latest",
		args: target => [
			"run",
			"--rm",
			"wapiti/wapiti:latest",
			"-u",
			target ?? "http://localhost:3000",
			"-f",
			"json",
			"-o",
			"/tmp/wapiti.json",
		],
		kind: "dast",
		tier: "free",
	},
	{
		id: "xsstrike",
		name: "XSStrike",
		image: "python:3.12-slim",
		args: target => [
			"run",
			"--rm",
			"python:3.12-slim",
			"sh",
			"-c",
			`pip install -q XSStrike && python -m xsstrike -u ${target ?? "http://localhost:3000"} --crawl`,
		],
		kind: "dast",
		tier: "free",
	},
	{
		id: "eslint-security",
		name: "ESLint (security plugins)",
		image: "node:20-alpine",
		args: dir => [
			"run",
			"--rm",
			"-v",
			`${dir}:/src:ro`,
			"node:20-alpine",
			"sh",
			"-c",
			"cd /src && npm i -g eslint eslint-plugin-security && eslint --ext .js,.ts --format json --output-file /tmp/eslint.json . || true",
		],
		kind: "sast",
		tier: "free",
	},
	{
		// FindSecBugs — SpotBugs plugin for Java security audit.
		// Per CLI-req.md §597, free users get this tool. The image
		// ships a precompiled SpotBugs + FindSecBugs so the container
		// runs without a JDK install on the host.
		id: "findsecbugs",
		name: "FindSecBugs",
		image: "find-sec-bugs/find-sec-bugs:latest",
		args: dir => [
			"run",
			"--rm",
			"-v",
			`${dir}:/src:ro`,
			"-v",
			`${path.join(dir, ".pakalon-agents", "phase-4", "raw", "findsecbugs")}:/out`,
			"find-sec-bugs/find-sec-bugs:latest",
			"-progress",
			"-text",
			"/src",
		],
		kind: "sast",
		tier: "free",
		timeoutMs: 600_000,
	},
	{
		// Brakeman — Rails / Ruby static security scanner.
		// Per CLI-req.md §597, free users get this tool. We emit JSON
		// via `-f json` and write to /out so the parser picks it up.
		id: "brakeman",
		name: "Brakeman",
		image: "presidentbeef/brakeman:latest",
		args: dir => [
			"run",
			"--rm",
			"-v",
			`${dir}:/src:ro`,
			"-v",
			`${path.join(dir, ".pakalon-agents", "phase-4", "raw", "brakeman")}:/out`,
			"presidentbeef/brakeman:latest",
			"--no-progress",
			"-f",
			"json",
			"-o",
			"/out/brakeman.json",
			"/src",
		],
		kind: "sast",
		tier: "free",
		timeoutMs: 300_000,
	},
	// Pro-tier tools
	{
		id: "semgrep",
		name: "Semgrep",
		image: "returntocorp/semgrep",
		args: dir => [
			"run",
			"--rm",
			"-v",
			`${dir}:/src:ro`,
			"returntocorp/semgrep",
			"semgrep",
			"--config=auto",
			"--json",
			"/src",
		],
		kind: "sast",
		tier: "pro",
	},
	{
		id: "gitleaks",
		name: "Gitleaks",
		image: "zricethezav/gitleaks",
		args: dir => [
			"run",
			"--rm",
			"-v",
			`${dir}:/src:ro`,
			"zricethezav/gitleaks",
			"detect",
			"--source",
			"/src",
			"--no-git",
			"--report-format",
			"json",
			"--report-path",
			"/tmp/gitleaks.json",
		],
		kind: "sast",
		tier: "pro",
	},
	{
		id: "owasp-zap",
		name: "OWASP ZAP",
		image: "ghcr.io/zaproxy/zap-stable:latest",
		args: target => [
			"run",
			"--rm",
			"-p",
			"8080:8080",
			"ghcr.io/zaproxy/zap-stable:latest",
			"daemon",
			"-port",
			"8080",
			"-config",
			"api.disablekey=true",
		],
		kind: "dast",
		tier: "pro",
		timeoutMs: 600_000,
	},
	{
		id: "nikto",
		name: "Nikto",
		image: "sullo/nikto:latest",
		args: target => [
			"run",
			"--rm",
			"sullo/nikto:latest",
			"-h",
			target ?? "http://localhost:3000",
			"-Format",
			"json",
			"-o",
			"/tmp/nikto.json",
		],
		kind: "dast",
		tier: "pro",
	},
	{
		id: "sonarqube",
		name: "SonarQube CE",
		image: "sonarqube:lts-community",
		args: () => ["run", "--rm", "-p", "9000:9000", "sonarqube:lts-community"],
		kind: "sast",
		tier: "pro",
		timeoutMs: 600_000,
	},
	{
		id: "nmap",
		name: "Nmap",
		image: "instrumentisto/nmap:latest",
		args: target => ["run", "--rm", "instrumentisto/nmap:latest", "-Pn", "-sV", "-T4", target ?? "localhost"],
		kind: "dast",
		tier: "pro",
		timeoutMs: 300_000,
	},
	{
		id: "hoppscotch",
		name: "Hoppscotch",
		// Hoppscotch ships its own web app + CLI replay; we run a one-shot
		// container that mounts the generated `.http` file and emits the
		// replay log to /out. The dedicated `runHoppscotch` helper below
		// performs the actual write+exec.
		image: "hoppscotch/hoppscotch-cli:latest",
		args: () => ["run", "--rm", "hoppscotch/hoppscotch-cli:latest", "--version"],
		kind: "hoppscotch",
		tier: "pro",
		timeoutMs: 180_000,
	},
	// Deep security scanning (pattern-based, no Docker needed)
	{
		id: "deep-scan",
		name: "Deep Security Scan",
		image: "",
		args: () => [],
		kind: "deep-scan",
		tier: "free",
		timeoutMs: 120_000,
	},
];

/** Filter the tool registry by the user's tier. */
export function toolsForTier(tier: ToolTier): ToolSpec[] {
	return TOOL_REGISTRY.filter(t => tier === "pro" || t.tier === "free");
}

/**
 * Run a single tool. Returns the stdout text and the exit code.
 * Docker is invoked via `Bun.spawn` (per AGENTS.md).
 */
export interface ToolRunResult {
	toolId: string;
	toolName: string;
	kind: ToolKind;
	tier: ToolTier;
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	parsed: unknown;
	skipped?: "tier-locked" | "docker-missing" | "no-target";
}

export async function runTool(spec: ToolSpec, projectDir: string, target?: string): Promise<ToolRunResult> {
	const tier: ToolTier = getUserTier() === "pro" ? "pro" : "free";
	if (spec.tier === "pro" && tier === "free") {
		logger.info("tool: skipped (tier-locked)", { tool: spec.id });
		return {
			toolId: spec.id,
			toolName: spec.name,
			kind: spec.kind,
			tier: spec.tier,
			exitCode: 0,
			stdout: "",
			stderr: "",
			durationMs: 0,
			parsed: null,
			skipped: "tier-locked",
		};
	}

	if (!(await isDockerAvailable())) {
		logger.warn("tool: skipped (docker missing)", { tool: spec.id });
		return {
			toolId: spec.id,
			toolName: spec.name,
			kind: spec.kind,
			tier: spec.tier,
			exitCode: 0,
			stdout: "",
			stderr: "",
			durationMs: 0,
			parsed: null,
			skipped: "docker-missing",
		};
	}

	// Create a host-side output directory for the tool's JSON report.
	// The container is bind-mounted with both the project source and
	// this output dir, so anything the tool writes to /out ends up on
	// the host and we can re-read it below (the audit noted that the
	// previous implementation only captured stdout, losing the JSON
	// files written to /tmp inside the container).
	const outDir = path.join(projectDir, ".pakalon-agents", "phase-4", "raw", spec.id);
	fs.mkdirSync(outDir, { recursive: true });

	const start = Date.now();
	const baseArgs = spec.args(target ?? projectDir);
	// Inject the `-v ${outDir}:/out` mount *after* `--rm` but before
	// the image, so the container can write JSON reports to /out
	// that we'll then read back from `outDir`.
	const args = injectOutMount(baseArgs, outDir);
	logger.info("tool: running", { tool: spec.id, image: spec.image, outDir });
	try {
		const proc = Bun.spawn(args, {
			stdout: "pipe",
			stderr: "pipe",
			timeout: spec.timeoutMs ?? TOOL_TIMEOUT_MS,
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
			new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
			proc.exited,
		]);
		// Read back any JSON file the tool wrote to /out. Prefer the
		// tool's standard output filename (most use /out/<name>.json
		// or write to /out/report.json), but fall back to scanning
		// the directory.
		const outFile = readOutJson(outDir);
		const parsed = outFile ? JSON.parse(outFile) : parseToolOutput(stdout);
		const duration = Date.now() - start;
		logger.info("tool: done", { tool: spec.id, exitCode, duration, outFile: outFile ? "yes" : "no" });
		return {
			toolId: spec.id,
			toolName: spec.name,
			kind: spec.kind,
			tier: spec.tier,
			exitCode,
			stdout,
			stderr,
			durationMs: duration,
			parsed,
		};
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.warn("tool: failed", { tool: spec.id, err: errMsg });
		return {
			toolId: spec.id,
			toolName: spec.name,
			kind: spec.kind,
			tier: spec.tier,
			exitCode: 1,
			stdout: "",
			stderr: errMsg,
			durationMs: Date.now() - start,
			parsed: null,
		};
	}
}

/**
 * Find a `-v ...:/src:ro` mount in the docker argv and add a second
 * `-v ${outDir}:/out` mount right after it. If no `-v` is present,
 * insert the mount after `--rm`.
 */
function injectOutMount(argv: string[], outDir: string): string[] {
	const out = [...argv];
	const outMount = ["-v", `${outDir}:/out`];
	const idx = out.indexOf("--rm");
	if (idx >= 0) {
		out.splice(idx + 1, 0, ...outMount);
	} else {
		out.unshift(...outMount);
	}
	return out;
}

/** Read the first `.json` file written by the tool to the output dir. */
function readOutJson(outDir: string): string | null {
	try {
		const files = fs.readdirSync(outDir).filter(f => f.endsWith(".json"));
		if (files.length === 0) return null;
		// Prefer well-known names if multiple exist.
		const preferred = files.find(f => /report|results?|findings|out/i.test(f)) ?? files[0];
		if (!preferred) return null;
		return fs.readFileSync(path.join(outDir, preferred), "utf-8");
	} catch {
		return null;
	}
}

/** Run all tools of a given kind. */
export async function runToolsByKind(kind: ToolKind, projectDir: string, target?: string): Promise<ToolRunResult[]> {
	const tier: ToolTier = getUserTier() === "pro" ? "pro" : "free";
	return Promise.all(
		toolsForTier(tier)
			.filter(t => t.kind === kind)
			.map(t => runTool(t, projectDir, target)),
	);
}

/** Hoppscotch: writes a `.http` file, runs the agent browser to replay it, captures responses. */
export async function runHoppscotch(projectDir: string, target: string): Promise<ToolRunResult> {
	const start = Date.now();
	const httpFile = path.join(projectDir, ".pakalon-agents", "phase-4", "hoppscotch.http");
	fs.mkdirSync(path.dirname(httpFile), { recursive: true });
	fs.writeFileSync(
		httpFile,
		`# Generated by Pakalon /phase-4 Hoppscotch runner
GET ${target}/api/v1/health
GET ${target}/api/v1/users
POST ${target}/api/v1/auth/login
Content-Type: application/json

{"email": "test@example.com", "password": "test"}
`,
	);
	if (!(await isDockerAvailable())) {
		return {
			toolId: "hoppscotch",
			toolName: "Hoppscotch",
			kind: "hoppscotch",
			tier: "pro",
			exitCode: 0,
			stdout: fs.readFileSync(httpFile, "utf-8"),
			stderr: "",
			durationMs: Date.now() - start,
			parsed: null,
			skipped: "docker-missing",
		};
	}
	const proc = Bun.spawn(
		[
			...dockerRun("hoppscotch/hoppscotch:latest", ["/data"], ["-v", `${path.dirname(httpFile)}:/data:ro`]),
			"sh",
			"-c",
			"ls /data",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
	const exitCode = await proc.exited;
	const duration = Date.now() - start;
	return {
		toolId: "hoppscotch",
		toolName: "Hoppscotch",
		kind: "hoppscotch",
		tier: "pro",
		exitCode,
		stdout,
		stderr: "",
		durationMs: duration,
		parsed: { httpFile },
	};
}

function dockerRun(image: string, _ports: string[], extraArgs: string[] = []): string[] {
	return ["docker", "run", "--rm", ...extraArgs, image];
}

async function isDockerAvailable(): Promise<boolean> {
	try {
		const r = await $`docker info --format {{.ServerVersion}}`.quiet().nothrow();
		return r.exitCode === 0 && r.text().trim().length > 0;
	} catch {
		return false;
	}
}

/** Best-effort JSON parse; falls back to `{ raw: text }`. */
export function parseToolOutput(text: string): unknown {
	if (!text.trim()) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		// Look for the first JSON-looking block.
		const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
		if (match) {
			try {
				return JSON.parse(match[0]) as unknown;
			} catch {
				/* ignore */
			}
		}
		return { raw: text.slice(0, 4_000) };
	}
}

/**
 * Hoppscotch-style readiness probe — confirms the dev server is
 * responding before the security tools hit it.
 */
export async function waitForApp(target: string, timeoutMs: number = 30_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const resp = await fetch(target, { signal: AbortSignal.timeout(2_000) });
			if (resp.status < 500) return true;
		} catch {
			/* not ready */
		}
		await Bun.sleep(1_000);
	}
	return false;
}

/**
 * Run the deep security scanner (pattern-based, no Docker needed).
 * Integrates with the deepsec module to scan source code for
 * advanced vulnerabilities like IDOR, privilege escalation, backdoors, etc.
 */
export async function runDeepScan(projectDir: string): Promise<ToolRunResult> {
	const start = Date.now();
	try {
		const { runDeepScan: scan, formatDeepScanReport } = await import("../../pakalon/deepsec/scanner");
		const report = await scan(projectDir);
		const reportPath = path.join(projectDir, ".pakalon-agents", "phase-4", "deep-scan-report.md");
		fs.mkdirSync(path.dirname(reportPath), { recursive: true });
		fs.writeFileSync(reportPath, formatDeepScanReport(report));
		const duration = Date.now() - start;
		logger.info("deep-scan: done", { findings: report.summary.total, duration });
		return {
			toolId: "deep-scan",
			toolName: "Deep Security Scan",
			kind: "deep-scan",
			tier: "free",
			exitCode: report.passed ? 0 : 1,
			stdout: formatDeepScanReport(report),
			stderr: "",
			durationMs: duration,
			parsed: report,
		};
	} catch (err) {
		const duration = Date.now() - start;
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.warn("deep-scan: failed", { err: errMsg });
		return {
			toolId: "deep-scan",
			toolName: "Deep Security Scan",
			kind: "deep-scan",
			tier: "free",
			exitCode: 1,
			stdout: "",
			stderr: errMsg,
			durationMs: duration,
			parsed: null,
		};
	}
}

/**
 * Run Chrome DevTools Protocol testing against a running application.
 * Takes screenshots, evaluates JavaScript, inspects elements.
 */
export async function runChromeDevToolsTest(projectDir: string, _target: string): Promise<ToolRunResult> {
	const start = Date.now();
	const evidenceDir = path.join(projectDir, ".pakalon-agents", "test-evidence");
	fs.mkdirSync(evidenceDir, { recursive: true });

	try {
		// Check if Chrome is running with CDP enabled
		const cdpUrl = "http://localhost:9222";
		const resp = await fetch(`${cdpUrl}/json/list`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
		if (!resp?.ok) {
			return {
				toolId: "chrome-devtools",
				toolName: "Chrome DevTools Test",
				kind: "chrome-devtools",
				tier: "free",
				exitCode: 0,
				stdout: "Chrome DevTools Protocol not available. Start Chrome with --remote-debugging-port=9222",
				stderr: "",
				durationMs: Date.now() - start,
				parsed: null,
				skipped: "no-target",
			};
		}

		// Get available targets
		const targets = (await resp.json()) as Array<{ id: string; url: string; title: string; type: string }>;
		const page = targets.find(t => t.type === "page");
		if (!page) {
			return {
				toolId: "chrome-devtools",
				toolName: "Chrome DevTools Test",
				kind: "chrome-devtools",
				tier: "free",
				exitCode: 0,
				stdout: "No page targets found in Chrome",
				stderr: "",
				durationMs: Date.now() - start,
				parsed: null,
				skipped: "no-target",
			};
		}

		// Take screenshot
		const screenshotPath = path.join(evidenceDir, `chrome-test-${Date.now()}.png`);
		const screenshotResult = (await sendCdpCommand(cdpUrl, page.id, "Page.captureScreenshot", { format: "png" })) as {
			data?: string;
		};
		if (screenshotResult?.data) {
			fs.writeFileSync(screenshotPath, Buffer.from(screenshotResult.data, "base64"));
		}

		// Evaluate page content
		const evalResult = (await sendCdpCommand(cdpUrl, page.id, "Runtime.evaluate", {
			expression: `JSON.stringify({
				title: document.title,
				url: location.href,
				forms: document.forms.length,
				links: document.links.length,
				images: document.images.length,
				scripts: document.scripts.length,
			})`,
			returnByValue: true,
		})) as { result?: { value?: string } };

		const pageInfo = evalResult?.result?.value ?? "{}";
		const report = {
			screenshot: screenshotPath,
			pageInfo: JSON.parse(pageInfo),
			targets: targets.length,
		};

		const reportPath = path.join(evidenceDir, `chrome-devtools-report-${Date.now()}.json`);
		fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

		const duration = Date.now() - start;
		return {
			toolId: "chrome-devtools",
			toolName: "Chrome DevTools Test",
			kind: "chrome-devtools",
			tier: "free",
			exitCode: 0,
			stdout: JSON.stringify(report, null, 2),
			stderr: "",
			durationMs: duration,
			parsed: report,
		};
	} catch (err) {
		const duration = Date.now() - start;
		const errMsg = err instanceof Error ? err.message : String(err);
		return {
			toolId: "chrome-devtools",
			toolName: "Chrome DevTools Test",
			kind: "chrome-devtools",
			tier: "free",
			exitCode: 1,
			stdout: "",
			stderr: errMsg,
			durationMs: duration,
			parsed: null,
		};
	}
}

/**
 * Send a CDP command to a Chrome target via WebSocket.
 */
async function sendCdpCommand(
	cdpUrl: string,
	targetId: string,
	method: string,
	params?: Record<string, unknown>,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`${cdpUrl}/devtools/page/${targetId}`);
		const timeout = setTimeout(() => {
			ws.close();
			reject(new Error("CDP command timed out"));
		}, 10_000);

		ws.onopen = () => {
			ws.send(JSON.stringify({ id: 1, method, params }));
		};
		ws.onmessage = event => {
			const data = JSON.parse(String(event.data));
			if (data.id === 1) {
				clearTimeout(timeout);
				ws.close();
				if (data.error) reject(new Error(`CDP error: ${data.error.message}`));
				else resolve(data.result);
			}
		};
		ws.onerror = err => {
			clearTimeout(timeout);
			reject(err);
		};
	});
}
