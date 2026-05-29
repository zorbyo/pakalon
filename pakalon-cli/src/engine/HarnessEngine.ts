/**
 * HarnessEngine — Master Entry Point for the Agentic Harness
 *
 * Initializes, wires together, and exposes all components of the agentic harness:
 *   - Skills system (loaders, dynamic discovery, conditional activation)
 *   - Tool system (enhanced Tool instances, pool assembly, deny filtering)
 *   - Permission system (multi-level resolution, confirmation management)
 *   - Context compression (compaction bridge, content budget)
 *   - State management (AppStore integration)
 *   - Tool rendering and interrupt handling
 *   - Skill-aware routing
 *   - Speculation engine
 *
 * Usage:
 *   const engine = await HarnessEngine.create(rootDir);
 *   const tools = engine.buildToolPool();
 *   const permitted = engine.filterTools(tools, ctx);
 *   engine.activateSkillsForPaths(["/project/src/foo.ts"]);
 */

import path from "node:path";
import fs from "node:fs";

import type { ToolPermissionContext, PermissionMode } from "../tools/tool-types.js";
import { Tool, toolsToRecord } from "../tools/tool.js";
import type { PermissionResult } from "../tools/tool-types.js";
import type { ToolDefinition } from "../tools/executor.js";
import { z } from "zod";

import {
  assembleToolPool,
  filterToolsByDenyRules,
  resolveToolDenyRules,
} from "../tools/toolPool.js";
import type { ToolPoolOptions } from "../tools/toolPool.js";
import { PermissionResolver } from "../tools/permissionResolver.js";
import { ContentBudgetManager } from "../tools/contentBudget.js";
import { ConfirmationManager } from "../tools/toolConfirmation.js";
import { SkillAwareRouter } from "../tools/skillAwareRouter.js";
import type { SkillToolRules, SkillToolProfile } from "../tools/skillAwareRouter.js";
import {
  getSkillDirCommands,
  getDynamicSkills,
  discoverSkillDirsForPaths,
  activateConditionalSkillsForPaths,
  getConditionalSkillCount,
  clearSkillCaches,
} from "../skills/loadSkillsDir.js";
import { getBundledSkills } from "../skills/bundledSkills.js";
import { getPluginSkills } from "../skills/pluginSkills.js";
import { getAllTools } from "../tools/registry.js";
import { SpeculationEngine } from "./SpeculationEngine.js";

import type { Command } from "../types-imported/command.js";

// ============================================================================
// Types
// ============================================================================

export interface HarnessConfig {
  /** Project root directory. */
  rootDir: string;

  /** Additional skill directories (from --add-dir flags). */
  additionalSkillDirs?: string[];

  /** Default permission mode. */
  permissionMode?: PermissionMode;

  /** Enable skill-aware tool routing. */
  enableSkillRouting?: boolean;

  /** Maximum tool result characters. */
  maxToolResultChars?: number;

  /** Auto-compact threshold (fraction of budget). */
  autoCompactThreshold?: number;

  /** Whether to enable speculation. */
  enableSpeculation?: boolean;
}

export interface HarnessState {
  /** Currently active skill names. */
  activeSkillNames: Set<string>;

  /** Tools currently loaded in the pool. */
  toolCount: number;

  /** Whether skills have been initialized. */
  skillsInitialized: boolean;

  /** Whether tools have been initialized. */
  toolsInitialized: boolean;
}

export interface ToolPoolResult {
  /** Primary tools available to the agent. */
  primary: ToolDefinition[];

  /** Restricted tools (demoted by skill routing). */
  restricted: ToolDefinition[];

  /** Blocked tools (hidden by skill routing). */
  blocked: ToolDefinition[];
}

// ============================================================================
// ToolDefinition → Tool Adapter
// ============================================================================

/**
 * Wraps a ToolDefinition (from executor.ts / registry) into a Tool instance
 * (from tool.ts) so it gains the full lifecycle methods:
 *   interruptBehavior, isSearchOrReadCommand, render methods, etc.
 */
export function wrapToolDefinition(toolDef: ToolDefinition): Tool {
  const schema = toolDef.parameters instanceof z.ZodType
    ? toolDef.parameters
    : z.object({}).passthrough();

  return new Tool({
    name: toolDef.name,
    description: toolDef.description,
    inputSchema: schema,
    isReadOnly: !toolDef.requiresPermission,
    call: async (args) => {
      const result = await toolDef.execute(args);
      return { data: result };
    },
  });
}

