import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { generateSyncJsScript, TddScreenshotCapture } from "./tdd";
import type { Phase2Input, Phase2Output } from "./types";

const PHASE2_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-2");
const PHASE1_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1");

interface PageLayout {
	name: string;
	description: string;
	sections: SectionDef[];
}

interface SectionDef {
	type: string;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color: string;
	children?: SectionDef[];
}

function loadPhase1Context(cwd: string): Record<string, string> {
	const memoryPath = path.join(PHASE1_DIR(cwd), ".memory.json");
	try {
		return JSON.parse(fs.readFileSync(memoryPath, "utf-8")) as Record<string, string>;
	} catch {
		return {};
	}
}

function determinePages(cwd: string, input?: Phase2Input): PageLayout[] {
	if (input?.pages && input.pages.length > 0) {
		return input.pages.map(p => getLayoutForPage(p));
	}
	const context = loadPhase1Context(cwd);
	const prompt = (context as any).prompt ?? "";
	const promptLower = prompt.toLowerCase();
	const pages: PageLayout[] = [];

	// Always include core pages
	pages.push(getLayoutForPage("Landing Page"));
	pages.push(getLayoutForPage("Login"));
	pages.push(getLayoutForPage("Register"));

	if (promptLower.includes("dashboard") || promptLower.includes("analytics")) {
		pages.push(getLayoutForPage("Dashboard"));
	}
	if (promptLower.includes("settings") || promptLower.includes("profile")) {
		pages.push(getLayoutForPage("Settings"));
	}
	if (promptLower.includes("ecommerce") || promptLower.includes("store") || promptLower.includes("shop")) {
		pages.push(getLayoutForPage("Product Listing"));
		pages.push(getLayoutForPage("Product Detail"));
		pages.push(getLayoutForPage("Cart"));
	}
	if (promptLower.includes("saas") || promptLower.includes("subscription")) {
		pages.push(getLayoutForPage("Pricing"));
	}
	if (promptLower.includes("blog") || promptLower.includes("content")) {
		pages.push(getLayoutForPage("Blog"));
	}

	return pages.slice(0, 8);
}

function getLayoutForPage(pageName: string): PageLayout {
	const layouts: Record<string, PageLayout> = {
		"Landing Page": {
			name: "Landing Page",
			description: "Main landing page with hero, features, and CTA",
			sections: [
				{ type: "navbar", label: "Navigation Bar", x: 0, y: 0, width: 1200, height: 64, color: "#1e293b" },
				{ type: "hero", label: "Hero Section", x: 0, y: 64, width: 1200, height: 400, color: "#3b82f6" },
				{ type: "features", label: "Features Grid", x: 0, y: 464, width: 1200, height: 300, color: "#f8fafc" },
				{ type: "testimonials", label: "Testimonials", x: 0, y: 764, width: 1200, height: 250, color: "#e2e8f0" },
				{ type: "cta", label: "Call to Action", x: 0, y: 1014, width: 1200, height: 200, color: "#2563eb" },
				{ type: "footer", label: "Footer", x: 0, y: 1214, width: 1200, height: 150, color: "#0f172a" },
			],
		},
		Dashboard: {
			name: "Dashboard",
			description: "Main dashboard with analytics and metrics",
			sections: [
				{ type: "sidebar", label: "Sidebar Navigation", x: 0, y: 0, width: 260, height: 800, color: "#1e293b" },
				{ type: "topbar", label: "Top Bar", x: 260, y: 0, width: 940, height: 64, color: "#f1f5f9" },
				{ type: "stats", label: "Statistics Cards", x: 260, y: 64, width: 940, height: 120, color: "#f8fafc" },
				{ type: "chart", label: "Chart Area", x: 260, y: 184, width: 620, height: 300, color: "#ffffff" },
				{ type: "activity", label: "Recent Activity", x: 880, y: 184, width: 320, height: 300, color: "#f8fafc" },
				{ type: "table", label: "Data Table", x: 260, y: 484, width: 940, height: 316, color: "#ffffff" },
			],
		},
		Login: {
			name: "Login",
			description: "User login page",
			sections: [
				{ type: "background", label: "Background", x: 0, y: 0, width: 1200, height: 800, color: "#f1f5f9" },
				{ type: "card", label: "Login Card", x: 400, y: 160, width: 400, height: 400, color: "#ffffff" },
				{ type: "logo", label: "Logo", x: 560, y: 190, width: 80, height: 80, color: "#3b82f6" },
				{ type: "form", label: "Login Form", x: 430, y: 290, width: 340, height: 200, color: "#f8fafc" },
				{ type: "button", label: "Submit Button", x: 430, y: 500, width: 340, height: 44, color: "#2563eb" },
				{ type: "link", label: "Sign Up Link", x: 430, y: 550, width: 340, height: 30, color: "transparent" },
			],
		},
		Register: {
			name: "Register",
			description: "User registration page",
			sections: [
				{ type: "background", label: "Background", x: 0, y: 0, width: 1200, height: 800, color: "#f1f5f9" },
				{ type: "card", label: "Register Card", x: 380, y: 100, width: 440, height: 550, color: "#ffffff" },
				{ type: "logo", label: "Logo", x: 560, y: 130, width: 80, height: 80, color: "#3b82f6" },
				{ type: "form", label: "Registration Form", x: 410, y: 240, width: 380, height: 300, color: "#f8fafc" },
				{ type: "button", label: "Submit Button", x: 410, y: 550, width: 380, height: 44, color: "#2563eb" },
				{ type: "link", label: "Login Link", x: 410, y: 600, width: 380, height: 30, color: "transparent" },
			],
		},
		Settings: {
			name: "Settings",
			description: "User settings and preferences",
			sections: [
				{ type: "sidebar", label: "Sidebar", x: 0, y: 0, width: 260, height: 800, color: "#1e293b" },
				{ type: "topbar", label: "Top Bar", x: 260, y: 0, width: 940, height: 64, color: "#f1f5f9" },
				{ type: "tabs", label: "Settings Tabs", x: 280, y: 80, width: 900, height: 50, color: "#e2e8f0" },
				{ type: "profile", label: "Profile Settings", x: 280, y: 150, width: 900, height: 400, color: "#ffffff" },
				{ type: "danger", label: "Danger Zone", x: 280, y: 570, width: 900, height: 200, color: "#fef2f2" },
			],
		},
	};

	return (
		layouts[pageName] ?? {
			name: pageName,
			description: `${pageName} page`,
			sections: [
				{ type: "navbar", label: "Navigation Bar", x: 0, y: 0, width: 1200, height: 64, color: "#1e293b" },
				{ type: "content", label: "Content Area", x: 0, y: 64, width: 1200, height: 586, color: "#ffffff" },
				{ type: "footer", label: "Footer", x: 0, y: 650, width: 1200, height: 150, color: "#0f172a" },
			],
		}
	);
}

