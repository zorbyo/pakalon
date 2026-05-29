import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(THIS_DIR, "..", "..");
const VENDOR_ROOT = path.join(CLI_ROOT, "vendor");
const EVERYTHING_ROOT = path.join(VENDOR_ROOT, "everything-claude-code");

function existingPaths(paths: string[]): string[] {
  return paths.filter((candidate) => fs.existsSync(candidate));
}

export function getCliRoot(): string {
  return CLI_ROOT;
}

export function getVendoredEverythingRoot(): string {
  return EVERYTHING_ROOT;
}

export function getEmbeddedSkillRoots(): string[] {
  return existingPaths([
    path.join(CLI_ROOT, ".agents", "skills"),
    path.join(CLI_ROOT, ".claude", "skills"),
    path.join(CLI_ROOT, "src", "integrations", "skills", "skills"),
  ]);
}

export function getEmbeddedCommandRoots(): string[] {
  return existingPaths([
    path.join(CLI_ROOT, "src", "integrations", "commands", "commands"),
  ]);
}

export function getVendoredEverythingSkillRoots(): string[] {
  return existingPaths([
    path.join(EVERYTHING_ROOT, "skills"),
    path.join(EVERYTHING_ROOT, ".agents", "skills"),
    path.join(EVERYTHING_ROOT, ".claude", "skills"),
  ]);
}

export function getVendoredEverythingCommandRoots(): string[] {
  return existingPaths([path.join(EVERYTHING_ROOT, "commands")]);
}

export function getVendoredEverythingHookRoots(): string[] {
  return existingPaths([
    path.join(EVERYTHING_ROOT, "hooks"),
    path.join(EVERYTHING_ROOT, "scripts", "hooks"),
  ]);
}

export function getVendoredEverythingPluginRoots(): string[] {
  return existingPaths([path.join(EVERYTHING_ROOT, "plugins")]);
}

export function getVendoredEverythingManifestPaths(): string[] {
  return existingPaths([
    path.join(EVERYTHING_ROOT, "manifests", "install-components.json"),
    path.join(EVERYTHING_ROOT, "manifests", "install-modules.json"),
    path.join(EVERYTHING_ROOT, "manifests", "install-profiles.json"),
  ]);
}

export function getVendoredEverythingMcpConfigPaths(): string[] {
  return existingPaths([
    path.join(EVERYTHING_ROOT, ".mcp.json"),
    path.join(EVERYTHING_ROOT, "mcp-configs", "mcp-servers.json"),
  ]);
}

export function summarizeVendoredEverythingAssets() {
  return {
    root: EVERYTHING_ROOT,
    skillRoots: getVendoredEverythingSkillRoots(),
    commandRoots: getVendoredEverythingCommandRoots(),
    hookRoots: getVendoredEverythingHookRoots(),
    pluginRoots: getVendoredEverythingPluginRoots(),
    manifestPaths: getVendoredEverythingManifestPaths(),
    mcpConfigPaths: getVendoredEverythingMcpConfigPaths(),
  };
}
