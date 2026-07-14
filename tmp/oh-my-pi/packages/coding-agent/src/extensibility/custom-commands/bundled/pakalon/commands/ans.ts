/**
 * /ans command — Side Q&A without interrupting running agent.
 *
 * Returns a structured prompt that tells the LLM to answer a question
 * as a side query — briefly and without disrupting the main workflow.
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

export class AnsCommand implements CustomCommand {
	name = "ans";
	description = "Ask a question without interrupting the running agent";

	constructor(readonly _api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const question = args.join(" ").trim();

		if (!question) {
			ctx.ui.notify("Usage: /ans <your question>", "error");
			return undefined;
		}

		ctx.ui.notify("Answering question as side query...", "info");

		return [
			"## /ans — side Q&A",
			"",
			`**Question:** ${question}`,
			"",
			"Answer this as a side query. Keep it concise and self-contained.",
			"After answering, immediately resume whatever task you were working on.",
			"Do NOT let this answer derail the main workflow — treat it like a brief interruption.",
			"",
			"### Guidelines",
			"",
			"- Answer in 3-5 sentences if possible",
			"- If you need to reference external resources, keep it brief",
			"- Do NOT change any files based on this question",
			"- Do NOT switch context away from the main task",
			"- Return to the previous task immediately after answering",
		].join("\n");
	}
}

export default function ansFactory(api: CustomCommandAPI): AnsCommand {
	return new AnsCommand(api);
}
