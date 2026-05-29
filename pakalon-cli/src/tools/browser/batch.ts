import { z } from "zod";
import {
  browserClick,
  browserClose,
  browserFillForm,
  browserNavigate,
  browserScreenshot,
  browserSelectOption,
  browserSnapshot,
  browserWait,
} from "@/tools/web-browser-tool.js";

export interface BatchCommand {
  command: string;
  args?: string[];
}

export interface BatchResult {
  command: string;
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

export const batchCommandSchema = z.object({
  command: z.string().trim().min(1),
  args: z.array(z.string()).optional(),
});

export const batchResultSchema = z.object({
  command: z.string(),
  success: z.boolean(),
  output: z.string().optional(),
  error: z.string().optional(),
  duration: z.number().nonnegative(),
});

export const batchJsonSchema = z.array(z.array(z.string()).min(1));

export const batchOptionsSchema = z.object({
  bail: z.boolean().optional(),
});

export function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function parseBatchCommandsFromArgs(args: string[]): BatchCommand[] {
  return args
    .map((arg) => tokenizeCommand(arg))
    .filter((tokens) => tokens.length > 0)
    .map((tokens) => ({ command: tokens[0] ?? "", args: tokens.slice(1) }))
    .filter((entry) => entry.command.length > 0);
}

export function parseBatchCommandsFromJson(jsonText: string): BatchCommand[] {
  const parsedJson = JSON.parse(jsonText);
  const parsed = batchJsonSchema.parse(parsedJson);
  return parsed
    .map((entry) => ({ command: entry[0] ?? "", args: entry.slice(1) }))
    .filter((entry) => entry.command.length > 0);
}

function formatResultOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function runBrowserCommand(command: BatchCommand): Promise<{ success: boolean; output?: string; error?: string }> {
  const name = command.command.trim().toLowerCase();
  const args = command.args ?? [];

  try {
    switch (name) {
      case "open":
      case "navigate":
      case "go":
      case "visit": {
        const input = z.object({ url: z.string().min(1), waitUntil: z.enum(["domcontentloaded", "load", "networkidle"]).optional() }).parse({
          url: args[0] ?? "",
          waitUntil: args[1] as "domcontentloaded" | "load" | "networkidle" | undefined,
        });
        const result = await browserNavigate(input);
        return result.success
          ? { success: true, output: formatResultOutput({ message: result.message, url: result.url, title: result.title, snapshot: result.snapshot }) }
          : { success: false, error: result.error ?? result.message };
      }
      case "click": {
        const input = z.object({ ref: z.string().min(1), elementDescription: z.string().optional(), doubleClick: z.boolean().optional(), button: z.enum(["left", "right", "middle"]).optional() }).parse({
          ref: args[0] ?? "",
          elementDescription: args.slice(1).join(" ") || undefined,
          doubleClick: args.includes("--double") || args.includes("-d"),
          button: (args.includes("--right") ? "right" : args.includes("--middle") ? "middle" : undefined) as "left" | "right" | "middle" | undefined,
        });
        const result = await browserClick(input);
        return result.success
          ? { success: true, output: formatResultOutput({ message: result.message, elementRef: result.elementRef }) }
          : { success: false, error: result.error ?? result.message };
      }
      case "fill": {
        const fieldRef = args[0] ?? ""
        const value = args.slice(1).join(" ");
        const result = await browserFillForm({
          fields: [
            { ref: fieldRef, name: fieldRef, type: "textbox", value },
          ],
        });
        return result.success
          ? { success: true, output: formatResultOutput({ message: result.message, fields: result.fields }) }
          : { success: false, error: result.error ?? result.message };
      }
      case "snapshot": {
        const filename = args.find((arg) => !arg.startsWith("-"));
        const result = await browserSnapshot({ filename: filename && filename !== "-i" ? filename : undefined });
        return result.success
          ? { success: true, output: formatResultOutput({ message: result.message, data: result.data }) }
          : { success: false, error: result.error ?? result.message };
      }
      case "screenshot": {
        const filename = args.find((arg) => !arg.startsWith("-"));
        const result = await browserScreenshot({ filename, fullPage: args.includes("--full") || args.includes("-f") });
        return result.success
          ? { success: true, output: formatResultOutput({ message: result.message, filename: result.filename, path: result.path }) }
          : { success: false, error: result.error ?? result.message };
      }
      case "wait": {
        const seconds = Number(args[0] ?? 0);
        const result = await browserWait({ time: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined, text: args.includes("--text") ? args[args.indexOf("--text") + 1] : undefined, textGone: args.includes("--gone") ? args[args.indexOf("--gone") + 1] : undefined });
        return result.success
          ? { success: true, output: formatResultOutput({ message: result.message }) }
          : { success: false, error: result.error ?? result.message };
      }
      case "select": {
        const input = z.object({ ref: z.string().min(1), values: z.array(z.string()).min(1) }).parse({
          ref: args[0] ?? "",
          values: args.slice(1).filter((arg) => !arg.startsWith("-")),
        });
        const result = await browserSelectOption(input);
        return result.success
          ? { success: true, output: formatResultOutput({ message: result.message }) }
          : { success: false, error: result.error ?? result.message };
      }
      case "close": {
        const result = await browserClose();
        return result.success
          ? { success: true, output: formatResultOutput({ message: result.message }) }
          : { success: false, error: result.error ?? result.message };
      }
      default:
        return { success: false, error: `Unsupported browser command: ${command.command}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function executeBatch(commands: BatchCommand[], options?: { bail?: boolean }): Promise<BatchResult[]> {
  const parsedCommands = z.array(batchCommandSchema).parse(commands);
  const parsedOptions = batchOptionsSchema.parse(options ?? {});
  const results: BatchResult[] = [];

  for (const command of parsedCommands) {
    const started = Date.now();
    const outcome = await runBrowserCommand(command);
    const duration = Date.now() - started;

    const commandText = [command.command, ...(command.args ?? [])].join(" ").trim();
    const result: BatchResult = outcome.success
      ? { command: commandText, success: true, output: outcome.output, duration }
      : { command: commandText, success: false, error: outcome.error ?? "Command failed", duration };

    results.push(result);

    if (!outcome.success && parsedOptions.bail) {
      break;
    }
  }

  return results;
}

export async function executeBatchFromArgs(rawArgs: string[], options?: { bail?: boolean; json?: boolean; stdin?: string }): Promise<BatchResult[]> {
  const parsedOptions = batchOptionsSchema.parse({ bail: options?.bail });
  try {
    const commands = options?.json
      ? parseBatchCommandsFromJson(options.stdin ?? "[]")
      : parseBatchCommandsFromArgs(rawArgs);
    return executeBatch(commands, parsedOptions);
  } catch (error) {
    return [
      {
        command: options?.json ? "<stdin>" : rawArgs.join(" "),
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: 0,
      },
    ];
  }
}
