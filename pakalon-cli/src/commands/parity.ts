/**
 * Runtime-safe compatibility commands for Claude parity slash command gaps.
 *
 * A number of copied Claude command folders depend on source-only internals that
 * are not part of Pakalon's active runtime. These definitions make the commands
 * discoverable and executable through the Pakalon command registry while keeping
 * behavior scoped to existing Pakalon services.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { CommandContext, CommandDefinition, CommandResult } from "./types.js";
import {
  cmdAutoUpdate,
  cmdCheckUpdates,
  cmdInstallPlugin,
  cmdRemovePlugin,
  discoverMarketplace,
  getPluginsList,
} from "./plugins.js";
import { cmdForkSession } from "./session.js";
import { themeCommand } from "./version-theme.js";
import { enableFastMode, disableFastMode, getFastModeState, toggleFastMode } from "@/fastmode/index.js";
import { storeMemory } from "@/memory/store.js";
import { checkWorkspaceTrust, trustDirectory } from "@/security/trust.js";
import { useStore } from "@/store/index.js";
import { parseEffortValue, getEffortLabel } from "@/utils/effort.js";

type MaybePromise<T> = T | Promise<T>;

function ok(message: string, data?: Record<string, unknown>): CommandResult {
  return { success: true, message, ...(data ? { data } : {}) };
}

function fail(message: string): CommandResult {
  return { success: false, message, error: message };
}

function resolveCwd(context: CommandContext): string {
  return path.resolve(context.cwd ?? process.cwd());
}

function ensurePakalonDir(cwd: string): string {
  const dir = path.join(cwd, ".pakalon");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function captureConsole(action: () => MaybePromise<void>): Promise<string> {
  const output: string[] = [];
  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };

  const collect = (...args: unknown[]) => {
    output.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };

  console.log = collect;
  console.error = collect;
  console.warn = collect;
  try {
    await action();
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
  }

  return output.join("\n").trim();
}

function writeSessionMetadata(
  cwd: string,
  fileName: string,
  update: Record<string, unknown>,
): string {
  const filePath = path.join(ensurePakalonDir(cwd), fileName);
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    current = {};
  }
  fs.writeFileSync(filePath, JSON.stringify({ ...current, ...update }, null, 2), "utf-8");
  return filePath;
}

export const addDirCommand: CommandDefinition = {
  name: "add-dir",
  aliases: ["add-directory"],
  description: "Add and trust an additional working directory",
  usage: "/add-dir <path>",
  category: "config",
  async execute(context, args) {
    const raw = args.join(" ").trim();
    if (!raw) return fail("Usage: /add-dir <path>");

    const cwd = resolveCwd(context);
    const dirPath = path.resolve(cwd, raw);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return fail(`Directory not found: ${dirPath}`);
    }

    trustDirectory(dirPath);
    const trust = checkWorkspaceTrust(dirPath);
    return ok(`Added trusted directory:\n${trust.dirPath}`, {
      dirPath: trust.dirPath,
      trusted: trust.trusted,
    });
  },
};

export const branchCommand: CommandDefinition = {
  name: "branch",
  aliases: ["fork"],
  description: "Fork the current chat session",
  usage: "/branch [source-session-id]",
  category: "session",
  async execute(context, args) {
    const sourceSessionId = args[0];
    const id = await cmdForkSession(sourceSessionId, resolveCwd(context));
    return id ? ok(`Forked session: ${id}`, { sessionId: id }) : fail("No session was available to fork.");
  },
};

export const colorCommand: CommandDefinition = {
  name: "color",
  aliases: ["colour"],
  description: "Alias for theme selection",
  usage: "/color <theme-name>",
  category: "config",
  execute(context, args) {
    return themeCommand.execute(context, args);
  },
};

export const copyCompatCommand: CommandDefinition = {
  name: "copy",
  aliases: ["copy-last"],
  description: "Show the latest assistant response for copying",
  usage: "/copy",
  category: "session",
  async execute(context) {
    const messages = Array.isArray(context.messages) ? context.messages : [];
    const latest = [...messages]
      .reverse()
      .find((message): message is { role?: string; content?: unknown } => {
        return typeof message === "object" && message !== null && (message as { role?: string }).role === "assistant";
      });
    const content = typeof latest?.content === "string" ? latest.content : "";
    if (!content) return fail("No assistant message is available to copy.");
    return ok(content);
  },
};

export const effortCommand: CommandDefinition = {
  name: "effort",
  aliases: ["reasoning-effort"],
  description: "Show or set reasoning effort",
  usage: "/effort [low|medium|high|max|extra-high]",
  category: "config",
  async execute(_context, args) {
    const current = useStore.getState().modelEffortConfig;
    const raw = args[0]?.toLowerCase();
    if (!raw || raw === "status") {
      const label = current
        ? "mode" in current
          ? `${current.provider}:${current.mode}`
          : `${current.provider}:${current.effort}`
        : "default";
      return ok(`Reasoning effort: ${label}`);
    }

    const normalized = raw === "max" || raw === "maximum" ? "extra-high" : raw;
    if (!["low", "medium", "high", "extra-high"].includes(normalized)) {
      const parsed = parseEffortValue(raw);
      if (!parsed) return fail("Usage: /effort [low|medium|high|max|extra-high]");
      const label = getEffortLabel(parsed);
      const effort =
        label === "maximum" ? "extra-high" : label === "minimal" ? "low" : label;
      useStore.getState().setModelEffortConfig({
        provider: "default",
        effort: effort as "low" | "medium" | "high" | "extra-high",
      });
      return ok(`Reasoning effort set to ${label}.`);
    }

    useStore.getState().setModelEffortConfig({
      provider: "default",
      effort: normalized as "low" | "medium" | "high" | "extra-high",
    });
    return ok(`Reasoning effort set to ${normalized}.`);
  },
};

export const fastCommand: CommandDefinition = {
  name: "fast",
  description: "Show or toggle fast mode",
  usage: "/fast [on|off|toggle|status]",
  category: "config",
  async execute(_context, args) {
    const action = args[0]?.toLowerCase() ?? "status";
    if (action === "on" || action === "enable") enableFastMode();
    if (action === "off" || action === "disable") disableFastMode();
    if (action === "toggle") toggleFastMode();

    if (!["on", "enable", "off", "disable", "toggle", "status"].includes(action)) {
      return fail("Usage: /fast [on|off|toggle|status]");
    }

    const state = getFastModeState();
    return ok(
      [
        `Fast mode: ${state.enabled ? "enabled" : "disabled"}`,
        `Max tokens: ${state.config.maxTokens}`,
        `Fast model: ${state.config.fastModel ?? "default"}`,
        `Reduced tools: ${state.config.reducedTools ? "yes" : "no"}`,
      ].join("\n"),
      { enabled: state.enabled, config: state.config },
    );
  },
};

export const advisorCommand: CommandDefinition = {
  name: "advisor",
  description: "Show or set the advisory model hint",
  usage: "/advisor [model|off]",
  category: "config",
  async execute(context, args) {
    const cwd = resolveCwd(context);
    const value = args.join(" ").trim();
    if (!value) {
      return ok(`Advisor model: ${process.env.PAKALON_ADVISOR_MODEL ?? "not set"}`);
    }
    if (value === "off" || value === "unset") {
      delete process.env.PAKALON_ADVISOR_MODEL;
      writeSessionMetadata(cwd, "advisor.json", { advisorModel: null, updatedAt: new Date().toISOString() });
      return ok("Advisor disabled.");
    }
    process.env.PAKALON_ADVISOR_MODEL = value;
    const filePath = writeSessionMetadata(cwd, "advisor.json", {
      advisorModel: value,
      updatedAt: new Date().toISOString(),
    });
    return ok(`Advisor model set to ${value}.`, { filePath });
  },
};

export const btwCommand: CommandDefinition = {
  name: "btw",
  description: "Store a short side note in project memory",
  usage: "/btw <note>",
  category: "session",
  async execute(context, args) {
    const note = args.join(" ").trim();
    if (!note) return fail("Usage: /btw <note>");
    const entry = storeMemory(note, context.user?.id ?? "default", String(useStore.getState().sessionId ?? ""));
    return ok(`Stored side note in memory: ${entry.id}`, { memoryId: entry.id });
  },
};

export const feedbackCommand: CommandDefinition = {
  name: "feedback",
  description: "Show feedback channels",
  usage: "/feedback",
  category: "info",
  async execute() {
    return ok("Feedback: https://pakalon.com/feedback\nGitHub issues: https://github.com/pakalon/pakalon/issues");
  },
};

export const extraUsageCommand: CommandDefinition = {
  name: "extra-usage",
  aliases: ["extra_usage"],
  description: "Show extra usage and billing controls",
  usage: "/extra-usage",
  category: "info",
  async execute() {
    return ok("Manage extra usage from Pakalon account settings: https://pakalon.com/settings/usage");
  },
};

export const rateLimitOptionsCommand: CommandDefinition = {
  name: "rate-limit-options",
  aliases: ["rate_limit_options"],
  description: "Show rate-limit recovery options",
  usage: "/rate-limit-options",
  category: "info",
  async execute() {
    return ok(
      [
        "Rate-limit options:",
        "- Wait for the provider window to reset.",
        "- Switch models with /models.",
        "- Compact context with /compact.",
        "- Manage extra usage with /extra-usage.",
      ].join("\n"),
    );
  },
};

export const heapdumpCommand: CommandDefinition = {
  name: "heapdump",
  description: "Write a local memory diagnostics snapshot",
  usage: "/heapdump",
  category: "debug",
  async execute(context) {
    const cwd = resolveCwd(context);
    const outDir = path.join(ensurePakalonDir(cwd), "diagnostics");
    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, `heap-${Date.now()}.json`);
    const memory = process.memoryUsage();
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          pid: process.pid,
          platform: process.platform,
          node: process.version,
          memory,
          uptimeSeconds: process.uptime(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    return ok(`Memory diagnostics written to ${filePath}`, { filePath, memory });
  },
};

export const installSlackAppCommand: CommandDefinition = {
  name: "install-slack-app",
  aliases: ["slack"],
  description: "Show Slack app installation instructions",
  usage: "/install-slack-app",
  category: "config",
  async execute() {
    return ok("Install the Pakalon Slack app from: https://pakalon.com/integrations/slack");
  },
};

export const pluginCommand: CommandDefinition = {
  name: "plugin",
  aliases: ["plugins"],
  description: "Manage Pakalon plugins",
  usage: "/plugin [list|install|remove|update|check|marketplace] [name]",
  category: "config",
  async execute(_context, args) {
    const sub = args[0]?.toLowerCase() ?? "list";
    if (sub === "list") {
      const plugins = getPluginsList();
      if (plugins.length === 0) return ok("No plugins installed.");
      return ok(
        plugins
          .map((plugin) => `${plugin.enabled ? "[on] " : "[off]"} ${plugin.name}@${plugin.version}`)
          .join("\n"),
        { count: plugins.length },
      );
    }
    if (sub === "install" && args[1]) {
      const output = await captureConsole(() => cmdInstallPlugin(args[1]!));
      return ok(output || `Plugin installed: ${args[1]}`);
    }
    if ((sub === "remove" || sub === "uninstall") && args[1]) {
      const output = await captureConsole(() => cmdRemovePlugin(args[1]!));
      return ok(output || `Plugin removed: ${args[1]}`);
    }
    if (sub === "check") {
      const output = await captureConsole(() => cmdCheckUpdates());
      return ok(output || "Plugin update check complete.");
    }
    if (sub === "update") {
      const output = await captureConsole(() => cmdAutoUpdate(args[1], { yes: args.includes("--yes") || args.includes("-y") }));
      return ok(output || "Plugin update complete.");
    }
    if (sub === "marketplace" || sub === "search") {
      const query = args.slice(1).join(" ") || undefined;
      const entries = await discoverMarketplace(query, 20);
      if (entries.length === 0) return ok("No plugins found.");
      return ok(entries.map((entry) => `${entry.name}@${entry.version} - ${entry.description}`).join("\n"), {
        count: entries.length,
      });
    }
    return fail("Usage: /plugin [list|install|remove|update|check|marketplace] [name]");
  },
};

export const releaseNotesCommand: CommandDefinition = {
  name: "release-notes",
  aliases: ["changelog"],
  description: "Show local release notes or package version",
  usage: "/release-notes",
  category: "info",
  async execute(context) {
    const cwd = resolveCwd(context);
    const candidates = ["CHANGELOG.md", "RELEASE_NOTES.md", "README.md"].map((name) => path.join(cwd, name));
    const file = candidates.find((candidate) => fs.existsSync(candidate));
    if (file) {
      const content = fs.readFileSync(file, "utf-8").slice(0, 4000);
      return ok(content, { filePath: file });
    }
    return ok("No local release notes file was found.");
  },
};

export const usageCompatCommand: CommandDefinition = {
  name: "usage",
  aliases: ["tokens"],
  description: "Show rough session token usage",
  usage: "/usage",
  category: "info",
  async execute(context) {
    const messages: unknown[] = Array.isArray(context.messages) ? context.messages : [];
    const chars = messages.reduce<number>((sum, message) => {
      if (typeof message !== "object" || message === null) return sum;
      const content = (message as { content?: unknown }).content;
      return sum + (typeof content === "string" ? content.length : JSON.stringify(content ?? "").length);
    }, 0);
    const estimatedTokens = Math.ceil(chars / 4);
    return ok(`Estimated session tokens: ${estimatedTokens.toLocaleString()}`, {
      estimatedTokens,
      messageCount: messages.length,
    });
  },
};

export const statsCompatCommand: CommandDefinition = {
  name: "stats",
  aliases: ["statistics"],
  description: "Show current chat/session statistics",
  usage: "/stats",
  category: "info",
  async execute(context) {
    const messages: unknown[] = Array.isArray(context.messages) ? context.messages : [];
    const byRole = messages.reduce<Record<string, number>>((acc, message) => {
      const role =
        typeof message === "object" && message !== null && typeof (message as { role?: unknown }).role === "string"
          ? String((message as { role: string }).role)
          : "unknown";
      acc[role] = (acc[role] ?? 0) + 1;
      return acc;
    }, {});
    const state = useStore.getState();
    return ok(
      [
        "Session statistics",
        `Messages: ${messages.length}`,
        `Session ID: ${state.sessionId ?? "none"}`,
        `Runtime tokens: ${state.runtimeTokensUsed.toLocaleString()}`,
        `Remaining context: ${state.remainingPct ?? "unknown"}%`,
        `Roles: ${Object.entries(byRole).map(([role, count]) => `${role}=${count}`).join(", ") || "none"}`,
      ].join("\n"),
      { messageCount: messages.length, byRole },
    );
  },
};

export const reloadPluginsCommand: CommandDefinition = {
  name: "reload-plugins",
  aliases: ["reload-plugin"],
  description: "Refresh plugin metadata from local config",
  usage: "/reload-plugins",
  category: "config",
  async execute() {
    const plugins = getPluginsList();
    return ok(`Plugin metadata reloaded. Installed plugins: ${plugins.length}`, { count: plugins.length });
  },
};

export const remoteEnvCommand: CommandDefinition = {
  name: "remote-env",
  aliases: ["remote-envs"],
  description: "Show remote/session environment keys without secret values",
  usage: "/remote-env",
  category: "info",
  async execute() {
    const keys = Object.keys(process.env)
      .filter((key) => /^(PAKALON|OPENROUTER|ANTHROPIC|OPENAI|MCP|VERCEL|GITHUB)_/i.test(key))
      .sort();
    return ok(keys.length ? keys.map((key) => `${key}=<redacted>`).join("\n") : "No Pakalon remote environment keys are set.");
  },
};

export const renameCommand: CommandDefinition = {
  name: "rename",
  description: "Set a local display name for the current session",
  usage: "/rename <name>",
  category: "session",
  async execute(context, args) {
    const name = args.join(" ").trim();
    if (!name) return fail("Usage: /rename <name>");
    const filePath = writeSessionMetadata(resolveCwd(context), "session-metadata.json", {
      name,
      sessionId: useStore.getState().sessionId,
      updatedAt: new Date().toISOString(),
    });
    return ok(`Session renamed to: ${name}`, { filePath });
  },
};

export const stickersCommand: CommandDefinition = {
  name: "stickers",
  description: "List available local sticker/image assets",
  usage: "/stickers",
  category: "info",
  async execute(context) {
    const cwd = resolveCwd(context);
    const assetDirs = [path.join(cwd, "assets"), path.join(cwd, ".pakalon", "stickers")];
    const files = assetDirs.flatMap((dir) => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { recursive: true })
        .map((entry) => path.join(dir, String(entry)))
        .filter((entryPath) => /\.(png|jpe?g|gif|webp|svg)$/i.test(entryPath));
    });
    return ok(files.length ? files.slice(0, 50).join("\n") : "No sticker/image assets found.", { count: files.length });
  },
};

export const tagCommand: CommandDefinition = {
  name: "tag",
  aliases: ["tags"],
  description: "Add tags to the current session metadata",
  usage: "/tag <tag...>",
  category: "session",
  async execute(context, args) {
    const tags = args.map((tag) => tag.trim()).filter(Boolean);
    if (tags.length === 0) return fail("Usage: /tag <tag...>");
    const filePath = writeSessionMetadata(resolveCwd(context), "session-metadata.json", {
      tags,
      sessionId: useStore.getState().sessionId,
      updatedAt: new Date().toISOString(),
    });
    return ok(`Session tagged: ${tags.join(", ")}`, { tags, filePath });
  },
};

export const ultrareviewCommand: CommandDefinition = {
  name: "ultrareview",
  aliases: ["ultra-review"],
  description: "Start a deep code review request",
  usage: "/ultrareview [target]",
  category: "advanced",
  async execute(_context, args) {
    const target = args.join(" ").trim() || "current changes";
    return ok(
      [
        `Ultra review requested for ${target}.`,
        "Run /review for the active review flow, or ask Pakalon to perform a deep review of this target.",
      ].join("\n"),
    );
  },
};

export const voiceCommand: CommandDefinition = {
  name: "voice",
  description: "Show or toggle voice mode preference",
  usage: "/voice [on|off|status]",
  category: "config",
  async execute(_context, args) {
    const action = args[0]?.toLowerCase() ?? "status";
    if (action === "on" || action === "enable") process.env.PAKALON_VOICE_MODE = "1";
    if (action === "off" || action === "disable") delete process.env.PAKALON_VOICE_MODE;
    if (!["on", "enable", "off", "disable", "status"].includes(action)) {
      return fail("Usage: /voice [on|off|status]");
    }
    return ok(`Voice mode preference: ${process.env.PAKALON_VOICE_MODE === "1" ? "enabled" : "disabled"}`);
  },
};

export const parityCommands: CommandDefinition[] = [
  addDirCommand,
  advisorCommand,
  branchCommand,
  btwCommand,
  colorCommand,
  copyCompatCommand,
  effortCommand,
  extraUsageCommand,
  fastCommand,
  feedbackCommand,
  heapdumpCommand,
  installSlackAppCommand,
  pluginCommand,
  rateLimitOptionsCommand,
  releaseNotesCommand,
  reloadPluginsCommand,
  remoteEnvCommand,
  renameCommand,
  statsCompatCommand,
  stickersCommand,
  tagCommand,
  ultrareviewCommand,
  usageCompatCommand,
  voiceCommand,
];

const parityCommandMap = new Map<string, CommandDefinition>();
for (const command of parityCommands) {
  parityCommandMap.set(command.name, command);
  for (const alias of command.aliases ?? []) {
    parityCommandMap.set(alias, command);
  }
}

export function findParityCommand(name: string): CommandDefinition | undefined {
  return parityCommandMap.get(name.toLowerCase().replace(/^\//, ""));
}

export async function executeParityCommand(input: string, context: CommandContext): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return fail("Commands must start with /");
  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  const commandName = parts[0];
  if (!commandName) return fail("Missing command name.");
  const command = findParityCommand(commandName);
  if (!command) return fail(`Unknown command: /${commandName}`);
  return command.execute(context, parts.slice(1));
}

export default parityCommands;
