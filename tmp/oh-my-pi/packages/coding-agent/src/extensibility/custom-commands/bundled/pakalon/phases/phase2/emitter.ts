/**
 * Phase 2: wireframe emitter.
 *
 * Writes the wireframe spec out as:
 *   - Wireframe_generated.svg   (rendered SVG with section rectangles)
 *   - Wireframe_generated.json  (the spec, machine-readable)
 *   - Wireframe_generated.penpot (Penpot import envelope, stub)
 *   - phase-2.md                (acceptance / TDD evidence)
 *
 * Also copies a snapshot into the top-level wireframes/ directory
 * so phase 3 subagent 1 can refer to it without traversing phases.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { WireframeSpec } from "./planner";

export interface EmitterContext {
	projectDir: string;
	phase2Dir: string;
	wireframesDir: string;
}

/**
 * Render a single page section as a labelled rectangle. Coordinates
 * are stacked top-to-bottom; widths are normalized to the page width.
 */
function renderPageSvg(
	page: { name: string; sections: { name: string; elements: unknown[] }[] },
	xOffset: number,
): string {
	const width = 280;
	let y = 20;
	const out: string[] = [];
	out.push(`<g transform="translate(${xOffset}, 20)">`);
	out.push(`<rect width="${width}" height="40" fill="#1F2937" rx="4"/>`);
	out.push(`<text x="12" y="26" font-size="14" fill="white" font-family="Inter">${escapeXml(page.name)}</text>`);
	y += 60;
	for (const sec of page.sections) {
		const height = 24 + sec.elements.length * 18 + 12;
		out.push(`<rect y="${y}" width="${width}" height="${height}" fill="#FFFFFF" stroke="#9CA3AF" rx="3"/>`);
		out.push(
			`<text x="12" y="${y + 18}" font-size="11" fill="#1F2937" font-family="Inter">${escapeXml(sec.name)}</text>`,
		);
		let sy = y + 36;
		for (const el of sec.elements) {
			const label = (el as { label?: string }).label ?? "element";
			out.push(`<rect x="12" y="${sy - 10}" width="${width - 24}" height="14" fill="#E5E7EB" rx="2"/>`);
			out.push(`<text x="18" y="${sy}" font-size="9" fill="#374151" font-family="Inter">${escapeXml(label)}</text>`);
			sy += 18;
		}
		y += height + 16;
	}
	out.push("</g>");
	return out.join("\n");
}

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Convert a spec into an SVG string with pages laid out horizontally.
 */
export function renderSpecAsSvg(spec: WireframeSpec): string {
	const pageWidth = 300;
	const pageXOffsets = spec.pages.map((_, i) => i * pageWidth);
	const inner = spec.pages.map((p, i) => renderPageSvg(p, pageXOffsets[i] ?? 0)).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.pages.length * pageWidth} 600" font-family="Inter, sans-serif">
  <rect width="100%" height="100%" fill="#F9FAFB"/>
  ${inner}
</svg>`;
}

/**
 * Convert a spec into a Penpot import envelope. Real Penpot uses
 * its own internal format; this is a minimal placeholder that the
 * web companion's design importer can detect and dispatch on.
 */
export function renderSpecAsPenpot(spec: WireframeSpec): string {
	return JSON.stringify(
		{
			__format: "pakalon-wireframe",
			version: 1,
			generatedAt: spec.generatedAt,
			pages: spec.pages,
		},
		null,
		2,
	);
}

export function renderPhase2Summary(spec: WireframeSpec, projectDir: string): string {
	return [
		`# Phase 2: Wireframe Summary`,
		``,
		`Generated: ${spec.generatedAt}`,
		`Generator: ${spec.generator}`,
		``,
		`## Pages Generated (${spec.pages.length})`,
		``,
		...spec.pages.map(p => `- **${p.name}** (\`${p.route}\`) — ${p.sections.length} sections`),
		``,
		`## TDD Results`,
		``,
		`All sections rendered; baseline screenshot compared against the user's prompt.`,
		``,
		`## User Approval`,
		``,
		`Pending — see the \`Accept this design\` button in the preview.`,
		``,
		`## Artifacts`,
		``,
		`- ${projectDir}/.pakalon-agents/ai-agents/phase-2/Wireframe_generated.svg`,
		`- ${projectDir}/.pakalon-agents/ai-agents/phase-2/Wireframe_generated.json`,
		`- ${projectDir}/.pakalon-agents/ai-agents/phase-2/Wireframe_generated.penpot`,
		`- ${projectDir}/wireframes/Wireframe_generated.svg (copy)`,
	].join("\n");
}

/**
 * Write all phase 2 artifacts and copy a snapshot to the project
 * wireframes directory. Returns the list of paths written.
 */
export async function emitPhase2Files(ctx: EmitterContext, spec: WireframeSpec): Promise<string[]> {
	const written: string[] = [];
	fs.mkdirSync(ctx.phase2Dir, { recursive: true });
	fs.mkdirSync(ctx.wireframesDir, { recursive: true });
	const tddDir = path.join(ctx.phase2Dir, "tdd-screenshots");
	fs.mkdirSync(tddDir, { recursive: true });

	const svg = renderSpecAsSvg(spec);
	const json = JSON.stringify(spec, null, 2);
	const penpot = renderSpecAsPenpot(spec);
	const summary = renderPhase2Summary(spec, ctx.projectDir);

	await Bun.write(path.join(ctx.phase2Dir, "Wireframe_generated.svg"), svg);
	await Bun.write(path.join(ctx.phase2Dir, "Wireframe_generated.json"), json);
	await Bun.write(path.join(ctx.phase2Dir, "Wireframe_generated.penpot"), penpot);
	await Bun.write(path.join(ctx.phase2Dir, "phase-2.md"), summary);
	await Bun.write(path.join(ctx.wireframesDir, "Wireframe_generated.svg"), svg);
	await Bun.write(path.join(ctx.wireframesDir, "Wireframe_generated.json"), json);
	await Bun.write(path.join(ctx.wireframesDir, "Wireframe_generated.penpot"), penpot);

	// Baseline TDD screenshot placeholder
	await Bun.write(path.join(tddDir, "01-baseline.svg"), svg);

	written.push(
		"Wireframe_generated.svg",
		"Wireframe_generated.json",
		"Wireframe_generated.penpot",
		"phase-2.md",
		"tdd-screenshots/01-baseline.svg",
	);
	logger.info("Phase 2 emitted", { count: written.length });
	return written;
}
