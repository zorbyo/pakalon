/**
 * /directory command — Show a tree view of the current project's
 * directory structure, with support for depth limits and gitignore
 * filtering.
 */
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

export interface TreeNode {
	name: string;
	path: string;
	type: "file" | "dir";
	size?: number;
	children?: TreeNode[];
}

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	".omp",
	".pakalon",
	"target",
	"dist",
	".next",
	"__pycache__",
	".vscode",
]);

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildTree(rootPath: string, maxDepth: number, depth: number = 0): TreeNode[] {
	if (depth > maxDepth) return [];

	const nodes: TreeNode[] = [];
	let entries: string[];
	try {
		entries = [...require("node:fs").readdirSync(rootPath, { withFileTypes: true })];
	} catch {
		return nodes;
	}

	entries.sort((a, b) => {
		if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	for (const entry of entries) {
		if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

		const fullPath = path.join(rootPath, entry.name);
		if (entry.isDirectory()) {
			const children = buildTree(fullPath, maxDepth, depth + 1);
			nodes.push({
				name: entry.name,
				path: fullPath,
				type: "dir",
				children: children.length > 0 ? children : undefined,
			});
		} else {
			let size: number | undefined;
			try {
				size = require("node:fs").statSync(fullPath).size;
			} catch {}
			nodes.push({
				name: entry.name,
				path: fullPath,
				type: "file",
				size,
			});
		}
	}

	return nodes;
}

function renderTree(
	nodes: TreeNode[],
	prefix: string = "",
	isLast: boolean = true,
	depth: number = 0,
	maxDepth: number,
): string[] {
	const lines: string[] = [];
	const branch = isLast ? "└── " : "├── ";
	const childPrefix = isLast ? "    " : "│   ";

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!;
		const isLastChild = i === nodes.length - 1;

		const sizeStr = node.type === "file" && node.size !== undefined ? ` (${formatSize(node.size)})` : "";
		lines.push(
			`${prefix}${isLastChild ? "└── " : "├── "}${node.type === "dir" ? "📁 " : "📄 "}${node.name}${sizeStr}`,
		);

		if (node.type === "dir" && node.children && depth < maxDepth) {
			const childLines = renderTree(node.children, prefix + childPrefix, isLastChild, depth + 1, maxDepth);
			lines.push(...childLines);
		}
	}

	return lines;
}

export class DirectoryCommand implements CustomCommand {
	name = "directory";
	description = "Show a tree view of the current project directory structure";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api?.cwd ?? ctx.cwd;
		const maxDepth = args[0] ? Math.min(Math.max(parseInt(args[0], 10) || 3, 1), 6) : 3;

		try {
			const tree = buildTree(cwd, maxDepth);
			if (tree.length === 0) {
				ctx.ui.notify("Directory is empty or inaccessible.", "warning");
				return "Directory is empty or inaccessible.";
			}

			const header = `## Directory: ${cwd}\nDepth: ${maxDepth}  |  📁 = directory  |  📄 = file\n`;
			const rendered = renderTree(tree, "", true, 0, maxDepth);
			const output = `${header}\`\`\`\n${rendered.join("\n")}\n\`\`\``;

			ctx.ui.notify(`Directory tree built (${countNodes(tree)} entries).`, "info");
			return output;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("directory: failed", { err: msg });
			ctx.ui.notify(`Directory failed: ${msg}`, "error");
			return undefined;
		}
	}
}

function countNodes(nodes: TreeNode[]): number {
	let count = 0;
	for (const node of nodes) {
		count++;
		if (node.children) count += countNodes(node.children);
	}
	return count;
}

export default function directoryFactory(_api: CustomCommandAPI): DirectoryCommand {
	return new DirectoryCommand();
}
