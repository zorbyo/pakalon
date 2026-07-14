import { logger } from "@oh-my-pi/pi-utils";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ModeName } from "./types";

const CONFIG_DIR = join(homedir(), ".config", "pakalon");
const MODE_PREF_FILE = join(CONFIG_DIR, "mode-preference.json");

function ensureConfigDir(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

export function saveModePreference(mode: ModeName): void {
	try {
		ensureConfigDir();
		writeFileSync(MODE_PREF_FILE, JSON.stringify({ mode, savedAt: new Date().toISOString() }), "utf-8");
	} catch (error) {
		logger.error("Failed to save mode preference", { error });
	}
}

export function loadModePreference(): ModeName | null {
	try {
		if (!existsSync(MODE_PREF_FILE)) return null;
		const data = JSON.parse(readFileSync(MODE_PREF_FILE, "utf-8")) as { mode: ModeName };
		return data.mode;
	} catch (error) {
		logger.warn("Failed to load mode preference", { error });
		return null;
	}
}

export function clearModePreference(): void {
	try {
		if (existsSync(MODE_PREF_FILE)) {
			writeFileSync(MODE_PREF_FILE, JSON.stringify({ mode: "edit", savedAt: new Date().toISOString() }), "utf-8");
		}
	} catch (error) {
		logger.error("Failed to clear mode preference", { error });
	}
}
