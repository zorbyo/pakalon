/**
 * Tests for the self-hosted runtime gate.
 *
 * Per CLI-req.md §707-713 / code.md §17, in self-hosted mode:
 *   - auth is skipped
 *   - only local models (Ollama / LM Studio) are used
 *   - no token window is shown
 *
 * These tests verify the gate logic. They do NOT actually start
 * Ollama / LM Studio; the registry code paths are exercised through
 * the `isSelfHostedMode` predicate.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("self-hosted mode gate", () => {
	const ORIGINAL_PAKALON_MODE = process.env.PAKALON_MODE;
	const ORIGINAL_PAKALON_SELF_HOSTED = process.env.PAKALON_SELF_HOSTED;

	beforeEach(() => {
		delete process.env.PAKALON_MODE;
		delete process.env.PAKALON_SELF_HOSTED;
	});

	afterEach(() => {
		if (ORIGINAL_PAKALON_MODE === undefined) delete process.env.PAKALON_MODE;
		else process.env.PAKALON_MODE = ORIGINAL_PAKALON_MODE;
		if (ORIGINAL_PAKALON_SELF_HOSTED === undefined) delete process.env.PAKALON_SELF_HOSTED;
		else process.env.PAKALON_SELF_HOSTED = ORIGINAL_PAKALON_SELF_HOSTED;
	});

	it("defaults to cloud mode (not self-hosted) when no env var is set", async () => {
		const { isSelfHostedMode } = await import("./registry");
		expect(isSelfHostedMode()).toBe(false);
	});

	it("returns true when PAKALON_MODE=selfhosted", async () => {
		process.env.PAKALON_MODE = "selfhosted";
		const { isSelfHostedMode } = await import("./registry");
		expect(isSelfHostedMode()).toBe(true);
	});

	it("returns true when PAKALON_SELF_HOSTED=1 (legacy flag)", async () => {
		process.env.PAKALON_SELF_HOSTED = "1";
		const { isSelfHostedMode } = await import("./registry");
		expect(isSelfHostedMode()).toBe(true);
	});

	it("pre-launch returns skipped=true in self-hosted mode", async () => {
		process.env.PAKALON_MODE = "selfhosted";
		const { runPreLaunchAuthGate } = await import("../pre-launch");
		const result = await runPreLaunchAuthGate({});
		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("self-hosted");
	});

	it("pre-launch returns skipped=true in smoke-test mode", async () => {
		const { runPreLaunchAuthGate } = await import("../pre-launch");
		const result = await runPreLaunchAuthGate({ smokeTest: true });
		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("smoke-test");
	});

	it("shouldRunAuthGate returns false in self-hosted mode", async () => {
		process.env.PAKALON_MODE = "selfhosted";
		const { shouldRunAuthGate } = await import("../pre-launch");
		expect(shouldRunAuthGate({})).toBe(false);
	});
});
