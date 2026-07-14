/**
 * /web command — Web search and content fetching.
 *
 * Re-uses omp's web_search and fetch tools. Renders a markdown
 * summary in chat.
 *
 * Per CLI-req.md §776 ("/web do a web search on example.com and give
 * me the contents in this site"), the command accepts three forms:
 *   1. A bare URL: `/web https://example.com` → fetch + summarize.
 *   2. A bare search query: `/web Foo bar` → web search + top hits.
 *   3. A free-form prompt containing either: `/web do a web search
 *      on example.com and give me the contents`. The command parses
 *      out any URL or quoted phrase and uses it as the search/fetch
 *      target; the rest of the prompt becomes the surrounding
 *      instruction to the agent.
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// WebCommand
// ============================================================================

export class WebCommand implements CustomCommand {
	name = "web";
	description = "Search the web or fetch content from a URL (URL, query, or free-form prompt)";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const raw = args.join(" ").trim();
		if (!raw) {
			ctx.ui.notify("Usage: /web <search query or URL>  OR  /web do a web search on <topic>", "error");
			return undefined;
		}

		// Extract the first URL or quoted phrase from a free-form prompt.
		const { target, rest } = extractTarget(raw);
		const isUrl = /^https?:\/\//i.test(target);

		if (isUrl) {
			ctx.ui.notify(`Fetching content from: ${target}`, "info");
			return [
				`Fetch the content at ${target}.`,
				rest ? `User's surrounding instructions: ${rest}` : "",
				`Summarize the page in markdown, keeping headings and links intact, then ${rest ? "address the surrounding instructions." : "return the summary."}`,
			]
				.filter(Boolean)
				.join("\n\n");
		}

		ctx.ui.notify(`Searching for: ${target}`, "info");
		return [
			`Search the web for: ${target}.`,
			rest ? `User's surrounding instructions: ${rest}` : "",
			`Provide a summary of the top results with source URLs and a 1-sentence takeaway per result.`,
			rest ? `Then address the surrounding instructions.` : "",
		]
			.filter(Boolean)
			.join("\n\n");
	}
}

/**
 * Pull the first URL or quoted phrase out of `raw` and return it as
 * `target`. Any remaining text is returned as `rest`. When no URL
 * or quoted phrase is present, the whole input is the target and
 * `rest` is empty.
 */
export function extractTarget(raw: string): { target: string; rest: string } {
	const urlMatch = raw.match(/https?:\/\/[^\s)]+/i);
	if (urlMatch) {
		const url = urlMatch[0];
		const before = raw.slice(0, urlMatch.index ?? 0).trim();
		const after = raw.slice((urlMatch.index ?? 0) + url.length).trim();
		const rest = [before, after].filter(Boolean).join(" ").trim();
		return { target: url, rest };
	}
	const quoted = raw.match(/["'“”‘’]([^"'“”‘’]{2,})["'“”‘’]/);
	if (quoted) {
		const phrase = quoted[1] ?? "";
		const before = raw.slice(0, quoted.index ?? 0).trim();
		const after = raw.slice((quoted.index ?? 0) + quoted[0].length).trim();
		const rest = [before, after].filter(Boolean).join(" ").trim();
		return { target: phrase, rest };
	}
	return { target: raw, rest: "" };
}

export default function webFactory(api: CustomCommandAPI): WebCommand {
	return new WebCommand(api);
}
