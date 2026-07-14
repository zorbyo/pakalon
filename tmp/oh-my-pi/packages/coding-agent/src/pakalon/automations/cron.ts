/**
 * Automation cron runner for Pakalon.
 * Stores workflow definitions in `.pakalon/automations/<id>.json` and
 * dispatches them on a per-automation schedule. Designed to be cheap
 * to start, and pause-able.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { invokePhaseLLM } from "../../llm/invoker";
import { dispatchToConnectors } from "./bridges";

export interface AutomationDefinition {
	id: string;
	name: string;
	description: string;
	prompt: string;
	integrations: string[];
	cron: string; // minute hour dom mon dow
	createdAt: string;
	lastRunAt?: string;
	lastError?: string;
}

const AUTOMATIONS_DIR = ".pakalon/automations";

function ensureDir(projectDir: string): string {
	const d = path.join(projectDir, AUTOMATIONS_DIR);
	fs.mkdirSync(d, { recursive: true });
	return d;
}

/** List all automations for a project. */
export function listAutomations(projectDir: string): AutomationDefinition[] {
	const dir = path.join(projectDir, AUTOMATIONS_DIR);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter(f => f.endsWith(".json"))
		.flatMap(f => {
			try {
				return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as AutomationDefinition];
			} catch {
				return [];
			}
		});
}

/** Persist an automation. */
export function saveAutomation(projectDir: string, def: AutomationDefinition): AutomationDefinition {
	const dir = ensureDir(projectDir);
	const next: AutomationDefinition = { ...def, createdAt: def.createdAt || new Date().toISOString() };
	fs.writeFileSync(path.join(dir, `${next.id}.json`), JSON.stringify(next, null, 2));
	return next;
}

/** Delete an automation by id. */
export function deleteAutomation(projectDir: string, id: string): boolean {
	const file = path.join(projectDir, AUTOMATIONS_DIR, `${id}.json`);
	try {
		fs.unlinkSync(file);
		return true;
	} catch {
		return false;
	}
}

/** Generate a stable id from a name. */
export function deriveAutomationId(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 32) || `auto-${Date.now().toString(36)}`
	);
}

/**
 * Lightweight cron tick — invoked by the TUI's background hook. Runs
 * any automation whose `cron` field matches the current minute.
 */
export function tickAutomations(projectDir: string, now: Date = new Date()): string[] {
	const due: string[] = [];
	const minute = now.getMinutes();
	const hour = now.getHours();
	const dom = now.getDate();
	const mon = now.getMonth() + 1;
	const dow = now.getDay();

	for (const def of listAutomations(projectDir)) {
		const parts = def.cron.split(/\s+/);
		if (parts.length !== 5) continue;
		const [m, h, d, mo, w] = parts;
		if (!matches(m, minute) || !matches(h, hour) || !matches(d, dom) || !matches(mo, mon) || !matches(w, dow)) {
			continue;
		}
		due.push(def.id);
		logger.info("automation: due", { id: def.id, name: def.name });
		// The actual handler runs the agent prompt — that's wired in
		// the slash-commands/builtin/pakalon/automations.ts handler.
	}
	return due;
}

function matches(field: string, value: number): boolean {
	if (field === "*") return true;
	if (field.includes(",")) return field.split(",").some(f => Number(f) === value);
	if (field.includes("/")) {
		const [_, step] = field.split("/");
		return value % Number(step) === 0;
	}
	return Number(field) === value;
}

// ============================================================================
// Scheduler
// ============================================================================

/** Hook invoked by the scheduler for each due automation. */
export type AutomationRunner = (
	cwd: string,
	automationId: string,
) => Promise<{ ok: boolean; error?: string; durationMs: number }>;

/** Default runner: looks up the automation, runs the prompt via
 *  LLM, dispatches to connectors, and records the run. */
