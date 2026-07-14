#!/usr/bin/env bun
/**
 * CLI entry point — registers all commands explicitly and delegates to the
 * lightweight CLI runner from pi-utils.
 */
import { type CliConfig, run } from "@oh-my-pi/pi-utils/cli";
import { APP_NAME, MIN_BUN_VERSION, VERSION } from "@oh-my-pi/pi-utils/dirs";
import { commands, isSubcommand } from "./cli-commands";
import { runPreLaunchAuthGate, smokeTestStubUser } from "./pakalon/pre-launch";
import { shouldUseSandbox } from "./pakalon/sandbox/policy";

if (Bun.semver.order(Bun.version, MIN_BUN_VERSION) < 0) {
	process.stderr.write(
		`error: Bun runtime must be >= ${MIN_BUN_VERSION} (found v${Bun.version}). Please upgrade: bun upgrade\n`,
	);
	process.exit(1);
}

process.title = APP_NAME;

async function showHelp(config: CliConfig): Promise<void> {
	const { renderRootHelp } = await import("@oh-my-pi/pi-utils/cli");
	const { getExtraHelpText } = await import("./cli/args");
	renderRootHelp(config);
	const extra = getExtraHelpText();
	if (extra.trim().length > 0) {
		process.stdout.write(`\n${extra}\n`);
	}
}

/**
 * Run the device-code auth gate once per process unless `--smoke-test`
 * is passed. In smoke-test mode we inject a stub user so the
 * rest of the CLI never has to handle the unauthenticated case.
 */
async function runAuthGateOnce(): Promise<void> {
	if (process.argv.includes("--smoke-test")) {
		await runPreLaunchAuthGate({ smokeTest: true, stubUser: smokeTestStubUser() });
		return;
	}
	if (process.argv.includes("--selfhost")) {
		// selfhost mode already bypasses the gate
		return;
	}
	// Default: try the gate. In selfhost (`PAKALON_MODE=selfhosted`) this
	// is a no-op. In cloud mode it issues a 6-digit code.
	await runPreLaunchAuthGate();
}

/**
 * Decide whether the current project should be sandboxed before the
 * interactive TUI starts. Used by /pakalon mode (not by /init or
 * the launch subcommand). The result is logged so the TUI can show
 * a banner.
 */
async function maybeStartSandbox(): Promise<void> {
	try {
		const cwd = process.cwd();
		const decision = await shouldUseSandbox(cwd);
		if (decision.sandbox) {
			const { enterSandbox } = await import("./pakalon/sandbox/policy");
			const { logger } = await import("@oh-my-pi/pi-utils");
			await enterSandbox(cwd, decision.reason);
			logger.info("sandbox: started", { reason: decision.reason });
		}
	} catch (_err) {
		// Sandboxing is opt-in; never block the launch.
	}
}

/**
 * Smoke-test entry. Spawns bundled workers, pings them, exits.
 *
 * Purpose: catch the silent worker-load regressions that hit compiled
 * binaries (issues #1011 and #1027). Version/help paths do not spawn worker
 * modules on a fresh install, so this probe is the minimal end-to-end test
 * that proves `new Worker(...)` resolves and bundled worker modules evaluate.
 * Wired into `scripts/install-tests/run-ci.sh` so binary / source-link /
 * tarball installs all exercise it on every CI run.
 */
async function runSmokeTest(): Promise<void> {
	const { smokeTestSyncWorker } = await import("@oh-my-pi/omp-stats");
	const { smokeTestTinyTitleWorker } = await import("./tiny/title-client");
	await smokeTestSyncWorker();
	await smokeTestTinyTitleWorker();
	process.stdout.write("smoke-test: ok\n");
}

/** Run the CLI with the given argv (no `process.argv` prefix). */
export async function runCli(argv: string[]): Promise<void> {
	if (argv[0] === "--smoke-test") {
		await runSmokeTest();
		return;
	}
	// Run the pre-launch auth gate. This is the single point where the
	// 6-digit device-code flow actually fires. In self-hosted or
	// already-authenticated mode this is a no-op.
	await runAuthGateOnce();
	// Auto-spin up a sandbox for large /pakalon projects. The TUI
	// sees a banner indicating the sandboxed state.
	if (process.argv.includes("launch") || argv[0] === undefined) {
		await maybeStartSandbox();
	}
	// Start the background dunning scheduler. The audit flagged that
	// no code path ever invoked `runDunningPass`; the scheduler
	// fires an immediate pass + a daily tick thereafter. The
	// timer holds an `unref` so it never blocks process exit.
	if (process.argv.includes("launch") || argv[0] === undefined) {
		try {
			const { startDunningScheduler } = await import("./pakalon/billing/dunning");
			startDunningScheduler();
		} catch (_err) {
			// Dunning is best-effort; never block launch.
		}
	}
	// Start the automation cron scheduler (1-minute tick). Same
	// best-effort + unref pattern.
	if (process.argv.includes("launch") || argv[0] === undefined) {
		try {
			const { startAutomationScheduler } = await import("./pakalon/automations/cron");
			startAutomationScheduler(process.cwd());
		} catch (_err) {
			// Automations are best-effort; never block launch.
		}
	}
	// --help and --version are handled by run() directly, don't rewrite those.
	// Everything else that isn't a known subcommand routes to "launch".
	const first = argv[0];
	const runArgv =
		first === "--help" || first === "-h" || first === "--version" || first === "-v" || first === "help"
			? argv
			: isSubcommand(first)
				? argv
				: ["launch", ...argv];
	return run({ bin: APP_NAME, version: VERSION, argv: runArgv, commands, help: showHelp });
}

await runCli(process.argv.slice(2));
