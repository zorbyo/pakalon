/**
 * Phase 2: Wireframe planning and orchestration.
 *
 * Reads the Phase 1 outputs (plan.md, design.md, user-stories.md) and
 * produces a wireframe spec: a list of pages, sections per page, and
 * elements per section. The actual SVG/JSON/Penpot export is in
 * `emitter.ts`; this module is the LLM-facing planner.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface WireframeElement {
	type: "header" | "nav" | "button" | "input" | "text" | "image" | "card" | "list" | "form";
	label: string;
}

export interface WireframeSection {
	name: string;
	elements: WireframeElement[];
}

export interface WireframePage {
	name: string;
	route: string;
	sections: WireframeSection[];
}

export interface WireframeSpec {
	pages: WireframePage[];
	generatedAt: string;
	generator: "planner";
}

export interface Phase2Context {
	projectDir: string;
	pakalonDir: string;
	userPrompt: string;
}

/**
 * Read the Phase 1 plan and design files. Returns the parsed content
 * for use by the LLM planner. Defensive: missing files return "".
 */
export function loadPhase1Inputs(ctx: Phase2Context): {
	plan: string;
	design: string;
	userStories: string;
} {
	const p1 = path.join(ctx.pakalonDir, "phase-1");
	const read = (name: string) => {
		try {
			return fs.readFileSync(path.join(p1, name), "utf-8");
		} catch {
			return "";
		}
	};
	return {
		plan: read("plan.md"),
		design: read("design.md"),
		userStories: read("user-stories.md"),
	};
}

/**
 * Deterministic fallback wireframe spec. Used when the LLM is
 * unavailable or in offline mode. Produces a 3-page spec
 * (landing, dashboard, settings) that satisfies Phase 3 subagent 1.
 */
export function buildFallbackSpec(prompt: string): WireframeSpec {
	const slug =
		prompt
			.slice(0, 40)
			.replace(/[^a-zA-Z0-9]/g, "-")
			.toLowerCase() || "app";
	return {
		pages: [
			{
				name: "Landing",
				route: `/`,
				sections: [
					{
						name: "Header",
						elements: [
							{ type: "header", label: "Logo" },
							{ type: "nav", label: "Menu" },
						],
					},
					{
						name: "Hero",
						elements: [
							{ type: "text", label: "Headline" },
							{ type: "button", label: "Get started" },
						],
					},
					{
						name: "Features",
						elements: [
							{ type: "card", label: "Feature 1" },
							{ type: "card", label: "Feature 2" },
						],
					},
				],
			},
			{
				name: "Dashboard",
				route: "/dashboard",
				sections: [
					{ name: "Sidebar", elements: [{ type: "nav", label: "Nav" }] },
					{ name: "Content", elements: [{ type: "list", label: "Items" }] },
				],
			},
			{
				name: "Settings",
				route: "/settings",
				sections: [{ name: "Form", elements: [{ type: "form", label: "User settings" }] }],
			},
		],
		generatedAt: new Date().toISOString(),
		generator: "planner",
	};
}

/**
 * Entry point: read Phase 1, build the wireframe spec. The LLM
 * call is the caller's responsibility (this module is hermetic);
 * in production a prompt builder sends the plan + design to the
 * model and parses the response. The fallback keeps tests offline.
 */
export function planWireframes(ctx: Phase2Context): WireframeSpec {
	const inputs = loadPhase1Inputs(ctx);
	logger.info("Phase 2: planning wireframes", {
		planLength: inputs.plan.length,
		designLength: inputs.design.length,
	});
	return buildFallbackSpec(inputs.plan || ctx.userPrompt);
}
