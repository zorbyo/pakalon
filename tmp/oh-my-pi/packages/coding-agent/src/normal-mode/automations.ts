/**
 * Automations management for Pakalon normal mode.
 * Supports cron scheduling, GitHub webhooks, and Slack integrations.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type AutomationType = "cron" | "github" | "slack" | "manual";
export type AutomationStatus = "active" | "paused" | "error" | "completed";

export interface Automation {
	id: string;
	name: string;
	type: AutomationType;
	status: AutomationStatus;
	prompt: string;
	schedule?: string; // cron expression
	webhookUrl?: string;
	modelId?: string;
	createdAt: string;
	updatedAt: string;
	lastRunAt?: string;
	nextRunAt?: string;
	runCount: number;
	errorCount: number;
	lastError?: string;
}

export interface AutomationRun {
	id: string;
	automationId: string;
	startedAt: string;
	completedAt?: string;
	status: "running" | "success" | "error";
	output?: string;
	error?: string;
	tokensUsed?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════════

function getAutomationsDir(cwd: string): string {
	return path.join(cwd, ".pakalon", "automations");
}

function getAutomationsFilePath(cwd: string): string {
	return path.join(getAutomationsDir(cwd), "automations.json");
}

function getRunsFilePath(cwd: string, automationId: string): string {
	return path.join(getAutomationsDir(cwd), `${automationId}_runs.jsonl`);
}

function ensureAutomationsDir(cwd: string): void {
	const dir = getAutomationsDir(cwd);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function generateAutomationId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 6);
	return `auto_${timestamp}_${random}`;
}

function generateRunId(): string {
	return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cron parsing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse a cron expression and calculate next run time.
 */
export function parseCronExpression(cronExpr: string): { isValid: boolean; nextRun?: Date; description?: string } {
	// Basic cron validation (5 fields: minute hour day-of-month month day-of-week)
	const parts = cronExpr.trim().split(/\s+/);
	if (parts.length !== 5) {
		return { isValid: false, description: "Invalid cron format (expected 5 fields)" };
	}

	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

	// Validate ranges
	if (minute !== "*" && (Number.isNaN(Number(minute)) || Number(minute) < 0 || Number(minute) > 59)) {
		return { isValid: false, description: "Invalid minute field" };
	}
	if (hour !== "*" && (Number.isNaN(Number(hour)) || Number(hour) < 0 || Number(hour) > 23)) {
		return { isValid: false, description: "Invalid hour field" };
	}
	if (dayOfMonth !== "*" && (Number.isNaN(Number(dayOfMonth)) || Number(dayOfMonth) < 1 || Number(dayOfMonth) > 31)) {
		return { isValid: false, description: "Invalid day-of-month field" };
	}
	if (month !== "*" && (Number.isNaN(Number(month)) || Number(month) < 1 || Number(month) > 12)) {
		return { isValid: false, description: "Invalid month field" };
	}
	if (dayOfWeek !== "*" && (Number.isNaN(Number(dayOfWeek)) || Number(dayOfWeek) < 0 || Number(dayOfWeek) > 7)) {
		return { isValid: false, description: "Invalid day-of-week field" };
	}

	// Calculate next run (simplified)
	const now = new Date();
	const nextRun = new Date(now);

	if (minute !== "*") nextRun.setMinutes(Number(minute));
	if (hour !== "*") nextRun.setHours(Number(hour));

	// If next run is in the past, move to next day
	if (nextRun <= now) {
		nextRun.setDate(nextRun.getDate() + 1);
	}

	// Generate description
	const descriptions: string[] = [];
	if (minute === "*") descriptions.push("every minute");
	else descriptions.push(`at minute ${minute}`);
	if (hour === "*") descriptions.push("every hour");
	else descriptions.push(`at ${hour}:00`);
	if (dayOfMonth !== "*") descriptions.push(`on day ${dayOfMonth}`);
	if (month !== "*") descriptions.push(`in month ${month}`);
	if (dayOfWeek !== "*") descriptions.push(`on day-of-week ${dayOfWeek}`);

	return {
		isValid: true,
		nextRun,
		description: descriptions.join(", "),
	};
}

/**
 * Get human-readable schedule description.
 */
