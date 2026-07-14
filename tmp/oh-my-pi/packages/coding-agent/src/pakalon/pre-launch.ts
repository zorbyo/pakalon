/**
 * Pre-launch auth gate.
 *
 * Runs before the main CLI is dispatched. In cloud mode it
 * triggers the 6-digit device-code flow; in self-hosted mode it's
 * a no-op. The result is written to `auth.json` for the rest of
 * the CLI session.
 *
 * On first run (no stored preference), the user is prompted to
 * choose between cloud and self-hosted mode. The choice is saved
 * to `~/.pakalon/prefs.json` (mode 0o600) and reused on subsequent
 * launches.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { needsLogin, bootstrapAuth as runBootstrap } from "./auth/bootstrap";
import { isSelfHostedMode } from "./local-models/registry";

export interface PreLaunchResult {
	skipped: boolean;
	authenticated: boolean;
	reason: "self-hosted" | "already-authenticated" | "fresh-login" | "no-auth" | "smoke-test";
}

const PREFS_PATH = path.join(os.homedir(), ".pakalon", "prefs.json");

interface Prefs {
	mode: "cloud" | "selfhosted";
	firstRun?: boolean;
}

function loadPrefs(): Prefs {
	try {
		return JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8")) as Prefs;
	} catch {
		return { mode: "cloud", firstRun: true };
	}
}

function savePrefs(prefs: Prefs): void {
	try {
		fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
		fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2), { mode: 0o600 });
	} catch {
		// best-effort
	}
}

/**
 * On first launch, prompt the user to choose between cloud and
 * self-hosted mode. The choice is persisted. If not in a TTY the
 * default is "cloud".
 */
async function maybePromptModeChoice(): Promise<Prefs> {
	if (process.env.PAKALON_MODE || process.env.PAKALON_SELF_HOSTED === "1" || process.argv.includes("--selfhost")) {
		const prefs = loadPrefs();
		prefs.mode = isSelfHostedMode() ? "selfhosted" : "cloud";
		prefs.firstRun = false;
		savePrefs(prefs);
		return prefs;
	}
	const prefs = loadPrefs();
	if (!prefs.firstRun && prefs.mode) {
		return prefs;
	}
	if (!process.stdin.isTTY) {
		prefs.firstRun = false;
		savePrefs(prefs);
		return prefs;
	}
	try {
		process.stdout.write(
			"\nWelcome to Pakalon!\nChoose deployment mode:\n  1) Cloud (requires login, uses OpenRouter LLMs)\n  2) Self-hosted (local models only, no cloud auth)\n\nEnter 1 or 2 [1]: ",
		);
		const answer =
			(
				await new Promise<string>(resolve => {
					let data = "";
					process.stdin.setEncoding("utf8");
					process.stdin.on("data", chunk => {
						data += chunk;
						if (data.includes("\n") || data.includes("\r")) {
							process.stdin.pause();
							resolve(data.trim());
						}
					});
					process.stdin.on("error", () => resolve(""));
					setTimeout(() => { process.stdin.pause(); resolve(""); }, 30_000);
				})
			) || "1";
		const choice = answer === "2" ? "selfhosted" : "cloud";
		process.stdout.write(`\nMode selected: ${choice}\n\n`);
		prefs.mode = choice;
		prefs.firstRun = false;
		savePrefs(prefs);
	} catch {
		prefs.firstRun = false;
		savePrefs(prefs);
	}
	return prefs;
}

const STUB_USER_ID = "smoke-test";

export function shouldRunAuthGate(opts: { smokeTest?: boolean; force?: boolean } = {}): boolean {
	if (opts.smokeTest) return false;
	if (isSelfHostedMode()) return false;
	if (opts.force) return true;
	return needsLogin({ force: false });
}

export async function runPreLaunchAuthGate(
	opts: { smokeTest?: boolean; force?: boolean; stubUser?: { id: string; email: string; sessionToken: string } } = {},
): Promise<PreLaunchResult> {
	await maybePromptModeChoice();
	if (opts.smokeTest) return { skipped: true, authenticated: true, reason: "smoke-test" };
	if (isSelfHostedMode()) {
		logger.info("pre-launch: self-hosted, skipping auth");
		return { skipped: true, authenticated: false, reason: "self-hosted" };
	}
	if (!shouldRunAuthGate(opts) && !opts.force) {
		logger.info("pre-launch: existing auth, skipping device-code");
		return { skipped: false, authenticated: true, reason: "already-authenticated" };
	}
	const result = await runBootstrap({ force: opts.force ?? false, stubUser: opts.stubUser });
	return {
		skipped: false,
		authenticated: !!result.authenticated,
		reason: result.authenticated ? "fresh-login" : "no-auth",
	};
}

export function smokeTestStubUser(): { id: string; email: string; sessionToken: string } {
	return { id: STUB_USER_ID, email: `${STUB_USER_ID}@smoke.local`, sessionToken: "smoke-test-token" };
}
