import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getAllSettings, setSetting, getSettingsSchema } from '@/settings/index.js';

const configTool = tool({
  description: 'Get or set configuration values. Use this tool to view or modify Pakalon settings.',
  inputSchema: z.object({
    action: z.enum(['get', 'set', 'list', 'reset']).describe('Action to perform'),
    key: z.string().optional().describe('Configuration key'),
    value: z.unknown().optional().describe('Value to set (for set action)'),
    scope: z.enum(['local', 'global']).optional().default('local').describe('Settings scope'),
  }),
  execute: async ({ arguments: args }) => {
    const { action, key, value, scope } = args;

    switch (action) {
      case 'get':
        if (!key) {
          return { success: false, error: 'key is required for get action' };
        }
        const setting = await getSetting(key as keyof typeof getAllSettings extends () => Promise<infer T> ? T : never);
        return { success: true, key, value: setting };

      case 'set':
        if (!key || value === undefined) {
          return { success: false, error: 'key and value are required for set action' };
        }
        await setSetting(key as keyof typeof getAllSettings extends () => Promise<infer T> ? T : never, value as never);
        return { success: true, key, value };

      case 'list':
        const settings = await getAllSettings();
        const schema = getSettingsSchema();
        return {
          success: true,
          settings,
          schema,
          scope,
        };

      case 'reset':
        await import('@/settings/index.js').then((m) => m.resetSettings?.() || {});
        return { success: true, message: 'Settings reset to defaults' };

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
});

export async function getSetting(key: string): Promise<unknown> {
  const settings = await getAllSettings();
  return (settings as Record<string, unknown>)[key];
}

export { configTool };

export const configTools = {
  config: configTool,
};