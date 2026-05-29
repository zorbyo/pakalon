import { describe, expect, it } from "vitest";
import {
  formatSlashCommandHelp,
  getSlashCommand,
  getSlashCommandSuggestions,
} from "../../commands/slash-registry.js";

describe("slash-registry alias canonicalization", () => {
  it("resolves underscore and camel-case aliases to canonical commands", () => {
    expect(getSlashCommand("/pr_comments")?.name).toBe("pr-comments");
    expect(getSlashCommand("/ctx_viz")?.name).toBe("ctx-viz");
    expect(getSlashCommand("/terminalSetup")?.name).toBe("terminal-setup");
    expect(getSlashCommand("/terminalsetup")?.name).toBe("terminal-setup");
  });

  it("formats help using canonical command metadata when alias is provided", () => {
    const help = formatSlashCommandHelp("/pr_comments");

    expect(help).toContain("/pr-comments");
    expect(help).toContain("Aliases: /pr_comments");
  });

  it("surfaces canonical command in suggestions when querying by alias", () => {
    const suggestions = getSlashCommandSuggestions("terminalsetup");

    expect(suggestions.some((entry) => entry.label === "/terminal-setup")).toBe(true);
  });

  it("resolves the multi-session typo alias to the canonical command", () => {
    expect(getSlashCommand("/mutli-session")?.name).toBe("multi-session");
    expect(getSlashCommand("/multisession")?.name).toBe("multi-session");
  });

  it("keeps feature-gap commands discoverable", () => {
    for (const name of ["update", "design-update", "ans", "phase-1", "phase-6", "install", "penpot"]) {
      expect(getSlashCommand(`/${name}`)?.name).toBe(name);
    }
  });

  it("keeps /model as an alias for /models", () => {
    expect(getSlashCommand("/model")?.name).toBe("models");
  });
});