export function getScheduleDescription(schedule: string): string {
	const result = parseCronExpression(schedule);
	if (!result.isValid) {
		return "Invalid schedule";
	}
	return result.description ?? "Scheduled";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Core operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an automation.
 */
export function createAutomation(
	cwd: string,
	name: string,
	type: AutomationType,
	prompt: string,
	options: {
		schedule?: string;
		webhookUrl?: string;
		modelId?: string;
	} = {},
): Automation {
	ensureAutomationsDir(cwd);

	const automation: Automation = {
		id: generateAutomationId(),
		name,
		type,
		status: "active",
		prompt,
		schedule: options.schedule,
		webhookUrl: options.webhookUrl,
		modelId: options.modelId,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		runCount: 0,
		errorCount: 0,
	};

	// Calculate next run for cron type
	if (type === "cron" && options.schedule) {
		const result = parseCronExpression(options.schedule);
		if (result.isValid && result.nextRun) {
			automation.nextRunAt = result.nextRun.toISOString();
		}
	}

	// Save
	const automations = loadAutomations(cwd);
	automations.push(automation);
	saveAutomations(cwd, automations);

	logger.info("Automation created", { id: automation.id, name, type });
	return automation;
}

/**
 * Load all automations.
 */
export function loadAutomations(cwd: string): Automation[] {
	try {
		const filePath = getAutomationsFilePath(cwd);
		const raw = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as Automation[];
	} catch {
		return [];
	}
}

/**
 * Save automations.
 */
export function saveAutomations(cwd: string, automations: Automation[]): void {
	ensureAutomationsDir(cwd);
	const filePath = getAutomationsFilePath(cwd);
	fs.writeFileSync(filePath, JSON.stringify(automations, null, 2));
}

/**
 * Get an automation by ID.
 */
export function getAutomation(cwd: string, automationId: string): Automation | undefined {
	return loadAutomations(cwd).find(a => a.id === automationId);
}

/**
 * Update an automation.
 */
export function updateAutomation(
	cwd: string,
	automationId: string,
	updates: Partial<Pick<Automation, "name" | "prompt" | "schedule" | "webhookUrl" | "modelId" | "status">>,
): boolean {
	const automations = loadAutomations(cwd);
	const automation = automations.find(a => a.id === automationId);
	if (!automation) return false;

	if (updates.name) automation.name = updates.name;
	if (updates.prompt) automation.prompt = updates.prompt;
	if (updates.schedule) automation.schedule = updates.schedule;
	if (updates.webhookUrl) automation.webhookUrl = updates.webhookUrl;
	if (updates.modelId) automation.modelId = updates.modelId;
	if (updates.status) automation.status = updates.status;
	automation.updatedAt = new Date().toISOString();

	// Recalculate next run if schedule changed
	if (updates.schedule && automation.type === "cron") {
		const result = parseCronExpression(updates.schedule);
		if (result.isValid && result.nextRun) {
			automation.nextRunAt = result.nextRun.toISOString();
		}
	}

	saveAutomations(cwd, automations);
	logger.info("Automation updated", { id: automationId });
	return true;
}

/**
 * Delete an automation.
 */
export function deleteAutomation(cwd: string, automationId: string): boolean {
	const automations = loadAutomations(cwd);
	const idx = automations.findIndex(a => a.id === automationId);
	if (idx < 0) return false;

	automations.splice(idx, 1);
	saveAutomations(cwd, automations);

	// Delete run history file
	try {
		const runsPath = getRunsFilePath(cwd, automationId);
		fs.unlinkSync(runsPath);
	} catch {
		// Ignore
	}

	logger.info("Automation deleted", { id: automationId });
	return true;
}

/**
 * Pause an automation.
 */
export function pauseAutomation(cwd: string, automationId: string): boolean {
	return updateAutomation(cwd, automationId, { status: "paused" });
}

/**
 * Resume an automation.
 */
export function resumeAutomation(cwd: string, automationId: string): boolean {
	return updateAutomation(cwd, automationId, { status: "active" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Run tracking
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Record an automation run.
 */
export function recordRun(
	cwd: string,
	automationId: string,
	status: AutomationRun["status"],
	options: {
		output?: string;
		error?: string;
		tokensUsed?: number;
	} = {},
): AutomationRun {
	ensureAutomationsDir(cwd);

	const run: AutomationRun = {
		id: generateRunId(),
		automationId,
		startedAt: new Date().toISOString(),
		status,
		...options,
	};

	if (status !== "running") {
		run.completedAt = new Date().toISOString();
	}

	// Append to runs file
	const runsPath = getRunsFilePath(cwd, automationId);
	const line = `${JSON.stringify(run)}\n`;
	fs.appendFileSync(runsPath, line);

	// Update automation stats
	const automations = loadAutomations(cwd);
	const automation = automations.find(a => a.id === automationId);
	if (automation) {
		automation.runCount++;
		automation.lastRunAt = run.startedAt;
		if (status === "error") {
			automation.errorCount++;
			automation.lastError = options.error;
		}
		saveAutomations(cwd, automations);
	}

	logger.debug("Run recorded", { id: run.id, automationId, status });
	return run;
}

/**
 * Get runs for an automation.
 */
export function getRuns(cwd: string, automationId: string, limit: number = 10): AutomationRun[] {
	try {
		const runsPath = getRunsFilePath(cwd, automationId);
		const raw = fs.readFileSync(runsPath, "utf-8");
		const lines = raw.trim().split("\n").filter(Boolean);
		const runs = lines.map(line => JSON.parse(line) as AutomationRun);
		return runs.slice(-limit).reverse();
	} catch {
		return [];
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format automation list for display.
 */
export function formatAutomationList(cwd: string): string {
	const automations = loadAutomations(cwd);
	if (automations.length === 0) {
		return "No automations configured.\n\nUse /automations create to create one.";
	}

	const lines = ["Automations:", "═══════════════════════════════════════"];

	for (const auto of automations) {
		const icon =
			auto.status === "active" ? "●" : auto.status === "paused" ? "◐" : auto.status === "error" ? "✗" : "○";

		lines.push(`${icon} ${auto.name} (${auto.id})`);
		lines.push(`  Type: ${auto.type} | Status: ${auto.status}`);

		if (auto.type === "cron" && auto.schedule) {
			lines.push(`  Schedule: ${getScheduleDescription(auto.schedule)}`);
		}

		lines.push(`  Runs: ${auto.runCount} | Errors: ${auto.errorCount}`);
		lines.push(`  Prompt: ${auto.prompt.slice(0, 60)}...`);
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Format a single automation for display.
 */
export function formatAutomation(cwd: string, automationId: string): string {
	const automation = getAutomation(cwd, automationId);
	if (!automation) return "Automation not found.";

	const lines = [
		`Automation: ${automation.name}`,
		"═══════════════════════════════════════",
		`ID: ${automation.id}`,
		`Type: ${automation.type}`,
		`Status: ${automation.status}`,
		`Prompt: ${automation.prompt}`,
	];

	if (automation.type === "cron" && automation.schedule) {
		lines.push(`Schedule: ${automation.schedule}`);
		lines.push(`Description: ${getScheduleDescription(automation.schedule)}`);
	}

	if (automation.nextRunAt) {
		lines.push(`Next Run: ${automation.nextRunAt}`);
	}

	lines.push(`Runs: ${automation.runCount}`);
	lines.push(`Errors: ${automation.errorCount}`);
	lines.push(`Created: ${automation.createdAt}`);
	lines.push(`Updated: ${automation.updatedAt}`);

	if (automation.lastError) {
		lines.push(`Last Error: ${automation.lastError}`);
	}

	return lines.join("\n");
}

/**
 * Format run history for display.
 */
export function formatRunHistory(cwd: string, automationId: string, limit: number = 10): string {
	const runs = getRuns(cwd, automationId, limit);
	if (runs.length === 0) {
		return "No runs recorded.";
	}

	const lines = [`Run History (last ${limit}):`, "═══════════════════════════════════════"];

	for (const run of runs) {
		const icon = run.status === "success" ? "✓" : run.status === "error" ? "✗" : "→";
		const time = new Date(run.startedAt).toLocaleString();
		lines.push(`${icon} [${time}] ${run.status}`);

		if (run.output) {
			lines.push(`   Output: ${run.output.slice(0, 80)}...`);
		}

		if (run.error) {
			lines.push(`   Error: ${run.error.slice(0, 80)}...`);
		}
	}

	return lines.join("\n");
}
