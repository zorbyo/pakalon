import type { ExecutionResult } from "./executor.js";
import logger from "@/utils/logger.js";

export interface StreamOptions {
  timeout?: number;
}

export interface StreamingExecutor {
  createStream(command: string, args?: string[], options?: StreamOptions): Promise<AsyncGenerator<string>>;
  handleStream(
    stream: AsyncGenerator<string>,
    onToken: (token: string) => void
  ): Promise<void>;
}

export async function createCommandStream(
  command: string,
  args: string[] = [],
  options: StreamOptions = {}
): Promise<AsyncGenerator<string>> {
  const { spawn } = await import("child_process");

  const isWindows = process.platform === "win32";
  const shell = isWindows ? "cmd.exe" : "/bin/sh";
  const shellFlag = isWindows ? "/c" : "-c";

  const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command;

  const proc = spawn(shell, [shellFlag, fullCommand], {
    shell: true,
    env: process.env as Record<string, string>,
  });

  const chunks: string[] = [];

  proc.stdout?.on("data", (data) => {
    chunks.push(data.toString());
  });

  proc.stderr?.on("data", (data) => {
    chunks.push(`[stderr] ${data.toString()}`);
  });

  const timeout = options.timeout ?? 30000;
  
  const timeoutPromise = new Promise<number>((resolve) => {
    setTimeout(() => {
      proc.kill();
      resolve(124);
    }, timeout);
  });

  const exitPromise = new Promise<number>((resolve) => {
    proc.on("close", (code) => {
      resolve(code ?? 0);
    });
    proc.on("error", () => {
      resolve(1);
    });
  });

  const exitCode = await Promise.race([exitPromise, timeoutPromise]);

  async function* generator(): AsyncGenerator<string> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  return generator();
}

export async function handleStreamingTool(
  command: string,
  args: string[],
  onChunk: (chunk: string) => void,
  options: StreamOptions = {}
): Promise<ExecutionResult> {
  const startTime = Date.now();
  let output = "";
  let exitCode = 0;
  let error: string | undefined;

  try {
    const stream = await createCommandStream(command, args, options);
    for await (const chunk of stream) {
      output += chunk;
      onChunk(chunk);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    exitCode = 2;
  }

  return {
    output,
    error,
    exitCode,
    tool: command,
    duration: Date.now() - startTime,
  };
}

export function createStreamingExecutor() {
  return {
    async stream(command: string, args: string[] = [], opts?: StreamOptions) {
      return createCommandStream(command, args, opts);
    },

    async execute(
      command: string,
      args: string[],
      onChunk: (chunk: string) => void,
      opts?: StreamOptions
    ): Promise<ExecutionResult> {
      return handleStreamingTool(command, args, onChunk, opts);
    },
  };
}

export function parseSseStream(data: string): Array<{ event?: string; data: string }> {
  const lines = data.split("\n");
  const events: Array<{ event?: string; data: string }> = [];
  let currentEvent: { event?: string; data: string } = { data: "" };

  for (const line of lines) {
    if (line.startsWith("event:")) {
      currentEvent.event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      currentEvent.data = line.slice(5).trim();
    } else if (line === "") {
      if (currentEvent.data) {
        events.push(currentEvent);
        currentEvent = { data: "" };
      }
    }
  }

  if (currentEvent.data) {
    events.push(currentEvent);
  }

  return events;
}

export async function streamAsync<T>(
  generator: AsyncGenerator<T>,
  onData?: (data: T) => void
): Promise<T[]> {
  const results: T[] = [];
  for await (const item of generator) {
    onData?.(item);
    results.push(item);
  }
  return results;
}