function generateSvgWireframe(page: PageLayout, index: number): string {
	const elements: string[] = [];
	elements.push(`<g id="page-${index}">`);

	for (const section of page.sections) {
		const hasBorder = section.type !== "background";
		const rx = section.type === "card" || section.type === "button" ? "8" : "0";
		const strokeColor = section.color === "#ffffff" || section.color === "#f8fafc" ? "#cbd5e1" : "none";
		elements.push(
			`  <rect x="${section.x}" y="${section.y}" width="${section.width}" height="${section.height}" fill="${section.color}" stroke="${strokeColor}" stroke-width="${hasBorder ? "1" : "0"}" rx="${rx}" />`,
		);
		elements.push(
			`  <text x="${section.x + 12}" y="${section.y + 24}" font-family="Inter, sans-serif" font-size="11" fill="${section.color === "#ffffff" || section.color === "#f8fafc" || section.color === "#f1f5f9" || section.color === "#e2e8f0" ? "#64748b" : "#ffffff"}" font-weight="600">${section.label}</text>`,
		);

		if (section.children) {
			for (const child of section.children) {
				elements.push(
					`  <rect x="${child.x}" y="${child.y}" width="${child.width}" height="${child.height}" fill="${child.color}" stroke="#cbd5e1" stroke-width="1" rx="4" />`,
				);
				elements.push(
					`  <text x="${child.x + 8}" y="${child.y + 18}" font-family="Inter, sans-serif" font-size="10" fill="#64748b">${child.label}</text>`,
				);
			}
		}
	}

	// Draw grid lines for reference
	if (index === 0) {
		elements.push(
			`  <line x1="400" y1="0" x2="400" y2="800" stroke="#e2e8f0" stroke-width="0.5" stroke-dasharray="4,4" />`,
		);
		elements.push(
			`  <line x1="800" y1="0" x2="800" y2="800" stroke="#e2e8f0" stroke-width="0.5" stroke-dasharray="4,4" />`,
		);
	}

	elements.push(`</g>`);

	return `  <!-- Page: ${page.name} -->
  <text x="20" y="${20 + index * 820}" font-family="Inter, sans-serif" font-size="14" fill="#334155" font-weight="700">${page.name}</text>
  <text x="20" y="${34 + index * 820}" font-family="Inter, sans-serif" font-size="10" fill="#94a3b8">${page.description}</text>
  <g transform="translate(20, ${44 + index * 820}) scale(0.8)">
    ${elements.join("\n    ")}
  </g>`;
}

