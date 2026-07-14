/**
 * Tests for the agent-team registry (persists to .pakalon/agents/*.json).
 *
 * Defends the contract: agents are keyed by stable id, list returns
 * the saved entries in insertion order, and deriveId slugifies a
 * display name into a filesystem-safe id.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deleteAgent, deriveId, findAgentByName, listAgents, saveAgent } from "./registry";

let tmp: string;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-agents-"));
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

const makeAgent = (overrides: Partial<{ id: string; name: string }> = {}) => ({
	id: overrides.id ?? "tester",
	name: overrides.name ?? "Test agent",
	description: "",
	color: "#3B82F6",
	tools: ["read"],
	systemPrompt: "You are a tester.",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
});

describe("deriveId", () => {
	test("slugifies a name", () => {
		expect(deriveId("Codebase Auditor")).toBe("codebase-auditor");
		expect(deriveId("Hello World!")).toBe("hello-world");
	});

	test("truncates to 32 chars", () => {
		const id = deriveId("a".repeat(100));
		expect(id.length).toBeLessThanOrEqual(32);
	});

	test("falls back to timestamp id for empty input", () => {
		expect(deriveId("")).toMatch(/^agent-/);
	});
});

describe("saveAgent / listAgents / findAgentByName", () => {
	test("save + list round-trips", () => {
		saveAgent(tmp, makeAgent());
		const all = listAgents(tmp);
		expect(all).toHaveLength(1);
		expect(all[0]?.id).toBe("tester");
	});

	test("findAgentByName matches id or name", () => {
		saveAgent(tmp, makeAgent());
		expect(findAgentByName(tmp, "tester")?.id).toBe("tester");
		expect(findAgentByName(tmp, "Test agent")?.id).toBe("tester");
		expect(findAgentByName(tmp, "missing")).toBeNull();
	});

	test("returns [] when no agents exist", () => {
		expect(listAgents(tmp)).toEqual([]);
	});
});

describe("deleteAgent", () => {
	test("removes the agent file", () => {
		saveAgent(tmp, makeAgent());
		const removed = deleteAgent(tmp, "tester");
		expect(removed).toBe(true);
		expect(listAgents(tmp)).toEqual([]);
	});

	test("returns false for an unknown id", () => {
		expect(deleteAgent(tmp, "nope")).toBe(false);
	});
});