async function defaultRunner(
	cwd: string,
	automationId: string,
): Promise<{ ok: boolean; error?: string; durationMs: number }> {
	const start = Date.now();
	try {
		const { getAutomation, recordRun } = await import("../../normal-mode/automations");
		const { loadAutomations, saveAutomations } = await import("../../normal-mode/automations");
		const auto = getAutomation(cwd, automationId);
		if (!auto) {
			return { ok: false, error: "automation not found", durationMs: Date.now() - start };
		}

		logger.info("automation: running (default)", { id: auto.id, name: auto.name, integrations: auto.integrations });

		let llmOutput = "";
		try {
			const result = await invokePhaseLLM(
				`You are the automation runner for Pakalon. Execute the following automation task and produce a concise result summary (max 2KB). Do not modify any files.`,
				auto.prompt,
				{ cwd, phase: "automation", subagent: auto.id },
			);
			llmOutput = result.text.slice(0, 5000);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("automation: llm invocation failed", { id: auto.id, error: msg });
			llmOutput = `[LLM error] ${msg}`;
		}

		const connectorResults = await dispatchToConnectors(
			{ projectDir: cwd, automationId: auto.id, prompt: auto.prompt, output: llmOutput },
			auto.integrations,
		);

		const failedConnectors = connectorResults.filter(r => !r.ok);
		const ok = failedConnectors.length === 0;
		if (!ok) {
			logger.warn("automation: connector failures", { id: auto.id, failures: failedConnectors.map(f => f.error) });
		}

		const automations = loadAutomations(cwd);
		const found = automations.find(a => a.id === automationId);
		if (found) {
			found.lastRunAt = new Date().toISOString();
			found.runCount = (found.runCount ?? 0) + 1;
			if (!ok) {
				found.errorCount = (found.errorCount ?? 0) + 1;
				found.lastError = failedConnectors.map(f => f.error).join("; ");
			}
			saveAutomations(cwd, automations);
		}

		recordRun(cwd, auto.id, {
			startedAt: new Date(start).toISOString(),
			finishedAt: new Date().toISOString(),
			status: ok ? "success" : "error",
			notes: `Connectors: ${connectorResults.map(r => `${r.service}:${r.ok ? "ok" : "fail"}`).join(", ")}`,
			output: llmOutput,
			error: failedConnectors.length > 0 ? failedConnectors.map(f => f.error).join("; ") : undefined,
		});

		return { ok, durationMs: Date.now() - start };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: msg, durationMs: Date.now() - start };
	}
}

interface SchedulerState {
	timer: ReturnType<typeof setInterval> | null;
	intervalMs: number;
	tickCount: number;
}

const SCHEDULER: SchedulerState = {
	timer: null,
	intervalMs: 60_000, // once a minute
	tickCount: 0,
};

/**
 * Start the background automation scheduler. Runs `tickAutomations`
 * immediately, then every `intervalMs` (default 1 min). The
 * returned promise resolves to the scheduler state.
 *
 * Safe to call multiple times — subsequent calls are no-ops while
 * the scheduler is already running. The timer holds an `unref` so
 * it never blocks process exit. In smoke-test / CI mode the
 * scheduler is disabled.
 */
export function startAutomationScheduler(
	projectDir: string,
	opts: { intervalMs?: number; run?: AutomationRunner } = {},
): void {
	if (SCHEDULER.timer !== null) return;
	if (process.env.PAKALON_SMOKE_TEST === "1" || process.env.CI === "true") {
		logger.info("automation: scheduler disabled (smoke-test/CI)");
		return;
	}
	if (process.env.PAKALON_AUTOMATION_DISABLED === "1") {
		logger.info("automation: scheduler disabled (env)");
		return;
	}
	const intervalMs = opts.intervalMs ?? SCHEDULER.intervalMs;
	const run = opts.run ?? defaultRunner;
	SCHEDULER.intervalMs = intervalMs;
	const tick = async (): Promise<void> => {
		SCHEDULER.tickCount++;
		const due = tickAutomations(projectDir);
		if (due.length === 0) return;
		logger.info("automation: scheduler tick", { due: due.length, tick: SCHEDULER.tickCount });
		// Run sequentially so the runner doesn't race on
		// recordRun() writes.
		for (const id of due) {
			try {
				const result = await run(projectDir, id);
				if (!result.ok) {
					logger.warn("automation: runner failed", { id, error: result.error });
				}
			} catch (err) {
				logger.warn("automation: runner threw", { id, err });
			}
		}
	};
	// First tick is immediate.
	void tick().catch(err => logger.warn("automation: initial tick failed", { err }));
	SCHEDULER.timer = setInterval(() => {
		void tick().catch(err => logger.warn("automation: scheduled tick failed", { err }));
	}, intervalMs);
	if (typeof SCHEDULER.timer === "object" && SCHEDULER.timer && "unref" in SCHEDULER.timer) {
		(SCHEDULER.timer as { unref?: () => void }).unref?.();
	}
	logger.info("automation: scheduler started", { intervalMs, projectDir });
}

/** Stop the background automation scheduler. */
export function stopAutomationScheduler(): void {
	if (SCHEDULER.timer === null) return;
	clearInterval(SCHEDULER.timer);
	SCHEDULER.timer = null;
}

/** Inspect the current scheduler state. */
export function getAutomationSchedulerState(): Readonly<SchedulerState> {
	return { ...SCHEDULER };
}
