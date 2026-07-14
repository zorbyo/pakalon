/**
 * Machine ID generation and tracking.
 * Creates a unique fingerprint for device identification.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { MachineId } from "./types";

const MACHINE_ID_PATH = path.join(os.homedir(), ".config", "pakalon", "machine.json");

/**
 * Generate a machine ID based on stable system attributes.
 */
export function generateMachineId(): MachineId {
	const hostname = os.hostname();
	const platform = os.platform();
	const arch = os.arch();
	const cpus = os.cpus().length;
	const totalMem = os.totalmem();
	const raw = `${hostname}:${platform}:${arch}:${cpus}:${totalMem}`;
	const hash = Bun.hash(raw).toString(36);

	const id: MachineId = {
		id: `pak-${hash}-${Date.now().toString(36)}`,
		hostname,
		platform: `${platform}-${arch}`,
		createdAt: new Date().toISOString(),
	};

	saveMachineId(id);
	return id;
}

/**
 * Load the persisted machine ID, or generate one if missing.
 */
export function getMachineId(): MachineId {
	try {
		if (fs.existsSync(MACHINE_ID_PATH)) {
			const raw = fs.readFileSync(MACHINE_ID_PATH, "utf-8");
			return JSON.parse(raw) as MachineId;
		}
	} catch (error) {
		logger.warn("Failed to load machine ID, regenerating", { error });
	}
	return generateMachineId();
}

/**
 * Persist machine ID to disk.
 */
export function saveMachineId(id: MachineId): void {
	try {
		fs.mkdirSync(path.dirname(MACHINE_ID_PATH), { recursive: true });
		fs.writeFileSync(MACHINE_ID_PATH, JSON.stringify(id, null, 2));
	} catch (error) {
		logger.warn("Failed to save machine ID", { error });
	}
}

/**
 * Get the raw machine fingerprint string (for telemetry).
 */
export function getMachineFingerprint(): string {
	const id = getMachineId();
	return `${id.id}:${id.platform}:${id.createdAt}`;
}
