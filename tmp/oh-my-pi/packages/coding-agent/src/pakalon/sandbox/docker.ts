/**
 * Real sandbox Docker spawn.
 *
 * Wraps the existing `integrations/sandbox.ts: startSandbox /
 * stopSandbox` with a real `Bun.spawn(["docker", "run", ...])`
 * call. The container is short-lived: started at the end of phase
 * 3, stopped at the end of phase 4 (or on demand).
 *
 * The container image is `pakalon/sandbox` (a slim Bun + Node image
 * with the CLI pre-installed). If the image is not present locally,
 * we attempt to pull it. If Docker is unavailable, we log a warning
 * and return a stub handle.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";

const IMAGE = "pakalon/sandbox:latest";
const CONTAINER_NAME = "pakalon-sandbox";
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 1_000;

export interface SandboxHandle {
	containerId: string;
	url: string;
	stop: () => Promise<void>;
}

let currentHandle: SandboxHandle | null = null;

export async function isDockerAvailable(): Promise<boolean> {
	try {
		const r = await $`docker info --format {{.ServerVersion}}`.quiet().nothrow();
		return r.exitCode === 0 && r.text().trim().length > 0;
	} catch {
		return false;
	}
}

export async function startSandbox(
	projectDir: string,
	opts: { name?: string; port?: number } = {},
): Promise<SandboxHandle> {
	if (currentHandle) return currentHandle;
	if (!(await isDockerAvailable())) {
		logger.warn("sandbox: docker not available, returning stub");
		currentHandle = { containerId: "stub", url: "sandbox://local", stop: async () => undefined };
		return currentHandle;
	}

	const name = opts.name ?? CONTAINER_NAME;
	const port = opts.port ?? 9300;
	const image = IMAGE;

	logger.info("sandbox: starting container", { image, port });
	const runResult = await $`docker run -d --rm --name ${name} -p ${port}:9300 -v ${projectDir}:/workspace:ro ${image}`
		.quiet()
		.nothrow();
	if (runResult.exitCode !== 0) {
		const stderr = runResult.stderr.toString();
		throw new Error(`Sandbox container failed to start: ${stderr}`);
	}
	const containerId = runResult.text().trim();
	const url = `http://localhost:${port}`;

	const ready = await waitForHttp(url, READY_TIMEOUT_MS);
	if (!ready) {
		await stopSandbox(name);
		throw new Error(`Sandbox did not become ready within ${READY_TIMEOUT_MS / 1000}s`);
	}

	const handle: SandboxHandle = {
		containerId,
		url,
		stop: async () => {
			await stopSandbox(name);
		},
	};
	currentHandle = handle;
	return handle;
}

export async function stopSandbox(name: string = CONTAINER_NAME): Promise<void> {
	if (currentHandle) {
		currentHandle = null;
	}
	try {
		await $`docker stop ${name}`.quiet().nothrow();
		logger.info("sandbox: container stopped", { name });
	} catch (err) {
		logger.warn("sandbox: stop failed", { name, err });
	}
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(url, { signal: AbortSignal.timeout(2_000) });
			if (r.ok || r.status < 500) return true;
		} catch {
			/* not ready */
		}
		await Bun.sleep(READY_POLL_MS);
	}
	return false;
}