// ============================================================================
// HarnessEngine
// ============================================================================

export class HarnessEngine {
  /** Configuration. */
  readonly config: Required<HarnessConfig>;

  /** Permission resolver. */
  readonly permissionResolver: PermissionResolver;

  /** Content budget manager. */
  readonly contentBudget: ContentBudgetManager;

  /** Confirmation manager. */
  readonly confirmationManager: ConfirmationManager;

  /** Skill-aware router. */
  readonly skillRouter: SkillAwareRouter;

  /** Built-in tool definitions (loaded from registry). */
  private builtinTools: ToolDefinition[] = [];

  /** Custom tool definitions (registered programmatically). */
  private customTools: ToolDefinition[] = [];

  /** MCP tool definitions (from connected servers). */
  private mcpTools: ToolDefinition[] = [];

  /** Cached enhanced Tool instances (wrapped from definitions). */
  private enhancedTools: Tool[] = [];

  /** Cached skill commands. */
  private skillCommands: Command[] = [];

  /** Internal state. */
  private state: HarnessState = {
    activeSkillNames: new Set(),
    toolCount: 0,
    skillsInitialized: false,
    toolsInitialized: false,
  };

  /** Working directory for skill discovery. */
  private cwd: string;

  // ====================================================================
  // Construction
  // ====================================================================

  private constructor(config: Required<HarnessConfig>, cwd: string) {
    this.config = config;
    this.cwd = cwd;
    this.permissionResolver = new PermissionResolver();
    this.contentBudget = new ContentBudgetManager({
      maxToolResultChars: config.maxToolResultChars,
    });
    this.confirmationManager = new ConfirmationManager();
    this.skillRouter = new SkillAwareRouter({
      enabled: config.enableSkillRouting,
    });
  }

  /** Create and initialize a new HarnessEngine instance. */
  static async create(config: HarnessConfig): Promise<HarnessEngine> {
    const defaults: Required<HarnessConfig> = {
      rootDir: config.rootDir,
      additionalSkillDirs: config.additionalSkillDirs ?? [],
      permissionMode: config.permissionMode ?? "default",
      enableSkillRouting: config.enableSkillRouting ?? true,
      maxToolResultChars: config.maxToolResultChars ?? 100_000,
      autoCompactThreshold: config.autoCompactThreshold ?? 0.75,
      enableSpeculation: config.enableSpeculation ?? false,
    };

    const engine = new HarnessEngine(defaults, config.rootDir);

    // Auto-initialize
    await engine.initializeSkills();
    engine.initializeTools();

    return engine;
  }

  // ====================================================================
  // Skills System
  // ====================================================================

  /** Load and initialize all skills from configured directories. */
  async initializeSkills(): Promise<void> {
    const { rootDir, additionalSkillDirs } = this.config;

    // Load skills from all standard sources using the loader from loadSkillsDir.ts
    const dirSkills = getSkillDirCommands(rootDir);
    const bundled = getBundledSkills();
    const plugin = getPluginSkills();
    const dynamic = getDynamicSkills();

    // Merge all skill sources (dir > dynamic > plugin > bundled priority)
    const skillMap = new Map<string, Command>();
    for (const cmd of bundled) skillMap.set(cmd.name, cmd);
    for (const cmd of plugin) skillMap.set(cmd.name, cmd);
    for (const cmd of dynamic) skillMap.set(cmd.name, cmd);
    for (const cmd of dirSkills) skillMap.set(cmd.name, cmd);

    this.skillCommands = Array.from(skillMap.values());
    this.state.skillsInitialized = true;

    // Register skill tool profiles with the skill router
    for (const cmd of this.skillCommands) {
      if (cmd.type !== "prompt") continue;
      this.skillRouter.registerSkillProfile({
        skillName: cmd.name,
        rules: {
          allowedTools: (cmd as any).allowedTools ?? [],
          restrictedTools: (cmd as any).restrictedTools ?? [],
          denyUnlistedTools: (cmd as any).denyUnlistedTools ?? false,
        },
        priority: 10,
      });
    }
  }

  /** Activate skills dynamically based on touched file paths. */
  activateSkillsForPaths(filePaths: string[]): string[] {
    const activated = activateConditionalSkillsForPaths(filePaths, this.cwd);
    for (const name of activated) {
      this.state.activeSkillNames.add(name);
    }
    return activated;
  }

