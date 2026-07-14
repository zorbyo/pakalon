/**
 * Tests for telemetry: machine-id generation, event recording,
 * privacy-mode redaction, and the runtime integration hooks.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	getRecentEvents,
	hashProjectDir,
	isPrivacyMode,
	loadOrCreateStorage,
	modelUsageEvent,
	previewPrompt,
	promptSubmitEvent,
	recordEvent,
	resetMachineIds,
	sessionEndEvent,
	sessionStartEvent,
	setPrivacyMode,
	toolCallEvent,
} from "./index";
import { beginSession, endSession, recordModelUsage, recordPrompt, recordToolCall } from "./runtime";

function withTmpStorage<T>(fn: (home: string) => T): T {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-telemetry-"));
	const prev = process.env.HOME ?? process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		return fn(home);
	} finally {
		if (prev === undefined) {
			delete process.env.HOME;
			delete process.env.USERPROFILE;
		} else {
			process.env.HOME = prev;
			process.env.USERPROFILE = prev;
		}
		fs.rmSync(home, { recursive: true, force: true });
	}
}

describe("loadOrCreateStorage", () => {
	test("creates machine IDs on first run", () => {
		withTmpStorage(() => {
			const storage = loadOrCreateStorage();
			expect(storage.telemetry.machineId).toMatch(/[0-9a-f-]{36}/);
			expect(storage.telemetry.macMachineId).toMatch(/[0-9a-f]{32}/);
			expect(storage.telemetry.devDeviceId).toMatch(/[0-9a-f-]{36}/);
		});
	});

	test("returns same machine IDs on second run", () => {
		withTmpStorage(() => {
			const first = loadOrCreateStorage().telemetry;
			const second = loadOrCreateStorage().telemetry;
			expect(second.machineId).toBe(first.machineId);
			expect(second.macMachineId).toBe(first.macMachineId);
		});
	});

	test("resetMachineIds rotates the IDs", () => {
		withTmpStorage(() => {
			const before = loadOrCreateStorage().telemetry;
			const after = resetMachineIds();
			expect(after.machineId).not.toBe(before.machineId);
		});
	});
});

describe("privacy mode", () => {
	test("setPrivacyMode toggles correctly", () => {
		withTmpStorage(() => {
			loadOrCreateStorage();
			expect(isPrivacyMode()).toBe(false);
			setPrivacyMode(true);
			expect(isPrivacyMode()).toBe(true);
			setPrivacyMode(false);
			expect(isPrivacyMode()).toBe(false);
		});
	});
});

describe("event recording", () => {
	test("records and retrieves events", () => {
		withTmpStorage(() => {
			loadOrCreateStorage();
			recordEvent(sessionStartEvent("s1", "proj-hash", "anthropic/claude-sonnet-4"));
			recordEvent(modelUsageEvent("s1", "anthropic/claude-sonnet-4", 100, 200));
			const events = getRecentEvents(10);
			expect(events).toHaveLength(2);
			expect(events[0]?.type).toBe("session.start");
			expect(events[1]?.type).toBe("model.usage");
		});
	});

	test("redacts prompt preview under privacy mode", () => {
		withTmpStorage(() => {
			loadOrCreateStorage();
			setPrivacyMode(true);
			recordEvent(promptSubmitEvent("s1", "console.log('secret')"));
			const events = getRecentEvents(1);
			expect(events[0]?.promptPreview).toBe("[redacted]");
		});
	});

	test("keeps prompt preview when privacy mode is off", () => {
		withTmpStorage(() => {
			loadOrCreateStorage();
			setPrivacyMode(false);
			recordEvent(promptSubmitEvent("s1", "echo hello"));
			const events = getRecentEvents(1);
			expect(events[0]?.promptPreview).toBe("echo hello");
		});
	});
});

describe("prompt preview", () => {
	test("truncates prompts over 4KB", () => {
		const big = "x".repeat(5_000);
		const previewed = previewPrompt(big);
		expect(previewed.length).toBeLessThan(5_000);
		expect(previewed).toContain("…[truncated]");
	});

	test("passes small prompts through", () => {
		expect(previewPrompt("hello")).toBe("hello");
	});
});

describe("hashProjectDir", () => {
	test("is stable per directory", () => {
		const a = hashProjectDir("/Users/x/projects/foo");
		const b = hashProjectDir("/Users/x/projects/foo");
		expect(a).toBe(b);
	});
	test("differs for different directories", () => {
		const a = hashProjectDir("/Users/x/projects/foo");
		const b = hashProjectDir("/Users/x/projects/bar");
		expect(a).not.toBe(b);
	});
});

describe("runtime hooks", () => {
	test("beginSession + record* + endSession flow", () => {
		withTmpStorage(() => {
			const ctx = beginSession("sess-1", "/Users/x/proj");
			expect(ctx.projectDir).toMatch(/[0-9a-f]{16}/);
			recordPrompt(ctx, "first prompt");
			recordToolCall(ctx, "bash", "ok");
			recordModelUsage(ctx, "anthropic/claude-sonnet-4", 100, 50);
			endSession(ctx, 100, 50, 1234);
			const events = getRecentEvents(10);
			// 1 start + 1 prompt + 1 tool + 1 usage + 1 end = 5
			expect(events).toHaveLength(5);
			expect(events[0]?.type).toBe("session.start");
			expect(events[events.length - 1]?.type).toBe("session.end");
		});
	});
});

describe("factory functions", () => {
	test("sessionStartEvent shape", () => {
		const ev = sessionStartEvent("s1", "p1", "model-x");
		expect(ev.type).toBe("session.start");
		expect(ev.sessionId).toBe("s1");
		expect(ev.model).toBe("model-x");
	});
	test("sessionEndEvent includes duration and tokens", () => {
		const ev = sessionEndEvent("s1", 5_000, 100, 200);
		expect(ev.type).toBe("session.end");
		expect(ev.durationMs).toBe(5_000);
		expect(ev.inputTokens).toBe(100);
		expect(ev.outputTokens).toBe(200);
	});
	test("toolCallEvent shape", () => {
		const ev = toolCallEvent("s1", "bash", "error");
		expect(ev.toolName).toBe("bash");
		expect(ev.toolStatus).toBe("error");
	});
});
