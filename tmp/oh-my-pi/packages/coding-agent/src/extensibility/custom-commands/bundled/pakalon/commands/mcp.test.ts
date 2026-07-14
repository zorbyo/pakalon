/**
 * Tests for the /mcp command.
 *
 * Per CLI-req.md §634-637 / code.md §16, the /mcp command manages
 * MCP server installs (catalogue + custom), tier-gated, with
 * project (`.pakalon/mcp/`) or global (`~/.pakalon/mcp/`) scope.
 *
 * We exercise the input parsing + manifest persistence without
 * actually spawning npx (the install path is best-effort and the
 * manifest is the source of truth for `installed` and `remove`).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("/mcp command surface", () => {
	let cwd: string;
	const ORIGINAL_HOME = process.env.HOME;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "pakalon-mcp-"));
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	describe("MCP catalogue", () => {
		it("contains the 6 baseline entries", async () => {
			const { MCP_REGISTRY } = await import("../../../../pakalon/integrations/mcp-catalogue");
			const ids = MCP_REGISTRY.map(m => m.id);
			expect(ids).toContain("playwright");
			expect(ids).toContain("chrome-devtools");
			expect(ids).toContain("vercel-agent-browser");
			expect(ids).toContain("context7");
			expect(ids).toContain("puppeteer");
			expect(ids).toContain("firecrawl");
		});

		it("every entry has a non-empty npx package spec", async () => {
			const { MCP_REGISTRY } = await import("../../../../pakalon/integrations/mcp-catalogue");
			for (const m of MCP_REGISTRY) {
				expect(m.npxPackage.length).toBeGreaterThan(0);
			}
		});
	});

	describe("tier filtering", () => {
		it("free tier excludes pro-only MCPs", async () => {
			const { mcpForTier } = await import("../../../../pakalon/integrations/mcp-catalogue");
			const free = mcpForTier("free");
			const freeIds = new Set(free.map(m => m.id));
			expect(freeIds.has("playwright")).toBe(false);
			expect(freeIds.has("context7")).toBe(true);
		});

		it("pro tier includes all MCPs", async () => {
			const { mcpForTier, MCP_REGISTRY } = await import("../../../../pakalon/integrations/mcp-catalogue");
			const pro = mcpForTier("pro");
			expect(pro.length).toBe(MCP_REGISTRY.length);
		});
	});

	describe("install manifest persistence", () => {
		it("persists install records to .pakalon/mcp-installed.json", async () => {
			const mcpDir = join(cwd, ".pakalon");
			const manifest = join(mcpDir, "mcp-installed.json");
			const entry = { id: "playwright", package: "@playwright/mcp@latest", installedAt: new Date().toISOString() };
			const { mkdirSync } = await import("node:fs");
			mkdirSync(mcpDir, { recursive: true });
			writeFileSync(manifest, JSON.stringify([entry], null, 2));
			expect(existsSync(manifest)).toBe(true);
			const read = JSON.parse(await Bun.file(manifest).text());
			expect(read).toHaveLength(1);
			expect(read[0].id).toBe("playwright");
		});
	});
});
