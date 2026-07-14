/**
 * Automation bridge connectors — real integrations between
 * automation triggers and downstream services (Slack, GitHub,
 * Telegram, Email).
 *
 * Each connector exposes a `post` signature that the cron runner
 * can call when an automation fires. The implementation falls
 * back gracefully when a required env var is missing.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";

export interface AutomationContext {
	projectDir: string;
	automationId: string;
	prompt: string;
	output?: string;
}

export interface ConnectorResult {
	ok: boolean;
	service: string;
	url?: string;
	error?: string;
}

const SLACK_WEBHOOK_ENV = "SLACK_WEBHOOK_URL";
const GITHUB_TOKEN_ENV = "GITHUB_TOKEN";
const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const SMTP_HOST_ENV = "SMTP_HOST";

export async function postToSlack(context: AutomationContext): Promise<ConnectorResult> {
	const webhook = process.env[SLACK_WEBHOOK_ENV];
	if (!webhook) {
		return { ok: false, service: "slack", error: `${SLACK_WEBHOOK_ENV} not configured` };
	}
	try {
		const body = {
			text: `*Automation: ${context.prompt.slice(0, 200)}*\n\`\`\`\n${(context.output ?? "").slice(0, 3000)}\n\`\`\``,
		};
		const resp = await fetch(webhook, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (resp.ok) {
			logger.info("automation: slack posted", { automationId: context.automationId });
			return { ok: true, service: "slack" };
		}
		const text = await resp.text();
		return { ok: false, service: "slack", error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, service: "slack", error: msg };
	}
}

export async function postToGitHubIssue(
	context: AutomationContext,
	options?: { repo?: string; labels?: string[] },
): Promise<ConnectorResult> {
	const token = process.env[GITHUB_TOKEN_ENV];
	if (!token) {
		return { ok: false, service: "github", error: `${GITHUB_TOKEN_ENV} not configured` };
	}
	const repo = options?.repo ?? (await detectRepoFromGit(context.projectDir));
	if (!repo) {
		return {
			ok: false,
			service: "github",
			error: "Could not detect GitHub repo (`git remote get-url origin` failed)",
		};
	}
	try {
		const body = {
			title: `[automation] ${context.prompt.slice(0, 100)}`,
			body: `Automation ID: ${context.automationId}\n\n${context.output ?? ""}`.slice(0, 65535),
			labels: options?.labels ?? ["automation"],
		};
		const resp = await fetch(`https://api.github.com/repos/${encodeURIComponent(repo)}/issues`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				Authorization: `Bearer ${token}`,
				"User-Agent": "pakalon-automation",
			},
			body: JSON.stringify(body),
		});
		if (resp.ok) {
			const data = (await resp.json()) as { html_url?: string };
			logger.info("automation: github issue created", { repo, url: data.html_url });
			return { ok: true, service: "github", url: data.html_url };
		}
		const text = await resp.text();
		return { ok: false, service: "github", error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, service: "github", error: msg };
	}
}

export async function postToGitHubPRComment(
	context: AutomationContext,
	options?: { repo?: string; prNumber?: number },
): Promise<ConnectorResult> {
	const token = process.env[GITHUB_TOKEN_ENV];
	if (!token) {
		return { ok: false, service: "github", error: `${GITHUB_TOKEN_ENV} not configured` };
	}
	const repo = options?.repo ?? (await detectRepoFromGit(context.projectDir));
	if (!repo || !options?.prNumber) {
		return { ok: false, service: "github", error: "repo and prNumber are required for PR comments" };
	}
	try {
		const body = {
			body: `**Automation output** (\`${context.automationId}\`)\n\n${context.output ?? ""}`,
		};
		const resp = await fetch(
			`https://api.github.com/repos/${encodeURIComponent(repo)}/issues/${options.prNumber}/comments`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					Authorization: `Bearer ${token}`,
					"User-Agent": "pakalon-automation",
				},
				body: JSON.stringify(body),
			},
		);
		if (resp.ok) {
			const data = (await resp.json()) as { html_url?: string };
			logger.info("automation: github pr comment created", { repo, pr: options.prNumber });
			return { ok: true, service: "github", url: data.html_url };
		}
		const text = await resp.text();
		return { ok: false, service: "github", error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, service: "github", error: msg };
	}
}

export async function postToTelegram(context: AutomationContext): Promise<ConnectorResult> {
	const token = process.env[TELEGRAM_BOT_TOKEN_ENV];
	if (!token) {
		return { ok: false, service: "telegram", error: `${TELEGRAM_BOT_TOKEN_ENV} not configured` };
	}
	try {
		const chatId = process.env.TELEGRAM_CHAT_ID;
		if (!chatId) {
			return { ok: false, service: "telegram", error: "TELEGRAM_CHAT_ID not configured" };
		}
		const text = `*Automation: ${context.prompt.slice(0, 100)}*\n\n${(context.output ?? "").slice(0, 3500)}`;
		const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
		});
		if (resp.ok) {
			logger.info("automation: telegram sent", { automationId: context.automationId });
			return { ok: true, service: "telegram" };
		}
		const data = (await resp.json()) as { description?: string };
		return { ok: false, service: "telegram", error: data.description ?? `HTTP ${resp.status}` };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, service: "telegram", error: msg };
	}
}

export async function postToEmail(_context: AutomationContext): Promise<ConnectorResult> {
	const host = process.env[SMTP_HOST_ENV];
	if (!host) {
		return { ok: false, service: "email", error: `${SMTP_HOST_ENV} not configured` };
	}
	logger.warn("automation: email connector requires additional SMTP auth config");
	return { ok: false, service: "email", error: "SMTP connector requires auth configuration beyond SMTP_HOST" };
}

/**
 * Dispatch to all connectors named in `connectors`. Called by the
 * automation runner after an automation's prompt has been executed.
 */
export async function dispatchToConnectors(
	context: AutomationContext,
	connectors: string[],
): Promise<ConnectorResult[]> {
	if (connectors.length === 0) return [];
	const results: ConnectorResult[] = [];
	for (const name of connectors) {
		const lower = name.toLowerCase().trim();
		let result: ConnectorResult;
		switch (lower) {
			case "slack":
				result = await postToSlack(context);
				break;
			case "github":
				result = await postToGitHubIssue(context);
				break;
			case "github-pr":
				result = await postToGitHubPRComment(context);
				break;
			case "telegram":
				result = await postToTelegram(context);
				break;
			case "email":
				result = await postToEmail(context);
				break;
			default:
				result = { ok: false, service: lower, error: `Unknown connector: ${lower}` };
		}
		results.push(result);
		logger.info("automation: connector result", { connector: lower, ok: result.ok, error: result.error });
	}
	return results;
}

async function detectRepoFromGit(projectDir: string): Promise<string | null> {
	try {
		const cmd = await $`git remote get-url origin`.cwd(projectDir).quiet().nothrow();
		if (cmd.exitCode !== 0) return null;
		const raw = cmd.text().trim();
		const match = raw.match(/github\.com[:/]([^/]+\/[^/.]+)/);
		if (match) return match[1];
		return null;
	} catch {
		return null;
	}
}
