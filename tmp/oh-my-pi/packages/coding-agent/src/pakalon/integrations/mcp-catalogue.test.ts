/**
 * Tests for the MCP catalogue.
 *
 * Per CLI-req.md §634-637 / code.md §16, the CLI ships a catalogue
 * of well-known MCP servers (Playwright, Chrome DevTools, Vercel
 * agent-browser, context7, Puppeteer, Firecrawl). Users install
 * them via `/mcp add <id>` and they're tier-gated where applicable.
 *
 * These tests verify the catalogue functions: presence checks,
 * tier filtering, and the npx-install command shape.
 */
import { describe, expect, it } from "bun:test";
import { hasMcp, MCP_REGISTRY, type McpId, mcpForTier, npxInstallCommand } from "./mcp-catalogue";

describe("mcp catalogue", () => {
	describe("hasMcp", () => {
		it("returns true for known ids", () => {
			expect(hasMcp("playwright")).toBe(true);
			expect(hasMcp("chrome-devtools")).toBe(true);
			expect(hasMcp("vercel-agent-browser")).toBe(true);
		});

		it("returns false for unknown ids", () => {
			expect(hasMcp("totally-made-up")).toBe(false);
			expect(hasMcp("")).toBe(false);
		});
	});

	describe("npxInstallCommand", () => {
		it("returns the npx command for a known id", () => {
			const cmd = npxInstallCommand("playwright");
			expect(cmd).toContain("npx");
			expect(cmd).toContain("playwright");
		});
	});

	describe("mcpForTier", () => {
		it("includes free-tier MCPs for free users", () => {
			const free = mcpForTier("free");
			// Free tier should not throw and should return at least the
			// always-free entries.
			expect(free.length).toBeGreaterThan(0);
		});

		it("returns the same or more for pro users", () => {
			const pro = mcpForTier("pro");
			const free = mcpForTier("free");
			expect(pro.length).toBeGreaterThanOrEqual(free.length);
		});
	});

	describe("MCP_REGISTRY", () => {
		it("contains at least the 6 baseline entries", () => {
			const ids: McpId[] = [
				"playwright",
				"chrome-devtools",
				"vercel-agent-browser",
				"context7",
				"puppeteer",
				"firecrawl",
			];
			for (const id of ids) {
				expect(MCP_REGISTRY.some(m => m.id === id)).toBe(true);
			}
		});

		it("every entry has a non-empty npxPackage", () => {
			for (const m of MCP_REGISTRY) {
				expect(m.npxPackage.length).toBeGreaterThan(0);
			}
		});
	});
});
