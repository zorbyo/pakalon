import { describe, expect, it } from "vitest";
import { installMcpServer } from "../manager.js";

describe("MCP manager security", () => {
  it("rejects invalid raw npm package names before install", async () => {
    const result = await installMcpServer("bad-package;whoami", "global", { force: true });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid MCP npm package name");
  });
});