  /** Discover skill directories for given paths (dynamic discovery). */
  async discoverSkillsForPaths(filePaths: string[]): Promise<void> {
    const dirs = await discoverSkillDirsForPaths(filePaths, this.cwd);
    if (dirs.length > 0) {
      // Clear cache so subsequent getSkillDirCommands call re-loads
      clearSkillCaches();
      await this.initializeSkills();
    }
  }

  /** Get all loaded skill commands. */
  getSkillCommands(): Command[] {
    return [...this.skillCommands];
  }

  /** Get pending conditional skill count. */
  getConditionalSkillCount(): number {
    return getConditionalSkillCount();
  }

  // ====================================================================
  // Tool System
  // ====================================================================

  /** Initialize tools from registry. */
  initializeTools(): void {
    // Load tools from the registry Map<string, ToolDefinition>
    const registryTools = getAllTools();
    this.builtinTools = Array.from(registryTools.values());
    this.state.toolsInitialized = true;
  }

  /** Register custom tool definitions. */
  registerTools(tools: ToolDefinition[]): void {
    this.customTools.push(...tools);
  }

  /** Register MCP tools. */
  registerMCPTools(tools: ToolDefinition[]): void {
    this.mcpTools.push(...tools);
  }

  /**
   * Build the tool pool with filtering.
   *
   * Returns primary, restricted, and blocked tools based on active skills.
   */
  buildToolPool(ctx?: ToolPermissionContext): ToolPoolResult {
    // Deny rules as string array (flattened from permission context)
    const denyRules = ctx ? resolveToolDenyRules(ctx.alwaysDenyRules) : undefined;

    // Assemble all tools into a Vercel AI SDK ToolSet
    const allTools = assembleToolPool({
      includeRegistry: true,
      includeBuiltin: false,
      includeMcp: false,
      includeSkillTool: true,
      denyRules,
    });

    // Extract ToolDefinition[] from the ToolSet for the skill router
    const registryMap = getAllTools();
    const allToolDefs = Array.from(registryMap.values());

    // Also include custom and MCP tools
    const fullToolDefs = [...allToolDefs, ...this.customTools, ...this.mcpTools];

    // Filter by deny rules (string-level) if the context is provided
    const filteredDefs = ctx
      ? fullToolDefs.filter((td) => {
          const toolDenyRules = resolveToolDenyRules(ctx.alwaysDenyRules);
          if (toolDenyRules.length === 0) return true;
          return !toolDenyRules.some((rule) => {
            if (rule.endsWith("*")) return td.name.startsWith(rule.slice(0, -1));
            return td.name === rule;
          });
        })
      : fullToolDefs;

    // Apply skill-aware routing
    if (this.config.enableSkillRouting && this.state.activeSkillNames.size > 0) {
      const result = this.skillRouter.routeTools(
        filteredDefs,
        Array.from(this.state.activeSkillNames),
        ctx ?? this.permissionResolver.getPermissionContext(),
      );
      this.state.toolCount = result.primaryTools.length + result.restrictedTools.length;
      return result;
    }

    this.state.toolCount = filteredDefs.length;
    return {
      primary: filteredDefs,
      restricted: [],
      blocked: [],
    };
  }

  /** Get all enhanced Tool instances (wrapped for full lifecycle). */
  getEnhancedTools(): Tool[] {
    if (this.enhancedTools.length === 0) {
      const allDefs = Array.from(getAllTools().values());
      this.enhancedTools = allDefs
        .filter((t) => t.name)
        .map((t) => wrapToolDefinition(t));
    }
    return [...this.enhancedTools];
  }

  // ====================================================================
  // Permission System
  // ====================================================================

  /** Check if a tool call is permitted. */
  checkPermission(
    toolName: string,
    args: Record<string, unknown>,
    mode?: PermissionMode,
  ): PermissionResult {
    const permissionMode = mode ?? this.config.permissionMode;
    return this.permissionResolver.resolve(toolName, args, permissionMode);
  }

  /** Get the current permission context. */
  getPermissionContext(): ToolPermissionContext {
    return this.permissionResolver.getPermissionContext();
  }

  /** Update permission rules. */
  setPermissionRules(rules: {
    alwaysAllow?: string[];
    alwaysDeny?: string[];
    alwaysAsk?: string[];
  }): void {
    this.permissionResolver.setRules(
      { cliArg: rules.alwaysAllow ?? [] },
      { cliArg: rules.alwaysDeny ?? [] },
      { cliArg: rules.alwaysAsk ?? [] },
    );
  }

