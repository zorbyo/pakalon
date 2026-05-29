import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { Command } from "../types-imported/command.js";
import type { CommandDefinition, CommandContext, CommandResult } from "./types.js";

const buildAnsPrompt = (question: string): string => `
You are answering a side-thread question without interrupting the main conversation.

Rules:
- Answer only the user's question.
- Be concise and useful.
- Do not modify files or run commands.
- Use the existing conversation context if it helps.
- If the answer is uncertain, say what is known and what is missing.

Question:
${question}
`;

// Export the Command for skills system compatibility (type: prompt)
const ans: Command = {
  type: "prompt",
  name: "ans",
  description: "Ask a non-blocking side-thread question",
  progressMessage: "answering in a side thread",
  contentLength: 0,
  source: "builtin",
  context: "fork",
  immediate: true,
  allowedTools: [],
  async getPromptForCommand(args: string): Promise<ContentBlockParam[]> {
    return [{ type: "text", text: buildAnsPrompt(args.trim()) }];
  },
};

// Export CommandDefinition for builtinCommands execution
const ansCommandDefinition: CommandDefinition = {
  name: "ans",
  description: "Ask a non-blocking side-thread question without interrupting work",
  usage: "/ans <question>",
  category: "session",
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const question = args.join(" ").trim();
    if (!question) {
      return {
        success: false,
        message: "Usage: /ans <question>\n\nAsk a side-thread question without interrupting the main conversation.",
      };
    }

    const prompt = buildAnsPrompt(question);
    // Return the prompt content to be sent to the AI for the side-thread
    return {
      success: true,
      message: prompt,
      data: {
        type: "prompt",
        prompt: prompt,
        context: "fork",
      },
    };
  },
};

export default ans;
export { ansCommandDefinition };
