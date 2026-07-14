/**
 * Tests for the undo menu's restore behaviour.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyUndo, recordSnapshot } from "./menu";

describe("undo/menu", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-undo-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("recordSnapshot + applyUndo(code) restores a file's contents", () => {
		const filePath = path.join(tmpDir, "hello.txt");
		fs.writeFileSync(filePath, "before", "utf-8");
		// Simulate the agent having changed the file.
		fs.writeFileSync(filePath, "after", "utf-8");
		recordSnapshot(tmpDir, [filePath], 0);
		// Agent overwrote the file again.
		fs.writeFileSync(filePath, "after-2", "utf-8");
		const { restored, popped } = applyUndo(tmpDir, "code");
		expect(popped).toBe(0);
		expect(restored.length).toBe(1);
		// The file is restored to the *captured* state ("after"), not "before".
		// That's the documented behaviour: we record the state at snapshot time.
		expect(fs.readFileSync(filePath, "utf-8")).toBe("after");
	});

	test("applyUndo deletes a file that was created by the agent", () => {
		const filePath = path.join(tmpDir, "new.txt");
		// File does not exist yet.
		recordSnapshot(tmpDir, [filePath], 0);
		// Agent creates the file.
		fs.writeFileSync(filePath, "created", "utf-8");
		applyUndo(tmpDir, "code");
		expect(fs.existsSync(filePath)).toBe(false);
	});

	test("applyUndo(conversation) does not touch files", () => {
		const filePath = path.join(tmpDir, "k.txt");
		fs.writeFileSync(filePath, "v1", "utf-8");
		fs.writeFileSync(filePath, "v2", "utf-8");
		recordSnapshot(tmpDir, [filePath], 5);
		const { restored, popped } = applyUndo(tmpDir, "conversation");
		expect(restored).toEqual([]);
		expect(popped).toBe(5);
		// File is untouched.
		expect(fs.readFileSync(filePath, "utf-8")).toBe("v2");
	});

	test("applyUndo(nothing) is a no-op", () => {
		const filePath = path.join(tmpDir, "n.txt");
		fs.writeFileSync(filePath, "x", "utf-8");
		fs.writeFileSync(filePath, "y", "utf-8");
		recordSnapshot(tmpDir, [filePath], 3);
		const { restored, popped } = applyUndo(tmpDir, "nothing");
		expect(restored).toEqual([]);
		expect(popped).toBe(0);
		expect(fs.readFileSync(filePath, "utf-8")).toBe("y");
	});

	test("applyUndo with no snapshot is a no-op", () => {
		const { restored, popped, failed } = applyUndo(tmpDir, "code");
		expect(restored).toEqual([]);
		expect(popped).toBe(0);
		expect(failed).toEqual([]);
	});
});
