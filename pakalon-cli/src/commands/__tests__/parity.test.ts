import { describe, expect, it } from "vitest";

import {
  executeParityCommand,
  findParityCommand,
  parityCommands,
} from "../parity.js";

describe("parity slash commands", () => {
  it("registers the report command gaps in the runtime-safe parity registry", () => {
    const names = new Set(parityCommands.map((command) => command.name));

    for (const name of [
      "add-dir",
      "advisor",
      "branch",
      "copy",
      "effort",
      "fast",
      "plugin",
      "stats",
      "usage",
      "voice",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("resolves aliases through the parity registry", () => {
    expect(findParityCommand("plugins")?.name).toBe("plugin");
    expect(findParityCommand("fork")?.name).toBe("branch");
    expect(findParityCommand("tokens")?.name).toBe("usage");
  });

  it("executes safe read-only fallback commands", async () => {
    const result = await executeParityCommand("/usage", {
      messages: [{ role: "user", content: "hello" }],
      cwd: process.cwd(),
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Estimated session tokens");
  });
});
