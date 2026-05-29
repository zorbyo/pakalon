import logger from "@/utils/logger.js";
import {
  bundledComponentRegistry,
  createEmptyComponentRegistry,
  CURATED_COMPONENT_SOURCES,
  ensureComponentRegistryDir,
  getComponentRegistryPath,
  readComponentRegistry,
  upsertComponents,
  writeComponentRegistry,
  type ComponentEntry,
  type ComponentRegistry,
} from "./component-registry.js";
import { scrapeComponents, type ScrapeCandidate } from "./component-scraper.js";

export interface RegistryBuildResult {
  registry: ComponentRegistry;
  path: string;
  added: number;
  updated: number;
}

export function initializeComponentRegistry(projectDir: string = process.cwd()): ComponentRegistry {
  ensureComponentRegistryDir(projectDir);
  const existing = readComponentRegistry(projectDir);
  if (existing.components.length > 0) return existing;

  const seeded = {
    ...bundledComponentRegistry,
    updatedAt: new Date().toISOString(),
  } satisfies ComponentRegistry;

  writeComponentRegistry(seeded, projectDir);
  return seeded;
}

export function loadComponentRegistry(projectDir: string = process.cwd()): ComponentRegistry {
  return initializeComponentRegistry(projectDir);
}

export function saveComponentRegistry(registry: ComponentRegistry, projectDir: string = process.cwd()): string {
  return writeComponentRegistry(registry, projectDir);
}

export function addComponentsToRegistry(projectDir: string, components: ComponentEntry[]): RegistryBuildResult {
  const current = loadComponentRegistry(projectDir);
  const next = upsertComponents(current, components);
  const existingIds = new Set(current.components.map((component) => component.id));
  const added = components.filter((component) => !existingIds.has(component.id)).length;
  const updated = components.length - added;
  const path = writeComponentRegistry(next, projectDir);
  return { registry: next, path, added, updated };
}

export async function scrapeAndAddComponents(projectDir: string, candidates: ScrapeCandidate[]): Promise<RegistryBuildResult> {
  const drafts = await scrapeComponents(candidates);
  const components: ComponentEntry[] = drafts.map((draft) => ({
    id: `${draft.framework}-${draft.category}-${draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    name: draft.title,
    description: draft.description,
    category: draft.category,
    framework: draft.framework,
    tags: draft.tags,
    sourceUrl: draft.url,
    code: draft.code,
    complexity: draft.complexity,
    dependencies: draft.dependencies,
  }));

  logger.info(`[rag] Scraped ${components.length} components from curated sources`);
  return addComponentsToRegistry(projectDir, components);
}

export function createBundledRegistry(projectDir: string = process.cwd()): RegistryBuildResult {
  const registry = initializeComponentRegistry(projectDir);
  const registryPath = getComponentRegistryPath(projectDir);
  return { registry, path: registryPath, added: registry.components.length, updated: 0 };
}

export function clearAndSeedRegistry(projectDir: string = process.cwd()): RegistryBuildResult {
  const registry = {
    ...createEmptyComponentRegistry(),
    components: bundledComponentRegistry.components,
    updatedAt: new Date().toISOString(),
  } satisfies ComponentRegistry;
  const registryPath = writeComponentRegistry(registry, projectDir);
  return { registry, path: registryPath, added: registry.components.length, updated: 0 };
}

export function buildCuratedScrapeCandidates(): ScrapeCandidate[] {
  return CURATED_COMPONENT_SOURCES.map((url) => ({
    url,
    tags: [new URL(url).hostname.replace(/^www\./, "")],
  }));
}
