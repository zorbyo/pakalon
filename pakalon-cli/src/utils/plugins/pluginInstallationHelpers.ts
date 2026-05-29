import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MarketplacePluginEntry } from './marketplaceManager.js';

function getUserPluginDir(pluginId: string): string {
  const baseDir = process.env.PAKALON_USER_PLUGIN_DIR ?? path.join(os.homedir(), '.pakalon', 'plugins', 'user');
  return path.join(baseDir, pluginId);
}

export async function cacheAndRegisterPlugin(
  pluginId: string,
  entry: MarketplacePluginEntry,
  scope: 'user' | 'project',
  projectPath?: string,
  localSourcePath?: string,
): Promise<string> {
  const destination = scope === 'project' && projectPath
    ? path.join(projectPath, '.pakalon', 'plugins', pluginId)
    : getUserPluginDir(pluginId);

  await fs.mkdir(destination, { recursive: true });

  if (localSourcePath) {
    await fs.cp(localSourcePath, destination, {
      recursive: true,
      force: true,
    });
  }

  const manifestPath = path.join(destination, 'pakalon.json');
  try {
    await fs.access(manifestPath);
  } catch {
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({ ...entry, id: entry.id ?? pluginId, installedScope: scope }, null, 2)}\n`,
      'utf-8',
    );
  }

  return destination;
}
