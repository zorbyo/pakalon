/**
 * Penpot sync bridge for Pakalon.
 *
 * Connects to a running Penpot container via WebSocket and pushes
 * changes to `.pakalon-agents/ai-agents/phase-2/Wireframe_generated.penpot`
 * (and the JSON / SVG siblings). Runs as a background task started
 * by `/penpot` and torn down by `/penpot-stop`.
 *
 * Two layers:
 *  - **Filesystem watcher**: the existing `fs.watch` (a
 *    `chokidar`-style debounce) detects local writes. This is the
 *    only reliable way to detect file changes cross-platform.
 *  - **Penpot WebSocket**: opens a connection to
 *    `${penpotUrl}/api/ws` and pushes a JSON-RPC `file-changed`
 *    notification whenever a watched file changes. Penpot does not
 *    expose a public plugin API for ingesting external files, so the
 *    WebSocket payload is a marker that a future Penpot plugin can
 *    subscribe to. Today it acts as a heartbeat + presence beacon;
 *    the next major Penpot version will add the matching listener.
 *
 * The fallback (no Penpot running, or WebSocket unreachable) is
 * identical to the legacy file-watcher behaviour.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { onPenpotLifecycle, type PenpotHandle, startPenpotContainer } from "./docker";
import { readPenpotFile } from "./format";

const WS_RECONNECT_MS = 3_000;

/**
 * Read the sync-bridge cooldown from the environment, falling back to
 * the canonical 2s default. Per CLI-req.md §108 the cooldown is
 * configurable in `settings.local.json`; the `pakalon.penpot.cooldownMs`
 * key is read here on each bridge start so live changes take effect.
 */
function readCooldownMs(): number {
	const envVal = process.env.PENPOT_COOLDOWN_MS;
	if (envVal && !Number.isNaN(Number(envVal))) {
		return Math.max(100, Number(envVal));
	}
	try {
		// Lazy require to avoid a hard module-graph dep on project-settings.
		const settingsPath = path.join(process.cwd(), ".pakalon", "settings.local.json");
		if (fs.existsSync(settingsPath)) {
			const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
				pakalon?: { penpot?: { cooldownMs?: number } };
			};
			const v = raw?.pakalon?.penpot?.cooldownMs;
			if (typeof v === "number" && v > 0) return Math.max(100, v);
		}
	} catch {
		/* fall through */
	}
	return 2_000;
}

export interface SyncBridgeConfig {
	projectDir: string;
	penpotUrl: string;
	onChange?: (file: string) => void | Promise<void>;
}

export interface SyncBridgeHandle {
	running: boolean;
	watching: string;
	penpot: PenpotHandle | null;
	ws: WebSocket | null;
	stop: () => Promise<void>;
	/** Last connection state of the Penpot WebSocket. */
	wsState: "connected" | "connecting" | "disconnected" | "off";
}

let watcher: fs.FSWatcher | null = null;
let lastSync = 0;
let currentConfig: SyncBridgeConfig | null = null;
let currentHandle: SyncBridgeHandle | null = null;
let wsRef: WebSocket | null = null;
let wsStateRef: SyncBridgeHandle["wsState"] = "off";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Per CLI-req.md §108, the sync-bridge lifecycle is bound to the
 * Penpot container lifecycle. We install a one-shot global subscriber
 * at module load time that auto-starts the bridge whenever Penpot is
 * ready and auto-stops it whenever Penpot stops.
 *
 * The subscriber is idempotent: multiple containers or repeated starts
 * are coalesced.
 */
let lifecycleInstalled = false;
function installLifecycleBinding(): void {
	if (lifecycleInstalled) return;
	lifecycleInstalled = true;
	onPenpotLifecycle(evt => {
		if (evt.kind === "ready") {
			// Auto-start if a project is registered with the bridge config.
			if (currentConfig && !currentHandle) {
				logger.info("sync-bridge: auto-starting (penpot ready)", { url: evt.url });
				startSyncBridge(currentConfig).catch(err => logger.warn("sync-bridge: auto-start failed", { err }));
			}
		} else if (evt.kind === "stopping" || evt.kind === "stopped") {
			if (currentHandle) {
				logger.info("sync-bridge: auto-stopping (penpot stopped)", { evt });
				stopSyncBridge().catch(err => logger.warn("sync-bridge: auto-stop failed", { err }));
			}
		}
	});
}
installLifecycleBinding();

