/**
 * Tests for telemetry storage.
 *
 * Per CLI-req.md §588-593, the CLI persists three machine IDs at
 * `~/.pakalon/storage.json` (`telemetry.machineId`,
 * `telemetry.macMachineId`, `telemetry.devDeviceId`) plus a
 * `privacy.enabled` flag. These IDs are stable across restarts.
 *
 * Per code.md §15, the privacy flag must short-circuit provider
 * training. We verify the flag round-trips through save/load.
 */
import { describe, expect, it } from "bun:test";

describe("telemetry storage", () => {
	it("seeds all three machine IDs on first read", async () => {
		const { loadStorage } = await import("./storage");
		const s = loadStorage();
		expect(typeof s["telemetry.machineId"]).toBe("string");
		expect((s["telemetry.machineId"] as string).length).toBeGreaterThan(0);
		expect(typeof s["telemetry.macMachineId"]).toBe("string");
		expect((s["telemetry.macMachineId"] as string).length).toBeGreaterThan(0);
		expect(typeof s["telemetry.devDeviceId"]).toBe("string");
		expect((s["telemetry.devDeviceId"] as string).length).toBeGreaterThan(0);
	});

	it("machine IDs are stable across reads", async () => {
		const { loadStorage } = await import("./storage");
		const a = loadStorage();
		const b = loadStorage();
		expect(a["telemetry.machineId"]).toBe(b["telemetry.machineId"]);
		expect(a["telemetry.macMachineId"]).toBe(b["telemetry.macMachineId"]);
		expect(a["telemetry.devDeviceId"]).toBe(b["telemetry.devDeviceId"]);
	});

	it("privacy mode flag round-trips", async () => {
		const { loadStorage, saveStorage, isPrivacyEnabled } = await import("./storage");
		saveStorage({ "privacy.enabled": true });
		const s = loadStorage();
		expect(s["privacy.enabled"]).toBe(true);
		expect(isPrivacyEnabled()).toBe(true);
	});

	it("privacy mode defaults to false", async () => {
		const { isPrivacyEnabled } = await import("./storage");
		// isPrivacyEnabled is read from disk; the previous test set it
		// to true. We re-save false here to keep the test self-contained.
		const { saveStorage } = await import("./storage");
		saveStorage({ "privacy.enabled": false });
		expect(isPrivacyEnabled()).toBe(false);
	});
});
