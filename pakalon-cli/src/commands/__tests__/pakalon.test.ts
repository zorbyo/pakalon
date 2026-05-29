/**
 * pakalon.test.ts — Unit tests for /pakalon agentic command.
 * Updated for native TypeScript pipeline (no Python bridge).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------
vi.mock("@/utils/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
  debugLog: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------
describe("getPakalonOpeningMessage", () => {
  it("includes the user prompt in the message", async () => {
    const { getPakalonOpeningMessage } = await import("../../commands/pakalon.js");
    const msg = getPakalonOpeningMessage("Build a SaaS product", "hil");
    expect(msg).toContain("Build a SaaS product");
  });

  it("includes mode in the message", async () => {
    const { getPakalonOpeningMessage } = await import("../../commands/pakalon.js");
    const msg = getPakalonOpeningMessage("anything", "yolo");
    expect(msg).toContain("YOLO");
  });

  it("mentions Phase 1", async () => {
    const { getPakalonOpeningMessage } = await import("../../commands/pakalon.js");
    const msg = getPakalonOpeningMessage("build X", "hil");
    expect(msg).toContain("Phase 1");
  });
});

describe("cmdPakalon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pipeline configuration without bridge", async () => {
    const { cmdPakalon } = await import("../../commands/pakalon.js");
    const result = await cmdPakalon({ prompt: "Build a todo app", mode: "yolo", dir: "/tmp" });
    expect(result.projectDir).toBe("/tmp");
    expect(result.bridgeMode.userPrompt).toBe("Build a todo app");
    expect(result.bridgeMode.isYolo).toBe(true);
  });

  it("uses yolo mode when specified", async () => {
    const { cmdPakalon } = await import("../../commands/pakalon.js");
    const result = await cmdPakalon({ prompt: "test", mode: "yolo" });
    expect(result.bridgeMode.isYolo).toBe(true);
  });

  it("uses hil mode by default", async () => {
    const { cmdPakalon } = await import("../../commands/pakalon.js");
    const result = await cmdPakalon({ prompt: "test" });
    expect(result.bridgeMode.isYolo).toBe(false);
  });

  it("uses process.cwd() as default dir", async () => {
    const { cmdPakalon } = await import("../../commands/pakalon.js");
    const result = await cmdPakalon({ prompt: "test" });
    expect(result.projectDir).toBe(process.cwd());
  });

  it("does not include bridgePort in result", async () => {
    const { cmdPakalon } = await import("../../commands/pakalon.js");
    const result = await cmdPakalon({ prompt: "test" });
    expect(result).not.toHaveProperty("bridgePort");
  });
});
