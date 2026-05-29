/**
 * MDM (Mobile Device Management) Settings
 *
 * Manages enterprise policy settings that can be enforced by
 * MDM systems. Provides read-only policy enforcement layer.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import logger from "@/utils/logger.js";

export interface MdmPolicy {
  identifier: string;
  enforced: boolean;
  value: unknown;
  source: string;
}

export interface MdmSettings {
  allowedModels?: string[];
  blockedModels?: string[];
  defaultModel?: string;
  maxTokensLimit?: number;
  telemetryEnabled?: boolean;
  privacyModeEnforced?: boolean;
  allowedPlugins?: string[];
  blockedPlugins?: string[];
  maxSessionDuration?: number;
  requireAuth?: boolean;
  allowedCommands?: string[];
  blockedCommands?: string[];
  skillMarketplaceUrl?: string;
  blockExternalSkills?: boolean;
  [key: string]: unknown;
}

export interface MdmConfigResult {
  settings: MdmSettings;
  policies: MdmPolicy[];
  isManaged: boolean;
}

const MDM_CONFIG_PATHS = [
  path.join(os.homedir(), ".config", "pakalon", "mdm.json"),
  path.join(os.homedir(), "Library", "Managed Preferences", "com.pakalon.cli.plist"),
  "/etc/pakalon/mdm.json",
];

const PROJECT_MDM_PATH = ".pakalon/mdm.json";

let cachedConfig: MdmConfigResult | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 30000;

function parseMdmJson(filePath: string): MdmSettings | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as MdmSettings;
  } catch {
    return null;
  }
}

function extractPolicies(settings: MdmSettings, source: string): MdmPolicy[] {
  const policies: MdmPolicy[] = [];

  for (const [key, value] of Object.entries(settings)) {
    if (key === "telemetryEnabled" || key === "privacyModeEnforced" || key === "requireAuth" || key === "blockExternalSkills") {
      policies.push({
        identifier: `com.pakalon.cli.${key}`,
        enforced: true,
        value,
        source,
      });
    }
  }

  if (settings.allowedModels) {
    policies.push({
      identifier: "com.pakalon.cli.allowedModels",
      enforced: true,
      value: settings.allowedModels,
      source,
    });
  }

  if (settings.blockedModels) {
    policies.push({
      identifier: "com.pakalon.cli.blockedModels",
      enforced: true,
      value: settings.blockedModels,
      source,
    });
  }

  if (settings.maxTokensLimit !== undefined) {
    policies.push({
      identifier: "com.pakalon.cli.maxTokensLimit",
      enforced: true,
      value: settings.maxTokensLimit,
      source,
    });
  }

  return policies;
}

function mergeSettings(base: MdmSettings, override: MdmSettings): MdmSettings {
  const merged: MdmSettings = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined && value !== null) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

export function loadMdmSettings(forceRefresh = false): MdmConfigResult {
  const now = Date.now();
  if (cachedConfig && !forceRefresh && now < cacheExpiry) {
    return cachedConfig;
  }

  let globalSettings: MdmSettings = {};
  let projectSettings: MdmSettings = {};
  const allPolicies: MdmPolicy[] = [];

  for (const configPath of MDM_CONFIG_PATHS) {
    const settings = parseMdmJson(configPath);
    if (settings) {
      globalSettings = mergeSettings(globalSettings, settings);
      allPolicies.push(...extractPolicies(settings, configPath));
      logger.info("[mdm] loaded config", { path: configPath });
    }
  }

  const projectPath = path.join(process.cwd(), PROJECT_MDM_PATH);
  const project = parseMdmJson(projectPath);
  if (project) {
    projectSettings = mergeSettings(projectSettings, project);
    allPolicies.push(...extractPolicies(project, projectPath));
    logger.info("[mdm] loaded project config", { path: projectPath });
  }

  const merged = mergeSettings(globalSettings, projectSettings);
  const isManaged = allPolicies.length > 0;

  cachedConfig = {
    settings: merged,
    policies: allPolicies,
    isManaged,
  };
  cacheExpiry = now + CACHE_TTL;

  return cachedConfig;
}

export function isModelAllowed(model: string): boolean {
  const { settings } = loadMdmSettings();

  if (settings.blockedModels?.includes(model)) {
    return false;
  }

  if (settings.allowedModels && settings.allowedModels.length > 0) {
    return settings.allowedModels.includes(model);
  }

  return true;
}

export function isCommandAllowed(command: string): boolean {
  const { settings } = loadMdmSettings();

  if (settings.blockedCommands?.includes(command)) {
    return false;
  }

  if (settings.allowedCommands && settings.allowedCommands.length > 0) {
    return settings.allowedCommands.includes(command);
  }

  return true;
}

export function isPluginAllowed(plugin: string): boolean {
  const { settings } = loadMdmSettings();

  if (settings.blockedPlugins?.includes(plugin)) {
    return false;
  }

  if (settings.allowedPlugins && settings.allowedPlugins.length > 0) {
    return settings.allowedPlugins.includes(plugin);
  }

  return true;
}

export function getMaxTokensOverride(): number | undefined {
  const { settings } = loadMdmSettings();
  return settings.maxTokensLimit;
}

export function isTelemetryAllowed(): boolean {
  const { settings } = loadMdmSettings();
  return settings.telemetryEnabled ?? true;
}

export function isPrivacyModeEnforced(): boolean {
  const { settings } = loadMdmSettings();
  return settings.privacyModeEnforced ?? false;
}

export function isExternalSkillsAllowed(): boolean {
  const { settings } = loadMdmSettings();
  return !settings.blockExternalSkills;
}

export function getEnforcedPolicies(): MdmPolicy[] {
  const { policies } = loadMdmSettings();
  return policies;
}

export function clearMdmCache(): void {
  cachedConfig = null;
  cacheExpiry = 0;
}
