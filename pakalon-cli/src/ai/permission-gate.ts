/**
 * Permission Gate — HIL (Human-in-the-Loop) permission system.
 *
 * When the AI agent wants to perform a destructive action (write, delete, bash),
 * it calls `requestPermission()` which:
 *   1. Emits a structured `PermissionRequest` with what/why/risk/affected fields
 *   2. Awaits a user decision from the TUI dialog
 *   3. Returns `PermissionDecision` — approved | denied | approvedForSession
 *
 * Approval modes:
 *   - "once"       → allow this single request only
 *   - "session"    → auto-allow all future requests for the same tool in this session
 *   - "deny"       → block this request (agent receives false)
 *
 * The TUI listens for `permission_request` events via `permissionGate.onRequest()` and
 * calls `permissionGate.resolve()` with one of those modes.
 */

import fs from "fs";
import path from "path";
import logger from "@/utils/logger.js";
import { approveForSession, approvePermanently } from "@/security/permission-cache.js";
import { PermissionRulesEngine } from "@/ai/permission-rules.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Risk level for a permission request. */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Structured permission request payload. */
export interface PermissionRequest {
  id: string;
  /** Tool name: "bash", "writeFile", "deleteFile", etc. */
  tool: string;
  /** Human-readable description of the ACTION being requested. */
  what: string;
  /** Why the AI needs to do this (from tool context). */
  why: string;
  /** Risk level for the action. */
  risk: RiskLevel;
  /** Files that will be created/modified/deleted. */
  affectedFiles: string[];
  /** Raw tool params for advanced display. */
  params: Record<string, unknown>;
  /** Optional agent ID that triggered the request. */
  agentId?: string;
}

/** Decision returned from a resolved permission request. */
export type PermissionDecisionMode = "once" | "session" | "always" | "deny";

export interface PermissionDecision {
  allowed: boolean;
  mode: PermissionDecisionMode;
}

type PermissionListener = (request: PermissionRequest) => void;
type PermissionChangeListener = () => void;

interface PersistedPermissionRule {
  tool: string;
  pattern?: string;
  action: "allow" | "deny" | "ask";
  description?: string;
  scope?: "user" | "project";
  createdAt?: string;
}

