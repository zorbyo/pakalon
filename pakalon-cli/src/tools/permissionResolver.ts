/**
 * Multi-Level Permission Resolution Engine
 *
 * Resolves tool permissions across multiple levels and sources.
 * Permission precedence (highest to lowest):
 *
 *   1. alwaysDenyRules        — tools blacklisted by any source
 *   2. alwaysAllowRules       — tools whitelisted by any source
 *   3. alwaysAskRules         — tools that always require user confirmation
 *   4. skill allowed-tools    — skill-level tool restrictions
 *   5. Tool overrides         — user-configured tool defaults
 *   6. Category defaults      — file/shell/mcp/python defaults
 *
 * Within each rule type, source precedence is:
 *   cliArg > session > frontmatter > plugin
 *
 * This integrates with the existing PermissionManager from permissions.ts
 * and provides a higher-level resolution that understands permission contexts
 * (ToolPermissionContext from tool-types.ts).
 */

import type {
  ToolPermissionContext,
  ToolPermissionRulesBySource,
  PermissionResult,
  PermissionMode,
} from "./tool-types.js";
import { getPermissionManager, isSafeYoloTool } from "./permissions.js";
import type { ToolDefinition } from "./executor.js";
import { logForDebugging } from "@/utils/debug.js";
import { getEmptyToolPermissionContext, resolvePermission as resolveRulesPermission } from "./permissions.js";
import { matchRules } from "./permissions/shellRuleMatching.js";
import { classifyToolUse } from "./permissions/yoloClassifier.js";

// ============================================================================
// Types
// ============================================================================

export type PermissionDecision =
  | { action: "allow"; reason: string }
  | { action: "deny"; reason: string }
  | { action: "ask"; reason: string };

// ============================================================================
// Source Precedence
// ============================================================================

const SOURCE_ORDER = ["cliArg", "session", "frontmatter", "plugin"] as const;

/**
 * Check if a tool name matches a rule pattern.
 * Supports exact match and wildcard (*) prefix matching.
 */
function toolMatchesRule(toolName: string, rule: string): boolean {
  const trimmed = rule.trim();
  if (!trimmed) return false;

  if (trimmed === "*") return true;
  if (trimmed.endsWith("*")) {
    return toolName.startsWith(trimmed.slice(0, -1));
  }
  return toolName === trimmed;
}

/**
 * Check if a tool name matches any rule in a given source bucket.
 */
function matchesAnyRule(
  toolName: string,
  source: ToolPermissionRulesBySource[string],
): boolean {
  if (!source || !Array.isArray(source)) return false;
  return source.some((rule) => toolMatchesRule(toolName, rule));
}

/**
 * Find the highest-precedence source that has a matching rule for a tool.
 * Returns the source name and whether a match was found.
 */
function findMatchingSource(
  toolName: string,
  rulesBySource: ToolPermissionRulesBySource | undefined,
): { matched: boolean; source?: string } {
  if (!rulesBySource) return { matched: false };

  for (const source of SOURCE_ORDER) {
    const rules = rulesBySource[source];
    if (rules && Array.isArray(rules) && matchesAnyRule(toolName, rules)) {
      return { matched: true, source };
    }
  }

  return { matched: false };
}

// ============================================================================
// Permission Resolution
// ============================================================================

/**
 * Resolve permission for a tool call given the full permission context.
 *
 * Resolution order:
 * 1. Check alwaysDenyRules — if matched, deny immediately
 * 2. Check alwaysAllowRules — if matched, allow immediately
 * 3. Check alwaysAskRules — if matched, prompt user
 * 4. Check PermissionManager for session/override/default state
 * 5. Apply YOLO mode rules
 *
 * @param toolName The name of the tool being called
 * @param permissionContext The current permission context
 * @returns A PermissionDecision with action and reason
 */
