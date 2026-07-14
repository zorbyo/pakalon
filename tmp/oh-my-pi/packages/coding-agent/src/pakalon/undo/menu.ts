/**
 * Undo menu for Pakalon.
 * Renders the 4-option revert menu (conversation / code / both / nothing)
 * and dispatches to the file-recorder + session-message pop.
 *
 * Snapshots now persist the *contents* of changed files (not just
 * their paths) under `.pakalon/checkpoints/<id>.json`. On undo, the
 * contents are restored to disk via an atomic `writeFile` and the
 * snapshot file is removed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export type UndoTarget = "conversation" | "code" | "both" | "nothing";

const CHECKPOINTS_DIR = ".pakalon/checkpoints";

export interface UndoFileSnapshot {
	/** Absolute path. */
	path: string;
	/** Full file contents at snapshot time. */
	contents: string;
	/** True if the file did not exist before the change. */
	created: boolean;
}

export interface UndoSnapshot {
	id: string;
	timestamp: string;
	files: UndoFileSnapshot[];
	conversationTail: number;
}

function checkpointDir(projectDir: string): string {
	const d = path.join(projectDir, CHECKPOINTS_DIR);
	fs.mkdirSync(d, { recursive: true });
	return d;
}

/** Capture the current contents of a file (or mark it as created). */
function captureFileContents(absPath: string): UndoFileSnapshot {
	try {
		const contents = fs.readFileSync(absPath, "utf-8");
		return { path: absPath, contents, created: false };
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			// File was newly created — record it as such so undo can
			// delete it on restore.
			return { path: absPath, contents: "", created: true };
		}
		// Permission errors / binary files: record empty + flag.
		logger.warn(`undo: failed to read ${absPath}: ${err}`);
		return { path: absPath, contents: "", created: false };
	}
}

/** Record a snapshot of the most recent file changes (with full contents). */
export function recordSnapshot(projectDir: string, changedFilePaths: string[], conversationTail: number): UndoSnapshot {
	const files = changedFilePaths.map(p => captureFileContents(path.isAbsolute(p) ? p : path.join(projectDir, p)));
	const snap: UndoSnapshot = {
		id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
		timestamp: new Date().toISOString(),
		files,
		conversationTail,
	};
	const dir = checkpointDir(projectDir);
	fs.writeFileSync(path.join(dir, `${snap.id}.json`), JSON.stringify(snap, null, 2));
	return snap;
}

/** Get the most recent snapshot (if any). */
export function latestSnapshot(projectDir: string): UndoSnapshot | null {
	const dir = path.join(projectDir, CHECKPOINTS_DIR);
	if (!fs.existsSync(dir)) return null;
	const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
	if (files.length === 0) return null;
	// Sort by filename descending — IDs start with a base-36 timestamp,
	// so the lexicographic order matches the chronological order.
	files.sort();
	const last = files[files.length - 1]!;
	try {
		return JSON.parse(fs.readFileSync(path.join(dir, last), "utf-8")) as UndoSnapshot;
	} catch {
		return null;
	}
}

/** Write a single file's restored contents to disk (atomic). */
function restoreFile(snap: UndoFileSnapshot): { restored: boolean; reason?: string } {
	try {
		if (snap.created) {
			// The file was newly created by the change being undone — delete it.
			try {
				fs.unlinkSync(snap.path);
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code !== "ENOENT") throw err;
			}
			return { restored: true };
		}
		// Restore the captured contents. Write to a temp file first then
		// rename to ensure the operation is atomic.
		const dir = path.dirname(snap.path);
		fs.mkdirSync(dir, { recursive: true });
		const tmp = `${snap.path}.undo.${process.pid}.${Date.now()}.tmp`;
		fs.writeFileSync(tmp, snap.contents, "utf-8");
		fs.renameSync(tmp, snap.path);
		return { restored: true };
	} catch (err) {
		logger.error(`undo: failed to restore ${snap.path}`, { err });
		return { restored: false, reason: String(err) };
	}
}

/** Apply the chosen undo target. Returns the list of files actually restored. */
export function applyUndo(
	projectDir: string,
	target: UndoTarget,
): { restored: string[]; popped: number; failed: Array<{ path: string; reason: string }> } {
	const snap = latestSnapshot(projectDir);
	if (!snap) {
		logger.info("undo: no snapshots to apply");
		return { restored: [], popped: 0, failed: [] };
	}
	if (target === "nothing") return { restored: [], popped: 0, failed: [] };

	const restored: string[] = [];
	const failed: Array<{ path: string; reason: string }> = [];
	if (target === "code" || target === "both") {
		for (const f of snap.files) {
			const r = restoreFile(f);
			if (r.restored) restored.push(f.path);
			else failed.push({ path: f.path, reason: r.reason ?? "unknown" });
		}
	}
	const popped = target === "conversation" || target === "both" ? snap.conversationTail : 0;

	// Remove the consumed snapshot so the next /undo targets the prior one.
	try {
		fs.unlinkSync(path.join(projectDir, CHECKPOINTS_DIR, `${snap.id}.json`));
	} catch {
		/* ignore */
	}
	return { restored, popped, failed };
}

/** Convenience: record a snapshot of the given files using the file recorder. */
export function snapshotFromFileRecorder(
	projectDir: string,
	record: { changedPaths: string[]; conversationTail?: number },
): UndoSnapshot {
	return recordSnapshot(projectDir, record.changedPaths, record.conversationTail ?? 0);
}