  /** Set permission mode. */
  setPermissionMode(mode: PermissionMode): void {
    this.config.permissionMode = mode;
    this.permissionResolver.setPermissionMode(mode);
  }

  // ====================================================================
  // Content Budget / Compaction
  // ====================================================================

  /** Record a tool result in the content budget. */
  recordToolResult(toolUseId: string, toolName: string, result: unknown): void {
    this.contentBudget.addToolResult(toolUseId, toolName, result);
  }

  /** Check if a tool result can be added without exceeding budget. */
  canAddToolResult(toolName: string, result: unknown, currentStepCount: number): boolean {
    return this.contentBudget.canAddToolResult(toolName, result, currentStepCount);
  }

  /** Compact the content budget, returning replacements. */
  compactContent(targetFraction?: number): void {
    this.contentBudget.compact(targetFraction);
  }

  /** Get current budget state. */
  getBudgetState() {
    return this.contentBudget.getState();
  }

  // ====================================================================
  // Confirmation Management
  // ====================================================================

  /** Resolve confirmation level for a tool call. */
  resolveConfirmation(toolName: string, args: Record<string, unknown>): "blocked" | "allowed" | "confirm" {
    return this.confirmationManager.resolveConfirmationLevel(
      toolName,
      args,
      this.config.permissionMode,
    );
  }

  /** Create a pending confirmation. */
  requestConfirmation(toolName: string, args: Record<string, unknown>): string | null {
    const entry = this.confirmationManager.createPendingConfirmation(
      toolName,
      args,
      this.config.permissionMode,
    );
    return entry?.id ?? null;
  }

  /** Resolve a pending confirmation. */
  handleConfirmationResponse(id: string, allowed: boolean): void {
    this.confirmationManager.resolveConfirmation(id, allowed);
  }

  /** Get pending confirmations. */
  getPendingConfirmations() {
    return this.confirmationManager.pendingConfirmations;
  }

  // ====================================================================
  // Skill-Aware Routing
  // ====================================================================

  /** Register a skill tool profile. */
  registerSkillProfile(profile: {
    skillName: string;
    allowedTools: string[];
    restrictedTools: string[];
    denyUnlistedTools: boolean;
    priority: number;
  }): void {
    this.skillRouter.registerSkillProfile(profile);
  }

  /** Get merged tool rules for active skills. */
  getActiveSkillRules() {
    return this.skillRouter.getMergedRules(Array.from(this.state.activeSkillNames));
  }

  // ====================================================================
  // Speculation Engine
  // ====================================================================

  private _speculationEngine: SpeculationEngine | null = null;

  /** Get or create the speculation engine. */
  getSpeculationEngine(): SpeculationEngine {
    if (!this._speculationEngine) {
      this._speculationEngine = new SpeculationEngine({
        enablePipelinedSuggestions: this.config.enableSpeculation,
      });
    }
    return this._speculationEngine;
  }

  // ====================================================================
  // Utility
  // ====================================================================

  /** Get current engine state. */
  getState(): HarnessState {
    return { ...this.state, toolCount: this.state.toolCount };
  }

  /** Get the config. */
  getConfig(): Required<HarnessConfig> {
    return { ...this.config };
  }

  /** Reset the engine. */
  reset(): void {
    this.enhancedTools = [];
    this.state = {
      activeSkillNames: new Set(),
      toolCount: 0,
      skillsInitialized: false,
      toolsInitialized: false,
    };
    this.confirmationManager.clearSessionDecisions();
    this.contentBudget.reset();
    this._speculationEngine?.reset();
  }

  /** Create a simplified permission context for a given mode. */
  createPermissionContext(mode: PermissionMode): ToolPermissionContext {
    return {
      mode,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: true,
    };
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let _globalEngine: HarnessEngine | null = null;

/**
 * Get or create the global HarnessEngine instance.
 * Uses process.cwd() as the root directory.
 */
export async function getGlobalEngine(config?: Partial<HarnessConfig>): Promise<HarnessEngine> {
  if (!_globalEngine) {
    _globalEngine = await HarnessEngine.create({
      rootDir: config?.rootDir ?? process.cwd(),
      ...config,
    });
  }
  return _globalEngine;
}

/** Reset the global engine instance (for testing). */
export function resetGlobalEngine(): void {
  _globalEngine = null;
}
