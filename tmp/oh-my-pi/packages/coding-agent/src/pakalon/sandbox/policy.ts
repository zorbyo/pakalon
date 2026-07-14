/**
 * Sandbox orchestration for Pakalon.
 * Wraps the existing `integrations/sandbox.ts` with policy enforcement:
 * if the project is "large" (per token estimate), spin up a Docker
 * sandbox for the first run + test. Promote to local env only after
 * Phase 4 reports clean.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { stopSandbox } from "../../integrations/sandbox";

const POLICY_FILE = path.join(process.cwd(), ".pakalon-agents", "sandbox-policy.json");
const SETTINGS_KEY = "pakalon.sandbox.enabled";
const THRESHOLD_KEY = "pakalon.sandbox.thresholdLines";

export interface SandboxPolicy {
	enabled: boolean;
	eligibleAfterPhase4: boolean;
	containerId?: string;
	startedAt?: string;
	reason?: string;
	eligibleScore?: number;
	/** True if the sandbox was auto-triggered by the size threshold. */
	autoTriggered?: boolean;
}

const DEFAULT_POLICY: SandboxPolicy = {
	enabled: false,
	eligibleAfterPhase4: false,
};

/**
 * Heuristic: a project is "large" if its source tree contains more than
 * `LARGE_PROJECT_FILE_THRESHOLD` files or its combined size exceeds
 * `LARGE_PROJECT_SIZE_BYTES`.
 */
const LARGE_PROJECT_FILE_THRESHOLD = 200;
const LARGE_PROJECT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const DEFAULT_LINE_THRESHOLD = 50_000; // matches code.md §11 default

/** Detect whether the project is a "large project" by file count or size. */
export async function shouldUseSandbox(projectDir: string): Promise<{ sandbox: boolean; reason: string }> {
	let fileCount = 0;
	let totalSize = 0;
	let totalLines = 0;
	function walk(dir: string) {
		try {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue;
				const p = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(p);
				} else if (entry.isFile()) {
					fileCount++;
					try {
						const stat = fs.statSync(p);
						totalSize += stat.size;
						// Heuristic: 1 line ≈ 50 bytes of source. Counts only
						// text-like extensions to avoid inflating with binary.
						if (/\.(ts|tsx|js|jsx|py|go|rs|html|css|json|md|java|rb|c|cpp|h|hpp)$/i.test(p)) {
							totalLines += Math.max(1, Math.round(stat.size / 50));
						}
					} catch {
						/* ignore */
					}
				}
				if (fileCount > LARGE_PROJECT_FILE_THRESHOLD) return;
			}
		} catch {
			/* ignore */
		}
	}
	walk(projectDir);
	if (fileCount > LARGE_PROJECT_FILE_THRESHOLD) {
		return { sandbox: true, reason: `${fileCount} files exceeds threshold (${LARGE_PROJECT_FILE_THRESHOLD})` };
	}
	if (totalSize > LARGE_PROJECT_SIZE_BYTES) {
		return { sandbox: true, reason: `tree size ${totalSize}b exceeds threshold (${LARGE_PROJECT_SIZE_BYTES})` };
	}
	// Line-count threshold (per code.md §11 default 50,000 lines).
	const lineThreshold = readThresholdLines();
	if (totalLines > lineThreshold) {
		return { sandbox: true, reason: `~${totalLines} lines exceeds threshold (${lineThreshold})` };
	}
	return { sandbox: false, reason: "project within safe size" };
}

/**
 * High-level wrapper: decide + start the sandbox if needed. Returns
 * the resulting `SandboxPolicy`. Called from the orchestrator /
 * phase-3 entry point so the sandbox is auto-triggered for large
 * projects without explicit user opt-in (per code.md §11).
 */
export async function ensureSandboxForProject(projectDir: string): Promise<SandboxPolicy> {
	const existing = load();
	if (existing.enabled) return existing; // already running
	if (!readEnabled()) {
		return { ...DEFAULT_POLICY };
	}
	const decision = await shouldUseSandbox(projectDir);
	if (!decision.sandbox) return { ...DEFAULT_POLICY };
	logger.info("Auto-triggering sandbox for large project", { reason: decision.reason });
	return enterSandbox(projectDir, decision.reason, true);
}

