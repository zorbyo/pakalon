/**
 * MCP runtime installer for Pakalon.
 *
 * The `mcp add <id> [git-url|npm-name]` slash command in the
 * registry (pre-existing in oh-my-pi) takes an id; this module
 * resolves the id to a `npx` package spec from the catalogue and
 * spawns the process so the MCP manager can wire it into the
 * active session.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { hasMcp, type McpId, npxInstallCommand } from "./mcp-catalogue";

export interface McpInstallResult {
	id: McpId;
	started: boolean;
	pid?: number;
	package: string;
	logFile?: string;
	error?: string;
}

/**
 * Install + start an MCP server by its catalogue id. Returns the
 * process info so the manager can attach a transport (stdio, http,
 * etc).
 */
export async function installMcp(id: McpId, opts: { extraArgs?: string[] } = {}): Promise<McpInstallResult> {
	if (!hasMcp(id)) {
		return { id, started: false, package: "", error: `Unknown MCP id: ${id}` };
	}
	const cmd = npxInstallCommand(id);
	const args = cmd.split(" ").concat(opts.extraArgs ?? []);
	const logFile = `/tmp/pakalon-mcp-${id}.log`;
	logger.info("mcp: spawning", { id, args, logFile });
	try {
		const proc = Bun.spawn(args, {
			stdout: "pipe",
			stderr: "pipe",
		});
		// Stream stderr to the log file in the background. The
		// transport (stdio) reads from stdout.
		const stderr = (proc.stderr as ReadableStream<Uint8Array>).getReader();
		(async () => {
			const fh = Bun.file(logFile).writer();
			try {
				while (true) {
					const { value, done } = await stderr.read();
					if (done) break;
					if (value) fh.write(value);
				}
			} catch {
				/* ignore */
			} finally {
				await fh.end();
			}
		})();
		// Give npx a beat to bind stdio.
		await Bun.sleep(250);
		return { id, started: true, pid: proc.pid, package: args.join(" "), logFile };
	} catch (err) {
		return { id, started: false, package: args.join(" "), error: String(err) };
	}
}

/** Best-effort: install via npm + npx in one shot. */
export async function installMcpViaNpm(id: McpId): Promise<McpInstallResult> {
	if (!hasMcp(id)) return { id, started: false, package: "", error: `Unknown MCP id: ${id}` };
	const cmd = `npx ${npxInstallCommand(id).split(" ").slice(1).join(" ")}`.split(" ");
	const result = await $`npm exec --package=${cmd[1]} -- ${cmd.slice(2).join(" ")}`.quiet().nothrow();
	if (result.exitCode === 0) {
		return { id, started: true, package: cmd.join(" ") };
	}
	return { id, started: false, package: cmd.join(" "), error: result.stderr.toString() };
}
