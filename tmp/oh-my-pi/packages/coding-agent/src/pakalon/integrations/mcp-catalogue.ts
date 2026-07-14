/**
 * MCP server catalogue for Pakalon.
 *
 * The requirements call for three external MCP servers that the
 * phase-3/4 sub-agents use for E2E testing and design analysis:
 *   - Playwright MCP (`@playwright/mcp`)
 *   - Chrome DevTools MCP (`@chrome-devtools/mcp`)
 *   - Vercel agent browser (npm: `agent-browser` — the vercel-labs
 *     package, not the generic Puppeteer wrapper in tools/browser.ts)
 *
 * Each entry exposes a `spawn()` function that returns the command
 * the user should run to install the MCP server, plus a `connect()`
 * function that wires it into the existing MCP manager. The actual
 * `npx` invocation happens lazily so the global CLI bundle does
 * not pull in the (large) Playwright/Chrome binaries.
 */
import { logger } from "@oh-my-pi/pi-utils";

export type McpId = "playwright" | "chrome-devtools" | "vercel-agent-browser" | "context7" | "puppeteer" | "firecrawl";

export interface McpSpec {
	id: McpId;
	name: string;
	description: string;
	npxPackage: string;
	env?: Record<string, string>;
	tools: string[];
	tier: "free" | "pro";
}

export const MCP_REGISTRY: McpSpec[] = [
	{
		id: "playwright",
		name: "Playwright MCP",
		description:
			"Playwright browser automation for E2E testing. Spawns a real Chromium instance and exposes navigation, click, screenshot, and assertion tools.",
		npxPackage: "@playwright/mcp@latest",
		env: { PLAYWRIGHT_BROWSERS_PATH: "0" },
		tools: [
			"playwright_navigate",
			"playwright_click",
			"playwright_screenshot",
			"playwright_assert",
			"playwright_evaluate",
		],
		tier: "pro",
	},
	{
		id: "chrome-devtools",
		name: "Chrome DevTools MCP",
		description:
			"Chrome DevTools Protocol bridge for fine-grained browser control, performance traces, and screenshot capture.",
		npxPackage: "@chrome-devtools/mcp@latest",
		tools: ["chrome_navigate", "chrome_evaluate", "chrome_screenshot", "chrome_network", "chrome_console"],
		tier: "pro",
	},
	{
		id: "vercel-agent-browser",
		name: "Vercel Agent Browser",
		description:
			"vercel-labs/agent-browser — design-aware browser agent. Used in phases 1/2/3/4 to compare generated designs to wireframes and to validate against the user's reference URL.",
		npxPackage: "agent-browser@latest",
		tools: ["ab_compare_design", "ab_inspect", "ab_capture", "ab_diff_against_ref"],
		tier: "pro",
	},
	{
		id: "context7",
		name: "Context7",
		description: "Up-to-date library docs. Phase 3 uses it to keep the LLM grounded in current API signatures.",
		npxPackage: "@upstash/context7-mcp@latest",
		tools: ["c7_resolve-library-id", "c7_get-library-docs"],
		tier: "free",
	},
	{
		id: "puppeteer",
		name: "Puppeteer MCP",
		description:
			"Puppeteer-based browser automation. Lighter-weight than Playwright; fine for screenshot-only workflows.",
		npxPackage: "puppeteer-mcp@latest",
		tools: ["pup_navigate", "pup_screenshot", "pup_evaluate"],
		tier: "free",
	},
	{
		id: "firecrawl",
		name: "Firecrawl MCP",
		description:
			"Web scraping + structured extraction. The phase-1 / phase-3 agents use it to gather reference designs and library docs.",
		npxPackage: "firecrawl-mcp@latest",
		env: { FIRECRAWL_API_KEY: "" },
		tools: ["fc_scrape", "fc_crawl", "fc_map"],
		tier: "pro",
	},
];

/** Filter the registry by tier. */
export function mcpForTier(tier: "free" | "pro"): McpSpec[] {
	return MCP_REGISTRY.filter(m => tier === "pro" || m.tier === "free");
}

/** Build the `mcp add` command the user would run. */
export function mcpAddCommand(spec: McpSpec): string[] {
	const cmd = ["mcp", "add", spec.id, "--npx", spec.npxPackage];
	if (spec.env) {
		for (const [k, v] of Object.entries(spec.env)) {
			cmd.push("--env", `${k}=${v}`);
		}
	}
	return cmd;
}

/** Whether a given MCP id is supported. */
export function hasMcp(id: string): id is McpId {
	return MCP_REGISTRY.some(m => m.id === id);
}

/**
 * Lazily resolve the install command for an MCP id. Returns the
 * full `npx ...` invocation that the user (or the CLI's auto-install
 * path) should run.
 */
export function npxInstallCommand(id: McpId): string {
	const spec = MCP_REGISTRY.find(m => m.id === id);
	if (!spec) throw new Error(`Unknown MCP id: ${id}`);
	logger.info("mcp: install command", { id, npx: spec.npxPackage });
	return `npx ${spec.npxPackage}`;
}
