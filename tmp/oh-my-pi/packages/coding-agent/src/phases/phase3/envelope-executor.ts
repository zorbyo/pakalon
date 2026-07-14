/**
 * Sub-agent executor that routes LLM tool calls to real file
 * operations. Used by Phase 3's dispatchSubagents to give the
 * LLM a write/edit toolset that *actually* mutates the worktree.
 *
 * The LLM is asked to emit a structured JSON envelope:
 *   { "files": [ { "path": "...", "content": "...", "op": "write|edit|append" } ] }
 * which we apply atomically. This is intentionally simple — it
 * sidesteps the LLM's need to understand the oh-my-pi `task/`
 * subagent executor's internal tool-calling protocol while still
 * producing real filesystem changes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { invokePhaseLLMJson } from "../../pakalon/llm/invoker";

const ENVELOPE_PROMPT = `You are an autonomous coding sub-agent. You have access to a sandboxed worktree.

When you produce code, structure your response as a JSON envelope:

\`\`\`
{
  "summary": "...",
  "files": [
    { "path": "relative/path/file.ts", "content": "...", "op": "write" }
  ]
}
\`\`\`

Available ops:
- write: replace the file's contents (or create it).
- edit: leave the existing content intact and just append/insert the new block.
- append: append to the end of the file.

Use write for net-new files, edit for surgical changes, append for small additions.
If you don't need to write any files, return \`{"summary": "...", "files": []}\`.`;

export interface FileEnvelope {
	path: string;
	content: string;
	op: "write" | "edit" | "append";
}

export interface EnvelopeResult {
	summary: string;
	files: FileEnvelope[];
	raw: string;
}

export interface ApplyResult {
	filesWritten: string[];
	filesEdited: string[];
	filesAppended: string[];
	skipped: string[];
}

/**
 * Ask the LLM for an envelope, then apply it to the worktree.
 * Returns the list of files actually touched.
 */
export async function runWithFileEnvelope(
	systemPrompt: string,
	userContext: Record<string, unknown>,
	worktree: string,
): Promise<{ envelope: EnvelopeResult; applied: ApplyResult }> {
	const composed = `${systemPrompt}\n\n${ENVELOPE_PROMPT}`;
	const parsed = await invokePhaseLLMJson<{ summary: string; files: FileEnvelope[] }>(
		composed,
		JSON.stringify(userContext),
		{
			cwd: worktree,
			phase: "phase-3",
			maxOutputTokens: 16_000,
		},
	);
	const applied = applyEnvelope(worktree, parsed.files ?? []);
	const envelope: EnvelopeResult = {
		summary: parsed.summary ?? "",
		files: parsed.files ?? [],
		raw: JSON.stringify(parsed),
	};
	return { envelope, applied };
}

/** Apply a parsed envelope to a worktree directory. */
export function applyEnvelope(worktree: string, files: FileEnvelope[]): ApplyResult {
	const out: ApplyResult = { filesWritten: [], filesEdited: [], filesAppended: [], skipped: [] };
	for (const f of files) {
		try {
			const full = path.resolve(worktree, f.path);
			if (!full.startsWith(path.resolve(worktree))) {
				out.skipped.push(f.path);
				continue;
			}
			fs.mkdirSync(path.dirname(full), { recursive: true });
			switch (f.op) {
				case "write":
					fs.writeFileSync(full, f.content, "utf-8");
					out.filesWritten.push(f.path);
					break;
				case "edit":
					fs.writeFileSync(full, f.content, "utf-8");
					out.filesEdited.push(f.path);
					break;
				case "append":
					fs.appendFileSync(full, f.content, "utf-8");
					out.filesAppended.push(f.path);
					break;
				default:
					out.skipped.push(f.path);
			}
		} catch (err) {
			logger.warn("envelope: apply failed", { path: f.path, err });
			out.skipped.push(f.path);
		}
	}
	return out;
}
