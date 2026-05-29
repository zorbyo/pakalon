/**
 * Skills Command - Enhanced
 *
 * Extended skills command with search, diagnostics, and management capabilities.
 */
import type { CommandContext, CommandResult } from "../types.js";
import {
  discoverSkillCatalog,
  findSkillCatalogEntry,
  searchSkillCatalog,
  type SkillCatalogSource,
} from "@/skills/catalog.js";
import {
  searchLocalSkills,
  findExactSkill,
  listAllSkills,
  recordSkillUsage,
} from "@/services/skillSearch/localSearch.js";
import {
  prefetchSkills,
  getCachedSkill,
  getPrefetchStats,
  clearPrefetchCache,
  warmupSkills,
} from "@/services/skillSearch/prefetch.js";
import {
  getDiagnosticReport,
  runHealthChecks,
  type DiagnosticSeverity,
} from "@/services/diagnosticTracking.js";
import {
  listInstalledDxtPackages,
  getEnabledSkills,
  getEnabledCommands,
} from "@/utils/dxt/index.js";
import { summarizeVendoredEverythingAssets } from "@/utils/claude-imports.js";
import logger from "@/utils/logger.js";

export interface ExtendedSkillDefinition {
  name: string;
  description: string;
  version?: string;
  author?: string;
  keywords?: string[];
  category?: string;
  triggers?: string[];
  enabled: boolean;
  source: SkillCatalogSource;
  path?: string;
  lastUsed?: number;
  useCount?: number;
}

function normalizeCategory(value: unknown): string {
  if (typeof value !== "string") return "other";
  return value.trim().toLowerCase();
}

function toExtendedSkillDefinition(
  entry: ReturnType<typeof discoverSkillCatalog>[number],
): ExtendedSkillDefinition {
  return {
    name: entry.name,
    description: entry.description,
    version: typeof entry.frontmatter.version === "string" ? entry.frontmatter.version : undefined,
    author: typeof entry.frontmatter.author === "string" ? entry.frontmatter.author : undefined,
    keywords: entry.keywords,
    category: normalizeCategory(entry.frontmatter.category),
    triggers: entry.triggers,
    enabled: true,
    source: entry.source,
    path: entry.path,
  };
}