interface PersistedPermissionSettings {
  permissionRules?: PersistedPermissionRule[];
  defaultPermissionAction?: "allow" | "deny" | "ask";
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Risk inference helpers
// ---------------------------------------------------------------------------

function _inferRisk(tool: string, params: Record<string, unknown>): RiskLevel {
  if (tool === "deleteFile") return "critical";
  if (tool === "bash") {
    const cmd = String(params.command ?? params.cmd ?? "");
    if (/rm -rf|sudo|chmod 777|dd if=|mkfs/.test(cmd)) return "critical";
    if (/rm |curl .* \| bash|wget .* \| sh/.test(cmd)) return "high";
    return "medium";
  }
  if (tool === "readFile") {
    // Check if reading a sensitive file
    if (params.sensitive === true) return "high";
    const p = String(params.path ?? params.filePath ?? "");
    const basename = p.split(/[/\\]/).pop() ?? "";
    if (/^\.env(\..*)?$/i.test(basename)) return "high";
  }
  if (tool === "writeFile" || tool === "editFile" || tool === "patchFile") {
    const p = String(params.path ?? params.filePath ?? "");
    if (/\.(env|pem|key|crt|pfx|p12)$/.test(p)) return "high";
    return "low";
  }
  return "low";
}

function _inferAffectedFiles(tool: string, params: Record<string, unknown>): string[] {
  const candidates = [params.path, params.filePath, params.file, params.target];
  const files = candidates
    .filter(Boolean)
    .map((f) => String(f));
  if (files.length) return files;
  // For bash, we can't know, but we indicate the command as relevant
  if (tool === "bash") {
    return [`[bash] ${String(params.command ?? params.cmd ?? "").slice(0, 80)}`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Project-local persistence helpers
// ---------------------------------------------------------------------------

function normalizeToolName(tool: string): string {
  return tool.trim().toLowerCase();
}

function getProjectSettingsPath(projectDir: string, local: boolean): string {
  return path.join(projectDir, ".pakalon", local ? "settings.local.json" : "settings.json");
}

function readSettings(filePath: string): PersistedPermissionSettings {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as PersistedPermissionSettings;
  } catch (err) {
    logger.warn("[permission-gate] Failed to read permission settings", { filePath, error: String(err) });
    return {};
  }
}

function loadProjectPermissionSettings(projectDir: string): {
  rules: PersistedPermissionRule[];
  defaultAction?: "allow" | "deny" | "ask";
} {
  const shared = readSettings(getProjectSettingsPath(projectDir, false));
  const local = readSettings(getProjectSettingsPath(projectDir, true));
  return {
    rules: [...(local.permissionRules ?? []), ...(shared.permissionRules ?? [])].filter(
      (rule) => rule && typeof rule.tool === "string",
    ),
    defaultAction: local.defaultPermissionAction ?? shared.defaultPermissionAction,
  };
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(escaped, "i");
}

function parsePersistedTool(ruleTool: string): { tool: string; pattern?: string } {
  const match = ruleTool.match(/^([^(]+)(?:\((.+)\))?$/);
  if (!match) return { tool: ruleTool.trim() };
  return {
    tool: match[1]?.trim() ?? ruleTool.trim(),
    pattern: match[2]?.trim(),
  };
}

function permissionInputText(params: Record<string, unknown>): string {
  const command = params.command ?? params.cmd;
  if (typeof command === "string" && command.trim()) return command;

  const executable = params.executable;
  const args = params.args;
  if (typeof executable === "string") {
    return `${executable} ${Array.isArray(args) ? args.join(" ") : ""}`.trim();
  }

  const filePath = params.filePath ?? params.path ?? params.dirPath ?? params.file ?? params.target;
  if (typeof filePath === "string" && filePath.trim()) return filePath;

  return JSON.stringify(params);
}

function matchPersistedRule(
  rule: PersistedPermissionRule,
  tool: string,
  params: Record<string, unknown>,
): boolean {
  const parsed = parsePersistedTool(rule.tool);
  const ruleTool = normalizeToolName(parsed.tool);
  if (ruleTool !== "*" && ruleTool !== normalizeToolName(tool)) return false;

  const pattern = rule.pattern ?? parsed.pattern;
  if (!pattern) return true;

  try {
    return globToRegex(pattern).test(permissionInputText(params));
  } catch {
    return permissionInputText(params).toLowerCase().includes(pattern.toLowerCase());
  }
}

function checkProjectPermissionRule(
  projectDir: string,
  tool: string,
  params: Record<string, unknown>,
): "allow" | "deny" | "ask" | "default" {
  const settings = loadProjectPermissionSettings(projectDir);
  for (const rule of settings.rules) {
    if (!matchPersistedRule(rule, tool, params)) continue;
    return rule.action;
  }
  return settings.defaultAction ?? "default";
}

function saveProjectAllowRule(projectDir: string, tool: string, params: Record<string, unknown>): void {
  const settingsPath = getProjectSettingsPath(projectDir, true);
  const settings = readSettings(settingsPath);
  const rules = settings.permissionRules ?? [];
  const normalized = normalizeToolName(tool);
  const pattern = permissionInputText(params).slice(0, 500);
  const exists = rules.some((rule) => {
    const parsed = parsePersistedTool(rule.tool);
    const existingPattern = rule.pattern ?? parsed.pattern ?? "";
    return normalizeToolName(parsed.tool) === normalized && existingPattern === pattern && rule.action === "allow";
  });

  if (!exists) {
    rules.push({
      tool,
      pattern,
      action: "allow",
      scope: "project",
      description: "Saved from Allow always in Pakalon CLI.",
      createdAt: new Date().toISOString(),
    });
  }

  settings.permissionRules = rules;
  if (!settings.defaultPermissionAction) {
    settings.defaultPermissionAction = "ask";
  }

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Singleton gate
// ---------------------------------------------------------------------------

class PermissionGate {
  private pending: Map<string, { request: PermissionRequest; resolve: (d: PermissionDecision) => void }> = new Map();
  private listeners: Set<PermissionListener> = new Set();
  private changeListeners: Set<PermissionChangeListener> = new Set();
  private projectDir: string = process.cwd();

  /** Programmatic permission rules engine (CLI flags, plugins, frontmatter). */
  private rulesEngine?: PermissionRulesEngine;

  /** Per-agent tool allowlists. If an agent has a policy, only listed tools are auto-allowed. */
  private agentToolPolicies: Map<string, string[]> = new Map();

  /**
   * Per-session auto-approvals: { tool → true }.
   * Set when user chooses "approve for session".
   */
  private sessionApprovals: Map<string, boolean> = new Map();

  setProjectDir(projectDir: string): void {
    this.projectDir = path.resolve(projectDir);
  }

  /**
   * Attach a PermissionRulesEngine for programmatic rule evaluation.
   * Rules are checked before the user-facing permission dialog.
   */
  setRulesEngine(engine: PermissionRulesEngine): void {
    this.rulesEngine = engine;
  }

  /**
   * Get the attached rules engine (or create a default one).
   */
  getRulesEngine(): PermissionRulesEngine {
    if (!this.rulesEngine) {
      this.rulesEngine = new PermissionRulesEngine("ask");
    }
    return this.rulesEngine;
  }

  // ── Core request/resolve API ─────────────────────────────────────

  /**
   * Request permission for a destructive action.
   * Blocks until the user accepts or declines via the TUI.
   *
   * @param what  Human-readable description of the action
   * @param why   Reason the AI is requesting this
   * @param tool  Tool identifier
   * @param params Raw tool parameters for display
   * @param agentId Optional agent ID for per-agent policy enforcement
   * @returns `true` if the user accepted, `false` if declined.
   */
  async requestPermission(
    tool: string,
    what: string,
    params: Record<string, unknown>,
    agentId?: string,
    why: string = "",
  ): Promise<boolean> {
    // Per-agent allowlist check: auto-deny if tool not in agent policy
    if (agentId && this.agentToolPolicies.has(agentId)) {
      const allowed = this.agentToolPolicies.get(agentId)!;
      if (!allowed.includes(tool)) return false;
    }

    // Session-level auto-approval
    if (this.sessionApprovals.get(tool)) return true;

    // PermissionRulesEngine check (CLI flags, plugins, frontmatter rules)
    if (this.rulesEngine) {
      const ruleResult = this.rulesEngine.evaluate(tool, params);
      if (ruleResult.decision === "allow") {
        logger.debug("[permission-gate] Allowed by rules engine", { tool, ruleId: ruleResult.matchedRule?.id });
        return true;
      }
      if (ruleResult.decision === "deny") {
        this.rulesEngine.logDenial(tool, `Denied by rule: ${ruleResult.matchedRule?.reason ?? "No reason"}`, params);
        logger.info("[permission-gate] Denied by rules engine", { tool, ruleId: ruleResult.matchedRule?.id });
        return false; // Denied — no user prompt
      }
      // "ask" falls through to project rules / user prompt
    }

    const projectDecision = checkProjectPermissionRule(this.projectDir, tool, params);
    if (projectDecision === "allow") return true;
    if (projectDecision === "deny") return false;

    const id = crypto.randomUUID();
    const risk = _inferRisk(tool, params);
    const affectedFiles = _inferAffectedFiles(tool, params);

    const request: PermissionRequest = {
      id,
      tool,
      what,
      why,
      risk,
      affectedFiles,
      params,
      agentId,
    };

    return new Promise<boolean>((resolve) => {
      this.pending.set(id, {
        request,
        resolve: (decision) => {
          if (decision.mode === "session" && decision.allowed) {
            this.sessionApprovals.set(tool, true);
            approveForSession(tool, permissionInputText(params));
          }
          if (decision.mode === "always" && decision.allowed) {
            this.sessionApprovals.set(tool, true);
            approveForSession(tool, permissionInputText(params));
            try {
              saveProjectAllowRule(this.projectDir, tool, params);
              approvePermanently(tool, this.projectDir, permissionInputText(params));
            } catch (err) {
              logger.warn("[permission-gate] Failed to persist allow-always rule", {
                projectDir: this.projectDir,
                tool,
                error: String(err),
              });
            }
          }
          resolve(decision.allowed);
        },
      });
      this.emitChange();
      for (const listener of this.listeners) {
        try { listener(request); } catch { /* ignore */ }
      }
    });
  }

  /**
   * Resolve a pending request with a full decision object.
   * `mode` can be "once", "session", or "deny".
   */
  resolve(id: string, mode: PermissionDecisionMode): void {
    const handler = this.pending.get(id);
    if (!handler) return;
    this.pending.delete(id);
    handler.resolve({ allowed: mode !== "deny", mode });
    this.emitChange();
  }

  /** Shorthand: accept once */
  accept(id: string): void {
    this.resolve(id, "once");
  }

  /** Shorthand: accept for the rest of this session */
  acceptForSession(id: string): void {
    this.resolve(id, "session");
  }

  /** Shorthand: deny */
  deny(id: string): void {
    this.resolve(id, "deny");
  }

  // ── Listener API ─────────────────────────────────────────────────

  onRequest(listener: PermissionListener): void {
    this.listeners.add(listener);
  }

  offRequest(listener: PermissionListener): void {
    this.listeners.delete(listener);
  }

  onChange(listener: PermissionChangeListener): void {
    this.changeListeners.add(listener);
  }

  offChange(listener: PermissionChangeListener): void {
    this.changeListeners.delete(listener);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      try { listener(); } catch { /* ignore */ }
    }
  }

  // ── Query API ────────────────────────────────────────────────────

  /** Returns the first pending request (for TUI display), or null. */
  getPendingRequest(): PermissionRequest | null {
    const first = this.pending.entries().next();
    if (first.done) return null;
    return first.value[1].request;
  }

  /** True if there are any pending requests */
  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** True when `tool` is auto-approved for the rest of this session. */
  isSessionApproved(tool: string): boolean {
    return this.sessionApprovals.get(tool) === true;
  }

  /** Clear all session-level approvals (e.g. on logout or mode change). */
  clearSessionApprovals(): void {
    this.sessionApprovals.clear();
  }

  // ── Per-agent policy API ─────────────────────────────────────────

  setAgentPolicy(agentId: string, allowedTools: string[]): void {
    this.agentToolPolicies.set(agentId, allowedTools);
  }

  clearAgentPolicy(agentId: string): void {
    this.agentToolPolicies.delete(agentId);
  }

  isToolAllowedForAgent(agentId: string, tool: string): boolean {
    if (!this.agentToolPolicies.has(agentId)) return true;
    return this.agentToolPolicies.get(agentId)!.includes(tool);
  }
}

export const permissionGate = new PermissionGate();
