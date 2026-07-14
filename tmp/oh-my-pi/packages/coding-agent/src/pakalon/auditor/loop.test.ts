/**
 * Tests for the auditor loop exit conditions.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type AuditReport, computeIterationLimit, runAuditorLoopWith } from "./loop";

describe("auditor/loop", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-auditor-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("computeIterationLimit caps YOLO at 10", () => {
		expect(computeIterationLimit("YOLO", 3)).toBe(3);
		expect(computeIterationLimit("YOLO", 10)).toBe(10);
		expect(computeIterationLimit("YOLO", 50)).toBe(10);
	});

	test("computeIterationLimit clamps HIL to >= 1", () => {
		expect(computeIterationLimit("HIL", 3)).toBe(3);
		expect(computeIterationLimit("HIL", 0)).toBe(1);
		expect(computeIterationLimit("HIL", -5)).toBe(1);
	});

	test("exits early on 100% pass (missing=0, partial=0)", async () => {
		const alwaysPerfect: AuditReport = {
			generatedAt: new Date().toISOString(),
			complete: 5,
			partial: 0,
			missing: 0,
			buckets: [],
			recommendedNext: "do-nothing",
		};
		const r = await runAuditorLoopWith(tmpDir, "YOLO", 10, async () => alwaysPerfect);
		expect(r.iterations).toBe(1); // exited after the first pass
		expect(r.finalReport.complete).toBe(5);
	});

	test("exits after max iterations in YOLO when never reaching 100%", async () => {
		let i = 0;
		const r = await runAuditorLoopWith(tmpDir, "YOLO", 10, async () => {
			i++;
			return {
				generatedAt: new Date().toISOString(),
				complete: 1,
				partial: 1,
				missing: 1,
				buckets: [],
				recommendedNext: "remediate-all",
			};
		});
		expect(r.iterations).toBe(10); // ran all 10 iterations
		expect(i).toBe(10);
	});

	test("HIL exits when recommendedNext is do-nothing", async () => {
		let i = 0;
		const r = await runAuditorLoopWith(tmpDir, "HIL", 5, async () => {
			i++;
			return {
				generatedAt: new Date().toISOString(),
				complete: 1,
				partial: 1,
				missing: 1,
				buckets: [],
				recommendedNext: i >= 2 ? "do-nothing" : "remediate-all",
			};
		});
		expect(r.iterations).toBe(2);
	});

	test("writes auditor.md to phase-3 on each pass", async () => {
		let i = 0;
		const r = await runAuditorLoopWith(tmpDir, "YOLO", 3, async () => {
			i++;
			return {
				generatedAt: new Date().toISOString(),
				complete: 0,
				partial: 0,
				missing: 0,
				buckets: [{ feature: "test", status: "complete" }],
				recommendedNext: "do-nothing",
			};
		});
		expect(r.iterations).toBe(1);
		const md = fs.readFileSync(path.join(tmpDir, ".pakalon-agents", "ai-agents", "phase-3", "auditor.md"), "utf-8");
		expect(md).toContain("# Auditor Report");
		expect(md).toContain("Complete: **1**");
	});
});
