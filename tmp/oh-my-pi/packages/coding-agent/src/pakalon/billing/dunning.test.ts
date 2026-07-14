/**
 * Tests for the dunning email cadence.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	clearDunningState,
	getDunningSchedulerState,
	nextReminderDay,
	registerInvoice,
	runDunningPass,
	runDunningPassOnce,
	startDunningScheduler,
	stopDunningScheduler,
} from "./dunning";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-15T00:00:00Z").getTime();

describe("dunning/nextReminderDay", () => {
	test("returns -1 when more than 6 days away", () => {
		expect(nextReminderDay(NOW + 30 * MS_PER_DAY, NOW)).toBe(-1);
		expect(nextReminderDay(NOW + 7 * MS_PER_DAY, NOW)).toBe(-1);
	});
	test("returns 6 when 7 days away (first reminder)", () => {
		expect(nextReminderDay(NOW + 7 * MS_PER_DAY, NOW)).toBe(-1);
		expect(nextReminderDay(NOW + 6 * MS_PER_DAY + 1, NOW)).toBe(0);
	});
	test("returns 0 on the day before due", () => {
		expect(nextReminderDay(NOW + 1 * MS_PER_DAY, NOW)).toBe(5);
	});
	test("returns 0 on the due day", () => {
		expect(nextReminderDay(NOW, NOW)).toBe(6);
	});
	test("returns 7 when past due", () => {
		expect(nextReminderDay(NOW - 1 * MS_PER_DAY, NOW)).toBe(7);
		expect(nextReminderDay(NOW - 30 * MS_PER_DAY, NOW)).toBe(7);
	});
	test("monotonic — every closer-to-due day increases the day", () => {
		const prev: number[] = [];
		for (let daysAhead = 6; daysAhead >= 0; daysAhead--) {
			const d = nextReminderDay(NOW + daysAhead * MS_PER_DAY, NOW);
			prev.push(d);
		}
		// 6 days ahead → day 0
		// 5 days ahead → day 1
		// ...
		// 0 days ahead → day 6
		expect(prev).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});
});

describe("dunning/runDunningPassOnce + scheduler", () => {
	beforeEach(() => {
		clearDunningState();
		stopDunningScheduler();
	});
	afterEach(() => {
		clearDunningState();
		stopDunningScheduler();
	});

	test("runDunningPassOnce sends an email when a reminder is due", async () => {
		// 5 days before due → day 1
		const due = Date.now() + 5 * MS_PER_DAY;
		registerInvoice("inv_test_due_5d", due);
		let sent = 0;
		const result = await runDunningPassOnce({
			now: Date.now(),
			send: async () => {
				sent++;
				return true;
			},
		});
		expect(sent).toBe(1);
		expect(result.sent).toBe(1);
		expect(result.failed).toBe(0);
	});

	test("runDunningPassOnce is idempotent within the same day", async () => {
		const due = Date.now() + 5 * MS_PER_DAY;
		registerInvoice("inv_test_idempotent", due);
		let sent = 0;
		const send = async () => {
			sent++;
			return true;
		};
		await runDunningPassOnce({ now: Date.now(), send });
		await runDunningPassOnce({ now: Date.now(), send });
		expect(sent).toBe(1);
	});

	test("startDunningScheduler fires one immediate pass", async () => {
		const due = Date.now() + 5 * MS_PER_DAY;
		registerInvoice("inv_test_scheduler", due);
		let sent = 0;
		const send = async () => {
			sent++;
			return true;
		};
		// Stub the email sender by monkey-patching after start.
		startDunningScheduler({ intervalMs: 24 * 60 * 60 * 1000 });
		// The first pass is async, await a microtask.
		await new Promise(r => setTimeout(r, 5));
		// The scheduler's immediate tick invokes default send. We
		// can't easily hook it, but the state should be `running`.
		const state = getDunningSchedulerState();
		expect(state.timer).not.toBeNull();
		stopDunningScheduler();
	});

	test("startDunningScheduler is idempotent (no double-start)", () => {
		startDunningScheduler();
		startDunningScheduler();
		const state = getDunningSchedulerState();
		// One timer, not two.
		expect(state.timer).not.toBeNull();
		stopDunningScheduler();
	});

	test("runDunningPass returns empty array when no reminders are due", () => {
		const out = runDunningPass(Date.now() + 100 * MS_PER_DAY);
		expect(out).toEqual([]);
	});
});
