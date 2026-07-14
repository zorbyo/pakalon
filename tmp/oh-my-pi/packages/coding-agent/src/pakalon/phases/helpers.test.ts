/**
 * Tests for the phase helpers.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hasPhaseOutputs, readLatestPhaseSummary, shouldRerunPhase, writePhaseSummary } from "./helpers";

describe("phases/helpers", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-phase-helpers-"));
		fs.mkdirSync(path.join(tmpDir, ".pakalon-agents", "ai-agents", "phase-1"), { recursive: true });
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("hasPhaseOutputs returns false on a fresh dir", () => {
		expect(hasPhaseOutputs(tmpDir, "phase-1")).toBe(false);
	});

	test("hasPhaseOutputs returns true when all required files exist", () => {
		const dir = path.join(tmpDir, ".pakalon-agents", "ai-agents", "phase-1");
		for (const f of ["plan.md", "tasks.md", "user-stories.md", "phase-1.md"]) {
			fs.writeFileSync(path.join(dir, f), "x");
		}
		expect(hasPhaseOutputs(tmpDir, "phase-1")).toBe(true);
	});

	test("hasPhaseOutputs returns false when some files are missing", () => {
		const dir = path.join(tmpDir, ".pakalon-agents", "ai-agents", "phase-1");
		fs.writeFileSync(path.join(dir, "plan.md"), "x");
		expect(hasPhaseOutputs(tmpDir, "phase-1")).toBe(false);
	});

	test("shouldRerunPhase allows YOLO always", async () => {
		// Force hasPhaseOutputs = true
		const dir = path.join(tmpDir, ".pakalon-agents", "ai-agents", "phase-1");
		for (const f of ["plan.md", "tasks.md", "user-stories.md", "phase-1.md"]) {
			fs.writeFileSync(path.join(dir, f), "x");
		}
		const ok = await shouldRerunPhase(tmpDir, "phase-1", "YOLO", () => true);
		expect(ok).toBe(true);
	});

	test("shouldRerunPhase in HIL requires the user to confirm", async () => {
		const dir = path.join(tmpDir, ".pakalon-agents", "ai-agents", "phase-1");
		for (const f of ["plan.md", "tasks.md", "user-stories.md", "phase-1.md"]) {
			fs.writeFileSync(path.join(dir, f), "x");
		}
		const denied = await shouldRerunPhase(tmpDir, "phase-1", "HIL", () => false);
		expect(denied).toBe(false);
		const allowed = await shouldRerunPhase(tmpDir, "phase-1", "HIL", () => true);
		expect(allowed).toBe(true);
	});

	test("writePhaseSummary creates and appends the file", () => {
		writePhaseSummary(tmpDir, "phase-1", "First run");
		const first = readLatestPhaseSummary(tmpDir, "phase-1");
		expect(first).toContain("First run");
		writePhaseSummary(tmpDir, "phase-1", "Second run");
		const second = readLatestPhaseSummary(tmpDir, "phase-1");
		expect(second).toContain("First run");
		expect(second).toContain("Second run");
	});

	test("readLatestPhaseSummary returns null on missing file", () => {
		expect(readLatestPhaseSummary(tmpDir, "phase-2")).toBeNull();
	});
});