/** Start a sandboxed container for the project. */
export async function enterSandbox(
	projectDir: string,
	reason: string,
	autoTriggered: boolean = false,
): Promise<SandboxPolicy> {
	const { startSandbox } = await import("./docker");
	const result = await startSandbox(projectDir).catch(err => {
		logger.warn("Sandbox failed to start, continuing without it", { err });
		return { containerId: "stub", url: "sandbox://local", stop: async () => undefined };
	});
	const policy: SandboxPolicy = {
		enabled: result.containerId !== "stub",
		eligibleAfterPhase4: false,
		containerId: result.containerId,
		startedAt: new Date().toISOString(),
		reason,
		autoTriggered,
	};
	persist(policy);
	return policy;
}

/** Read whether the user has enabled sandbox auto-trigger. */
function readEnabled(): boolean {
	try {
		// We don't import settings to avoid a top-level cycle; read from
		// ~/.omp/settings.json via a lazy JSON parse.
		const home = process.env.HOME ?? "";
		const candidates = [path.join(home, ".omp", "settings.json"), path.join(home, ".config", "omp", "settings.json")];
		for (const f of candidates) {
			if (!fs.existsSync(f)) continue;
			const data = JSON.parse(fs.readFileSync(f, "utf-8")) as Record<string, unknown>;
			const v = data[SETTINGS_KEY] ?? data["pakalon.sandbox.enabled"];
			if (typeof v === "boolean") return v;
		}
	} catch {
		/* ignore */
	}
	return true; // default ON
}

function readThresholdLines(): number {
	try {
		const home = process.env.HOME ?? "";
		const candidates = [path.join(home, ".omp", "settings.json"), path.join(home, ".config", "omp", "settings.json")];
		for (const f of candidates) {
			if (!fs.existsSync(f)) continue;
			const data = JSON.parse(fs.readFileSync(f, "utf-8")) as Record<string, unknown>;
			const v = data[THRESHOLD_KEY] ?? data["pakalon.sandbox.thresholdLines"];
			if (typeof v === "number" && v > 0) return v;
		}
	} catch {
		/* ignore */
	}
	return DEFAULT_LINE_THRESHOLD;
}

/** Mark the sandbox as eligible to be torn down after Phase 4. */
export function markSandboxEligible(score: number = 0): void {
	const policy = load();
	policy.eligibleAfterPhase4 = true;
	policy.eligibleScore = score;
	persist(policy);
}

/** Compute a numeric "phase 4 review score" 0-100 from tool results. */
export function computeReviewScore(sastIssues: number, dastIssues: number): number {
	const total = sastIssues + dastIssues;
	if (total === 0) return 100;
	return Math.max(0, 100 - total * 2);
}

/**
 * Aggregate phase 4 score across all 5 subagent buckets (SAST, DAST,
 * code review, CI/CD, pentest). Per CLI-req.md §716 the sandbox
 * only tears down when the *aggregated* review score passes the
 * threshold. The formula:
 *
 *   score = 100 - (critical * 10) - (high * 5) - (medium * 2) - (low * 1)
 *
 * clamped to [0, 100]. This is more accurate than the simple
 * `computeReviewScore(sast, dast)` because it includes the code
 * review / CI/CD / pentest buckets.
 */
export function computeAggregateReviewScore(findings: {
	critical: number;
	high: number;
	medium: number;
	low: number;
	info?: number;
}): number {
	const c = findings.critical;
	const h = findings.high;
	const m = findings.medium;
	const l = findings.low;
	const i = findings.info ?? 0;
	return Math.max(0, Math.min(100, 100 - c * 10 - h * 5 - m * 2 - l - Math.floor(i / 2)));
}

/** Decide if the sandbox can be torn down based on the phase-4 score. */
export function canPromoteFromSandbox(score: number, threshold: number = 80): boolean {
	return score >= threshold;
}

/** Stop the sandbox and clear the policy. */
export async function exitSandbox(): Promise<void> {
	const policy = load();
	if (policy.containerId) {
		await stopSandbox("pakalon-sbx");
	}
	persist(DEFAULT_POLICY);
}

/** Load the current sandbox policy. */
export function load(): SandboxPolicy {
	try {
		return { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(POLICY_FILE, "utf-8")) };
	} catch {
		return { ...DEFAULT_POLICY };
	}
}

function persist(policy: SandboxPolicy): void {
	try {
		fs.mkdirSync(path.dirname(POLICY_FILE), { recursive: true });
		fs.writeFileSync(POLICY_FILE, JSON.stringify(policy, null, 2));
	} catch (err) {
		logger.warn("Failed to persist sandbox policy", { err });
	}
}
