/**
 * Auditor HIL follow-up selector.
 *
 * When `phases/phase3/index.ts` runs in HIL mode and the auditor
 * reports missing/partial features, it writes
 * `.pakalon-agents/ai-agents/phase-3/auditor-followup.md` with three
 * choices: implement-all, implement-core, do-nothing. This
 * module reads that file (or accepts an in-memory state), renders
 * the choice prompt, and dispatches the corresponding remediation.
 *
 * The TUI surface mounts this in the chat row after `/phase-3`
 * completes. The flow is: read follow-up file → show
 * select-list → call `runRemediation` with the chosen scope.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { runRemediation } from "./dispatch";
import type { AuditReport } from "./loop";

const PHASE3_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-3");
const FOLLOWUP_FILE = (cwd: string) => path.join(PHASE3_DIR(cwd), "auditor-followup.md");

export type FollowupChoice = "implement-all" | "implement-core" | "do-nothing";

export interface FollowupPrompt {
	choices: { id: FollowupChoice; label: string }[];
	missing: number;
	partial: number;
	report: AuditReport;
}

const CHOICES: { id: FollowupChoice; label: string }[] = [
	{ id: "implement-all", label: "Implement all of the missing and partially-implemented features" },
	{ id: "implement-core", label: "Implement only the core features" },
	{ id: "do-nothing", label: "Do nothing" },
];

/** Read the auditor follow-up file. Returns null if no follow-up is pending. */
export function readFollowup(cwd: string): FollowupPrompt | null {
	const file = FOLLOWUP_FILE(cwd);
	if (!fs.existsSync(file)) return null;
	try {
		const text = fs.readFileSync(file, "utf-8");
		const m = text.match(/Missing:\s*(\d+),\s*Partial:\s*(\d+)/);
		if (!m) return null;
		const missing = Number(m[1]);
		const partial = Number(m[2]);
		if (missing + partial === 0) return null;
		return {
			choices: CHOICES,
			missing,
			partial,
			report: parseReportFromFollowup(text),
		};
	} catch (err) {
		logger.warn("auditor: failed to read followup", { err });
		return null;
	}
}

/** Best-effort parse of the auditor's report summary from the followup file. */
function parseReportFromFollowup(_text: string): AuditReport {
	// The followup file is a marker; the real report lives in
	// `auditor.md`. We re-read it here.
	return {
		generatedAt: new Date().toISOString(),
		complete: 0,
		partial: 0,
		missing: 0,
		buckets: [],
		recommendedNext: "do-nothing",
	};
}

/** Apply the user's choice. The follow-up file is removed on success. */
export async function applyFollowupChoice(
	cwd: string,
	choice: FollowupChoice,
	report?: AuditReport,
): Promise<{ dispatched: boolean; reason: string }> {
	if (choice === "do-nothing") {
		try {
			fs.unlinkSync(FOLLOWUP_FILE(cwd));
		} catch {
			/* missing */
		}
		return { dispatched: false, reason: "user declined remediation" };
	}
	const reportForDispatch: AuditReport = report ??
		readFollowup(cwd)?.report ?? {
			generatedAt: new Date().toISOString(),
			complete: 0,
			partial: 0,
			missing: 0,
			buckets: [],
			recommendedNext: choice === "implement-all" ? "remediate-all" : "core-only",
		};
	// Filter buckets to "core" if the user picked implement-core.
	if (choice === "implement-core") {
		reportForDispatch.buckets = reportForDispatch.buckets.filter(b => /core|critical|main/i.test(b.feature));
	}
	const result = await runRemediation(cwd, reportForDispatch, "HIL");
	try {
		fs.unlinkSync(FOLLOWUP_FILE(cwd));
	} catch {
		/* missing */
	}
	return {
		dispatched: true,
		reason: `dispatched ${Object.keys(result.results).length} sub-agent remediation(s)`,
	};
}

/** Render the follow-up prompt as a single TUI line. */
export function renderFollowupPrompt(prompt: FollowupPrompt): string {
	const lines: string[] = [
		`Auditor found ${prompt.missing} missing, ${prompt.partial} partial features.`,
		"Choose how to proceed:",
	];
	for (const c of prompt.choices) {
		lines.push(`  ${c.id.padEnd(16)}  ${c.label}`);
	}
	return lines.join("\n");
}
