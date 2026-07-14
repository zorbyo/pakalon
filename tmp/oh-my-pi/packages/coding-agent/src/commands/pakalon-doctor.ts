/**
 * `pakalon doctor` command — System requirements check.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import chalk from "chalk";
import { detectLocalProviders } from "../selfhost";

interface CheckResult {
	name: string;
	pass: boolean;
	message: string;
}

async function runChecks(): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	// 1. Bun version
	const bunVersion = Bun.version;
	const bunMinParts = [1, 3, 14];
	const bunParts = bunVersion.split(".").map(Number);
	const bunOk =
		bunParts[0] > bunMinParts[0] ||
		(bunParts[0] === bunMinParts[1] && bunParts[1] > bunMinParts[1]) ||
		(bunParts[0] === bunMinParts[0] && bunParts[1] === bunMinParts[1] && bunParts[2] >= bunMinParts[2]);
	results.push({
		name: "Bun runtime",
		pass: bunOk,
		message: bunOk ? `v${bunVersion}` : `v${bunVersion} (need >= ${bunMinParts.join(".")})`,
	});

	// 2. Git
	try {
		const proc = Bun.spawn(["git", "--version"], { stdout: "pipe", stderr: "pipe" });
		const exitCode = await proc.exited;
		results.push({
			name: "Git",
			pass: exitCode === 0,
			message: exitCode === 0 ? "installed" : "not found",
		});
	} catch {
		results.push({ name: "Git", pass: false, message: "not found" });
	}

	// 3. Docker (optional)
	try {
		const proc = Bun.spawn(["docker", "--version"], { stdout: "pipe", stderr: "pipe" });
		const exitCode = await proc.exited;
		results.push({
			name: "Docker (optional)",
			pass: true, // Not required
			message: exitCode === 0 ? "installed" : "not found (needed for security scanning)",
		});
	} catch {
		results.push({ name: "Docker (optional)", pass: true, message: "not found (needed for security scanning)" });
	}

	// 4. Node.js (optional)
	try {
		const proc = Bun.spawn(["node", "--version"], { stdout: "pipe", stderr: "pipe" });
		const exitCode = await proc.exited;
		results.push({
			name: "Node.js (optional)",
			pass: true,
			message: exitCode === 0 ? "installed" : "not found",
		});
	} catch {
		results.push({ name: "Node.js (optional)", pass: true, message: "not found" });
	}

	// 5. Local LLM providers
	const providers = await detectLocalProviders();
	if (providers.length > 0) {
		results.push({
			name: "Local LLM",
			pass: true,
			message: `${providers.map(p => p.name).join(", ")} (${providers.reduce((s, p) => s + p.models.length, 0)} models)`,
		});
	} else {
		results.push({
			name: "Local LLM",
			pass: false,
			message: "No providers detected (start Ollama or LM Studio)",
		});
	}

	// 6. Auth config
	const authPath = `${process.env.HOME || process.env.USERPROFILE}/.pakalon/auth.json`;
	const hasAuth = fs.existsSync(authPath);
	results.push({
		name: "Auth config",
		pass: true, // Not required for self-hosted
		message: hasAuth ? "found" : "not configured (OK for self-hosted)",
	});

	// 7. Disk space
	const tmpDir = os.tmpdir();
	try {
		const stats = fs.statfsSync(tmpDir);
		const freeGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
		results.push({
			name: "Disk space",
			pass: freeGB > 1,
			message: `${freeGB.toFixed(1)}GB free`,
		});
	} catch {
		results.push({ name: "Disk space", pass: true, message: "unknown" });
	}

	return results;
}

export default async function doctorCommand(): Promise<void> {
	console.log(chalk.bold.cyan("Pakalon Doctor\n"));
	console.log(chalk.dim(`Platform: ${os.platform()} ${os.arch()}`));
	console.log(chalk.dim(`Bun: v${Bun.version}\n`));

	const checks = await runChecks();
	let allPass = true;

	for (const check of checks) {
		const icon = check.pass ? chalk.green("✓") : chalk.red("✗");
		console.log(`  ${icon} ${chalk.bold(check.name)}: ${check.message}`);
		if (!check.pass) allPass = false;
	}

	console.log("");
	if (allPass) {
		console.log(chalk.green.bold("All checks passed! Pakalon is ready."));
	} else {
		console.log(chalk.yellow.bold("Some checks failed. Pakalon may still work but some features require attention."));
	}
}
