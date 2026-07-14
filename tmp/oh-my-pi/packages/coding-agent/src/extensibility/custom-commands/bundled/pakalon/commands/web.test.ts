/**
 * Tests for the /web command's free-form prompt parser.
 *
 * Per CLI-req.md §776 and code.md §11, /web must accept three forms:
 *   1. A bare URL.
 *   2. A bare search query.
 *   3. A free-form prompt containing a URL or quoted phrase.
 */
import { describe, expect, it } from "bun:test";
import { extractTarget } from "./web";

describe("/web target extraction", () => {
	it("returns the URL as target for a bare URL", () => {
		const { target, rest } = extractTarget("https://example.com");
		expect(target).toBe("https://example.com");
		expect(rest).toBe("");
	});

	it("returns the URL with surrounding instructions in rest", () => {
		const { target, rest } = extractTarget("go to https://x.io and summarize it");
		expect(target).toBe("https://x.io");
		expect(rest).toContain("go to");
		expect(rest).toContain("summarize");
	});

	it("returns the quoted phrase as target", () => {
		const { target, rest } = extractTarget('search for "best practices for typescript"');
		expect(target).toBe("best practices for typescript");
		expect(rest).toContain("search for");
	});

	it("returns the whole input as target when no URL or quote is present", () => {
		const { target, rest } = extractTarget("nextjs app router");
		expect(target).toBe("nextjs app router");
		expect(rest).toBe("");
	});

	it("handles http:// and https:// the same way", () => {
		const a = extractTarget("fetch http://example.com and summarize");
		const b = extractTarget("fetch https://example.com and summarize");
		expect(a.target.startsWith("http://")).toBe(true);
		expect(b.target.startsWith("https://")).toBe(true);
	});
});
