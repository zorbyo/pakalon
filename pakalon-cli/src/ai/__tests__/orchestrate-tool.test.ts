import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { orchestrateTool } from "../tools.js";
import { useStore } from "../../store/index.js";

function toolExecute<TInput extends Record<string, unknown>>(toolDef: unknown, input: TInput): Promise<any> {
  const execute = (toolDef as { execute?: (args: TInput) => Promise<unknown> }).execute;
  if (!execute) {
    throw new Error("Tool definition is missing execute()");
  }
  return execute(input);
}

describe("orchestrate tool (in-process)", () => {
  beforeEach(() => {
    useStore.getState().setPermissionMode("auto-accept");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useStore.getState().setPermissionMode("normal");
  });

  it("blocks orchestration mode (Q&A only)", async () => {
    useStore.getState().setPermissionMode("orchestration");

    const result = await toolExecute(orchestrateTool, {
      tools: [{ tool_name: "list_dir", params: { path: "." } }],
    });

    expect(result.blocked).toBe(true);
    expect(String(result.error)).toContain("Q&A only");
  });

  it("blocks allowMutation in plan mode", async () => {
    useStore.getState().setPermissionMode("plan");

    const result = await toolExecute(orchestrateTool, {
      tools: [{ tool_name: "run_command", params: { command: "echo hi" } }],
      allowMutation: true,
    });

    expect(result.blocked).toBe(true);
    expect(String(result.error)).toContain("allowMutation=true");
  });

  it("executes list_dir in-process", async () => {
    const result = await toolExecute(orchestrateTool, {
      tools: [{ tool_name: "list_dir", params: { path: "." } }],
    });

    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBe(1);
    expect(result.results[0].tool_name).toBe("list_dir");
    expect(result.results[0].result).toBeDefined();
    expect(result.results[0].result.entries).toBeDefined();
  });

  it("executes read_file in-process", async () => {
    const result = await toolExecute(orchestrateTool, {
      tools: [{ tool_name: "read_file", params: { path: "package.json", maxBytes: 100 } }],
    });

    expect(result.results).toBeDefined();
    expect(result.results.length).toBe(1);
    expect(result.results[0].tool_name).toBe("read_file");
    expect(result.results[0].result).toBeDefined();
    expect(result.results[0].result.content).toBeDefined();
  });

  it("returns count of operations", async () => {
    const result = await toolExecute(orchestrateTool, {
      tools: [
        { tool_name: "list_dir", params: { path: "." } },
        { tool_name: "list_dir", params: { path: "src" } },
      ],
    });

    expect(result.count).toBe(2);
  });
});
