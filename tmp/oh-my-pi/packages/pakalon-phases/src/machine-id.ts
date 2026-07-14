import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface MachineInfo {
	machineId: string;
	hostname: string;
	platform: string;
	arch: string;
	osVersion: string;
	cpuCores: number;
	totalMemory: number;
}

const CONFIG_DIR = path.join(os.homedir(), ".pakalon");

function generateMachineId(): string {
	const seed = [
		os.hostname(),
		os.platform(),
		os.arch(),
		os.release(),
		os.cpus().length,
		os.totalmem(),
		os.machine(),
	].join("|");
	return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

export function getMachineId(): string {
	try {
		fs.mkdirSync(CONFIG_DIR, { recursive: true });
		const idPath = path.join(CONFIG_DIR, "machine.json");
		let existing: { machineId?: string } | null = null;
		try {
			existing = JSON.parse(fs.readFileSync(idPath, "utf-8"));
		} catch {
			existing = null;
		}
		if (existing?.machineId) return existing.machineId;

		const machineId = generateMachineId();
		fs.writeFileSync(idPath, JSON.stringify({ machineId, createdAt: new Date().toISOString() }, null, 2));
		return machineId;
	} catch {
		return generateMachineId();
	}
}

export function getMachineInfo(): MachineInfo {
	return {
		machineId: getMachineId(),
		hostname: os.hostname(),
		platform: os.platform(),
		arch: os.arch(),
		osVersion: os.release(),
		cpuCores: os.cpus().length,
		totalMemory: os.totalmem(),
	};
}

export function machineIdTag(): string {
	const info = getMachineInfo();
	return `${info.machineId.slice(0, 8)}-${info.platform}-${info.hostname}`;
}
