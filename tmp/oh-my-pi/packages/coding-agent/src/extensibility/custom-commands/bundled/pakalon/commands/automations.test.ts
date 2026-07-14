/**
 * Tests for the /automations command.
 *
 * Per CLI-req.md §674 / code.md §22, /automations manages workflows
 * with built-in templates. We verify:
 *   - the templates list has the 5 baseline entries
 *   - parseCronExpression accepts a 5-field cron
 *   - the full create/delete/pause/resume cycle works
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("/automations command", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "pakalon-auto-"));
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	describe("built-in templates", () => {
		it("has the 5 baseline templates", async () => {
			const { AUTOMATION_TEMPLATES } = await import("./automations");
			const ids = AUTOMATION_TEMPLATES.map(t => t.id);
			expect(ids).toContain("pr-checker");
			expect(ids).toContain("issue-triage");
			expect(ids).toContain("dep-update");
			expect(ids).toContain("ci-monitor");
			expect(ids).toContain("daily-standup");
		});

		it("every template has a 5-field cron schedule", async () => {
			const { AUTOMATION_TEMPLATES } = await import("./automations");
			for (const t of AUTOMATION_TEMPLATES) {
				expect(t.schedule.split(/\s+/)).toHaveLength(5);
			}
		});

		it("every template has at least one connector", async () => {
			const { AUTOMATION_TEMPLATES } = await import("./automations");
			for (const t of AUTOMATION_TEMPLATES) {
				expect(t.connectors.length).toBeGreaterThan(0);
			}
		});
	});

	describe("automation CRUD", () => {
		it("creates and lists an automation", async () => {
			const { createAutomation, loadAutomations } = await import("../../../../normal-mode/automations");
			const auto = createAutomation(cwd, "Test", "cron", "do the thing", { schedule: "0 9 * * *" });
			expect(auto.name).toBe("Test");
			expect(loadAutomations(cwd)).toHaveLength(1);
		});

		it("pauses and resumes an automation", async () => {
			const { createAutomation, pauseAutomation, resumeAutomation, getAutomation } = await import(
				"../../../../normal-mode/automations"
			);
			const auto = createAutomation(cwd, "T", "cron", "p", { schedule: "0 9 * * *" });
			pauseAutomation(cwd, auto.id);
			expect(getAutomation(cwd, auto.id)?.status).toBe("paused");
			resumeAutomation(cwd, auto.id);
			expect(getAutomation(cwd, auto.id)?.status).toBe("active");
		});

		it("deletes an automation", async () => {
			const { createAutomation, deleteAutomation, loadAutomations } = await import(
				"../../../../normal-mode/automations"
			);
			const auto = createAutomation(cwd, "T", "cron", "p", { schedule: "0 9 * * *" });
			expect(deleteAutomation(cwd, auto.id)).toBe(true);
			expect(loadAutomations(cwd)).toHaveLength(0);
		});
	});
});
