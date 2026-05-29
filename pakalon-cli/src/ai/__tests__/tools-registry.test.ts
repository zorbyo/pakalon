import { describe, expect, it } from "vitest";

import { allTools } from "../tools.js";

describe("allTools registry", () => {
  it("exposes browser automation tools to the runtime tool surface", () => {
    expect(allTools).toHaveProperty("browserNavigate");
    expect(allTools).toHaveProperty("browserClick");
    expect(allTools).toHaveProperty("browserFillForm");
    expect(allTools).toHaveProperty("browserSnapshot");
    expect(allTools).toHaveProperty("browserScreenshot");
    expect(allTools).toHaveProperty("browserWait");
    expect(allTools).toHaveProperty("browserSelectOption");
    expect(allTools).toHaveProperty("browserClose");
  });

  it("exposes report parity tools to the runtime tool surface", () => {
    expect(allTools).toHaveProperty("agent");
    expect(allTools).toHaveProperty("taskList");
    expect(allTools).toHaveProperty("taskOutput");
    expect(allTools).toHaveProperty("taskStop");
    expect(allTools).toHaveProperty("swarm");
    expect(allTools).toHaveProperty("toolSearch");
    expect(allTools).toHaveProperty("customToolRegistry");
    expect(allTools).toHaveProperty("mcpResources");
    expect(allTools).toHaveProperty("brief");
    expect(allTools).toHaveProperty("sleep");
    expect(allTools).toHaveProperty("scheduleCron");
    expect(allTools).toHaveProperty("cronCreate");
    expect(allTools).toHaveProperty("cronList");
    expect(allTools).toHaveProperty("cronDelete");
    expect(allTools).toHaveProperty("lspCodeActions");
    expect(allTools).toHaveProperty("lspSemanticTokens");
  });
});
