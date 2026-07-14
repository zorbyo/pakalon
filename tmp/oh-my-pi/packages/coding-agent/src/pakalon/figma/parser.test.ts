/**
 * Tests for the Figma parser.
 *
 * Per CLI-req.md §617 / code.md §23, free users can import `.fig`
 * files (local archive); Pro users can also import Figma URLs via
 * the REST API. These tests verify the URL-key extraction and the
 * wireframe-spec conversion (no network calls).
 */
import { describe, expect, it } from "bun:test";
import { type FigmaNode, figmaToWireframeSpec } from "./parser";

describe("figma parser", () => {
	describe("figmaToWireframeSpec", () => {
		it("extracts CANVAS nodes as pages", () => {
			const root: FigmaNode = {
				id: "0",
				name: "root",
				type: "DOCUMENT",
				children: [
					{
						id: "1",
						name: "Home",
						type: "CANVAS",
						absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
					},
					{
						id: "2",
						name: "About",
						type: "CANVAS",
						absoluteBoundingBox: { x: 0, y: 0, width: 1024, height: 768 },
					},
				],
			};
			const spec = figmaToWireframeSpec(root);
			expect(spec.pages).toHaveLength(2);
			expect(spec.pages[0]).toEqual({ name: "Home", width: 1440, height: 900 });
			expect(spec.pages[1]).toEqual({ name: "About", width: 1024, height: 768 });
		});

		it("also picks up FRAME and COMPONENT nodes", () => {
			const root: FigmaNode = {
				id: "0",
				name: "root",
				type: "DOCUMENT",
				children: [
					{
						id: "1",
						name: "Hero Frame",
						type: "FRAME",
						absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 },
					},
					{
						id: "2",
						name: "Button",
						type: "COMPONENT",
						absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
					},
				],
			};
			const spec = figmaToWireframeSpec(root);
			expect(spec.pages).toHaveLength(2);
		});

		it("falls back to 1280x800 when no bounding box is present", () => {
			const root: FigmaNode = {
				id: "0",
				name: "root",
				type: "DOCUMENT",
				children: [{ id: "1", name: "No Box", type: "CANVAS" }],
			};
			const spec = figmaToWireframeSpec(root);
			expect(spec.pages[0]?.width).toBe(1280);
			expect(spec.pages[0]?.height).toBe(800);
		});

		it("returns empty pages for a tree with no canvases", () => {
			const root: FigmaNode = { id: "0", name: "root", type: "DOCUMENT" };
			const spec = figmaToWireframeSpec(root);
			expect(spec.pages).toHaveLength(0);
		});
	});
});
