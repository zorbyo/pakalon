import fs from "node:fs";
import path from "node:path";

import {
  discoverCommandCatalog,
  importCatalogCommands,
} from "@/commands/catalog.js";
import { importVendoredHooks } from "@/hooks/manager.js";
import { importVendoredMcpServers } from "@/mcp/manager.js";
import {
  getVendoredEverythingManifestPaths,
  getVendoredEverythingRoot,
} from "@/utils/claude-imports.js";
import {
  importVendoredSkills,
  listImportableVendoredSkills,
} from "@/skills/importer.js";

type ManifestModuleKind =
  | "rules"
  | "agents"
  | "commands"
  | "hooks"
  | "platform"
  | "skills"
  | "orchestration";

export interface VendoredManifestModule {
  id: string;
  kind: ManifestModuleKind;
  description: string;
  paths: string[];
  targets?: string[];
  dependencies?: string[];
  defaultInstall?: boolean;
  cost?: string;
  stability?: string;
}

export interface VendoredManifestComponent {
  id: string;
  family: string;
  description: string;
  modules: string[];
}

export interface VendoredManifestProfile {
  id: string;
  description: string;
  modules: string[];
}

export interface VendoredManifestCatalog {
  modules: VendoredManifestModule[];
  components: VendoredManifestComponent[];
  profiles: VendoredManifestProfile[];
  sourcePaths: string[];
}

