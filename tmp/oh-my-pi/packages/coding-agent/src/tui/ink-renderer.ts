/**
 * Minimal React-to-text renderer for the multi-session dashboard.
 *
 * The dashboard component (`MultiSessionDashboard`) is a React element
 * tree using `box`/`text` primitives. Since the surrounding TUI is a
 * custom differential renderer (not Ink), we walk the React element
 * tree and produce a flat text representation suitable for `showStatus`.
 *
 * This is intentionally simple: a real implementation would use a
 * flexbox-aware renderer, but for the dashboard cards the layout is
 * linear (header → list → footer) and a flat string is enough.
 */

import type { ReactElement, ReactNode } from "react";
import * as React from "react";

type ElementProps = Record<string, unknown>;

/** Walk a React element tree and emit one line per node. */
function flatten(node: ReactNode, depth = 0, lines: string[] = []): string[] {
	if (node === null || node === undefined || typeof node === "boolean") return lines;
	if (typeof node === "string") {
		if (node.length > 0) lines.push(node);
		return lines;
	}
	if (typeof node === "number") {
		lines.push(String(node));
		return lines;
	}
	if (Array.isArray(node)) {
		for (const child of node) flatten(child, depth, lines);
		return lines;
	}
	if (React.isValidElement(node)) {
		const el = node as ReactElement<ElementProps>;
		const children = (el.props as ElementProps).children as ReactNode | undefined;
		// For our components, the meaningful text is the `children` of `<text>` nodes
		// and the `bold` / `color` props are visual cues we just preserve as-is.
		if (typeof children === "string" || typeof children === "number") {
			lines.push("  ".repeat(depth) + String(children));
		} else if (children !== undefined) {
			flatten(children, depth + 1, lines);
		}
	}
	return lines;
}

/** Render a React element tree to a multi-line string. */
export function renderToString(element: ReactElement): string {
	const lines = flatten(element);
	return lines.join("\n");
}