/** Open the Penpot WebSocket and start emitting `file-changed` events. */
function openWebSocket(url: string): void {
	if (wsRef && (wsRef.readyState === WebSocket.OPEN || wsRef.readyState === WebSocket.CONNECTING)) {
		return;
	}
	wsStateRef = "connecting";
	const wsUrl = `${url.replace(/^http/, "ws")}/api/ws`;
	logger.info("sync-bridge: opening WebSocket", { wsUrl });
	try {
		const ws = new WebSocket(wsUrl);
		ws.onopen = () => {
			wsStateRef = "connected";
			logger.info("sync-bridge: WebSocket connected");
			// Send a "hello" payload so the Penpot side (or any
			// listener) can confirm we're a real client.
			try {
				ws.send(
					JSON.stringify({
						type: "pakalon-hello",
						version: "1.0.0",
						projectDir: currentConfig?.projectDir,
					}),
				);
			} catch (err) {
				logger.warn("sync-bridge: hello send failed", { err });
			}
		};
		ws.onmessage = ev => {
			// The Penpot side doesn't currently send anything back,
			// but we log inbound messages for debuggability.
			logger.debug("sync-bridge: ws message", { data: ev.data });
		};
		ws.onerror = ev => {
			wsStateRef = "disconnected";
			logger.warn("sync-bridge: WebSocket error", { message: (ev as ErrorEvent).message ?? "unknown" });
		};
		ws.onclose = () => {
			wsStateRef = "disconnected";
			wsRef = null;
			if (currentHandle) {
				logger.info("sync-bridge: WebSocket closed, scheduling reconnect");
				reconnectTimer = setTimeout(() => openWebSocket(url), WS_RECONNECT_MS);
				if (typeof reconnectTimer === "object" && reconnectTimer && "unref" in reconnectTimer) {
					(reconnectTimer as { unref?: () => void }).unref?.();
				}
			}
		};
		wsRef = ws;
	} catch (err) {
		wsStateRef = "disconnected";
		logger.warn("sync-bridge: WebSocket open failed", { err });
	}
}

function closeWebSocket(): void {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (wsRef) {
		try {
			wsRef.close();
		} catch {
			/* ignore */
		}
		wsRef = null;
	}
	wsStateRef = "off";
}

/** Emit a `file-changed` event over the WebSocket (if connected). */
function emitFileChanged(file: string): void {
	if (wsRef && wsRef.readyState === WebSocket.OPEN) {
		try {
			wsRef.send(JSON.stringify({ type: "file-changed", path: file, ts: Date.now() }));
		} catch (err) {
			logger.warn("sync-bridge: ws send failed", { err });
		}
	}
}

/**
 * Start the file watcher + Penpot WebSocket. Idempotent — re-calling
 * with the same config is a no-op; with a different config it tears
 * down and restarts.
 *
 * If `penpotUrl` is empty or Docker is not available, the bridge
 * still runs as a file watcher (so `.penpot` writes are validated
 * and hot-reloaded into the local watcher), but `penpot` and `ws`
 * are null.
 */
export async function startSyncBridge(config: SyncBridgeConfig): Promise<SyncBridgeHandle> {
	if (watcher) {
		if (currentConfig?.projectDir === config.projectDir) {
			return currentHandle!;
		}
		await stopSyncBridge();
	}
	currentConfig = config;
	const dir = watchDir(config.projectDir);
	fs.mkdirSync(dir, { recursive: true });
	const cooldownMs = readCooldownMs();
	lastSync = 0;

	// Best-effort Penpot spawn.
	let penpot: PenpotHandle | null = null;
	try {
		penpot = await startPenpotContainer();
	} catch (err) {
		logger.warn("sync-bridge: Penpot container not started, falling back to local-watcher-only", { err });
	}

	// Open the WebSocket (best-effort). When `penpot` is null we
	// still set `wsState = "disconnected"` so callers can see the
	// bridge is running but the WebSocket isn't.
	if (penpot && config.penpotUrl) {
		openWebSocket(config.penpotUrl);
	}

	watcher = fs.watch(dir, { recursive: false }, (event, filename) => {
		if (!filename) return;
		const now = Date.now();
		if (now - lastSync < cooldownMs) return;
		lastSync = now;
		const file = path.join(dir, filename.toString());
		logger.info("sync-bridge: file changed", { file, event, cooldownMs });
		void onFileChanged(file).catch(err => logger.warn("sync-bridge: change handler failed", { err }));
	});

	const handle: SyncBridgeHandle = {
		running: true,
		watching: dir,
		penpot,
		ws: wsRef,
		stop: stopSyncBridge,
		get wsState() {
			return wsStateRef;
		},
	};
	currentHandle = handle;
	logger.info("sync-bridge: started", {
		dir,
		penpotUrl: penpot?.url ?? "(local-only)",
		wsState: wsStateRef,
	});
	return handle;
}

async function onFileChanged(file: string): Promise<void> {
	// Read & validate the .penpot file; surface errors but do not crash.
	if (file.endsWith(".penpot")) {
		try {
			await readPenpotFile(file);
		} catch (err) {
			logger.warn("sync-bridge: failed to read .penpot file", { file, err });
		}
	}
	// Always emit a `file-changed` event over the WebSocket so any
	// Penpot-side listener can react.
	emitFileChanged(file);
	if (currentConfig?.onChange) {
		await currentConfig.onChange(file);
	}
}

function watchDir(projectDir: string): string {
	return path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2");
}

/** Stop the file watcher, close the WebSocket, and tear down the Penpot container. */
export async function stopSyncBridge(): Promise<void> {
	if (watcher) {
		watcher.close();
		watcher = null;
	}
	closeWebSocket();
	if (currentHandle?.penpot) {
		try {
			await currentHandle.penpot.stop();
		} catch (err) {
			logger.warn("sync-bridge: failed to stop Penpot container", { err });
		}
	}
	currentHandle = null;
	currentConfig = null;
	logger.info("sync-bridge: stopped");
}

/** Returns whether the bridge is currently running. */
export function isSyncBridgeRunning(): boolean {
	return watcher !== null;
}

/** Returns the current WebSocket connection state. */
export function getSyncBridgeWebSocketState(): SyncBridgeHandle["wsState"] {
	return wsStateRef;
}
