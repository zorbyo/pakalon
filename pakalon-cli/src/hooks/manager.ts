import fs from "node:fs";
import path from "node:path";

import {
  addHook as addConfiguredHook,
  reloadHooksConfig,
  removeHook as removeConfiguredHook,
  type HookDefinition,
  type HookEvent,
  type HooksConfig,
} from "@/ai/hooks.js";
import { getVendoredEverythingRoot } from "@/utils/claude-imports.js";

export type HookScope = "global" | "project";

type HooksConfigFile = HooksConfig & { disableAllHooks?: boolean };

type VendoredHookFile = {
  hooks?: Partial<Record<
    HookEvent,
    Array<{
      matcher?: string;
      description?: string;
      hooks?: Array<{
        type?: HookDefinition["type"];
        command?: string;
        url?: string;
        method?: "GET" | "POST";
        headers?: Record<string, string>;
        model?: string;
        systemMessage?: string;
        maxTurns?: number;
        allowedTools?: string[];
        timeout?: number;
        async?: boolean;
        blockOnFail?: boolean;
      }>;
    }>
  >>;
};

type VendoredHookGroup = NonNullable<
  NonNullable<VendoredHookFile["hooks"]>[HookEvent]
>[number];

type VendoredHookDefinition = NonNullable<VendoredHookGroup["hooks"]>[number];

export interface ConfiguredHookEntry {
  scope: HookScope;
  event: HookEvent;
  index: number;
  hook: HookDefinition;
  sourcePath: string;
}

export interface VendoredHookPreset {
  id: string;
  event: HookEvent;
  matcher?: string;
  description?: string;
  hooks: HookDefinition[];
  sourcePath: string;
}

export interface VendoredHookImportResult {
  imported: string[];
  skipped: string[];
  errors: Array<{ id: string; reason: string }>;
  configPath: string;
}

const VENDORED_HOOKS_PATH = path.join(
  getVendoredEverythingRoot(),
  "hooks",
  "hooks.json",
);

const TOOL_MATCHER_MAP: Record<string, string[]> = {
  Bash: ["bash"],
  Edit: ["edit", "editFile"],
  Write: ["write", "writeFile", "createFile"],
  MultiEdit: ["multiEdit", "multiedit"],
  Read: ["read", "readFile"],
  Grep: ["grep"],
  Glob: ["glob"],
  WebFetch: ["webFetch", "web-fetch"],
};

export function getHooksConfigPath(scope: HookScope, cwd = process.cwd()): string {
  if (scope === "global") {
    return path.join(
      process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
      ".pakalon",
      "hooks.json",
    );
  }

  return path.join(cwd, ".pakalon", "hooks.json");
}

function readHooksConfigFile(configPath: string): HooksConfigFile {
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as HooksConfigFile;
  } catch {
    return {};
  }
}

function writeHooksConfigFile(configPath: string, config: HooksConfigFile): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  reloadHooksConfig();
}

function normalizeMatcher(matcher?: string): string | undefined {
  if (!matcher) {
    return undefined;
  }

  const trimmed = matcher.trim();
  if (!trimmed || trimmed === "*") {
    return undefined;
  }

  const tokens = trimmed
    .split("|")
    .map((token) => token.trim())
    .filter(Boolean);

  const expanded = tokens.flatMap((token) => TOOL_MATCHER_MAP[token] ?? [token]);
  if (expanded.length === 0) {
    return undefined;
  }

  const simple = expanded.every((token) => /^[A-Za-z0-9_-]+$/.test(token));
  if (!simple) {
    return expanded.join("|");
  }

  const unique = [...new Set(expanded)];
  if (unique.length === 1) {
    return unique[0];
  }

  return `^(${unique.join("|")})$`;
}

function convertVendoredHookDefinition(
  definition: VendoredHookDefinition,
  matcher?: string,
): HookDefinition {
  const converted: HookDefinition = {};

  if (definition.type) converted.type = definition.type;
  if (definition.command) converted.command = definition.command;
  if (definition.url) converted.url = definition.url;
  if (definition.method) converted.method = definition.method;
  if (definition.headers) converted.headers = definition.headers;
  if (definition.model) converted.model = definition.model;
  if (definition.systemMessage) converted.systemMessage = definition.systemMessage;
  if (definition.maxTurns !== undefined) converted.maxTurns = definition.maxTurns;
  if (definition.allowedTools) converted.allowedTools = definition.allowedTools;
  if (definition.async !== undefined) converted.async = definition.async;
  if (definition.blockOnFail !== undefined) converted.blockOnFail = definition.blockOnFail;

  if (definition.timeout !== undefined) {
    converted.timeoutMs = definition.timeout < 1000
      ? definition.timeout * 1000
      : definition.timeout;
  }

  const normalizedMatcher = normalizeMatcher(matcher);
  if (normalizedMatcher) {
    converted.match = normalizedMatcher;
  }

  return converted;
}

