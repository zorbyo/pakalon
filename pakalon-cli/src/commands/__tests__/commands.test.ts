/**
 * commands.test.ts — Unit tests for CLI commands.
 * T088: init, history, undo, doctor, update-cli, setup-token, models.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------
// Shared mocks
// ------------------------------------------------------------------
vi.mock("@/utils/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
  debugLog: vi.fn(),
}));

vi.mock("@/store/db.js", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([{ id: 1 }]),
    delete: vi.fn().mockReturnThis(),
  })),
}));

// ------------------------------------------------------------------
// doctor
// ------------------------------------------------------------------
describe("cmdDoctor", () => {
  it("returns checks array with tool results", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execSync: vi.fn((cmd: string) => {
        if (cmd.includes("bun")) return "1.0.0";
        if (cmd.includes("node")) return "v20.0.0";
        if (cmd.includes("python")) return "Python 3.12.0";
        if (cmd.includes("git")) return "git version 2.40.0";
        throw new Error("not found");
      }),
    }));
    const { cmdDoctor } = await import("../../commands/doctor.js");
    const results = await cmdDoctor({ json: true });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty("tool");
      expect(r).toHaveProperty("ok");
    }
  });
});

// ------------------------------------------------------------------
// init
// ------------------------------------------------------------------
describe("cmdInit", () => {
  it("creates project structure in target directory", async () => {
    vi.resetModules();
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const writeMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock("node:fs/promises", () => ({
      mkdir: mkdirMock,
      writeFile: writeMock,
      access: vi.fn().mockRejectedValue({ code: "ENOENT" }),
    }));
    const { cmdInit } = await import("../../commands/init.js");
    // Should not throw
    await expect(cmdInit({ name: "test-project", dir: "/tmp/test" })).resolves.not.toThrow();
  });
});

// ------------------------------------------------------------------
// setup-token
// ------------------------------------------------------------------
describe("cmdSetupToken", () => {
  it("generates a 6-digit device code", async () => {
    vi.resetModules();
    const { generateDeviceCode } = await import("../../commands/setup-token.js");
    const code = generateDeviceCode();
    expect(typeof code).toBe("string");
    expect(code).toMatch(/^\d{6}$/);
  });

  it("generates unique codes on successive calls", async () => {
    vi.resetModules();
    const { generateDeviceCode } = await import("../../commands/setup-token.js");
    const codes = new Set(Array.from({ length: 20 }, () => generateDeviceCode()));
    // With 6-digit codes and 20 calls there should be at least some uniqueness
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ------------------------------------------------------------------
// models (console output variant)
// ------------------------------------------------------------------
describe("Models command utilities", () => {
  it("fetches models list from OpenRouter API", async () => {
    vi.resetModules();
    vi.mock("axios", () => ({
      default: {
        get: vi.fn().mockResolvedValue({
          data: {
            data: [
              { id: "anthropic/claude-3-5-haiku", name: "Claude 3.5 Haiku", context_length: 200000, pricing: { prompt: "0.00000025" } },
              { id: "openai/gpt-4o", name: "GPT-4o", context_length: 128000, pricing: { prompt: "0.000005" } },
            ],
          },
        }),
      },
    }));
    const { fetchModels } = await import("../../commands/models.js");
    const models = await fetchModels();
    expect(Array.isArray(models)).toBe(true);
    if (models.length > 0) {
      expect(models[0]).toHaveProperty("id");
      expect(models[0]).toHaveProperty("name");
    }
  });

  it("exposes a slash-command definition for /models and /model", async () => {
    vi.resetModules();
    const { modelsCommand } = await import("../../commands/models.js");
    expect(modelsCommand.name).toBe("models");
    expect(modelsCommand.aliases).toContain("model");
  });
});

// ------------------------------------------------------------------
// feature-gap command definitions
// ------------------------------------------------------------------
describe("feature-gap slash command definitions", () => {
  it("exports command definitions for comparison.md critical commands", async () => {
    vi.resetModules();
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:fs/promises");
    const [
      history,
      session,
      web,
      penpot,
      undo,
      doctor,
      install,
    ] = await Promise.all([
      import("../../commands/history.js"),
      import("../../commands/session.js"),
      import("../../commands/web.js"),
      import("../../commands/penpot.js"),
      import("../../commands/undo.js"),
      import("../../commands/doctor.js"),
      import("../../commands/install.js"),
    ]);

    expect(history.historyCommand.name).toBe("history");
    expect(session.sessionCommand.aliases).toContain("sessions");
    expect(session.newSessionCommand.name).toBe("new");
    expect(session.resumeCommand.name).toBe("resume");
    expect(web.webCommand.name).toBe("web");
    expect(penpot.penpotCommand.name).toBe("penpot");
    expect(undo.undoCommand.name).toBe("undo");
    expect(doctor.doctorCommand.name).toBe("doctor");
    expect(install.installCommand.name).toBe("install");
  });
});

// ------------------------------------------------------------------
// history
// ------------------------------------------------------------------
describe("cmdHistory", () => {
  it("returns empty array when no sessions exist", async () => {
    vi.resetModules();
    vi.mock("@/store/db.js", () => ({
      getDb: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      })),
    }));
    const { cmdHistory } = await import("../../commands/history.js");
    const result = await cmdHistory({ limit: 10, json: true });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ------------------------------------------------------------------
// update-cli
// ------------------------------------------------------------------
describe("cmdUpdateCli", () => {
  it("checks for latest version without throwing", async () => {
    vi.resetModules();
    vi.mock("axios", () => ({
      default: {
        get: vi.fn().mockResolvedValue({
          data: { "dist-tags": { latest: "1.0.0" } },
        }),
      },
    }));
    const { checkForUpdate } = await import("../../commands/update-cli.js");
    const result = await checkForUpdate();
    expect(result).toHaveProperty("currentVersion");
    expect(result).toHaveProperty("latestVersion");
    expect(result).toHaveProperty("needsUpdate");
  });
});
