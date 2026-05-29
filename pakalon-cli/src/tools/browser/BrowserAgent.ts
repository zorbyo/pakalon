import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { z } from "zod";
import { type ModelMessage } from "ai";
import { DEFAULT_FREE_MODEL_ID } from "@/constants/models.js";
import { generateCompletion } from "@/ai/openrouter.js";
import { browserSnapshot } from "@/tools/web-browser-tool.js";
import { executeBatch, type BatchCommand, type BatchResult } from "@/tools/browser/batch.js";

export const browserAgentOptionsSchema = z.object({
  model: z.string().optional(),
  apiKey: z.string().optional(),
  useProxy: z.boolean().optional(),
  authToken: z.string().optional(),
  proxyBaseUrl: z.string().optional(),
  quickSummary: z.boolean().optional(),
});

export type BrowserAgentOptions = z.infer<typeof browserAgentOptionsSchema>;

export class BrowserAgent {
  private readonly options: BrowserAgentOptions;

  constructor(options: BrowserAgentOptions = {}) {
    this.options = browserAgentOptionsSchema.parse(options);
  }

  async batch(commands: BatchCommand[], options?: { bail?: boolean }): Promise<BatchResult[]> {
    return executeBatch(commands, options);
  }

  private async buildMessages(message: string): Promise<ModelMessage[]> {
    const snapshotResult = await browserSnapshot({});
    const snapshotText = snapshotResult.success ? JSON.stringify(snapshotResult.data ?? {}, null, 2) : snapshotResult.error ?? snapshotResult.message;

    const system = this.options.quickSummary
      ? "You are BrowserAgent. Provide concise browser summaries and practical next actions."
      : "You are BrowserAgent. Help with browser automation tasks, summarize page state, and suggest browser commands when useful.";

    const userPrompt = [
      `User request: ${message}`,
      "",
      "Current browser snapshot:",
      snapshotText || "(unavailable)",
      "",
      "Respond plainly and keep the answer directly useful.",
    ].join("\n");

    return [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ];
  }

  async chat(message: string): Promise<string> {
    const parsedMessage = z.string().trim().min(1).parse(message);
    const completion = await generateCompletion({
      model: this.options.model ?? DEFAULT_FREE_MODEL_ID,
      apiKey: this.options.apiKey,
      useProxy: this.options.useProxy,
      authToken: this.options.authToken,
      proxyBaseUrl: this.options.proxyBaseUrl,
      messages: await this.buildMessages(parsedMessage),
      maxTokens: this.options.quickSummary ? 512 : 1200,
      temperature: this.options.quickSummary ? 0.2 : 0.4,
    });

    return completion.text.trim();
  }

  async runRepl(): Promise<void> {
    const rl = readline.createInterface({ input, output });
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const line = await rl.question("browser> ");
        const trimmed = line.trim();
        if (!trimmed || trimmed === "/exit" || trimmed === "exit" || trimmed === "quit") {
          break;
        }
        try {
          const response = await this.chat(trimmed);
          output.write(`${response}\n`);
        } catch (error) {
          output.write(`${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    } finally {
      rl.close();
    }
  }
}

export async function createBrowserAgent(options?: BrowserAgentOptions): Promise<BrowserAgent> {
  return new BrowserAgent(options);
}
