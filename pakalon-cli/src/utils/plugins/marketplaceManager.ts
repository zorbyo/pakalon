import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface MarketplacePluginEntry {
  id?: string;
  name?: string;
  source?: string | { type?: string; url?: string; path?: string };
  description?: string;
  [key: string]: unknown;
}

export interface MarketplacePluginData {
  marketplaceInstallLocation: string;
  entry: MarketplacePluginEntry;
}

function getMarketplaceRoots(): string[] {
  const roots = [
    path.join(os.homedir(), '.codex', 'plugins'),
    path.join(os.homedir(), '.pakalon', 'plugins'),
  ];
  const extraRoots = process.env.PAKALON_PLUGIN_MARKETPLACE_PATH
    ? process.env.PAKALON_PLUGIN_MARKETPLACE_PATH.split(path.delimiter)
    : [];
  return [...extraRoots, ...roots];
}

function readMarketplaceEntries(root: string): MarketplacePluginData[] {
  const manifestPath = path.join(root, 'marketplace.json');
  if (!fs.existsSync(manifestPath)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as unknown;
    const entries = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { plugins?: unknown }).plugins)
        ? (raw as { plugins: unknown[] }).plugins
        : [];

    return entries
      .filter((entry): entry is MarketplacePluginEntry => Boolean(entry) && typeof entry === 'object')
      .map((entry) => ({ marketplaceInstallLocation: root, entry }));
  } catch {
    return [];
  }
}

export async function getPluginById(pluginId: string): Promise<MarketplacePluginData | null> {
  for (const root of getMarketplaceRoots()) {
    for (const plugin of readMarketplaceEntries(root)) {
      if (plugin.entry.id === pluginId || plugin.entry.name === pluginId) {
        return plugin;
      }
    }
  }
  return null;
}