function formatSkillList(skills: ExtendedSkillDefinition[], showDetails = false): string {
  if (skills.length === 0) {
    return "No skills discovered.";
  }

  const lines: string[] = [];
  const groups = new Map<SkillCatalogSource, ExtendedSkillDefinition[]>();

  for (const skill of skills) {
    const group = groups.get(skill.source) ?? [];
    group.push(skill);
    groups.set(skill.source, group);
  }

  for (const source of ["project", "global", "embedded", "vendored"] as const) {
    const group = groups.get(source);
    if (!group || group.length === 0) continue;

    lines.push(`${source} skills (${group.length})`);
    lines.push("-".repeat(40));

    for (const skill of group.sort((a, b) => a.name.localeCompare(b.name))) {
      const status = skill.enabled ? "enabled" : "disabled";
      lines.push(`  ${skill.name} [${status}]`);
      lines.push(`    ${skill.description}`);

      if (showDetails) {
        if (skill.version) lines.push(`    version: ${skill.version}`);
        if (skill.author) lines.push(`    author: ${skill.author}`);
        if (skill.path) lines.push(`    path: ${skill.path}`);
        if (skill.triggers?.length) lines.push(`    triggers: ${skill.triggers.join(", ")}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function formatSearchResults(
  query: string,
  results: Awaited<ReturnType<typeof searchLocalSkills>>,
): string {
  if (results.matches.length === 0) {
    return `No skills found matching: "${query}"`;
  }

  const lines: string[] = [
    `Search results for: "${query}"`,
    `Found ${results.matches.length} match(es) in ${results.elapsedMs}ms`,
    "-".repeat(50),
  ];

  for (let i = 0; i < results.matches.length; i++) {
    const match = results.matches[i]!;
    const score = Math.round(match.score * 100);
    lines.push(`${i + 1}. ${match.entry.name} [score: ${score}%] [${match.entry.source}]`);
    lines.push(`   ${match.entry.description}`);
    lines.push(`   matched: ${match.matchFields.join(", ")}`);
    if (match.entry.path) {
      lines.push(`   path: ${match.entry.path}`);
    }
  }

  return lines.join("\n");
}

function formatDiagnostics(severity?: DiagnosticSeverity): string {
  const report = getDiagnosticReport({ severity, unresolvedOnly: true });
  const lines: string[] = [
    "Diagnostic Report",
    "=".repeat(40),
    `Health Score: ${report.summary.healthScore}/100`,
    `Total entries: ${report.summary.total}`,
    `Unresolved: ${report.summary.unresolved}`,
    "",
    "By Severity:",
    `  Critical: ${report.summary.bySeverity.critical}`,
    `  Error:    ${report.summary.bySeverity.error}`,
    `  Warning:  ${report.summary.bySeverity.warning}`,
    `  Info:     ${report.summary.bySeverity.info}`,
  ];

  if (report.entries.length > 0) {
    lines.push("");
    lines.push("Recent Unresolved Issues:");
    for (const entry of report.entries.slice(0, 10)) {
      const icon = entry.severity === "critical" ? "!!" : entry.severity === "error" ? "! " : entry.severity === "warning" ? "W " : "i ";
      lines.push(`  [${icon}] ${entry.title}`);
      lines.push(`      ${entry.message}`);
    }
  }

  return lines.join("\n");
}

async function formatHealthChecks(): Promise<string> {
  const checks = await runHealthChecks();
  const lines: string[] = [
    "Health Checks",
    "=".repeat(40),
  ];

  for (const check of checks) {
    const icon = check.status === "pass" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
    const msg = check.message ? ` - ${check.message}` : "";
    const time = check.durationMs ? ` (${check.durationMs}ms)` : "";
    lines.push(`  [${icon}] ${check.name}${msg}${time}`);
  }

  const allPassed = checks.every((c) => c.status === "pass");
  lines.push("");
  lines.push(allPassed ? "All checks passed." : "Some checks need attention.");

  return lines.join("\n");
}

function formatPrefetchStats(): string {
  const stats = getPrefetchStats();
  const lines: string[] = [
    "Prefetch Cache Stats",
    "=".repeat(40),
    `Cached skills: ${stats.totalCached}`,
    `Cache size: ${(stats.totalSizeBytes / 1024).toFixed(1)} KB`,
    `Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`,
  ];

  if (stats.newestEntry > 0) {
    const age = Date.now() - stats.newestEntry;
    const mins = Math.floor(age / 60000);
    lines.push(`Newest entry: ${mins}m ago`);
  }

  return lines.join("\n");
}

function formatDxtPackages(): string {
  const packages = listInstalledDxtPackages();
  if (packages.length === 0) {
    return "No DXT packages installed.";
  }

  const lines: string[] = [
    "Installed DXT Packages",
    "=".repeat(40),
  ];

  for (const pkg of packages) {
    const status = pkg.isEnabled ? "enabled" : "disabled";
    lines.push(`  ${pkg.manifest.name}@${pkg.manifest.version} [${status}]`);
    lines.push(`    ${pkg.manifest.description}`);
  }

  const enabledSkills = getEnabledSkills();
  const enabledCommands = getEnabledCommands();

  if (enabledSkills.length > 0) {
    lines.push("");
    lines.push(`Skills from packages: ${enabledSkills.join(", ")}`);
  }
  if (enabledCommands.length > 0) {
    lines.push(`Commands from packages: ${enabledCommands.map((c) => c.name).join(", ")}`);
  }

  return lines.join("\n");
}

export const skillsCommandEnhanced = {
  name: "skills",
  aliases: ["skill"],
  description: "List, search, and manage skills with diagnostics",
  usage: "/skills [list|search|info|diagnostics|health|prefetch|dxt|sources] [args...]",
  category: "mcp" as const,

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const action = args[0]?.toLowerCase() ?? "list";

    switch (action) {
      case "list":
      case "ls": {
        const showDetails = args.includes("--details") || args.includes("-d");
        const skills = listAllSkills().map(toExtendedSkillDefinition);
        return {
          success: true,
          message: formatSkillList(skills, showDetails),
        };
      }

      case "search": {
        const query = args.slice(1).join(" ").trim();
        if (!query) {
          return { success: false, message: "Search query required: /skills search <query>" };
        }
        const results = await searchLocalSkills(query, { limit: 20 });
        return { success: true, message: formatSearchResults(query, results) };
      }

      case "info": {
        const skillName = args[1];
        if (!skillName) {
          return { success: false, message: "Skill name required: /skills info <name>" };
        }
        const exact = await findExactSkill(skillName);
        if (!exact) {
          return { success: false, message: `Skill not found: ${skillName}` };
        }
        recordSkillUsage(skillName);
        const skill = exact.entry;
        const lines: string[] = [
          skill.name,
          "=".repeat(skill.name.length),
          skill.description,
          "",
          `source: ${skill.source}`,
          `path: ${skill.path}`,
        ];
        if (Object.keys(skill.frontmatter).length > 0) {
          lines.push("");
          lines.push("Metadata:");
          for (const [key, value] of Object.entries(skill.frontmatter)) {
            lines.push(`  ${key}: ${value}`);
          }
        }
        return { success: true, message: lines.join("\n") };
      }

      case "diagnostics":
      case "diag": {
        const severity = args[1] as DiagnosticSeverity | undefined;
        return { success: true, message: formatDiagnostics(severity) };
      }

      case "health": {
        return { success: true, message: await formatHealthChecks() };
      }

      case "prefetch": {
        const subAction = args[1]?.toLowerCase() ?? "stats";
        switch (subAction) {
          case "stats":
            return { success: true, message: formatPrefetchStats() };
          case "warm":
          case "warmup": {
            const skillNames = args.slice(2);
            if (skillNames.length === 0) {
              await prefetchSkills();
              return { success: true, message: "All skills prefetched." };
            }
            await warmupSkills(skillNames);
            return { success: true, message: `Warmed ${skillNames.length} skill(s).` };
          }
          case "clear":
            clearPrefetchCache();
            return { success: true, message: "Prefetch cache cleared." };
          default:
            return { success: false, message: "Usage: /skills prefetch [stats|warmup <names>|clear]" };
        }
      }

      case "dxt": {
        return { success: true, message: formatDxtPackages() };
      }

      case "sources": {
        const summary = summarizeVendoredEverythingAssets();
        const lines = [
          "Skill sources",
          "--------------------",
          `vendored root: ${summary.root}`,
          ...summary.skillRoots.map((root) => `skill root: ${root}`),
          ...summary.pluginRoots.map((root) => `plugin root: ${root}`),
          ...summary.hookRoots.map((root) => `hook root: ${root}`),
          ...summary.manifestPaths.map((file) => `manifest: ${file}`),
          ...summary.mcpConfigPaths.map((file) => `mcp config: ${file}`),
        ];
        return { success: true, message: lines.join("\n") };
      }

      default:
        return {
          success: false,
          message: `Unknown action: ${action}\nUsage: /skills [list|search|info|diagnostics|health|prefetch|dxt|sources]`,
        };
    }
  },
};

export default {
  skillsCommandEnhanced,
};
