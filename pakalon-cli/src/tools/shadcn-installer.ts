import { execFileNoThrow } from '@/utils/execFileNoThrow.js';
import logger from '@/utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ShadcnRegistryEntry {
  name: string;
  category: string;
  description: string;
}

const COMPONENT_REGISTRY: ShadcnRegistryEntry[] = [
  { name: 'button', category: 'form', description: 'Button component' },
  { name: 'card', category: 'layout', description: 'Card component' },
  { name: 'dialog', category: 'overlay', description: 'Dialog/modal component' },
  { name: 'dropdown-menu', category: 'navigation', description: 'Dropdown menu component' },
  { name: 'input', category: 'form', description: 'Input field component' },
  { name: 'label', category: 'form', description: 'Label component' },
  { name: 'separator', category: 'layout', description: 'Separator component' },
  { name: 'sheet', category: 'overlay', description: 'Sheet component' },
  { name: 'tabs', category: 'navigation', description: 'Tabs component' },
  { name: 'toast', category: 'feedback', description: 'Toast notifications' },
];

export async function installComponent(componentName: string, projectDir: string): Promise<{ success: boolean; method: 'shadcn-cli' | 'ai-fallback'; message: string }> {
  const component = lookupComponent(componentName);
  const targetName = component?.name ?? componentName;

  const shadcn = await execFileNoThrow('npx', ['shadcn@latest', 'add', targetName], { cwd: projectDir });
  if (shadcn.code === 0) {
    logger.info(`[shadcn] Installed ${targetName} via CLI`);
    return { success: true, method: 'shadcn-cli', message: shadcn.stdout.trim() || `Installed ${targetName}` };
  }

  logger.warn(`[shadcn] CLI unavailable for ${targetName}, using AI fallback`);
  return {
    success: false,
    method: 'ai-fallback',
    message: `shadcn CLI unavailable for ${targetName}: ${shadcn.stderr || shadcn.stdout}`,
  };
}

export function lookupComponent(componentName: string): ShadcnRegistryEntry | undefined {
  const normalized = componentName.toLowerCase();
  return COMPONENT_REGISTRY.find(entry => entry.name === normalized || entry.name.replace(/-/g, '') === normalized.replace(/-/g, ''));
}

export function listAvailableComponents(): ShadcnRegistryEntry[] {
  return [...COMPONENT_REGISTRY];
}

export async function ensureShadcnConfig(projectDir: string): Promise<boolean> {
  const configPaths = ['components.json', 'components.ts', 'components.jsonc'];
  for (const config of configPaths) {
    try {
      await fs.access(path.join(projectDir, config));
      return true;
    } catch {}
  }
  return false;
}
