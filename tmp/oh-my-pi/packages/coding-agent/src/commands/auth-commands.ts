/**
 * Auth commands for Pakalon: /auth, /login, /logout (already exists)
 * Handles 6-digit code flow, Clerk OAuth, self-hosted mode
 */

import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import fs from "fs";
import path from "path";

const AUTH_CONFIG_PATH = (cwd: string) => path.join(cwd, ".pakalon-agents", "auth-config.json");

export const authCommand: CommandEntry = {
	name: "auth",
	description: "Authentication and login status",
	usage: "/auth",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		const config = loadAuthConfig(cwd);
		const isSelfHosted = config.selfHosted || false;

		if (isSelfHosted) {
			return {
				success: true,
				message:
					"Self-Hosted Mode\n\n" +
					"- No login required\n" +
					"- Using local models (Ollama / LM Studio)\n" +
					"- Offline capable\n\n" +
					"Tip: Use /models to select from available local models.",
			};
		}

		if (config.authenticated) {
			return {
				success: true,
				message:
					"Authentication Status\n\n" +
					`- Logged in as: ${config.email || "unknown"}\n` +
					`- Tier: ${config.tier || "free"}\n` +
					`- Credits remaining: ${config.creditsRemaining ?? "unlimited"}\n\n` +
					`Tip: Use /logout to sign out.`,
			};
		}

		return {
			success: false,
			message:
				"Error: Not authenticated\n\n" +
				"To log in:\n" +
				"1. Visit the Pakalon web app\n" +
				"2. Sign in with GitHub (Clerk OAuth)\n" +
				"3. Copy the 6-digit code from the terminal\n" +
				"4. Paste it in the browser\n\n" +
				"Tip: For self-hosted mode, set PAKALON_SELF_HOSTED=true in your environment.",
		};
	},
};

export const loginCommand: CommandEntry = {
	name: "login",
	description: "Get 6-digit authentication code and login",
	usage: "/login",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		const configPath = AUTH_CONFIG_PATH(cwd);
		ensureAuthDir(cwd);

		const existing = loadAuthConfig(cwd);
		if (existing.authenticated) {
			return {
				success: true,
				message:
					"[OK] Already authenticated\n\n" +
					`User: ${existing.email}\n` +
					`Tier: ${existing.tier}\n\n` +
					`Tip: Use /logout to sign out first.`,
			};
		}

		const code = Math.floor(100000 + Math.random() * 900000).toString();

		const authData = {
			code,
			generatedAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
			authenticated: false,
			email: null,
			tier: "free",
		};

		fs.writeFileSync(configPath, JSON.stringify(authData, null, 2));

		return {
			success: true,
			message:
				"Authentication Required\n\n" +
				`Your 6-digit code: ${code.slice(0, 3)}-${code.slice(3)}\n\n` +
				"Steps to verify:\n" +
				"1. Visit the Pakalon web app\n" +
				"2. Click 'Verify Terminal'\n" +
				`3. Enter this code: ${code}\n\n` +
				"Code expires in 5 minutes.\n\n" +
				"Tip: After verification, use /auth to confirm login status.",
		};
	},
};

export const selfHostedCommand: CommandEntry = {
	name: "self-hosted",
	description: "Enable/disable self-hosted mode (local models, no login)",
	usage: "/self-hosted [on|off]",
	async execute(args: string[]) {
		const cwd = process.cwd();
		const configPath = AUTH_CONFIG_PATH(cwd);
		ensureAuthDir(cwd);

		const state = (args[0] || "on").toLowerCase();

		if (state === "on" || state === "enable" || state === "true") {
			const config = {
				selfHosted: true,
				authenticated: false,
				email: null,
				tier: "local",
				creditsRemaining: null,
			};
			fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

			return {
				success: true,
				message:
					"Self-Hosted Mode Enabled\n\n" +
					"- No login required\n" +
					"- Using local models only (Ollama / LM Studio)\n" +
					"- Offline capable\n" +
					"- No token tracking\n\n" +
					"Next steps:\n" +
					"1. Start Ollama or LM Studio\n" +
					"2. Use /models to select a local model\n" +
					"3. Start building without cloud dependency\n\n" +
					"Tip: Use /self-hosted off to return to cloud mode.",
			};
		}

		if (state === "off" || state === "disable" || state === "false") {
			const config = {
				selfHosted: false,
				authenticated: false,
				email: null,
				tier: "free",
				creditsRemaining: 100,
			};
			fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

			return {
				success: true,
				message:
					"Self-Hosted Mode Disabled\n\n" +
					"- Cloud mode enabled\n" +
					"- Login required\n\n" +
					"Tip: Use /login to authenticate with your Pakalon account.",
			};
		}

		const current = loadAuthConfig(cwd);
		return {
			success: true,
			message:
				`Self-Hosted Mode: ${current.selfHosted ? "Enabled" : "Disabled"}\n\n` +
				`Usage: /self-hosted [on|off]\n\n` +
				`Current settings:\n` +
				`- Mode: ${current.selfHosted ? "Self-hosted (local)" : "Cloud (requires login)"}\n` +
				`- Tier: ${current.tier}\n` +
				`- Auth: ${current.authenticated ? "Logged in" : "Not logged in"}`,
		};
	},
};

function loadAuthConfig(cwd: string): {
	selfHosted: boolean;
	authenticated: boolean;
	email: string | null;
	tier: string;
	creditsRemaining: number | null;
	code?: string;
	generatedAt?: string;
	expiresAt?: string;
} {
	const configPath = AUTH_CONFIG_PATH(cwd);
	if (fs.existsSync(configPath)) {
		try {
			return JSON.parse(fs.readFileSync(configPath, "utf-8"));
		} catch {
			/* ignore */
		}
	}
	return {
		selfHosted: false,
		authenticated: false,
		email: null,
		tier: "free",
		creditsRemaining: 100,
	};
}

function ensureAuthDir(cwd: string): void {
	const dir = path.dirname(AUTH_CONFIG_PATH(cwd));
	fs.mkdirSync(dir, { recursive: true });
}

export default authCommand;
