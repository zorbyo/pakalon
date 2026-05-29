/**
 * Permission mode persistence — saves and loads the user's preferred
 * interaction mode (YOLO vs Human-in-Loop) from project-local settings.
 *
 * Storage location:
 *   - .pakalon/settings.local.json
 */
import fs from "fs";
import path from "path";
import type { PermissionMode } from "@/store/slices/mode.slice.js";

interface PermissionRule {
  tool: string;
  action: "allow" | "deny";
  pattern?: string; // Optional glob pattern for file paths
  timestamp: number;
}

interface SettingsLocal {
  permissionMode?: string;
  permissionRules?: PermissionRule[];
  [key: string]: unknown;
}

function resolveSettingsDir(cwd: string): string {
  return path.join(cwd, ".pakalon");
}

function getSettingsPath(cwd: string): string {
  return path.join(resolveSettingsDir(cwd), "settings.local.json");
}

function getLegacySettingsPaths(cwd: string): string[] {
  return [
    path.join(cwd, ".pakalon", ".settings.local.json"),
    path.join(cwd, ".pakalon-agents", ".settings.local.json"),
  ];
}

export function loadPermissionMode(cwd: string): PermissionMode | null {
  try {
    const paths = [getSettingsPath(cwd), ...getLegacySettingsPaths(cwd)];
    for (const settingsPath of paths) {
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const settings: SettingsLocal = JSON.parse(raw);
      const mode = settings.permissionMode;
      if (mode === "auto-accept" || mode === "normal" || mode === "plan" || mode === "orchestration") {
        return mode as PermissionMode;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function savePermissionMode(cwd: string, mode: PermissionMode): void {
  try {
    const settingsDir = resolveSettingsDir(cwd);
    // Ensure the directory exists
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
    const settingsPath = getSettingsPath(cwd);
    let settings: SettingsLocal = {};
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      settings = JSON.parse(raw);
    }
    settings.permissionMode = mode;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // Best-effort persistence — don't block mode switching if save fails
  }
}

export function savePermissionRule(
  cwd: string,
  tool: string,
  action: "allow" | "deny",
  pattern?: string,
): void {
  try {
    const settingsDir = resolveSettingsDir(cwd);
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
    const settingsPath = getSettingsPath(cwd);
    let settings: SettingsLocal = {};
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      settings = JSON.parse(raw);
    }
    if (!settings.permissionRules) {
      settings.permissionRules = [];
    }
    // Remove existing rule for the same tool+pattern
    settings.permissionRules = settings.permissionRules.filter(
      (r) => !(r.tool === tool && r.pattern === pattern),
    );
    // Add new rule
    settings.permissionRules.push({
      tool,
      action,
      pattern,
      timestamp: Date.now(),
    });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // Best-effort persistence
  }
}

export function loadPermissionRules(cwd: string): PermissionRule[] {
  try {
    const paths = [getSettingsPath(cwd), ...getLegacySettingsPaths(cwd)];
    for (const settingsPath of paths) {
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const settings: SettingsLocal = JSON.parse(raw);
      return settings.permissionRules ?? [];
    }
    return [];
  } catch {
    return [];
  }
}

export function checkPermissionRule(
  cwd: string,
  tool: string,
  filePath?: string,
): "allow" | "deny" | null {
  const rules = loadPermissionRules(cwd);
  for (const rule of rules) {
    if (rule.tool === tool) {
      if (!rule.pattern || !filePath) {
        return rule.action;
      }
      // Simple glob matching (supports * wildcard)
      const regex = new RegExp(
        "^" + rule.pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      );
      if (regex.test(filePath)) {
        return rule.action;
      }
    }
  }
  return null;
}