export function resolvePermission(
  toolName: string,
  permissionContext: ToolPermissionContext,
): PermissionDecision {
  const { alwaysDenyRules, alwaysAllowRules, alwaysAskRules, mode } =
    permissionContext;

  // 1. Check alwaysDenyRules (highest precedence)
  if (alwaysDenyRules) {
    const denyMatch = findMatchingSource(toolName, alwaysDenyRules);
    if (denyMatch.matched) {
      return {
        action: "deny",
        reason: `Tool '${toolName}' is denied by ${denyMatch.source} rule`,
      };
    }
  }

  // 2. Check alwaysAllowRules
  if (alwaysAllowRules) {
    const allowMatch = findMatchingSource(toolName, alwaysAllowRules);
    if (allowMatch.matched) {
      return {
        action: "allow",
        reason: `Tool '${toolName}' is allowed by ${allowMatch.source} rule`,
      };
    }
  }

  // 3. Check alwaysAskRules
  if (alwaysAskRules) {
    const askMatch = findMatchingSource(toolName, alwaysAskRules);
    if (askMatch.matched) {
      return {
        action: "ask",
        reason: `Tool '${toolName}' requires confirmation (${askMatch.source} rule)`,
      };
    }
  }

  // 4. Delegate to PermissionManager for session/override/default state
  const pm = getPermissionManager();
  const effectiveState = pm.getEffectiveState(toolName);

  // Apply YOLO rules
  if (mode === "auto" || mode === "bypassPermissions") {
    // In fully autonomous modes, still block critical commands
    if (effectiveState === "deny") {
      return { action: "deny", reason: `Tool '${toolName}' is denied by user settings` };
    }
    // Safe read-only tools are automatically allowed
    if (isSafeYoloTool(toolName)) {
      return { action: "allow", reason: "Safe tool auto-allowed in autonomous mode" };
    }
    // For other tools in auto mode, check risk before allowing
    if (mode === "bypassPermissions") {
      return { action: "allow", reason: "Bypass permissions mode" };
    }
    // Auto mode still checks permission manager
    if (effectiveState === "allow") {
      return { action: "allow", reason: "Tool is in allowed state" };
    }
    // Default to allow in auto mode (user opted in)
    return { action: "allow", reason: "Auto mode default allow" };
  }

  // Default mode — check PermissionManager state
  switch (effectiveState) {
    case "allow":
      return { action: "allow", reason: "Tool is in allowed state" };
    case "deny":
      return { action: "deny", reason: "Tool is denied by default" };
    case "ask":
    default:
      return { action: "ask", reason: "Tool requires user confirmation" };
  }
}

/**
 * Check if a tool is allowed by the skill's allowed-tools list.
 * A skill with no allowed-tools list is unrestricted.
 * A skill with an empty allowed-tools list is fully restricted.
 *
 * @param toolName The tool to check
 * @param skillAllowedTools The skill's allowed-tools list
 * @returns True if the tool is allowed by the skill
 */
export function isToolAllowedBySkill(
  toolName: string,
  skillAllowedTools?: string[],
): boolean {
  if (!skillAllowedTools || skillAllowedTools.length === 0) {
    // No restrictions — tool is allowed
    return true;
  }

  return skillAllowedTools.some((allowed) =>
    toolMatchesRule(toolName, allowed),
  );
}

/**
 * Filter tools by skill restrictions. Returns only tools that the skill
 * is allowed to use.
 *
 * @param toolNames Array of tool names to filter
 * @param skillAllowedTools The skill's allowed-tools list
 * @returns Filtered array of allowed tool names
 */
export function filterToolsBySkillRestrictions(
  toolNames: string[],
  skillAllowedTools?: string[],
): string[] {
  if (!skillAllowedTools || skillAllowedTools.length === 0) {
    return [...toolNames];
  }

  return toolNames.filter((name) =>
    isToolAllowedBySkill(name, skillAllowedTools),
  );
}

/**
 * Resolve a permission context update to know whether to show
 * a permission prompt to the user.
 *
 * @param toolName Tool being used
 * @param context The tool permission context
 * @returns Whether a permission prompt should be shown
 */
export function shouldShowPermissionPrompt(
  toolName: string,
  context: ToolPermissionContext,
): boolean {
  const decision = resolvePermission(toolName, context);

  if (decision.action === "allow") return false;
  if (decision.action === "deny") return false; // Just block silently
  if (decision.action === "ask") return true;

  return true;
}

/**
 * Resolve the effective permission mode for a tool call.
 * Handles permission mode transitions (e.g., plan → default).
 *
 * @param context The tool permission context
 * @returns The effective permission mode
 */
export function getEffectivePermissionMode(
  context: ToolPermissionContext,
): PermissionMode {
  // If in plan mode, use the pre-plan mode for tool execution
  if (context.mode === "plan" && context.prePlanMode) {
    return context.prePlanMode;
  }
  return context.mode;
}

/**
 * Merge multiple ToolPermissionRulesBySource objects, with later sources
 * taking precedence for the same rule+source combination.
 *
 * @param sources Array of rules by source, ordered by precedence (last wins)
 * @returns Merged rules
 */
