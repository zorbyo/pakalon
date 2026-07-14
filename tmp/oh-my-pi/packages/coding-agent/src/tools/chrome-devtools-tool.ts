import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import * as z from "zod/v4";
import type { ToolSession } from "../sdk";
import { ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";
import { clampTimeout } from "./tool-timeouts";

const chromeDevtoolsSchema = z.object({
	action: z
		.enum([
			"navigate",
			"screenshot",
			"evaluate",
			"get_console",
			"get_network",
			"inspect_element",
			"test_form",
		] as const)
		.describe("Chrome DevTools action to perform"),
	url: z.string().describe("URL to navigate to (for navigate action)").optional(),
	script: z.string().describe("JavaScript to evaluate in the page (for evaluate action)").optional(),
	selector: z.string().describe("CSS selector for inspect_element or test_form actions").optional(),
	form_data: z
		.record(z.string(), z.string())
		.describe("Form field values for test_form action (key=value pairs)")
		.optional(),
	cdp_url: z.string().describe("Chrome DevTools Protocol URL (default: http://localhost:9222)").optional(),
	timeout: z.number().default(30).describe("Timeout in seconds").optional(),
});

export type ChromeDevtoolsParams = z.infer<typeof chromeDevtoolsSchema>;

export interface ChromeDevtoolsDetails {
	action: string;
	url?: string;
	result?: string;
	screenshot?: string;
	console_logs?: string[];
	network_requests?: string[];
}

export class ChromeDevtoolsTool implements AgentTool<typeof chromeDevtoolsSchema, ChromeDevtoolsDetails> {
	readonly name = "chrome_devtools";
	readonly approval = "exec" as const;
	readonly formatApprovalDetails = (args: unknown): string[] => {
		const params = args as Partial<ChromeDevtoolsParams>;
		return [`Action: ${params.action ?? "unknown"}`, params.url ? `URL: ${params.url}` : ""].filter(Boolean);
	};
	readonly label = "Chrome DevTools";
	readonly loadMode = "discoverable" as const;
	readonly summary = "Control Chrome via DevTools Protocol for automated UI testing";
	readonly parameters = chromeDevtoolsSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	async execute(
		_toolCallId: string,
		params: ChromeDevtoolsParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<ChromeDevtoolsDetails>> {
		throwIfAborted(signal);
		const timeoutMs = clampTimeout("chrome_devtools", params.timeout) * 1000;
		const cdpUrl = params.cdp_url ?? "http://localhost:9222";

		const details: ChromeDevtoolsDetails = { action: params.action };

		try {
			switch (params.action) {
				case "navigate":
					return await this.#navigate(cdpUrl, params, details, timeoutMs);
				case "screenshot":
					return await this.#screenshot(cdpUrl, params, details, timeoutMs);
				case "evaluate":
					return await this.#evaluate(cdpUrl, params, details, timeoutMs);
				case "get_console":
					return await this.#getConsole(cdpUrl, details, timeoutMs);
				case "get_network":
					return await this.#getNetwork(cdpUrl, details, timeoutMs);
				case "inspect_element":
					return await this.#inspectElement(cdpUrl, params, details, timeoutMs);
				case "test_form":
					return await this.#testForm(cdpUrl, params, details, timeoutMs);
				default:
					throw new ToolError(`Unknown action: ${params.action}`);
			}
		} catch (err) {
			if (err instanceof ToolError) throw err;
			throw new ToolError(`Chrome DevTools error: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async #getTargets(cdpUrl: string): Promise<Array<{ id: string; url: string; title: string; type: string }>> {
		const resp = await fetch(`${cdpUrl}/json/list`);
		if (!resp.ok) throw new ToolError(`Failed to list targets: ${resp.status}`);
		return await resp.json();
	}

	async #sendCommand(
		cdpUrl: string,
		targetId: string,
		method: string,
		params?: Record<string, unknown>,
	): Promise<unknown> {
		const WebSocket = globalThis.WebSocket;
		if (!WebSocket) throw new ToolError("WebSocket not available");

		return new Promise((resolve, reject) => {
			const ws = new WebSocket(`${cdpUrl}/devtools/page/${targetId}`);
			const timeout = setTimeout(() => {
				ws.close();
				reject(new ToolError("CDP command timed out"));
			}, 10_000);

			ws.onopen = () => {
				ws.send(JSON.stringify({ id: 1, method, params }));
			};
			ws.onmessage = event => {
				const data = JSON.parse(String(event.data));
				if (data.id === 1) {
					clearTimeout(timeout);
					ws.close();
					if (data.error) reject(new ToolError(`CDP error: ${data.error.message}`));
					else resolve(data.result);
				}
			};
			ws.onerror = err => {
				clearTimeout(timeout);
				reject(new ToolError(`CDP WebSocket error: ${err}`));
			};
		});
	}

	async #navigate(
		cdpUrl: string,
		params: ChromeDevtoolsParams,
		details: ChromeDevtoolsDetails,
		timeoutMs: number,
	): Promise<AgentToolResult<ChromeDevtoolsDetails>> {
		if (!params.url) throw new ToolError("URL is required for navigate action");
		const targets = await this.#getTargets(cdpUrl);
		const target = targets.find(t => t.type === "page");
		if (!target) throw new ToolError("No page target found in Chrome");

		await this.#sendCommand(cdpUrl, target.id, "Page.navigate", { url: params.url });
		// Wait for load
		await Bun.sleep(Math.min(timeoutMs, 5000));
		details.url = params.url;
		details.result = `Navigated to ${params.url}`;
		return toolResult(details).text(details.result).done();
	}

	async #screenshot(
		cdpUrl: string,
		_params: ChromeDevtoolsParams,
		details: ChromeDevtoolsDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<ChromeDevtoolsDetails>> {
		const targets = await this.#getTargets(cdpUrl);
		const target = targets.find(t => t.type === "page");
		if (!target) throw new ToolError("No page target found in Chrome");

		const result = (await this.#sendCommand(cdpUrl, target.id, "Page.captureScreenshot", {
			format: "png",
		})) as { data: string };

		// Save screenshot to test-evidence directory
		const evidenceDir = path.join(this.session.cwd, ".pakalon-agents", "ai-agents", "test-evidence");
		fs.mkdirSync(evidenceDir, { recursive: true });
		const filename = `chrome-screenshot-${Date.now()}.png`;
		const filepath = path.join(evidenceDir, filename);
		fs.writeFileSync(filepath, Buffer.from(result.data, "base64"));

		details.screenshot = filepath;
		details.result = `Screenshot saved to ${filepath}`;
		return toolResult(details).text(details.result).done();
	}

	async #evaluate(
		cdpUrl: string,
		params: ChromeDevtoolsParams,
		details: ChromeDevtoolsDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<ChromeDevtoolsDetails>> {
		if (!params.script) throw new ToolError("script is required for evaluate action");
		const targets = await this.#getTargets(cdpUrl);
		const target = targets.find(t => t.type === "page");
		if (!target) throw new ToolError("No page target found in Chrome");

		const result = (await this.#sendCommand(cdpUrl, target.id, "Runtime.evaluate", {
			expression: params.script,
			returnByValue: true,
		})) as { result?: { value?: unknown } };

		const value = result.result?.value;
		const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
		details.result = text;
		return toolResult(details).text(text).done();
	}

	async #getConsole(
		cdpUrl: string,
		details: ChromeDevtoolsDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<ChromeDevtoolsDetails>> {
		const targets = await this.#getTargets(cdpUrl);
		const target = targets.find(t => t.type === "page");
		if (!target) throw new ToolError("No page target found in Chrome");

		// Enable console and get recent logs via Runtime.evaluate
		const result = (await this.#sendCommand(cdpUrl, target.id, "Runtime.evaluate", {
			expression: `
				(() => {
					if (!window.__pakalon_console_logs) window.__pakalon_console_logs = [];
					return JSON.stringify(window.__pakalon_console_logs.slice(-50));
				})()
			`,
			returnByValue: true,
		})) as { result?: { value?: string } };

		let logs: string[] = [];
		try {
			logs = JSON.parse(result.result?.value ?? "[]");
		} catch {
			// ignore
		}

		details.console_logs = logs;
		details.result = `Found ${logs.length} console entries`;
		return toolResult(details)
			.text(logs.join("\n") || "No console entries found")
			.done();
	}

	async #getNetwork(
		cdpUrl: string,
		details: ChromeDevtoolsDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<ChromeDevtoolsDetails>> {
		const targets = await this.#getTargets(cdpUrl);
		const target = targets.find(t => t.type === "page");
		if (!target) throw new ToolError("No page target found in Chrome");

		const result = (await this.#sendCommand(cdpUrl, target.id, "Runtime.evaluate", {
			expression: `
				(() => {
					if (!window.__pakalon_network_log) window.__pakalon_network_log = [];
					return JSON.stringify(window.__pakalon_network_log.slice(-30));
				})()
			`,
			returnByValue: true,
		})) as { result?: { value?: string } };

		let requests: string[] = [];
		try {
			requests = JSON.parse(result.result?.value ?? "[]");
		} catch {
			// ignore
		}

		details.network_requests = requests;
		details.result = `Found ${requests.length} network requests`;
		return toolResult(details)
			.text(requests.join("\n") || "No network requests recorded")
			.done();
	}

	async #inspectElement(
		cdpUrl: string,
		params: ChromeDevtoolsParams,
		details: ChromeDevtoolsDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<ChromeDevtoolsDetails>> {
		if (!params.selector) throw new ToolError("selector is required for inspect_element action");
		const targets = await this.#getTargets(cdpUrl);
		const target = targets.find(t => t.type === "page");
		if (!target) throw new ToolError("No page target found in Chrome");

		const result = (await this.#sendCommand(cdpUrl, target.id, "Runtime.evaluate", {
			expression: `
				(() => {
					const el = document.querySelector(${JSON.stringify(params.selector)});
					if (!el) return JSON.stringify({ error: "Element not found" });
					const rect = el.getBoundingClientRect();
					const styles = window.getComputedStyle(el);
					return JSON.stringify({
						tag: el.tagName,
						id: el.id,
						classNames: el.className,
						innerHTML: el.innerHTML.substring(0, 500),
						outerHTML: el.outerHTML.substring(0, 1000),
						rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
						visible: styles.display !== "none" && styles.visibility !== "hidden",
						text: el.textContent?.substring(0, 200),
					}, null, 2);
				})()
			`,
			returnByValue: true,
		})) as { result?: { value?: string } };

		details.result = result.result?.value ?? "{}";
		return toolResult(details).text(details.result).done();
	}

	async #testForm(
		cdpUrl: string,
		params: ChromeDevtoolsParams,
		details: ChromeDevtoolsDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<ChromeDevtoolsDetails>> {
		if (!params.selector) throw new ToolError("selector is required for test_form action");
		if (!params.form_data) throw new ToolError("form_data is required for test_form action");

		const targets = await this.#getTargets(cdpUrl);
		const target = targets.find(t => t.type === "page");
		if (!target) throw new ToolError("No page target found in Chrome");

		const results: string[] = [];
		for (const [fieldSelector, value] of Object.entries(params.form_data)) {
			const fillResult = (await this.#sendCommand(cdpUrl, target.id, "Runtime.evaluate", {
				expression: `
					(() => {
						const el = document.querySelector(${JSON.stringify(fieldSelector)});
						if (!el) return JSON.stringify({ error: "Field not found: " + ${JSON.stringify(fieldSelector)} });
						const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
							window.HTMLInputElement.prototype, "value"
						)?.set;
						if (nativeInputValueSetter) {
							nativeInputValueSetter.call(el, ${JSON.stringify(value)});
						} else {
							el.value = ${JSON.stringify(value)};
						}
						el.dispatchEvent(new Event("input", { bubbles: true }));
						el.dispatchEvent(new Event("change", { bubbles: true }));
						return JSON.stringify({ ok: true, value: el.value });
					})()
				`,
				returnByValue: true,
			})) as { result?: { value?: string } };

			results.push(`${fieldSelector}: ${fillResult.result?.value ?? "failed"}`);
		}

		details.result = results.join("\n");
		return toolResult(details).text(details.result).done();
	}
}
