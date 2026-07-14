/**
 * Tests for the multi-session TUI dashboard.
 *
 * Per CLI-req.md §705 / code.md §11, the dashboard renders cards
 * with three states: working (animated spinner), awaiting-input
 * (cursor), idle (dot). Pressing `+` creates a new session.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardCard } from "./multi-session-dashboard";

describe("multi-session dashboard", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "pakalon-msd-"));
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	describe("renderDashboard", () => {
		it("renders an empty state when there are no sessions", async () => {
			const { renderDashboard } = await import("./multi-session-dashboard");
			const out = renderDashboard(80, []);
			expect(out).toContain("Pakalon Sessions");
			expect(out).toContain("No active sessions");
		});

		it("renders a card row when one session exists", async () => {
			const { renderDashboard } = await import("./multi-session-dashboard");
			const cards: DashboardCard[] = [
				{ id: "ses_abc", project: "~/demo", model: "auto", status: "working", elapsed: "⠋ 5s" },
			];
			const out = renderDashboard(80, cards);
			expect(out).toContain("ses_abc");
			expect(out).toContain("auto");
		});

		it("renders a card for awaiting-input state with the cursor indicator", async () => {
			const { renderDashboard } = await import("./multi-session-dashboard");
			const cards: DashboardCard[] = [
				{ id: "ses_xyz", project: "~/demo", model: "auto", status: "awaiting-input", elapsed: "❯ 12s" },
			];
			const out = renderDashboard(80, cards);
			expect(out).toContain("ses_xyz");
			expect(out).toContain("❯");
		});

		it("renders two cards side by side when width allows", async () => {
			const { renderDashboard } = await import("./multi-session-dashboard");
			const cards: DashboardCard[] = [
				{ id: "ses_a", project: "~/a", model: "auto", status: "idle", elapsed: "· 1s" },
				{ id: "ses_b", project: "~/b", model: "auto", status: "idle", elapsed: "· 2s" },
			];
			const out = renderDashboard(120, cards);
			expect(out).toContain("ses_a");
			expect(out).toContain("ses_b");
		});
	});
});