export function mergePermissionRules(
  ...sources: (ToolPermissionRulesBySource | undefined)[]
): ToolPermissionRulesBySource {
  const merged: ToolPermissionRulesBySource = {};

  for (const source of sources) {
    if (!source) continue;
    for (const key of SOURCE_ORDER) {
      const rules = source[key];
      if (rules && Array.isArray(rules) && rules.length > 0) {
        merged[key] = [...new Set([...(merged[key] ?? []), ...rules])];
      }
    }
  }

  return merged;
}

/**
 * Check if a permission context indicates the user has granted blanket
 * approval for the session (e.g., "always allow" on the first prompt).
 *
 * @param context The tool permission context
 * @returns True if session-wide approval is active
 */
export function isSessionAutoApproved(context: ToolPermissionContext): boolean {
  return (
    context.mode === "bypassPermissions" ||
    context.mode === "auto" ||
    context.mode === "acceptEdits"
  );
}

/**
 * Normalize permission mode string to PermissionMode type.
 *
 * @param mode Raw mode string
 * @returns Valid PermissionMode
 */
export function normalizePermissionMode(mode: string): PermissionMode {
  const validModes: PermissionMode[] = [
    "default",
    "acceptEdits",
    "bypassPermissions",
    "plan",
    "auto",
    "bubble",
  ];
  const normalized = mode?.toLowerCase().trim() as PermissionMode;
  if (validModes.includes(normalized)) return normalized;
  return "default";
}

export class PermissionResolver {
  private context: ToolPermissionContext;

  constructor(initial?: Partial<ToolPermissionContext>) {
    this.context = { ...getEmptyToolPermissionContext(), ...initial };
  }

  getPermissionContext(): ToolPermissionContext {
    return this.context;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.context = { ...this.context, mode };
  }

  setRules(
    allow: ToolPermissionRulesBySource,
    deny: ToolPermissionRulesBySource,
    ask: ToolPermissionRulesBySource,
  ): void {
    this.context = {
      ...this.context,
      alwaysAllowRules: allow,
      alwaysDenyRules: deny,
      alwaysAskRules: ask,
    };
  }

  resolve(toolName: string, args: Record<string, unknown>, mode?: PermissionMode): PermissionResult {
    const effectiveContext = { ...this.context, mode: mode ?? this.context.mode };
    const decision = resolveRulesPermission(toolName, effectiveContext.alwaysDenyRules);
    if (decision.action === "deny") {
      return { behavior: "deny", message: decision.reason, decisionReason: { type: "rule", rule: { source: "cliArg", ruleBehavior: "deny", ruleValue: { toolName } } as any } };
    }

    if ((effectiveContext.mode === "auto" || effectiveContext.mode === "bypassPermissions") && isSafeYoloTool(toolName)) {
      return { behavior: "allow", updatedInput: args };
    }

    const pm = getPermissionManager(effectiveContext.mode === "bypassPermissions");
    const state = pm.getEffectiveState(toolName);
    if (effectiveContext.mode === "auto" && state === "allow") return { behavior: "allow", updatedInput: args };
    if (state === "allow") return { behavior: "allow", updatedInput: args };
    if (state === "deny") {
      return { behavior: "deny", message: `Tool '${toolName}' is denied`, decisionReason: { type: "rule", rule: { source: "cliArg", ruleBehavior: "deny", ruleValue: { toolName } } as any } };
    }

    const shellCommand = String(args.command ?? args.cmd ?? args.script ?? "");
    if (toolName.toLowerCase().includes("bash") && shellCommand && matchRules(shellCommand, effectiveContext.alwaysDenyRules.session ?? [])) {
      return { behavior: "deny", message: `Shell command denied by rule` };
    }

    const classifier = classifyToolUse(toolName, args, [] , effectiveContext);
    if (classifier.shouldBlock) return { behavior: "deny", message: classifier.reason };

    return { behavior: "ask", message: `Tool '${toolName}' requires confirmation` };
  }
}

export function getDenyRuleForAgent(agentId: string, rulesBySource: ToolPermissionRulesBySource): string[] {
  return [
    ...(rulesBySource.session ?? []),
    ...(rulesBySource.cliArg ?? []),
    ...(rulesBySource.command ?? []),
  ].filter((rule) => rule.includes(agentId));
}

export function shouldAvoidPermissionPrompts(ctx: ToolPermissionContext): boolean {
  return ctx.shouldAvoidPermissionPrompts ?? !!ctx.agentId;
}

export function awaitAutomatedChecksBeforeDialog(ctx: ToolPermissionContext): boolean {
  return ctx.awaitAutomatedChecksBeforeDialog ?? false;
}