export interface ManifestImportResult {
  importedModules: string[];
  importedCommands: string[];
  importedSkills: string[];
  importedHooks: string[];
  importedMcpServers: string[];
  copiedPaths: string[];
  skippedModules: string[];
  skippedPaths: string[];
  unsupportedModules: Array<{ id: string; reason: string }>;
  errors: Array<{ id: string; reason: string }>;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

export function loadVendoredManifestCatalog(): VendoredManifestCatalog {
  const manifestPaths = getVendoredEverythingManifestPaths();
  const modulesPath = manifestPaths.find((filePath) => filePath.endsWith("install-modules.json"));
  const componentsPath = manifestPaths.find((filePath) => filePath.endsWith("install-components.json"));
  const profilesPath = manifestPaths.find((filePath) => filePath.endsWith("install-profiles.json"));

  const modules = modulesPath
    ? readJsonFile<{ modules: VendoredManifestModule[] }>(modulesPath).modules
    : [];
  const components = componentsPath
    ? readJsonFile<{ components: VendoredManifestComponent[] }>(componentsPath).components
    : [];
  const profilesObject = profilesPath
    ? readJsonFile<{
      profiles: Record<string, { description: string; modules: string[] }>;
    }>(profilesPath).profiles
    : {};
  const profiles = Object.entries(profilesObject).map(([id, profile]) => ({
    id,
    description: profile.description,
    modules: profile.modules,
  }));

  return {
    modules,
    components,
    profiles,
    sourcePaths: manifestPaths,
  };
}

function normalizePrefix(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function commandMatchesModulePath(commandPath: string, modulePath: string): boolean {
  const relative = normalizePrefix(commandPath);
  const prefix = normalizePrefix(modulePath);

  if (!prefix) {
    return false;
  }

  if (prefix === "commands") {
    return relative.startsWith("commands/");
  }

  return relative === prefix || relative.startsWith(`${prefix}/`);
}

function copyVendoredPathIfMissing(
  relativePath: string,
  destinationRoot: string,
): { copied?: string; skipped?: string; error?: string } {
  const vendoredRoot = getVendoredEverythingRoot();
  const sourcePath = path.join(vendoredRoot, relativePath);
  const destinationPath = path.join(destinationRoot, relativePath);

  if (!fs.existsSync(sourcePath)) {
    return { error: `Vendored path not found: ${relativePath}` };
  }

  if (fs.existsSync(destinationPath)) {
    return { skipped: destinationPath };
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.cpSync(sourcePath, destinationPath, { recursive: true });
  return { copied: destinationPath };
}

export async function importVendoredManifestModules(options: {
  moduleIds: string[];
  scope?: "global" | "project";
  cwd?: string;
}): Promise<ManifestImportResult> {
  const catalog = loadVendoredManifestCatalog();
  const scope = options.scope ?? "project";
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const commandEntries = discoverCommandCatalog({ includeContent: true }).filter(
    (entry) => entry.source === "vendored",
  );
  const skillEntries = listImportableVendoredSkills();

  const result: ManifestImportResult = {
    importedModules: [],
    importedCommands: [],
    importedSkills: [],
    importedHooks: [],
    importedMcpServers: [],
    copiedPaths: [],
    skippedModules: [],
    skippedPaths: [],
    unsupportedModules: [],
    errors: [],
  };

  for (const moduleId of options.moduleIds) {
    const module = catalog.modules.find((entry) => entry.id === moduleId);
    if (!module) {
      result.errors.push({ id: moduleId, reason: "Module not found" });
      continue;
    }

    let touched = false;

    if (module.kind === "commands" || module.paths.some((modulePath) => normalizePrefix(modulePath).startsWith("commands"))) {
      const names = commandEntries
        .filter((entry) => {
          const relative = path.relative(getVendoredEverythingRoot(), entry.path).replace(/\\/g, "/");
          return module.paths.some((modulePath) => commandMatchesModulePath(relative, modulePath));
        })
        .map((entry) => entry.name);

      if (names.length > 0) {
        const importResult = await importCatalogCommands({ names, scope, cwd });
        result.importedCommands.push(...importResult.imported);
        if (importResult.imported.length > 0) touched = true;
        result.errors.push(...importResult.errors.map((error) => ({ id: `${module.id}:${error.name}`, reason: error.reason })));
      }
    }

    if (module.kind === "skills" || module.paths.some((modulePath) => normalizePrefix(modulePath).startsWith("skills/"))) {
      const names = skillEntries
        .filter((entry) => {
          const relative = path.relative(getVendoredEverythingRoot(), path.dirname(entry.path)).replace(/\\/g, "/");
          return module.paths.some((modulePath) => commandMatchesModulePath(relative, modulePath));
        })
        .map((entry) => entry.name);

      if (names.length > 0) {
        const importResult = await importVendoredSkills({ names, scope, cwd });
        result.importedSkills.push(...importResult.imported);
        if (importResult.imported.length > 0) touched = true;
        result.errors.push(...importResult.errors.map((error) => ({ id: `${module.id}:${error.name}`, reason: error.reason })));
      }
    }

    if (module.kind === "hooks" || module.paths.includes("hooks")) {
      const importResult = await importVendoredHooks({ scope, cwd });
      result.importedHooks.push(...importResult.imported);
      if (importResult.imported.length > 0) touched = true;
      result.errors.push(...importResult.errors.map((error) => ({ id: `${module.id}:${error.id}`, reason: error.reason })));
    }

    if (
      module.kind === "platform" ||
      module.paths.includes("mcp-configs") ||
      module.paths.includes(".mcp.json")
    ) {
      const importResult = await importVendoredMcpServers({ scope, cwd });
      result.importedMcpServers.push(...importResult.imported);
      if (importResult.imported.length > 0) touched = true;
      result.errors.push(...importResult.errors.map((error) => ({ id: `${module.id}:${error.name}`, reason: error.reason })));
    }

    const rawCopyPaths = module.paths.filter((modulePath) =>
      !normalizePrefix(modulePath).startsWith("commands") &&
      !normalizePrefix(modulePath).startsWith("skills/") &&
      modulePath !== "hooks" &&
      modulePath !== ".mcp.json" &&
      modulePath !== "mcp-configs"
    );

    for (const rawPath of rawCopyPaths) {
      const copyResult = copyVendoredPathIfMissing(rawPath, cwd);
      if (copyResult.copied) {
        result.copiedPaths.push(copyResult.copied);
        touched = true;
      } else if (copyResult.skipped) {
        result.skippedPaths.push(copyResult.skipped);
      } else if (copyResult.error) {
        result.errors.push({ id: `${module.id}:${rawPath}`, reason: copyResult.error });
      }
    }

    if (touched) {
      result.importedModules.push(module.id);
    } else if (result.errors.every((error) => !error.id.startsWith(`${module.id}:`))) {
      result.skippedModules.push(module.id);
    }

    if (
      module.kind !== "commands" &&
      module.kind !== "skills" &&
      module.kind !== "hooks" &&
      module.kind !== "platform" &&
      module.kind !== "agents" &&
      module.kind !== "rules" &&
      module.kind !== "orchestration"
    ) {
      result.unsupportedModules.push({ id: module.id, reason: `Unsupported module kind: ${module.kind}` });
    }
  }

  result.importedCommands = [...new Set(result.importedCommands)].sort();
  result.importedSkills = [...new Set(result.importedSkills)].sort();
  result.importedHooks = [...new Set(result.importedHooks)].sort();
  result.importedMcpServers = [...new Set(result.importedMcpServers)].sort();
  result.copiedPaths = [...new Set(result.copiedPaths)].sort();
  result.skippedPaths = [...new Set(result.skippedPaths)].sort();
  result.importedModules = [...new Set(result.importedModules)].sort();
  result.skippedModules = [...new Set(result.skippedModules)].sort();

  return result;
}

export async function importVendoredManifestProfile(options: {
  profileId: string;
  scope?: "global" | "project";
  cwd?: string;
}): Promise<ManifestImportResult> {
  const catalog = loadVendoredManifestCatalog();
  const profile = catalog.profiles.find((entry) => entry.id === options.profileId);
  if (!profile) {
    return {
      importedModules: [],
      importedCommands: [],
      importedSkills: [],
      importedHooks: [],
      importedMcpServers: [],
      copiedPaths: [],
      skippedModules: [],
      skippedPaths: [],
      unsupportedModules: [],
      errors: [{ id: options.profileId, reason: "Profile not found" }],
    };
  }

  return importVendoredManifestModules({
    moduleIds: profile.modules,
    scope: options.scope,
    cwd: options.cwd,
  });
}
