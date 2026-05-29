/**
 * DXT (Distributed Extension) Module
 *
 * Handles discovery, loading, and management of DXT extension packages
 * for the Pakalon CLI plugin ecosystem.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import logger from "@/utils/logger.js";

export interface DxtManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  main?: string;
  skills?: string[];
  commands?: DxtCommand[];
  dependencies?: Record<string, string>;
  pakalonEngines?: Record<string, string>;
  capabilities?: DxtCapability[];
}

export interface DxtCommand {
  name: string;
  description: string;
  handler: string;
  permissions?: string[];
}

export type DxtCapability =
  | "filesystem"
  | "network"
  | "shell"
  | "skills"
  | "mcp"
  | "telemetry";

export interface DxtPackage {
  manifest: DxtManifest;
  installPath: string;
  isEnabled: boolean;
  installedAt: number;
  lastUpdated: number;
}

export interface DxtRegistryEntry {
  name: string;
  version: string;
  description: string;
  downloadUrl: string;
  checksum: string;
  size: number;
  publishedAt: string;
}

export interface DxtInstallOptions {
  installDir?: string;
  enableAfterInstall?: boolean;
  verifyChecksum?: boolean;
}

export interface DxtInstallResult {
  success: boolean;
  package: DxtPackage | null;
  error?: string;
}

const DXT_INSTALL_DIR = path.join(
  os.homedir(),
  ".config",
  "pakalon",
  "extensions",
);

const DXT_REGISTRY_PATH = path.join(DXT_INSTALL_DIR, "registry.json");

let installedPackages = new Map<string, DxtPackage>();

function loadRegistry(): void {
  try {
    if (fs.existsSync(DXT_REGISTRY_PATH)) {
      const raw = fs.readFileSync(DXT_REGISTRY_PATH, "utf-8");
      const data = JSON.parse(raw) as DxtPackage[];
      installedPackages = new Map(data.map((pkg) => [pkg.manifest.name, pkg]));
    }
  } catch {
    installedPackages = new Map();
  }
}

function saveRegistry(): void {
  try {
    if (!fs.existsSync(DXT_INSTALL_DIR)) {
      fs.mkdirSync(DXT_INSTALL_DIR, { recursive: true });
    }
    const data = Array.from(installedPackages.values());
    fs.writeFileSync(DXT_REGISTRY_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error("[dxt] failed to save registry", err);
  }
}

function parseManifest(manifestPath: string): DxtManifest | null {
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as DxtManifest;
  } catch {
    return null;
  }
}

export function getDxtInstallDir(): string {
  return DXT_INSTALL_DIR;
}

export function listInstalledDxtPackages(): DxtPackage[] {
  return Array.from(installedPackages.values());
}

export function getInstalledDxtPackage(name: string): DxtPackage | undefined {
  return installedPackages.get(name);
}

export function discoverDxtPackages(dir?: string): DxtPackage[] {
  const installDir = dir ?? DXT_INSTALL_DIR;
  const packages: DxtPackage[] = [];

  if (!fs.existsSync(installDir)) return packages;

  try {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(installDir, entry.name, "dxt.json");
      const manifest = parseManifest(manifestPath);
      if (!manifest) continue;

      const installed = installedPackages.get(manifest.name);
      packages.push({
        manifest,
        installPath: path.join(installDir, entry.name),
        isEnabled: installed?.isEnabled ?? true,
        installedAt: installed?.installedAt ?? 0,
        lastUpdated: installed?.lastUpdated ?? 0,
      });
    }
  } catch {
    // Directory not accessible
  }

  return packages;
}

export async function installDxtPackage(
  manifestPath: string,
  options?: DxtInstallOptions,
): Promise<DxtInstallResult> {
  const manifest = parseManifest(manifestPath);
  if (!manifest) {
    return {
      success: false,
      package: null,
      error: "Invalid or missing dxt.json manifest",
    };
  }

  const installDir = options?.installDir ?? DXT_INSTALL_DIR;
  const packageDir = path.join(installDir, manifest.name);

  try {
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }

    if (fs.existsSync(packageDir)) {
      return {
        success: false,
        package: null,
        error: `Package ${manifest.name} is already installed`,
      };
    }

    const sourceDir = path.dirname(manifestPath);
    copyDirectoryRecursive(sourceDir, packageDir);

    const pkg: DxtPackage = {
      manifest,
      installPath: packageDir,
      isEnabled: options?.enableAfterInstall ?? true,
      installedAt: Date.now(),
      lastUpdated: Date.now(),
    };

    installedPackages.set(manifest.name, pkg);
    saveRegistry();

    logger.info("[dxt] installed package", {
      name: manifest.name,
      version: manifest.version,
      path: packageDir,
    });

    return { success: true, package: pkg };
  } catch (err) {
    return {
      success: false,
      package: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function uninstallDxtPackage(name: string): boolean {
  const pkg = installedPackages.get(name);
  if (!pkg) return false;

  try {
    if (fs.existsSync(pkg.installPath)) {
      fs.rmSync(pkg.installPath, { recursive: true, force: true });
    }
    installedPackages.delete(name);
    saveRegistry();

    logger.info("[dxt] uninstalled package", { name });
    return true;
  } catch {
    return false;
  }
}

export function enableDxtPackage(name: string): boolean {
  const pkg = installedPackages.get(name);
  if (!pkg) return false;

  pkg.isEnabled = true;
  saveRegistry();
  logger.info("[dxt] enabled package", { name });
  return true;
}

export function disableDxtPackage(name: string): boolean {
  const pkg = installedPackages.get(name);
  if (!pkg) return false;

  pkg.isEnabled = false;
  saveRegistry();
  logger.info("[dxt] disabled package", { name });
  return true;
}

export function getEnabledSkills(): string[] {
  const skills: string[] = [];
  for (const pkg of installedPackages.values()) {
    if (pkg.isEnabled && pkg.manifest.skills) {
      skills.push(...pkg.manifest.skills);
    }
  }
  return [...new Set(skills)];
}

export function getEnabledCommands(): DxtCommand[] {
  const commands: DxtCommand[] = [];
  for (const pkg of installedPackages.values()) {
    if (pkg.isEnabled && pkg.manifest.commands) {
      commands.push(...pkg.manifest.commands);
    }
  }
  return commands;
}

function copyDirectoryRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export async function loadDxtModule(name: string): Promise<unknown | null> {
  const pkg = installedPackages.get(name);
  if (!pkg || !pkg.isEnabled) return null;

  const mainFile = pkg.manifest.main ?? "index.js";
  const modulePath = path.join(pkg.installPath, mainFile);

  if (!fs.existsSync(modulePath)) {
    logger.warn("[dxt] module file not found", { name, path: modulePath });
    return null;
  }

  try {
    const mod = await import(modulePath);
    logger.info("[dxt] loaded module", { name });
    return mod;
  } catch (err) {
    logger.error("[dxt] failed to load module", { name, error: err });
    return null;
  }
}

export async function initializeAllDxtModules(): Promise<Map<string, unknown>> {
  const modules = new Map<string, unknown>();
  const packages = discoverDxtPackages();

  for (const pkg of packages) {
    if (!pkg.isEnabled) continue;
    const mod = await loadDxtModule(pkg.manifest.name);
    if (mod) {
      modules.set(pkg.manifest.name, mod);
    }
  }

  return modules;
}

export function getDxtSummary(): {
  totalInstalled: number;
  totalEnabled: number;
  totalDisabled: number;
  packages: Array<{ name: string; version: string; enabled: boolean }>;
} {
  const packages = Array.from(installedPackages.values()).map((p) => ({
    name: p.manifest.name,
    version: p.manifest.version,
    enabled: p.isEnabled,
  }));

  return {
    totalInstalled: packages.length,
    totalEnabled: packages.filter((p) => p.enabled).length,
    totalDisabled: packages.filter((p) => !p.enabled).length,
    packages,
  };
}

loadRegistry();
