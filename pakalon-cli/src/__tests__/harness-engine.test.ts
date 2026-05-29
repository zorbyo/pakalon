/**
 * Harness Engine Tests
 *
 * Tests for the agentic harness master entry point and all its subsystems:
 *   - HarnessEngine wiring and singleton factory
 *   - SpeculationEngine pre-computation
 *   - ToolDefinition → Tool wrapping
 *   - Skill integration
 *   - Permission resolution
 *   - Content budget management
 *   - Confirmation management
 *   - Skill-aware routing
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  HarnessEngine,
  SpeculationEngine,
  wrapToolDefinition,
  getGlobalEngine,
  resetGlobalEngine,
} from "../engine/index.js";
import type { ToolPermissionContext, PermissionMode } from "../tools/tool-types.js";
import type { ToolDefinition } from "../tools/executor.js";
import { z } from "zod";
import { Tool } from "../tools/tool.js";

// ============================================================================
// Mock Tool Definition Factory
// ============================================================================

function createMockToolDef(name: string, opts?: {
  requiresPermission?: boolean;
  description?: string;
}): ToolDefinition {
  return {
    name,
    description: opts?.description ?? `Mock tool ${name}`,
    parameters: z.object({
      input: z.string().optional(),
    }),
    requiresPermission: opts?.requiresPermission ?? false,
    execute: vi.fn(async (args: { input?: string }) => {
      return `executed ${name}${args.input ? `: ${args.input}` : ""}`;
    }),
  };
}

// ============================================================================
// HarnessEngine Tests
// ============================================================================

describe("HarnessEngine", () => {
  let engine: HarnessEngine;

  beforeEach(async () => {
    resetGlobalEngine();
    engine = await HarnessEngine.create({
      rootDir: process.cwd(),
      permissionMode: "default",
      enableSkillRouting: true,
      enableSpeculation: false,
    });
  });

  afterEach(() => {
    resetGlobalEngine();
  });

  describe("Construction & Singleton", () => {
    it("should create an engine instance", () => {
      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(HarnessEngine);
    });

    it("should have initialized subsystems", () => {
      const state = engine.getState();
      expect(state.skillsInitialized).toBe(true);
      expect(state.toolsInitialized).toBe(true);
    });

    it("should provide a global singleton via getGlobalEngine", async () => {
      resetGlobalEngine();
      const global1 = await getGlobalEngine({ rootDir: process.cwd() });
      const global2 = await getGlobalEngine();
      expect(global1).toBe(global2);
    });

    it("should reset global engine on resetGlobalEngine", async () => {
      const global1 = await getGlobalEngine({ rootDir: process.cwd() });
      resetGlobalEngine();
      const global2 = await getGlobalEngine({ rootDir: process.cwd() });
      expect(global1).not.toBe(global2);
    });

    it("should have config values available", () => {
      const config = engine.getConfig();
      expect(config.rootDir).toBe(process.cwd());
      expect(config.permissionMode).toBe("default");
      expect(config.enableSkillRouting).toBe(true);
      expect(config.maxToolResultChars).toBe(100_000);
    });
  });

  describe("Tool System Integration", () => {
    it("should initialize tools from registry", () => {
      const state = engine.getState();
      expect(state.toolsInitialized).toBe(true);
    });

    it("should build tool pool without permission context", () => {
      const pool = engine.buildToolPool();
      expect(pool).toHaveProperty("primary");
      expect(pool).toHaveProperty("restricted");
      expect(pool).toHaveProperty("blocked");
      expect(Array.isArray(pool.primary)).toBe(true);
    });

    it("should build tool pool with permission context", () => {
      const ctx: ToolPermissionContext = {
        mode: "default",
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: true,
      };
      const pool = engine.buildToolPool(ctx);
      expect(Array.isArray(pool.primary)).toBe(true);
    });

    it("should register and track custom tools", () => {
      const customTool = createMockToolDef("custom_tool_v1");
      engine.registerTools([customTool]);

      const pool = engine.buildToolPool();
      const allNames = pool.primary.map((t) => t.name);
      expect(allNames).toContain("custom_tool_v1");
    });

    it("should produce enhanced Tool instances", () => {
      const tools = engine.getEnhancedTools();
      expect(Array.isArray(tools)).toBe(true);
      if (tools.length > 0) {
        expect(tools[0]).toBeInstanceOf(Tool);
        expect(typeof tools[0].name).toBe("string");
        expect(typeof tools[0].isReadOnly).toBe("function");
        expect(typeof tools[0].interruptBehavior).toBe("function");
        expect(typeof tools[0].isSearchOrReadCommand).toBe("function");
        expect(typeof tools[0].renderToolUseMessage).toBe("function");
        expect(typeof tools[0].renderToolResultMessage).toBe("function");
        expect(typeof tools[0].getActivityDescription).toBe("function");
        expect(typeof tools[0].extractSearchText).toBe("function");
        expect(typeof tools[0].toAutoClassifierInput).toBe("function");
      }
    });
  });

  describe("Permission System", () => {
    it("should provide permission context", () => {
      const ctx = engine.getPermissionContext();
      expect(ctx).toHaveProperty("mode", "default");
      expect(ctx).toHaveProperty("alwaysAllowRules");
      expect(ctx).toHaveProperty("alwaysDenyRules");
      expect(ctx).toHaveProperty("alwaysAskRules");
      expect(ctx.isBypassPermissionsModeAvailable).toBe(true);
    });

    it("should set permission mode", () => {
      engine.setPermissionMode("auto");
      const ctx = engine.getPermissionContext();
      expect(ctx.mode).toBe("auto");
    });

    it("should create simplified permission context", () => {
      const ctx = engine.createPermissionContext("plan");
      expect(ctx.mode).toBe("plan");
      expect(ctx.additionalWorkingDirectories).toBeInstanceOf(Map);
    });

    it("should check permissions for tools", () => {
      // Default mode should allow by default
      const result = engine.checkPermission("read_file", {});
      // Result should have either allow/deny/ask
      expect(["allow", "deny", "ask"]).toContain(result.behavior);
    });

    it("should set permission rules and enforce deny", () => {
      engine.setPermissionRules({
        alwaysDeny: ["bash"],
      });

      // Check resolution
      const ctx = engine.getPermissionContext();
      expect(ctx.alwaysDenyRules.cliArg).toContain("bash");
    });
  });

  describe("Content Budget", () => {
    it("should manage tool result budget", () => {
      const entry = engine.recordToolResult("tool_1", "read_file", "file content here");
      const state = engine.getBudgetState();
      expect(state.usedTools).toBeGreaterThanOrEqual(1);
    });

    it("should check budget capacity", () => {
      const canAdd = engine.canAddToolResult("read_file", "short content", 1);
      expect(canAdd).toBe(true);
    });

    it("should compact budget", () => {
      engine.recordToolResult("tool_1", "read_file", "a".repeat(1000));
      engine.recordToolResult("tool_2", "grep", "b".repeat(500));
      engine.compactContent(0.5);
      const state = engine.getBudgetState();
      expect(state).toHaveProperty("config");
    });

    it("should reset budget", () => {
      engine.recordToolResult("tool_1", "bash", "some output");
      engine.reset();
      const state = engine.getBudgetState();
      expect(state.usedTools).toBe(0);
    });
  });

  describe("Confirmation Management", () => {
    it("should resolve confirmation level", () => {
      const level = engine.resolveConfirmation("read_file", {});
      expect(["blocked", "allowed", "confirm"]).toContain(level);
    });

    it("should create and resolve pending confirmations", () => {
      engine.setPermissionMode("default");
      const id = engine.requestConfirmation("bash", { command: "rm -rf /" });
      // May be null if directly allowed/blocked
      if (id !== null) {
        engine.handleConfirmationResponse(id, true);
        const pending = engine.getPendingConfirmations();
        expect(pending).not.toContainEqual(expect.objectContaining({ id }));
      }
    });
  });

  describe("Skill System Integration", () => {
    it("should have skills initialized", () => {
      const state = engine.getState();
      expect(state.skillsInitialized).toBe(true);
    });

    it("should provide skill commands", () => {
      const commands = engine.getSkillCommands();
      expect(Array.isArray(commands)).toBe(true);
    });

    it("should track conditional skill count", () => {
      const count = engine.getConditionalSkillCount();
      expect(typeof count).toBe("number");
    });

    it("should activate skills for paths", () => {
      const activated = engine.activateSkillsForPaths(["/project/src/foo.ts"]);
      expect(Array.isArray(activated)).toBe(true);
    });
  });

  describe("Skill-Aware Routing", () => {
    it("should register skill profiles", () => {
      engine.registerSkillProfile({
        skillName: "test-skill",
        allowedTools: ["read", "grep"],
        restrictedTools: ["bash", "write"],
        denyUnlistedTools: false,
        priority: 10,
      });

      const rules = engine.getActiveSkillRules();
      expect(rules).toHaveProperty("allowedTools");
      expect(rules).toHaveProperty("restrictedTools");
    });

    it("should build tool pool with skill routing", () => {
      engine.registerSkillProfile({
        skillName: "qa-skill",
        allowedTools: ["read_file", "grep", "glob"],
        restrictedTools: ["bash", "write_file"],
        denyUnlistedTools: false,
        priority: 20,
      });

      // Activate the skill
      engine.activateSkillsForPaths(["/project/test/foo.test.ts"]);

      const pool = engine.buildToolPool();
      expect(pool).toHaveProperty("primary");
      expect(pool).toHaveProperty("restricted");
      expect(pool).toHaveProperty("blocked");
    });
  });

  describe("Speculation Engine", () => {
    it("should create speculation engine on demand", () => {
      const spec = engine.getSpeculationEngine();
      expect(spec).toBeDefined();
      expect(spec).toBeInstanceOf(SpeculationEngine);
    });

    it("should return cached speculation engine", () => {
      const spec1 = engine.getSpeculationEngine();
      const spec2 = engine.getSpeculationEngine();
      expect(spec1).toBe(spec2);
    });

    it("should start and complete speculation", () => {
      const spec = engine.getSpeculationEngine();
      const id = spec.startSpeculation({
        recentMessages: [
          { role: "user", content: "Hello" } as any,
          { role: "assistant", content: "Hi there!" } as any,
          { role: "user", content: "Can you help?" } as any,
        ],
        userInput: "What is ",
      });

      if (id !== null) {
        const state = spec.getState();
        expect(state.status).toBe("active");
      }
    });

    it("should abort speculation on user input", () => {
      const spec = engine.getSpeculationEngine();
      spec.startSpeculation({
        recentMessages: [
          { role: "user", content: "Hello" } as any,
          { role: "assistant", content: "Hi" } as any,
          { role: "user", content: "How do I..." } as any,
        ],
        userInput: "",
      });
      spec.onUserInput("What is the weather?");
      const state = spec.getState();
      expect(state.status).toBe("idle");
    });

    it("should reset on engine reset", () => {
      const spec = engine.getSpeculationEngine();
      expect(spec.getState().status).toBe("idle");
      engine.reset();
      const state = spec.getState();
      expect(state.status).toBe("idle");
    });
  });
});

// ============================================================================
// wrapToolDefinition Tests
// ============================================================================

describe("wrapToolDefinition", () => {
  it("should wrap a ToolDefinition into a Tool instance", () => {
    const def = createMockToolDef("test_tool");
    const tool = wrapToolDefinition(def);

    expect(tool).toBeInstanceOf(Tool);
    expect(tool.name).toBe("test_tool");
  });

  it("should preserve tool name and description", () => {
    const def = createMockToolDef("my_tool", { description: "Does something useful" });
    const tool = wrapToolDefinition(def);

    expect(tool.name).toBe("my_tool");
    expect(tool.description).toBe("Does something useful");
  });

  it("should provide lifecycle methods on wrapped tool", () => {
    const def = createMockToolDef("lifecycle_tool");
    const tool = wrapToolDefinition(def);

    expect(typeof tool.isReadOnly).toBe("function");
    expect(typeof tool.isDestructive).toBe("function");
    expect(typeof tool.isConcurrencySafe).toBe("function");
    expect(typeof tool.interruptBehavior).toBe("function");
    expect(typeof tool.isSearchOrReadCommand).toBe("function");
    expect(typeof tool.renderToolUseMessage).toBe("function");
    expect(typeof tool.renderToolResultMessage).toBe("function");
    expect(typeof tool.getActivityDescription).toBe("function");
    expect(typeof tool.extractSearchText).toBe("function");
    expect(typeof tool.toAutoClassifierInput).toBe("function");
  });

  it("should execute the underlying tool when called", async () => {
    const executeFn = vi.fn(async () => "result data");
    const def: ToolDefinition = {
      name: "exec_tool",
      description: "Executable tool",
      parameters: z.object({ arg: z.string() }),
      execute: executeFn,
    };

    const tool = wrapToolDefinition(def);
    const result = await tool.call({ arg: "test" }, {} as any);

    expect(executeFn).toHaveBeenCalledWith({ arg: "test" });
    expect(result.data).toBe("result data");
  });

  it("should classify search/read commands", () => {
    const readTool = wrapToolDefinition(
      createMockToolDef("read_file", { description: "Read files" }),
    );
    const searchTool = wrapToolDefinition(
      createMockToolDef("grep", { description: "Search content" }),
    );
    const writeTool = wrapToolDefinition(
      createMockToolDef("write_file", { description: "Write files" }),
    );

    const readClass = readTool.isSearchOrReadCommand();
    const searchClass = searchTool.isSearchOrReadCommand();
    const writeClass = writeTool.isSearchOrReadCommand();

    expect(readClass.isRead).toBe(true);
    expect(searchClass.isSearch).toBe(true);
    expect(writeClass.isRead).toBe(false);
    expect(writeClass.isSearch).toBe(false);
  });
});

// ============================================================================
// SpeculationEngine Unit Tests
// ============================================================================

describe("SpeculationEngine (standalone)", () => {
  let spec: SpeculationEngine;

  beforeEach(() => {
    spec = new SpeculationEngine();
  });

  it("should start idle", () => {
    expect(spec.getState().status).toBe("idle");
  });

  it("should not speculate with insufficient context", () => {
    const can = spec.canSpeculate(1);
    expect(can).toBe(false);
  });

  it("should speculate with sufficient context", () => {
    const can = spec.canSpeculate(10);
    expect(can).toBe(true);
  });

  it("should not speculate if already active", () => {
    spec.startSpeculation({
      recentMessages: [
        { role: "user", content: "a" } as any,
        { role: "assistant", content: "b" } as any,
        { role: "user", content: "c" } as any,
      ],
      userInput: "",
    });
    const second = spec.startSpeculation({
      recentMessages: [],
      userInput: "",
    });
    expect(second).toBeNull();
  });

  it("should register completion boundaries", () => {
    spec.startSpeculation({
      recentMessages: [
        { role: "user", content: "a" } as any,
        { role: "assistant", content: "b" } as any,
        { role: "user", content: "c" } as any,
      ],
      userInput: "test",
    });
    spec.registerBoundary({
      type: "complete",
      completedAt: Date.now(),
      outputTokens: 100,
    });
    expect(spec.getState().toolUseCount).toBe(1);
  });

  it("should set pipelined suggestions", () => {
    spec.startSpeculation({
      recentMessages: [
        { role: "user", content: "a" } as any,
        { role: "assistant", content: "b" } as any,
        { role: "user", content: "c" } as any,
      ],
      userInput: "test",
    });
    spec.setPipelinedSuggestion({
      text: "I'll look into that",
      promptId: "user_intent",
      generationRequestId: null,
    });
    expect(spec.getState().isPipelined).toBe(true);
  });

  it("should try to match speculation on completion", () => {
    spec.startSpeculation({
      recentMessages: [
        { role: "user", content: "a" } as any,
        { role: "assistant", content: "b" } as any,
        { role: "user", content: "c" } as any,
      ],
      userInput: "",
    });
    spec.registerBoundary({
      type: "complete",
      completedAt: Date.now(),
      outputTokens: 50,
    });
    spec.finishSpeculation();

    const result = spec.tryMatchSpeculation("actual input");
    expect(result).not.toBeNull();
    expect(result!.wasUsed).toBe(true);
    expect(typeof result!.timeSavedMs).toBe("number");
  });

  it("should manage pending messages", () => {
    spec.onUserInput("Hello");
    spec.onUserInput("World");
    expect(spec.getPendingMessages()).toHaveLength(2);
    spec.clearPendingMessages();
    expect(spec.getPendingMessages()).toHaveLength(0);
  });

  it("should reset completely", () => {
    spec.onUserInput("Test");
    spec.startSpeculation({
      recentMessages: [
        { role: "user", content: "a" } as any,
        { role: "assistant", content: "b" } as any,
        { role: "user", content: "c" } as any,
      ],
      userInput: "q",
    });
    spec.reset();
    expect(spec.getState().status).toBe("idle");
    expect(spec.getPendingMessages()).toHaveLength(0);
  });

  it("should update config", () => {
    const initialConfig = spec.getConfig();
    expect(initialConfig.maxSpeculationDuration).toBe(10_000);

    spec.updateConfig({ maxSpeculationDuration: 30_000 });
    const updatedConfig = spec.getConfig();
    expect(updatedConfig.maxSpeculationDuration).toBe(30_000);
  });
});
