import { describe, expect, it } from "vitest";
import { validateSafeCommand } from "../execution-enhancements.js";

describe("validateSafeCommand", () => {
  it("allows simple allowlisted commands", () => {
    expect(validateSafeCommand("git status --short")).toEqual({ valid: true });
    expect(validateSafeCommand("node --version")).toEqual({ valid: true });
  });

  it("rejects shell composition after an allowed first token", () => {
    expect(validateSafeCommand("echo ok; rm -rf .").valid).toBe(false);
    expect(validateSafeCommand("git status && npm publish").valid).toBe(false);
    expect(validateSafeCommand("cat package.json | powershell -Command whoami").valid).toBe(false);
    expect(validateSafeCommand("echo $(whoami)").valid).toBe(false);
  });

  it("rejects commands outside the sandbox allowlist", () => {
    const result = validateSafeCommand("docker run --privileged alpine");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("docker");
  });
});
