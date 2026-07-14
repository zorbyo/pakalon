/**
 * Docker sandbox management for Pakalon.
 * Handles container lifecycle, command execution, and environment management.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface SandboxConfig {
	name: string;
	image: string;
	volumes: string[];
	env: Record<string, string>;
	port: number;
	memoryLimit: string;
	cpuLimit: number;
}

export interface SandboxStatus {
	running: boolean;
	containerId?: string;
	createdAt?: string;
	uptime?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default configuration
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: SandboxConfig = {
	name: "pakalon-sandbox",
	image: "oven/bun:1",
	volumes: [],
	env: {},
	port: 3000,
	memoryLimit: "2g",
	cpuLimit: 2,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Container operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start a Docker sandbox.
 */
export async function startSandbox(
	projectDir: string,
	config: Partial<SandboxConfig> = {},
): Promise<{ success: boolean; message: string; containerId?: string }> {
	const fullConfig = { ...DEFAULT_CONFIG, ...config };

	// Check if already running
	const status = await getSandboxStatus(fullConfig.name);
	if (status.running) {
		return { success: true, message: "Sandbox already running", containerId: status.containerId };
	}

	// Build volume mounts
	const volumeMounts = [`-v ${projectDir}:/workspace`, ...(fullConfig.volumeFlags ?? [])];

	// Build environment flags
	const envFlags = Object.entries(fullConfig.env)
		.map(([key, value]) => `-e ${key}=${value}`)
		.join(" ");

	// Start container
	const result = await $`docker run -d \
		--name ${fullConfig.name} \
		${volumeMounts.join(" ")} \
		${envFlags} \
		--memory ${fullConfig.memoryLimit} \
		--cpus ${fullConfig.cpuLimit} \
		-p ${fullConfig.port}:${fullConfig.port} \
		${fullConfig.image} \
		sleep infinity`
		.quiet()
		.nothrow();

	if (result.exitCode !== 0) {
		const error = result.stderr.toString();
		logger.error("Failed to start sandbox", { error });
		return { success: false, message: `Failed to start sandbox: ${error}` };
	}

	const containerId = result.stdout.toString().trim();
	logger.info("Sandbox started", { containerId, projectDir });

	return {
		success: true,
		message: "Sandbox started successfully",
		containerId,
	};
}

/**
 * Stop a Docker sandbox.
 */
export async function stopSandbox(name: string = DEFAULT_CONFIG.name): Promise<{ success: boolean; message: string }> {
	// Stop container
	const stopResult = await $`docker stop ${name}`.quiet().nothrow();
	if (stopResult.exitCode !== 0) {
		const error = stopResult.stderr.toString();
		if (!error.includes("No such container")) {
			logger.error("Failed to stop sandbox", { error });
			return { success: false, message: `Failed to stop sandbox: ${error}` };
		}
	}

	// Remove container
	const rmResult = await $`docker rm ${name}`.quiet().nothrow();
	if (rmResult.exitCode !== 0) {
		const error = rmResult.stderr.toString();
		if (!error.includes("No such container")) {
			logger.error("Failed to remove sandbox", { error });
			return { success: false, message: `Failed to remove sandbox: ${error}` };
		}
	}

	logger.info("Sandbox stopped", { name });
	return { success: true, message: "Sandbox stopped successfully" };
}

/**
 * Get sandbox status.
 */
export async function getSandboxStatus(name: string = DEFAULT_CONFIG.name): Promise<SandboxStatus> {
	const result = await $`docker inspect --format='{{.State.StartedAt}}' ${name}`.quiet().nothrow();

	if (result.exitCode !== 0) {
		return { running: false };
	}

	const createdAt = result.stdout.toString().trim();
	const containerResult = await $`docker inspect --format='{{.Id}}' ${name}`.quiet().nothrow();
	const containerId = containerResult.stdout.toString().trim();

	return {
		running: true,
		containerId,
		createdAt,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Command execution
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run a command in the sandbox.
 */
export async function runInSandbox(
	command: string,
	name: string = DEFAULT_CONFIG.name,
): Promise<{ success: boolean; output: string; error?: string }> {
	const result = await $`docker exec ${name} ${command}`.quiet().nothrow();

	if (result.exitCode !== 0) {
		const error = result.stderr.toString();
		return { success: false, output: "", error };
	}

	return { success: true, output: result.stdout.toString() };
}

/**
 * Run a shell command in the sandbox.
 */
export async function runShellInSandbox(
	command: string,
	name: string = DEFAULT_CONFIG.name,
): Promise<{ success: boolean; output: string; error?: string }> {
	return runInSandbox(`sh -c "${command}"`, name);
}

/**
 * Copy files to sandbox.
 */
export async function copyToSandbox(
	localPath: string,
	sandboxPath: string,
	name: string = DEFAULT_CONFIG.name,
): Promise<{ success: boolean; message: string }> {
	const result = await $`docker cp ${localPath} ${name}:${sandboxPath}`.quiet().nothrow();

	if (result.exitCode !== 0) {
		const error = result.stderr.toString();
		return { success: false, message: `Failed to copy: ${error}` };
	}

	return { success: true, message: "Files copied successfully" };
}

/**
 * Copy files from sandbox.
 */
export async function copyFromSandbox(
	sandboxPath: string,
	localPath: string,
	name: string = DEFAULT_CONFIG.name,
): Promise<{ success: boolean; message: string }> {
	const result = await $`docker cp ${name}:${sandboxPath} ${localPath}`.quiet().nothrow();

	if (result.exitCode !== 0) {
		const error = result.stderr.toString();
		return { success: false, message: `Failed to copy: ${error}` };
	}

	return { success: true, message: "Files copied successfully" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Environment setup
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Install dependencies in sandbox.
 */
export async function installDependencies(
	packageManager: "npm" | "yarn" | "pnpm" | "bun" = "bun",
	name: string = DEFAULT_CONFIG.name,
): Promise<{ success: boolean; message: string }> {
	const installCmd = {
		npm: "npm install",
		yarn: "yarn install",
		pnpm: "pnpm install",
		bun: "bun install",
	}[packageManager];

	return runShellInSandbox(`cd /workspace && ${installCmd}`, name);
}

/**
 * Build project in sandbox.
 */
export async function buildProject(
	buildCommand: string = "bun run build",
	name: string = DEFAULT_CONFIG.name,
): Promise<{ success: boolean; output: string; error?: string }> {
	return runShellInSandbox(`cd /workspace && ${buildCommand}`, name);
}

/**
 * Run tests in sandbox.
 */
export async function runTests(
	testCommand: string = "bun run test",
	name: string = DEFAULT_CONFIG.name,
): Promise<{ success: boolean; output: string; error?: string }> {
	return runShellInSandbox(`cd /workspace && ${testCommand}`, name);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format sandbox status for display.
 */
export async function formatSandboxStatus(name: string = DEFAULT_CONFIG.name): Promise<string> {
	const status = await getSandboxStatus(name);

	const lines = [
		"Sandbox Status",
		"═══════════════════════════════════════",
		`Name: ${name}`,
		`Status: ${status.running ? "Running" : "Stopped"}`,
	];

	if (status.running) {
		lines.push(`Container ID: ${status.containerId?.slice(0, 12)}`);
		if (status.createdAt) {
			lines.push(`Started: ${status.createdAt}`);
		}
	}

	return lines.join("\n");
}
