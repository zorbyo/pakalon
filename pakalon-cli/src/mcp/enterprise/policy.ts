/**
 * Enterprise MCP Policy Manager
 * 
 * Provides enterprise-grade MCP server management with:
 * - Allowlist/denylist for MCP servers
 * - Managed MCP configurations
 * - Channel permissions (Slack/Discord gating)
 * - MCP server policy enforcement
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { z } from "zod";
import logger from "@/utils/logger.js";

export interface McpServerPolicy {
  serverName: string;
  action: "allow" | "deny" | "managed";
  reason?: string;
  allowedScopes?: Array<"global" | "project">;
  allowedTools?: string[];
  deniedTools?: string[];
  maxConcurrentConnections?: number;
  rateLimitPerMinute?: number;
  channelRestrictions?: ChannelRestriction[];
  createdAt: string;
  updatedAt: string;
}

export interface ChannelRestriction {
  channelType: "slack" | "discord" | "web" | "mobile";
  channelId?: string;
  allowed: boolean;
  reason?: string;
}

export interface EnterprisePolicyConfig {
  mode: "allowlist" | "denylist" | "managed";
  defaultAction: "allow" | "deny";
  policies: Map<string, McpServerPolicy>;
  channelPermissions: Map<string, ChannelRestriction[]>;
  globalAllowedServers: string[];
  globalDeniedServers: string[];
}

const POLICY_SCHEMA = z.object({
  serverName: z.string(),
  action: z.enum(["allow", "deny", "managed"]),
  reason: z.string().optional(),
  allowedScopes: z.array(z.enum(["global", "project"])).optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  maxConcurrentConnections: z.number().optional(),
  rateLimitPerMinute: z.number().optional(),
  channelRestrictions: z.array(z.object({
    channelType: z.enum(["slack", "discord", "web", "mobile"]),
    channelId: z.string().optional(),
    allowed: z.boolean(),
    reason: z.string().optional(),
  })).optional(),
});

const CONFIG_SCHEMA = z.object({
  version: z.string(),
  mode: z.enum(["allowlist", "denylist", "managed"]),
  defaultAction: z.enum(["allow", "deny"]),
  policies: z.record(z.string(), POLICY_SCHEMA),
  channelPermissions: z.record(z.string(), z.array(z.object({
    channelType: z.enum(["slack", "discord", "web", "mobile"]),
    channelId: z.string().optional(),
    allowed: z.boolean(),
    reason: z.string().optional(),
  }))),
  globalAllowedServers: z.array(z.string()).optional(),
  globalDeniedServers: z.array(z.string()).optional(),
});

type EnterprisePolicyConfigFile = z.infer<typeof CONFIG_SCHEMA>;

class EnterpriseMcpPolicyManager {
  private config: EnterprisePolicyConfig;
  private configPath: string;
  private watchers: Set<(policy: McpServerPolicy, action: "added" | "updated" | "removed") => void> = new Set();

  constructor(configPath?: string) {
    const defaultPath = join(process.cwd(), ".pakalon", "enterprise-mcp-policy.json");
    this.configPath = configPath || defaultPath;
    this.config = this.loadConfig();
  }

  private loadConfig(): EnterprisePolicyConfig {
    const defaultConfig: EnterprisePolicyConfig = {
      mode: "denylist",
      defaultAction: "allow",
      policies: new Map(),
      channelPermissions: new Map(),
      globalAllowedServers: [],
      globalDeniedServers: [],
    };

    if (!existsSync(this.configPath)) {
      return defaultConfig;
    }

    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw) as EnterprisePolicyConfigFile;

      const policies = new Map<string, McpServerPolicy>();
      for (const [name, policy] of Object.entries(parsed.policies || {})) {
        policies.set(name, {
          ...policy,
          createdAt: policy.createdAt || new Date().toISOString(),
          updatedAt: policy.updatedAt || new Date().toISOString(),
        } as McpServerPolicy);
      }

      const channelPermissions = new Map<string, ChannelRestriction[]>();
      for (const [server, perms] of Object.entries(parsed.channelPermissions || {})) {
        channelPermissions.set(server, perms as ChannelRestriction[]);
      }

      return {
        mode: parsed.mode || "denylist",
        defaultAction: parsed.defaultAction || "allow",
        policies,
        channelPermissions,
        globalAllowedServers: parsed.globalAllowedServers || [],
        globalDeniedServers: parsed.globalDeniedServers || [],
      };
    } catch (err) {
      logger.error("[EnterprisePolicy] Failed to load config:", err);
      return defaultConfig;
    }
  }

  private saveConfig(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const policies: Record<string, unknown> = {};
    for (const [name, policy] of this.config.policies.entries()) {
      policies[name] = {
        ...policy,
        channelRestrictions: policy.channelRestrictions || [],
      };
    }

    const channelPermissions: Record<string, unknown[]> = {};
    for (const [server, perms] of this.config.channelPermissions.entries()) {
      channelPermissions[server] = perms;
    }

    const configFile: EnterprisePolicyConfigFile = {
      version: "1.0",
      mode: this.config.mode,
      defaultAction: this.config.defaultAction,
      policies,
      channelPermissions,
      globalAllowedServers: this.config.globalAllowedServers,
      globalDeniedServers: this.config.globalDeniedServers,
    };

    writeFileSync(this.configPath, JSON.stringify(configFile, null, 2), "utf-8");
  }

  setMode(mode: "allowlist" | "denylist" | "managed"): void {
    this.config.mode = mode;
    this.saveConfig();
    logger.info(`[EnterprisePolicy] Mode set to: ${mode}`);
  }

  getMode(): EnterprisePolicyConfig["mode"] {
    return this.config.mode;
  }

  addPolicy(serverName: string, policy: Omit<McpServerPolicy, "createdAt" | "updatedAt">): boolean {
    const fullPolicy: McpServerPolicy = {
      ...policy,
      serverName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.config.policies.set(serverName, fullPolicy);
    this.saveConfig();
    this.notifyWatchers(fullPolicy, "added");
    logger.info(`[EnterprisePolicy] Added policy for ${serverName}: ${policy.action}`);
    return true;
  }

  updatePolicy(serverName: string, updates: Partial<McpServerPolicy>): boolean {
    const existing = this.config.policies.get(serverName);
    if (!existing) return false;

    const updated: McpServerPolicy = {
      ...existing,
      ...updates,
      serverName,
      updatedAt: new Date().toISOString(),
    };

    this.config.policies.set(serverName, updated);
    this.saveConfig();
    this.notifyWatchers(updated, "updated");
    logger.info(`[EnterprisePolicy] Updated policy for ${serverName}`);
    return true;
  }

  removePolicy(serverName: string): boolean {
    const removed = this.config.policies.delete(serverName);
    if (removed) {
      this.saveConfig();
      this.notifyWatchers({ serverName, action: "deny", createdAt: "", updatedAt: "" } as McpServerPolicy, "removed");
      logger.info(`[EnterprisePolicy] Removed policy for ${serverName}`);
    }
    return removed;
  }

  getPolicy(serverName: string): McpServerPolicy | undefined {
    return this.config.policies.get(serverName);
  }

  getAllPolicies(): McpServerPolicy[] {
    return Array.from(this.config.policies.values());
  }

  checkServerAccess(serverName: string): { allowed: boolean; reason?: string } {
    const policy = this.config.policies.get(serverName);

    if (this.config.mode === "allowlist") {
      if (this.config.globalAllowedServers.includes(serverName)) {
        return { allowed: true };
      }
      if (policy?.action === "allow") {
        return { allowed: true };
      }
      if (policy?.action === "managed") {
        return { allowed: true, reason: "Managed server" };
      }
      return { allowed: false, reason: policy?.reason || "Server not in allowlist" };
    }

    if (this.config.mode === "denylist") {
      if (this.config.globalDeniedServers.includes(serverName)) {
        return { allowed: false, reason: "Server in global denylist" };
      }
      if (policy?.action === "deny") {
        return { allowed: false, reason: policy.reason || "Server explicitly denied" };
      }
      return { allowed: true };
    }

    if (this.config.mode === "managed") {
      if (policy?.action === "managed") {
        return { allowed: true };
      }
      return { allowed: false, reason: "Only managed servers are allowed" };
    }

    return { allowed: this.config.defaultAction === "allow" };
  }

  checkToolAccess(serverName: string, toolName: string): { allowed: boolean; reason?: string } {
    const policy = this.config.policies.get(serverName);
    if (!policy) {
      return { allowed: true };
    }

    if (policy.allowedTools && policy.allowedTools.length > 0) {
      return policy.allowedTools.includes(toolName)
        ? { allowed: true }
        : { allowed: false, reason: `Tool ${toolName} not in allowed list` };
    }

    if (policy.deniedTools?.includes(toolName)) {
      return { allowed: false, reason: `Tool ${toolName} explicitly denied` };
    }

    return { allowed: true };
  }

  checkChannelAccess(serverName: string, channelType: "slack" | "discord" | "web" | "mobile", channelId?: string): { allowed: boolean; reason?: string } {
    const restrictions = this.config.channelPermissions.get(serverName);
    if (!restrictions) {
      return { allowed: true };
    }

    for (const restriction of restrictions) {
      if (restriction.channelType === channelType) {
        if (!restriction.channelId || restriction.channelId === channelId) {
          return {
            allowed: restriction.allowed,
            reason: restriction.reason || (restriction.allowed ? undefined : "Channel not permitted"),
          };
        }
      }
    }

    return { allowed: true };
  }

  addChannelRestriction(serverName: string, restriction: ChannelRestriction): void {
    const existing = this.config.channelPermissions.get(serverName) || [];
    const idx = existing.findIndex(
      (r) => r.channelType === restriction.channelType && r.channelId === restriction.channelId
    );

    if (idx >= 0) {
      existing[idx] = restriction;
    } else {
      existing.push(restriction);
    }

    this.config.channelPermissions.set(serverName, existing);
    this.saveConfig();
  }

  removeChannelRestriction(serverName: string, channelType: "slack" | "discord" | "web" | "mobile", channelId?: string): void {
    const existing = this.config.channelPermissions.get(serverName);
    if (!existing) return;

    const filtered = existing.filter(
      (r) => !(r.channelType === channelType && r.channelId === channelId)
    );

    if (filtered.length > 0) {
      this.config.channelPermissions.set(serverName, filtered);
    } else {
      this.config.channelPermissions.delete(serverName);
    }

    this.saveConfig();
  }

  watch(callback: (policy: McpServerPolicy, action: "added" | "updated" | "removed") => void): () => void {
    this.watchers.add(callback);
    return () => this.watchers.delete(callback);
  }

  private notifyWatchers(policy: McpServerPolicy, action: "added" | "updated" | "removed"): void {
    for (const watcher of this.watchers) {
      try {
        watcher(policy, action);
      } catch {
        // Ignore watcher errors
      }
    }
  }

  getAllowedServers(): string[] {
    const servers: string[] = [];

    if (this.config.mode === "allowlist") {
      servers.push(...this.config.globalAllowedServers);
      for (const [name, policy] of this.config.policies.entries()) {
        if (policy.action === "allow" && !servers.includes(name)) {
          servers.push(name);
        }
      }
    } else {
      for (const [name, policy] of this.config.policies.entries()) {
        if (policy.action !== "deny") {
          servers.push(name);
        }
      }
    }

    return servers;
  }

  getDeniedServers(): string[] {
    const servers = [...this.config.globalDeniedServers];
    for (const [name, policy] of this.config.policies.entries()) {
      if (policy.action === "deny" && !servers.includes(name)) {
        servers.push(name);
      }
    }
    return servers;
  }
}

let policyManager: EnterpriseMcpPolicyManager | null = null;

export function getEnterprisePolicyManager(configPath?: string): EnterpriseMcpPolicyManager {
  if (!policyManager) {
    policyManager = new EnterpriseMcpPolicyManager(configPath);
  }
  return policyManager;
}

export function checkMcpServerAccess(serverName: string): { allowed: boolean; reason?: string } {
  return getEnterprisePolicyManager().checkServerAccess(serverName);
}

export function checkMcpToolAccess(serverName: string, toolName: string): { allowed: boolean; reason?: string } {
  return getEnterprisePolicyManager().checkToolAccess(serverName, toolName);
}

export default EnterpriseMcpPolicyManager;