/**
 * Tests for the cron-field matcher used by the automations tick.
 *
 * Defends the contract: `tickAutomations` returns the ids whose cron
 * field matches the supplied Date. Wildcard (`*`), list (`,`), step
 * (`/`), and exact values are all honoured.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deleteAutomation, listAutomations, saveAutomation, tickAutomations } from "./cron";

let tmp: string;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-cron-"));
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

function saveCron(id: string, cron: string) {
	saveAutomation(tmp, {
		id,
		name: id,
		description: "",
		prompt: "",
		integrations: [],
		cron,
		createdAt: new Date().toISOString(),
	});
}

describe("listAutomations / saveAutomation / deleteAutomation", () => {
	test("saves and lists automations", () => {
		saveCron("a", "*/5 * * * *");
		saveCron("b", "0 9 * * 1-5");
		const all = listAutomations(tmp);
		expect(all.map(a => a.id).sort()).toEqual(["a", "b"]);
	});

	test("deleteAutomation removes the entry", () => {
		saveCron("a", "*/5 * * * *");
		expect(deleteAutomation(tmp, "a")).toBe(true);
		expect(listAutomations(tmp)).toEqual([]);
	});

	test("deleteAutomation returns false for unknown id", () => {
		expect(deleteAutomation(tmp, "nope")).toBe(false);
	});
});

describe("tickAutomations", () => {
	test("returns ids that match the supplied date", () => {
		saveCron("every-minute", "* * * * *");
		const d = new Date("2026-01-15T10:30:00Z");
		expect(tickAutomations(tmp, d)).toEqual(["every-minute"]);
	});

	test("does not return ids whose cron doesn't match", () => {
		saveCron("morning", "0 9 * * 1-5");
		const d = new Date("2026-01-17T10:30:00Z"); // Saturday 10:30
		expect(tickAutomations(tmp, d)).toEqual([]);
	});

	test("supports the */step form", () => {
		saveCron("every-five", "*/5 * * * *");
		const d = new Date("2026-01-15T10:25:00Z");
		expect(tickAutomations(tmp, d)).toEqual(["every-five"]);
	});

	test("supports comma-separated lists", () => {
		saveCron("hours", "0 9,17 * * *");
		const d = new Date("2026-01-15T09:00:00Z");
		expect(tickAutomations(tmp, d)).toEqual(["hours"]);
	});

	test("ignores automations with invalid cron expressions", () => {
		saveAutomation(tmp, {
			id: "bad",
			name: "bad",
			description: "",
			prompt: "",
			integrations: [],
			cron: "not-a-cron",
			createdAt: new Date().toISOString(),
		});
		expect(tickAutomations(tmp, new Date())).toEqual([]);
	});
});
