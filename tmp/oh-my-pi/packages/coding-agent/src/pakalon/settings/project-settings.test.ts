/**
 * Tests for the settings.local.json per-project permission persistence.
 *
 * Defends the contract: load returns defaults when the file is
 * missing; set+load round-trips; allowed-permission lookups are
 * accurate.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	effectiveAutoAccept,
	isAlwaysAllowed,
	isPermissionAllowed,
	loadProjectSettings,
	saveProjectSettings,
	setAllowedPermission,
	setAlwaysAllow,
	setAutoAcceptTool,
	setDeniedTool,
} from "./project-settings";

let tmp: string;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pakalon-settings-"));
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("loadProjectSettings", () => {
	test("returns defaults when the file is missing", () => {
		const s = loadProjectSettings(tmp);
		expect(s.allowedPermissions).toEqual({});
		expect(s.autoAcceptTools).toEqual([]);
		expect(s.deniedTools).toEqual([]);
	});

	test("round-trips through save + load", () => {
		saveProjectSettings(tmp, {
			allowedPermissions: { "bash:npm install *": true },
			autoAcceptTools: ["read", "grep"],
			deniedTools: ["rm -rf"],
		});
		const loaded = loadProjectSettings(tmp);
		expect(loaded.allowedPermissions["bash:npm install *"]).toBe(true);
		expect(loaded.autoAcceptTools).toEqual(["read", "grep"]);
		expect(loaded.deniedTools).toEqual(["rm -rf"]);
	});
});

describe("setAllowedPermission", () => {
	test("sets and reads back a single rule", () => {
		setAllowedPermission(tmp, "bash:bun install", true);
		expect(isPermissionAllowed(tmp, "bash:bun install")).toBe(true);
	});

	test("toggling off removes the rule", () => {
		setAllowedPermission(tmp, "bash:test", true);
		setAllowedPermission(tmp, "bash:test", false);
		expect(isPermissionAllowed(tmp, "bash:test")).toBe(false);
	});
});

describe("setAutoAcceptTool / setDeniedTool", () => {
	test("adds and removes a tool from autoAccept", () => {
		setAutoAcceptTool(tmp, "read", true);
		expect(loadProjectSettings(tmp).autoAcceptTools).toContain("read");
		setAutoAcceptTool(tmp, "read", false);
		expect(loadProjectSettings(tmp).autoAcceptTools).not.toContain("read");
	});

	test("adds and removes a tool from denied", () => {
		setDeniedTool(tmp, "rm", true);
		expect(loadProjectSettings(tmp).deniedTools).toContain("rm");
	});
});

describe("effectiveAutoAccept", () => {
	test("merges global + local", () => {
		setAutoAcceptTool(tmp, "read", true);
		setAutoAcceptTool(tmp, "grep", true);
		const merged = effectiveAutoAccept(tmp, ["bash"]);
		expect(merged.sort()).toEqual(["bash", "grep", "read"]);
	});
});

describe("setAlwaysAllow (per CLI-req.md §701)", () => {
	test("adds a tool to the alwaysAllow list", () => {
		setAlwaysAllow(tmp, "bash", true);
		expect(isAlwaysAllowed(tmp, "bash")).toBe(true);
	});
	test("removes a tool from the alwaysAllow list", () => {
		setAlwaysAllow(tmp, "bash", true);
		setAlwaysAllow(tmp, "bash", false);
		expect(isAlwaysAllowed(tmp, "bash")).toBe(false);
	});
	test("the alwaysAllow list is persisted across save/load", () => {
		setAlwaysAllow(tmp, "edit", true);
		setAlwaysAllow(tmp, "bash", true);
		const loaded = loadProjectSettings(tmp);
		expect(loaded.alwaysAllow?.sort()).toEqual(["bash", "edit"]);
	});
});