function readVendoredHookFile(): VendoredHookFile {
  if (!fs.existsSync(VENDORED_HOOKS_PATH)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(VENDORED_HOOKS_PATH, "utf-8")) as VendoredHookFile;
}

export function listConfiguredHooks(
  cwd = process.cwd(),
  scope?: HookScope,
): ConfiguredHookEntry[] {
  const scopes = scope ? [scope] : (["global", "project"] as HookScope[]);
  const entries: ConfiguredHookEntry[] = [];

  for (const selectedScope of scopes) {
    const configPath = getHooksConfigPath(selectedScope, cwd);
    const config = readHooksConfigFile(configPath);

    for (const [event, hooks] of Object.entries(config)) {
      if (event === "disableAllHooks" || !Array.isArray(hooks)) {
        continue;
      }

      hooks.forEach((hook, index) => {
        entries.push({
          scope: selectedScope,
          event: event as HookEvent,
          index,
          hook,
          sourcePath: configPath,
        });
      });
    }
  }

  return entries.sort((left, right) => {
    if (left.scope !== right.scope) {
      return left.scope.localeCompare(right.scope);
    }
    if (left.event !== right.event) {
      return left.event.localeCompare(right.event);
    }
    return left.index - right.index;
  });
}

export function listVendoredHookPresets(query?: string): VendoredHookPreset[] {
  const vendored = readVendoredHookFile();
  const presets: VendoredHookPreset[] = [];

  for (const [event, groups] of Object.entries(vendored.hooks ?? {})) {
    if (!Array.isArray(groups)) {
      continue;
    }

    groups.forEach((group, index) => {
      const hooks = (group.hooks ?? []).map((hook) =>
        convertVendoredHookDefinition(hook, group.matcher),
      );

      presets.push({
        id: `${event}:${index}`,
        event: event as HookEvent,
        matcher: group.matcher,
        description: group.description,
        hooks,
        sourcePath: VENDORED_HOOKS_PATH,
      });
    });
  }

  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) {
    return presets;
  }

  return presets.filter((preset) => {
    const haystack = [
      preset.id,
      preset.event,
      preset.matcher ?? "",
      preset.description ?? "",
      ...preset.hooks.map((hook) => hook.command ?? hook.url ?? hook.type ?? ""),
    ]
      .join("\n")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export async function importVendoredHooks(options?: {
  scope?: HookScope;
  cwd?: string;
  ids?: string[];
  query?: string;
}): Promise<VendoredHookImportResult> {
  const scope = options?.scope ?? "project";
  const cwd = options?.cwd ?? process.cwd();
  const configPath = getHooksConfigPath(scope, cwd);
  const config = readHooksConfigFile(configPath);
  const presets = listVendoredHookPresets(options?.query);
  const requestedIds = new Set((options?.ids ?? []).filter(Boolean));
  const selectedPresets = requestedIds.size > 0
    ? presets.filter((preset) => requestedIds.has(preset.id))
    : presets;

  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ id: string; reason: string }> = [];

  for (const preset of selectedPresets) {
    const eventHooks = [...(config[preset.event] ?? [])];
    let changed = false;

    for (const hook of preset.hooks) {
      const serialized = JSON.stringify(hook);
      const exists = eventHooks.some((candidate) => JSON.stringify(candidate) === serialized);
      if (exists) {
        continue;
      }

      eventHooks.push(hook);
      changed = true;
    }

    if (!changed) {
      skipped.push(preset.id);
      continue;
    }

    config[preset.event] = eventHooks;
    imported.push(preset.id);
  }

  if (requestedIds.size > 0) {
    for (const id of requestedIds) {
      if (!selectedPresets.some((preset) => preset.id === id)) {
        errors.push({ id, reason: "Preset not found" });
      }
    }
  }

  if (imported.length > 0) {
    writeHooksConfigFile(configPath, config);
  }

  return { imported, skipped, errors, configPath };
}

export function removeConfiguredHookEntry(
  event: HookEvent,
  index: number,
  scope: HookScope,
  cwd = process.cwd(),
): boolean {
  const removed = removeConfiguredHook(event, index, scope, cwd);
  if (removed) {
    reloadHooksConfig();
  }
  return removed;
}

export function addConfiguredHookEntry(
  event: HookEvent,
  hook: HookDefinition,
  scope: HookScope,
  cwd = process.cwd(),
): string {
  const configPath = addConfiguredHook(event, hook as unknown as Record<string, unknown>, scope, cwd);
  reloadHooksConfig();
  return configPath;
}