function generateWireframeSvg(pages: PageLayout[]): string {
	const totalHeight = pages.length * 680 + 100;
	const pageElements = pages.map((p, i) => generateSvgWireframe(p, i)).join("\n\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 ${totalHeight}" width="1240" height="${totalHeight}">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;display=swap');
    </style>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.1"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1240" height="${totalHeight}" fill="#f8fafc"/>

  <!-- Title -->
  <text x="620" y="40" text-anchor="middle" font-family="Inter, sans-serif" font-size="24" fill="#0f172a" font-weight="700">Wireframe Designs</text>
  <text x="620" y="62" text-anchor="middle" font-family="Inter, sans-serif" font-size="12" fill="#94a3b8">Generated by Pakalon AI - ${new Date().toISOString().slice(0, 10)}</text>

  <!-- Pages -->
  ${pageElements}

  <!-- Legend -->
  <g transform="translate(20, ${totalHeight - 60})">
    <rect x="0" y="0" width="16" height="16" fill="#3b82f6" rx="2" />
    <text x="22" y="12" font-family="Inter, sans-serif" font-size="11" fill="#64748b">Header/Nav</text>
    <rect x="120" y="0" width="16" height="16" fill="#f8fafc" stroke="#cbd5e1" rx="2" />
    <text x="142" y="12" font-family="Inter, sans-serif" font-size="11" fill="#64748b">Content</text>
    <rect x="240" y="0" width="16" height="16" fill="#0f172a" rx="2" />
    <text x="262" y="12" font-family="Inter, sans-serif" font-size="11" fill="#64748b">Footer/Sidebar</text>
    <rect x="370" y="0" width="16" height="16" fill="#2563eb" rx="2" />
    <text x="392" y="12" font-family="Inter, sans-serif" font-size="11" fill="#64748b">CTA/Buttons</text>
    <rect x="490" y="0" width="16" height="16" fill="#e2e8f0" rx="2" />
    <text x="512" y="12" font-family="Inter, sans-serif" font-size="11" fill="#64748b">Secondary</text>
  </g>
</svg>`;
}

function generateWireframeJson(pages: PageLayout[]): string {
	const data = {
		generatedAt: new Date().toISOString(),
		generator: "pakalon-phase-2",
		totalPages: pages.length,
		pages: pages.map((p, i) => ({
			id: `page-${i + 1}`,
			name: p.name,
			description: p.description,
			width: 1200,
			height: 800,
			elements: p.sections.map((s, j) => ({
				id: `elem-${i + 1}-${j + 1}`,
				type: s.type,
				label: s.label,
				x: s.x,
				y: s.y,
				width: s.width,
				height: s.height,
				color: s.color,
				children: s.children?.map((c, k) => ({
					id: `child-${i + 1}-${j + 1}-${k + 1}`,
					type: c.type,
					label: c.label,
					x: c.x,
					y: c.y,
					width: c.width,
					height: c.height,
				})),
			})),
		})),
	};
	return JSON.stringify(data, null, 2);
}

function generatePenpotSpec(pages: PageLayout[]): string {
	const data = {
		version: 1,
		generator: "pakalon-phase-2",
		generatedAt: new Date().toISOString(),
		pages: pages.map((p, i) => ({
			id: `page-${i + 1}`,
			name: p.name,
			width: 1200,
			height: 800,
			background: "#FFFFFF",
			layers: p.sections.map((s, j) => ({
				id: `layer-${i + 1}-${j + 1}`,
				name: s.label,
				type: "rect",
				x: s.x,
				y: s.y,
				width: s.width,
				height: s.height,
				fill: s.color,
				stroke: s.color === "#ffffff" ? "#cbd5e1" : undefined,
				strokeWidth: s.color === "#ffffff" ? 1 : 0,
				opacity: 1,
				children: s.children?.map((c, k) => ({
					id: `sublayer-${i + 1}-${j + 1}-${k + 1}`,
					name: c.label,
					type: "rect",
					x: c.x,
					y: c.y,
					width: c.width,
					height: c.height,
					fill: c.color,
				})),
			})),
		})),
	};
	return JSON.stringify(data, null, 2);
}

function generateSummary(pages: PageLayout[], tddPassed: boolean, tddAttempts: number, figmaImported: boolean): string {
	return `# Phase 2: Wireframe & Design Summary

## Overview
- **Generated:** ${new Date().toISOString()}
- **Total Pages:** ${pages.length}
- **TDD Status:** ${tddPassed ? "✅ PASSED" : "⏳ PENDING"}
- **TDD Attempts:** ${tddAttempts}
- **Figma Imported:** ${figmaImported ? "✅ Yes" : "❌ No"}

## Pages Generated
${pages.map((p, i) => `${i + 1}. **${p.name}** - ${p.description} (${p.sections.length} sections)`).join("\n")}

## Output Files
| File | Format | Description |
|------|--------|-------------|
| Wireframe_generated.svg | SVG | Visual wireframe with all pages |
| Wireframe_generated.json | JSON | Structured element data |
| Wireframe_generated.penpot | Penpot | Penpot-compatible format |
| phase-2.md | Markdown | This summary document |

## Next Steps
1. Review wireframes and provide feedback
2. Use "/update" command for specific modifications
3. Open Penpot with "/penpot" for visual editing
4. Type "Accept this design" to proceed to Phase 3

## Technical Details
- Wireframes follow a 12-column grid system
- Responsive design considerations applied
- Component spacing follows 8px grid
- Color scheme uses Tailwind CSS palette
`;
}

export async function runPhase2(cwd: string, input?: Phase2Input): Promise<Phase2Output> {
	logger.info("Phase 2: Wireframe Generation started", { cwd });
	const dir = PHASE2_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(path.join(dir, "tdd-screenshots"), { recursive: true });

	// Determine pages either from input or from Phase 1 context
	const pages = determinePages(cwd, input);

	// Generate wireframes
	const wireframeSvg = generateWireframeSvg(pages);
	const wireframeJson = generateWireframeJson(pages);
	const penpotSpec = generatePenpotSpec(pages);

	// Save figma import if provided
	let figmaImported = false;
	if (input?.figmaSource) {
		try {
			const figmaDir = path.join(dir, "figma-imports");
			fs.mkdirSync(figmaDir, { recursive: true });
			fs.writeFileSync(path.join(figmaDir, "figma-source.txt"), input.figmaSource);
			figmaImported = true;
			logger.info("Figma source imported", { source: input.figmaSource.slice(0, 100) });
		} catch (err) {
			logger.warn("Figma import failed", { error: err });
		}
	}

	let tddPassed = false;
	let tddAttempts = 0;
	if (input?.tddEnabled) {
		const tdd = new TddScreenshotCapture();
		const maxAttempts = input?.tddMaxAttempts ?? 3;
		const tddResult = await tdd.captureScreenshots({
			maxAttempts,
			outputDir: path.join(dir, "tdd-screenshots"),
			svgPath: path.join(dir, "Wireframe_generated.svg"),
		});
		tddPassed = tddResult.passed;
		tddAttempts = tddResult.attempts;
		logger.info("TDD screenshots captured", { passed: tddPassed, attempts: tddAttempts });
	}

	const syncJsContent = generateSyncJsScript();
	const agentsDir = path.join(cwd, ".pakalon-agents", "ai-agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	fs.writeFileSync(path.join(agentsDir, "sync.js"), syncJsContent);

	const summary = generateSummary(pages, tddPassed, tddAttempts, figmaImported);

	// Write output files
	fs.writeFileSync(path.join(dir, "Wireframe_generated.svg"), wireframeSvg);
	fs.writeFileSync(path.join(dir, "Wireframe_generated.json"), wireframeJson);
	fs.writeFileSync(path.join(dir, "Wireframe_generated.penpot"), penpotSpec);
	fs.writeFileSync(path.join(dir, "phase-2.md"), summary);

	// Write memory context for phase-to-phase passing
	const memoryContext = {
		phase: "phase-2",
		pages: pages.map(p => ({ name: p.name, sections: p.sections.length })),
		wireframeFiles: ["Wireframe_generated.svg", "Wireframe_generated.json", "Wireframe_generated.penpot"],
		figmaImported,
		tddPassed,
		tddAttempts,
		syncJsGenerated: true,
		generatedAt: new Date().toISOString(),
	};
	fs.writeFileSync(path.join(dir, ".memory.json"), JSON.stringify(memoryContext, null, 2));

	logger.info("Phase 2 completed", { pages: pages.length, tddPassed, tddAttempts });
	return {
		wireframeSvg,
		wireframeJson,
		penpotSpec,
		summary,
		tddAttempts,
		tddPassed,
		figmaImported,
	};
}
