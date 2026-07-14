import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { McpServerConfig, McpServerSpec } from "@pakalon/mcp-registry";
import { KNOWN_SERVERS, McpRegistry } from "@pakalon/mcp-registry";

export interface McpProcessInfo {
	id: string;
	spec: McpServerSpec;
	pid: number | null;
	status: "running" | "stopped" | "error" | "starting";
	startedAt: Date | null;
	error?: string;
	stdoutLog?: string;
	stderrLog?: string;
}

export interface McpServerManagerOptions {
	projectDir?: string;
	registry?: McpRegistry;
}

interface ManagedProcess {
	info: McpProcessInfo;
	process: import("bun").Subprocess | null;
	abortController: AbortController | null;
}

export class McpServerManager {
	#processes: Map<string, ManagedProcess> = new Map();
	#registry: McpRegistry;
	#projectDir: string;

	constructor(options: McpServerManagerOptions = {}) {
		this.#registry = options.registry ?? new McpRegistry();
		this.#projectDir = options.projectDir ?? process.cwd();
	}

	get registry(): McpRegistry {
		return this.#registry;
	}

	async start(idOrSpec: string | McpServerSpec, scope: "project" | "global" = "project"): Promise<McpProcessInfo> {
		if (this.#processes.has(typeof idOrSpec === "string" ? idOrSpec : idOrSpec.id)) {
			const existing = this.#processes.get(typeof idOrSpec === "string" ? idOrSpec : idOrSpec.id)!;
			if (existing.info.status === "running") {
				logger.info("MCP server already running", { id: existing.info.id });
				return existing.info;
			}
			logger.info("Restarting MCP server", { id: existing.info.id });
			await this.#cleanupProcess(existing);
		}

		const spec = typeof idOrSpec === "string" ? this.#resolveSpec(idOrSpec) : idOrSpec;
		if (!spec) {
			throw new Error(`Unknown MCP server: ${typeof idOrSpec === "string" ? idOrSpec : idOrSpec.id}`);
		}

		const id = spec.id;
		const abortController = new AbortController();
		const stdoutLog = path.join(this.#projectDir, ".pakalon", "mcp-logs", `${id}-stdout.log`);
		const stderrLog = path.join(this.#projectDir, ".pakalon", "mcp-logs", `${id}-stderr.log`);

		const managed: ManagedProcess = {
			info: {
				id,
				spec,
				pid: null,
				status: "starting",
				startedAt: null,
			},
			process: null,
			abortController,
		};
		this.#processes.set(id, managed);

		try {
			fs.mkdirSync(path.dirname(stdoutLog), { recursive: true });
			const outFd = fs.openSync(stdoutLog, "a");
			const errFd = fs.openSync(stderrLog, "a");

			const proc = Bun.spawn([spec.command, ...spec.args], {
				env: { ...process.env, ...spec.env },
				stdout: outFd,
				stderr: errFd,
				signal: abortController.signal,
			});

			managed.process = proc;
			managed.info.pid = proc.pid ?? null;
			managed.info.status = "running";
			managed.info.startedAt = new Date();
			managed.info.stdoutLog = stdoutLog;
			managed.info.stderrLog = stderrLog;

			const config: McpServerConfig = {
				id: spec.id,
				name: spec.name,
				command: spec.command,
				args: spec.args,
				env: spec.env,
				scope,
				autoStart: true,
			};
			this.#registry.registerConfig(config);

			proc.ref();
			const exited = proc.exited.then(code => {
				managed.info.status = code === 0 ? "stopped" : "error";
				managed.info.error = code !== 0 ? `Exited with code ${code}` : undefined;
				logger.warn("MCP server process exited", { id, code });
			});

			logger.info("MCP server started", { id, pid: proc.pid, command: `${spec.command} ${spec.args.join(" ")}` });
			return managed.info;
		} catch (err) {
			managed.info.status = "error";
			managed.info.error = err instanceof Error ? err.message : String(err);
			logger.error("Failed to start MCP server", { id, error: managed.info.error });
			throw err;
		}
	}

	async stop(id: string): Promise<void> {
		const managed = this.#processes.get(id);
		if (!managed) {
			logger.warn("MCP server not found", { id });
			return;
		}
		await this.#cleanupProcess(managed);
		logger.info("MCP server stopped", { id });
	}

	async restart(id: string): Promise<McpProcessInfo> {
		const managed = this.#processes.get(id);
		if (!managed) {
			throw new Error(`MCP server not found: ${id}`);
		}
		await this.#cleanupProcess(managed);
		return this.start(id, managed.info.spec.scope);
	}

	async status(id: string): Promise<McpProcessInfo | undefined> {
		const managed = this.#processes.get(id);
		if (!managed) return undefined;

		await this.#syncProcessStatus(managed);
		return { ...managed.info };
	}

	list(): McpProcessInfo[] {
		return Array.from(this.#processes.values()).map(m => ({ ...m.info }));
	}

	runningServers(): McpProcessInfo[] {
		return this.list().filter(s => s.status === "running");
	}

	async stopAll(): Promise<void> {
		const ids = Array.from(this.#processes.keys());
		await Promise.all(ids.map(id => this.stop(id)));
	}

	async healthCheck(id: string): Promise<boolean> {
		const managed = this.#processes.get(id);
		if (!managed?.process) return false;
		await this.#syncProcessStatus(managed);
		return managed.info.status === "running";
	}

	listSpecs(): McpServerSpec[] {
		return [...KNOWN_SERVERS, ...this.#registry.getAllSpecs()];
	}

	#resolveSpec(id: string): McpServerSpec | undefined {
		const specs = this.listSpecs();
		return specs.find(s => s.id === id);
	}

	async #syncProcessStatus(managed: ManagedProcess): Promise<void> {
		if (!managed.process) return;
		try {
			const exited = await Promise.race([
				managed.process.exited.then(code => ({ exited: true, code })),
				Bun.sleep(10).then(() => ({ exited: false, code: null })),
			]);
			if (exited.exited) {
				managed.info.status = exited.code === 0 ? "stopped" : "error";
				managed.info.error = exited.code !== 0 ? `Exited with code ${exited.code}` : undefined;
				managed.info.pid = null;
				managed.process = null;
			}
		} catch {
			managed.info.status = "error";
			managed.info.error = "Health check failed";
		}
	}

	async #cleanupProcess(managed: ManagedProcess): Promise<void> {
		managed.abortController?.abort();
		if (managed.process) {
			try {
				managed.process.kill();
			} catch {
				/* ignore */
			}
			try {
				await Promise.race([managed.process.exited, Bun.sleep(2000)]);
			} catch {
				/* ignore */
			}
			managed.process = null;
		}
		managed.info.status = "stopped";
		managed.info.pid = null;
	}
}
