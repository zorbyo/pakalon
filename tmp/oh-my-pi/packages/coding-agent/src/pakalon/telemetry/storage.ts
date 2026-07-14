/**
 * Telemetry + machine-id storage for Pakalon.
 * Tracks per-install identifiers (machineId, macMachineId, devDeviceId)
 * plus account info — mirrors the Cursor-style storage format.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

const STORAGE_PATH = path.join(os.homedir(), ".pakalon", "storage.json");

export interface StorageRecord {
	"telemetry.machineId": string;
	"telemetry.macMachineId": string;
	"telemetry.devDeviceId": string;
	"account.email"?: string;
	"account.name"?: string;
	"privacy.enabled"?: boolean;
	"usage.totalPrompts"?: number;
	"usage.totalAIRequests"?: number;
	"usage.linesAdded"?: number;
	"usage.linesRemoved"?: number;
}

const DEFAULTS: StorageRecord = {
	"telemetry.machineId": "",
	"telemetry.macMachineId": "",
	"telemetry.devDeviceId": "",
};

function ensureDir(): void {
	fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
}

function macHash(): string {
	const ifaces = os.networkInterfaces();
	const macs: string[] = [];
	for (const list of Object.values(ifaces)) {
		if (!list) continue;
		for (const i of list) {
			if (i.mac && i.mac !== "00:00:00:00:00:00") macs.push(i.mac);
		}
	}
	return crypto.createHash("sha256").update(macs.sort().join("|")).digest("hex").slice(0, 32);
}

function genId(): string {
	return crypto.randomUUID();
}

/** Load the storage record, seeding it on first read. */
export function loadStorage(): StorageRecord {
	try {
		const raw = JSON.parse(fs.readFileSync(STORAGE_PATH, "utf-8")) as StorageRecord;
		return { ...DEFAULTS, ...raw };
	} catch {
		ensureDir();
		const seed: StorageRecord = {
			"telemetry.machineId": genId(),
			"telemetry.macMachineId": macHash(),
			"telemetry.devDeviceId": genId(),
		};
		fs.writeFileSync(STORAGE_PATH, JSON.stringify(seed, null, 2), { mode: 0o600 });
		return seed;
	}
}

/** Persist updated fields; merges with the existing record. */
export function saveStorage(patch: Partial<StorageRecord>): StorageRecord {
	const current = loadStorage();
	const next = { ...current, ...patch };
	ensureDir();
	fs.writeFileSync(STORAGE_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
	return next;
}

/** Increment a numeric usage counter. */
export function bumpUsage(field: keyof StorageRecord, by: number = 1): void {
	const cur = loadStorage();
	const val = (cur[field] as number | undefined) ?? 0;
	saveStorage({ [field]: val + by } as Partial<StorageRecord>);
}

/** Reset the storage record (used by the "Fake pakalon" dev command). */
export function resetStorage(): void {
	try {
		fs.unlinkSync(STORAGE_PATH);
	} catch {
		/* ignore */
	}
	logger.info("Telemetry storage reset");
}

/** Whether the user opted into privacy mode. */
export function isPrivacyEnabled(): boolean {
	return loadStorage()["privacy.enabled"] === true;
}
