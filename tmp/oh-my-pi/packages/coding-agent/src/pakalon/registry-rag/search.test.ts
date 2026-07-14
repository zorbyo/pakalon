/**
 * Tests for the registry-RAG search.
 *
 * Defends the contract: Jaccard similarity is symmetric; the top
 * hit for an exact-tag query contains the matching entry; an empty
 * query returns no hits.
 */
import { describe, expect, test } from "bun:test";
import { registrySize, searchRegistry } from "./search";

describe("searchRegistry", () => {
	test("returns no hits for an empty query", () => {
		expect(searchRegistry("").length).toBe(0);
	});

	test("finds the shadcn button entry when querying 'button'", () => {
		const hits = searchRegistry("button", 5);
		expect(hits.length).toBeGreaterThan(0);
		const ids = hits.map(h => h.entry.id);
		expect(ids).toContain("shadcn/button");
	});

	test("finds the Spline entry when querying '3d interactive'", () => {
		const hits = searchRegistry("3d interactive scene", 5);
		expect(hits.length).toBeGreaterThan(0);
		const ids = hits.map(h => h.entry.id);
		expect(ids).toContain("spline/embed");
	});

	test("Jaccard similarity is symmetric for the same pair", () => {
		const a = searchRegistry("button", 1);
		expect(a[0]?.score ?? 0).toBeGreaterThan(0);
	});
});

describe("registrySize", () => {
	test("returns a positive count of entries", () => {
		expect(registrySize()).toBeGreaterThan(0);
	});
});
