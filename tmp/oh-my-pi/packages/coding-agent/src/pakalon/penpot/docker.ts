/**
 * Penpot Docker orchestration for Pakalon.
 *
 * Spawns the Penpot container, waits for the HTTP endpoint to come
 * up, and tears it down when the user is done. The sync-bridge (file
 * watcher) runs in the same CLI process and pushes `.penpot` writes
 * to Penpot via the RPC client.
 *
 * Per CLI-req.md §108, the sync.js lifecycle is bound to the Penpot
 * container lifecycle:
 *   - start sync-bridge when the container is up (this also opens the
 *     browser to the Penpot URL via `/penpot`)
 *   - stop sync-bridge and remove the container when the process exits
 *     or a SIGINT/SIGTERM is received.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";

const DEFAULT_IMAGE = "penpot/penpot:latest";
const DEFAULT_PORT = 9100;
const CONTAINER_NAME = "pakalon-penpot";
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 1_000;

export interface PenpotHandle {
	url: string;
	containerId: string;
	stop: () => Promise<void>;
}

/** Lightweight lifecycle-event bus for the Penpot container. */
const lifecycleListeners = new Set<(event: PenpotLifecycleEvent) => void>();

export type PenpotLifecycleEvent =
	| { kind: "starting"; url: string; containerId: string }
	| { kind: "ready"; url: string; containerId: string }
	| { kind: "stopping"; containerId: string; reason: string }
	| { kind: "stopped"; containerId: string };

/**
 * Subscribe to Penpot lifecycle events. Returns an unsubscribe fn.
 * Used by the sync-bridge to bind its watcher to the container lifecycle.
 */
export function onPenpotLifecycle(fn: (e: PenpotLifecycleEvent) => void): () => void {
	lifecycleListeners.add(fn);
	return () => lifecycleListeners.delete(fn);
}

function emit(e: PenpotLifecycleEvent): void {
	for (const fn of lifecycleListeners) {
		try {
			fn(e);
		} catch (err) {
			logger.warn("penpot: lifecycle listener threw", { err });
		}
	}
}

/**
 * Resolve the user-configurable port (env override wins).
 */
export function getPenpotPort(): number {
	const env = process.env.PENPOT_PORT;
	return env ? Number(env) : DEFAULT_PORT;
}

/**
 * Check whether Docker is available on this machine.
 */
export async function isDockerAvailable(): Promise<boolean> {
	try {
		const result = await $`docker info --format '{{.ServerVersion}}'`.quiet().nothrow();
		return result.exitCode === 0 && result.text().trim().length > 0;
	} catch {
		return false;
	}
}

/**
 * Check whether a Penpot container is already running. If so, return
 * its handle (do not start a second one).
 */
export async function findExistingPenpot(): Promise<PenpotHandle | null> {
	try {
		const result = await $`docker ps --filter name=${CONTAINER_NAME} --format {{.ID}}`.quiet().nothrow();
		const id = result.text().trim();
		if (!id) return null;
		const url = `http://localhost:${getPenpotPort()}`;
		logger.info("penpot: found existing container", { containerId: id, url });
		emit({ kind: "ready", url, containerId: id });
		return { url, containerId: id, stop: () => stopPenpot(id, "explicit-stop") };
	} catch (err) {
		logger.debug("penpot: findExistingPenpot failed", { err });
		return null;
	}
}

/**
 * Start a Penpot container and wait for it to be ready.
 *
 * Side effects (per CLI-req.md §108):
 *  - Installs process exit / SIGINT / SIGTERM handlers so the container
 *    is auto-stopped when the CLI exits.
 *  - Emits a "ready" lifecycle event so the sync-bridge auto-starts.
 */
export async function startPenpotContainer(opts: { port?: number; image?: string } = {}): Promise<PenpotHandle> {
	const existing = await findExistingPenpot();
	if (existing) return existing;

	const port = opts.port ?? getPenpotPort();
	const image = opts.image ?? DEFAULT_IMAGE;

	if (!(await isDockerAvailable())) {
		throw new Error("Penpot requires Docker, but `docker` was not found on PATH.");
	}

	logger.info("penpot: starting container", { image, port });
	emit({ kind: "starting", url: `http://localhost:${port}`, containerId: "pending" });
	const runResult = await $`docker run -d --rm --name ${CONTAINER_NAME} -p ${port}:80 ${image}`.quiet().nothrow();
	if (runResult.exitCode !== 0) {
		const stderr = runResult.stderr.toString();
		throw new Error(`Penpot container failed to start: ${stderr}`);
	}
	const containerId = runResult.text().trim();
	const url = `http://localhost:${port}`;

	logger.info("penpot: waiting for HTTP endpoint", { url });
	const ready = await waitForHttp(url, READY_TIMEOUT_MS);
	if (!ready) {
		await stopPenpot(containerId, "not-ready");
		throw new Error(`Penpot did not become ready within ${READY_TIMEOUT_MS / 1000}s`);
	}

	installProcessExitHandlers(containerId);
	emit({ kind: "ready", url, containerId });

	return { url, containerId, stop: () => stopPenpot(containerId, "explicit-stop") };
}

/** Stop a Penpot container by id, emitting lifecycle events. */
export async function stopPenpot(containerId: string, reason: string = "explicit-stop"): Promise<void> {
	emit({ kind: "stopping", containerId, reason });
	try {
		await $`docker stop ${containerId}`.quiet().nothrow();
		logger.info("penpot: container stopped", { containerId, reason });
	} catch (err) {
		logger.warn("penpot: stop failed", { containerId, err });
	} finally {
		emit({ kind: "stopped", containerId });
	}
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const resp = await fetch(url, { signal: AbortSignal.timeout(2_000) });
			if (resp.ok || resp.status < 500) return true;
		} catch {
			/* not ready yet */
		}
		await Bun.sleep(READY_POLL_MS);
	}
	return false;
}

/**
 * Best-effort install of process exit / SIGINT / SIGTERM handlers that
 * auto-stop the Penpot container. Idempotent: re-installing for a
 * different container replaces the previous handlers.
 *
 * Per CLI-req.md §108: "this file should act as bridge between the
 * changes that are made in penpot via frontend and backend file
 * syncing. In the code there should be cooldown period which prevents
 * the excessive token usage. ... The sync.js automatically starts when
 * the penpot is opened, and closes when penpot is closed, the
 * starting and stoping of penpot is entirely depends on sync.js file
 * only."
 */
const handlers = new Map<string, () => void>();

function installProcessExitHandlers(containerId: string): void {
	removeProcessExitHandlers();
	const onSignal = (sig: NodeJS.Signals | "exit") => {
		logger.info("penpot: process exiting, stopping container", { containerId, sig });
		// Best-effort: not awaited, but emits the lifecycle event so
		// the sync-bridge can stop watching the file system.
		void stopPenpot(containerId, `process-${sig}`).catch(err =>
			logger.warn("penpot: exit-handler stop failed", { containerId, err }),
		);
	};
	const onSigInt = () => onSignal("SIGINT");
	const onSigTerm = () => onSignal("SIGTERM");
	process.on("SIGINT", onSigInt);
	process.on("SIGTERM", onSigTerm);
	const onExit = () => onSignal("exit");
	process.on("exit", onExit);
	handlers.set(containerId, () => {
		process.off("SIGINT", onSigInt);
		process.off("SIGTERM", onSigTerm);
		process.off("exit", onExit);
	});
}

function removeProcessExitHandlers(): void {
	for (const cleanup of handlers.values()) cleanup();
	handlers.clear();
}
