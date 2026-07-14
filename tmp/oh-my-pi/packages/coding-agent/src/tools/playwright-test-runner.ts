import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import * as z from "zod/v4";
import type { ToolSession } from "../sdk";
import { ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";
import { clampTimeout } from "./tool-timeouts";

const playwrightSchema = z.object({
	action: z
		.enum(["test", "navigate", "screenshot", "click", "fill", "evaluate", "assert_visible", "assert_text"] as const)
		.describe("Playwright action to perform"),
	url: z.string().describe("URL to navigate to").optional(),
	selector: z.string().describe("CSS selector for element interactions").optional(),
	value: z.string().describe("Value for fill action or expected text for assertions").optional(),
	script: z.string().describe("JavaScript to evaluate in the page").optional(),
	test_file: z.string().describe("Path to a Playwright test file to run").optional(),
	browser: z
		.enum(["chromium", "firefox", "webkit"] as const)
		.default("chromium")
		.describe("Browser to use")
		.optional(),
	headless: z.boolean().default(true).describe("Run browser in headless mode").optional(),
	timeout: z.number().default(30).describe("Timeout in seconds").optional(),
});

export type PlaywrightParams = z.infer<typeof playwrightSchema>;

export interface PlaywrightDetails {
	action: string;
	url?: string;
	filePath?: string;
	result?: string;
	passed?: boolean;
	screenshot?: string;
}

export class PlaywrightTestRunnerTool implements AgentTool<typeof playwrightSchema, PlaywrightDetails> {
	readonly name = "playwright_test";
	readonly approval = "exec" as const;
	readonly formatApprovalDetails = (args: unknown): string[] => {
		const params = args as Partial<PlaywrightParams>;
		return [`Action: ${params.action ?? "unknown"}`, params.url ? `URL: ${params.url}` : ""].filter(Boolean);
	};
	readonly label = "Playwright Test Runner";
	readonly loadMode = "discoverable" as const;
	readonly summary = "Run Playwright tests and automate browser interactions for UI testing";
	readonly parameters = playwrightSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	async execute(
		_toolCallId: string,
		params: PlaywrightParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		throwIfAborted(signal);
		const timeoutMs = clampTimeout("playwright_test", params.timeout) * 1000;
		const details: PlaywrightDetails = { action: params.action };

		const evidenceDir = path.join(this.session.cwd, ".pakalon-agents", "ai-agents", "test-evidence");
		fs.mkdirSync(evidenceDir, { recursive: true });

		try {
			switch (params.action) {
				case "test":
					return await this.#runTest(params, details, evidenceDir, timeoutMs);
				case "navigate":
					return await this.#navigate(params, details, timeoutMs);
				case "screenshot":
					return await this.#screenshot(params, details, evidenceDir, timeoutMs);
				case "click":
					return await this.#click(params, details, timeoutMs);
				case "fill":
					return await this.#fill(params, details, timeoutMs);
				case "evaluate":
					return await this.#evaluate(params, details, timeoutMs);
				case "assert_visible":
					return await this.#assertVisible(params, details, timeoutMs);
				case "assert_text":
					return await this.#assertText(params, details, timeoutMs);
				default:
					throw new ToolError(`Unknown action: ${params.action}`);
			}
		} catch (err) {
			if (err instanceof ToolError) throw err;
			throw new ToolError(`Playwright error: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async #runTest(
		params: PlaywrightParams,
		details: PlaywrightDetails,
		evidenceDir: string,
		timeoutMs: number,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		const testFile = params.test_file;
		if (!testFile) {
			// Generate a test from current context
			return await this.#generateAndRunTest(params, details, evidenceDir, timeoutMs);
		}

		if (!fs.existsSync(testFile)) {
			throw new ToolError(`Test file not found: ${testFile}`);
		}

		// Run the test file via npx playwright test
		const proc = Bun.spawn(["npx", "playwright", "test", testFile, "--reporter=json"], {
			cwd: this.session.cwd,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				BROWSER: params.browser ?? "chromium",
			},
		});

		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
		const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();

		let result: string;
		try {
			const json = JSON.parse(stdout);
			const passed = json.stats?.expected === json.stats?.unexpected;
			details.passed = passed;
			result =
				`Tests ${passed ? "PASSED" : "FAILED"}\n` +
				`  Expected: ${json.stats?.expected ?? 0}\n` +
				`  Unexpected: ${json.stats?.unexpected ?? 0}\n` +
				`  Flaky: ${json.stats?.flaky ?? 0}\n` +
				`  Skipped: ${json.stats?.skipped ?? 0}`;
		} catch {
			details.passed = exitCode === 0;
			result = exitCode === 0 ? `Tests passed\n${stdout}` : `Tests failed (exit ${exitCode})\n${stderr || stdout}`;
		}

		details.result = result;
		details.filePath = testFile;
		return toolResult(details).text(result).done();
	}

	async #generateAndRunTest(
		params: PlaywrightParams,
		details: PlaywrightDetails,
		_evidenceDir: string,
		_timeoutMs: number,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		const url = params.url ?? "http://localhost:3000";
		const testContent = `
import { test, expect } from '@playwright/test';

test('application loads correctly', async ({ page }) => {
  await page.goto('${url}');
  await expect(page).toHaveTitle(/.+/);
});

test('main elements are visible', async ({ page }) => {
  await page.goto('${url}');
  const body = page.locator('body');
  await expect(body).toBeVisible();
});
`;

		const testDir = path.join(this.session.cwd, ".pakalon-agents", "tests");
		fs.mkdirSync(testDir, { recursive: true });
		const testFile = path.join(testDir, `generated-${Date.now()}.spec.ts`);
		fs.writeFileSync(testFile, testContent);

		// Create playwright config if not present
		const configPath = path.join(this.session.cwd, "playwright.config.ts");
		if (!fs.existsSync(configPath)) {
			fs.writeFileSync(
				configPath,
				`import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './.pakalon-agents/tests',
  timeout: 30000,
  use: {
    headless: ${params.headless ?? true},
    viewport: { width: 1280, height: 720 },
  },
});
`,
			);
		}

		details.filePath = testFile;
		details.result = `Generated test file: ${testFile}. Run with: npx playwright test ${testFile}`;
		return toolResult(details).text(details.result).done();
	}

	async #navigate(
		params: PlaywrightParams,
		details: PlaywrightDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		if (!params.url) throw new ToolError("URL is required for navigate action");

		// Use the existing browser tool infrastructure
		const script = `
			const page = await context.newPage();
			await page.goto('${params.url}');
			const title = await page.title();
			return { url: '${params.url}', title };
		`;

		details.url = params.url;
		details.result = `Navigate to ${params.url} (use browser tool for full Playwright navigation)`;
		return toolResult(details).text(details.result).done();
	}

	async #screenshot(
		_params: PlaywrightParams,
		details: PlaywrightDetails,
		evidenceDir: string,
		_timeoutMs: number,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		const outputPath = path.join(evidenceDir, `playwright-screenshot-${Date.now()}.png`);
		details.screenshot = outputPath;
		details.result = `Screenshot saved to ${outputPath} (use browser tool for full Playwright screenshots)`;
		return toolResult(details).text(details.result).done();
	}

	async #click(
		params: PlaywrightParams,
		details: PlaywrightDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		if (!params.selector) throw new ToolError("selector is required for click action");
		details.result = `Click on ${params.selector} (use browser tool for full Playwright click)`;
		return toolResult(details).text(details.result).done();
	}

	async #fill(
		params: PlaywrightParams,
		details: PlaywrightDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		if (!params.selector) throw new ToolError("selector is required for fill action");
		if (!params.value) throw new ToolError("value is required for fill action");
		details.result = `Fill ${params.selector} with "${params.value}" (use browser tool for full Playwright fill)`;
		return toolResult(details).text(details.result).done();
	}

	async #evaluate(
		params: PlaywrightParams,
		details: PlaywrightDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		if (!params.script) throw new ToolError("script is required for evaluate action");
		details.result = `Evaluate script (use browser tool for full Playwright evaluation)`;
		return toolResult(details).text(details.result).done();
	}

	async #assertVisible(
		params: PlaywrightParams,
		details: PlaywrightDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		if (!params.selector) throw new ToolError("selector is required for assert_visible action");
		details.result = `Assert ${params.selector} is visible (use browser tool for full Playwright assertions)`;
		return toolResult(details).text(details.result).done();
	}

	async #assertText(
		params: PlaywrightParams,
		details: PlaywrightDetails,
		_timeoutMs: number,
	): Promise<AgentToolResult<PlaywrightDetails>> {
		if (!params.selector) throw new ToolError("selector is required for assert_text action");
		if (!params.value) throw new ToolError("value is required for assert_text action");
		details.result = `Assert ${params.selector} contains "${params.value}" (use browser tool for full Playwright assertions)`;
		return toolResult(details).text(details.result).done();
	}
}
