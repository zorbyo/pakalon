/**
 * Plugin Hook Loader
 *
 * Loads hook configuration from plugin directories and registers it with the
 * existing hook manager.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { HookManager } from '../hooks/HookManager.js'
import type { HookConfig, HookEvent, HookMatcher, HookResult } from '../hooks/types.js'
import type { PluginManifest } from './types.js'

export type PluginHook = HookMatcher & {
  pluginName: string
  pluginId: string
  sourcePath: string
}

type LoadedHookRecord = {
  hook: PluginHook
  event: HookEvent
}

const loadedHooksByPlugin = new Map<string, LoadedHookRecord[]>()

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function normalizeEvent(name: string): HookEvent | null {
  const events: HookEvent[] = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'SessionStart', 'SessionEnd', 'Stop']
  const found = events.find(event => event.toLowerCase() === name.toLowerCase())
  return found ?? null
}

function normalizeHookMatcher(matcher: unknown): HookMatcher | null {
  if (typeof matcher !== 'object' || matcher === null) return null
  const record = matcher as Record<string, unknown>

  const hooks = Array.isArray(record.hooks)
    ? record.hooks.filter(hook => typeof hook === 'object' && hook !== null).map(hook => hook as HookMatcher['hooks'])
    : []

  if (!hooks.length) return null

  return {
    event: 'PreToolUse',
    matchers: Array.isArray(record.matchers) ? record.matchers as HookMatcher['matchers'] : [],
    hooks: hooks as HookMatcher['hooks'],
    description: typeof record.description === 'string' ? record.description : undefined,
  }
}

async function loadJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function pluginIdFromManifest(manifest: PluginManifest): string {
  return manifest.version ? `${manifest.name}@${manifest.version}` : manifest.name
}

async function loadHooksFile(filePath: string, pluginName: string, pluginId: string): Promise<PluginHook[]> {
  const data = await loadJson(filePath)
  if (!data || typeof data !== 'object') return []

  const config = data as Partial<Record<HookEvent, Array<HookMatcher | Record<string, unknown>>>>
  const hooks: PluginHook[] = []

  for (const [eventName, matchers] of Object.entries(config)) {
    const event = normalizeEvent(eventName)
    if (!event) continue

    for (const matcher of asArray(matchers)) {
      if (typeof matcher !== 'object' || matcher === null) continue
      const record = matcher as Record<string, unknown>
      const hookDefs = Array.isArray(record.hooks) ? record.hooks : []

      for (const hookDef of hookDefs) {
        if (typeof hookDef !== 'object' || hookDef === null) continue
        const hookRecord = hookDef as Record<string, unknown>
        const hook: PluginHook = {
          pluginName,
          pluginId,
          sourcePath: filePath,
          event,
          matchers: Array.isArray(record.matchers) ? record.matchers as HookMatcher['matchers'] : [],
          hooks: [
            {
              id: typeof hookRecord.id === 'string' ? hookRecord.id : `${pluginName}:${event}:${hooks.length}`,
              type: hookRecord.type === 'function' ? 'function' : 'command',
              command: typeof hookRecord.command === 'string' ? hookRecord.command : undefined,
              function: typeof hookRecord.function === 'string' ? hookRecord.function : undefined,
              async: typeof hookRecord.async === 'boolean' ? hookRecord.async : undefined,
              timeout: typeof hookRecord.timeout === 'number' ? hookRecord.timeout : undefined,
              description: typeof hookRecord.description === 'string' ? hookRecord.description : undefined,
            },
          ],
          description: typeof record.description === 'string' ? record.description : undefined,
        }
        hooks.push(hook)
      }
    }
  }

  return hooks
}

async function loadHooksDirectory(dirPath: string, pluginName: string, pluginId: string): Promise<PluginHook[]> {
  const hooks: PluginHook[] = []
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      hooks.push(...await loadHooksDirectory(fullPath, pluginName, pluginId))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      hooks.push(...await loadHooksFile(fullPath, pluginName, pluginId))
    }
  }

  return hooks
}

export async function loadPluginHooks(pluginDir: string, pluginManifest?: PluginManifest): Promise<PluginHook[]> {
  const manifest = pluginManifest ?? { name: path.basename(pluginDir) }
  const pluginName = manifest.name
  const pluginId = pluginIdFromManifest(manifest)
  const hooksDir = path.join(pluginDir, 'hooks')
  const hooksPath = path.join(hooksDir, 'hooks.json')

  const directHooks = await loadJson(hooksPath)
  if (directHooks) {
    const loaded = await loadHooksFile(hooksPath, pluginName, pluginId)
    if (loaded.length) return loaded
  }

  const stats = await fs.stat(hooksDir).catch(() => null)
  if (stats?.isDirectory()) {
    return loadHooksDirectory(hooksDir, pluginName, pluginId)
  }

  return []
}

export function registerPluginHooks(hooks: PluginHook[]): void {
  const manager = new HookManager()
  const byEvent = new Map<HookEvent, HookMatcher[]>()

  for (const hook of hooks) {
    const matchers = byEvent.get(hook.event) ?? []
    matchers.push({
      event: hook.event,
      matchers: hook.matchers,
      hooks: hook.hooks,
      description: hook.description,
    })
    byEvent.set(hook.event, matchers)
  }

  for (const [event, matchers] of byEvent) {
    manager.updateConfig({
      hooks: {
        [event]: matchers,
      },
    } as Partial<HookConfig>)
  }

  for (const hook of hooks) {
    const list = loadedHooksByPlugin.get(hook.pluginName) ?? []
    list.push({ hook, event: hook.event })
    loadedHooksByPlugin.set(hook.pluginName, list)
  }
}

export function unregisterPluginHooks(pluginName: string): void {
  loadedHooksByPlugin.delete(pluginName)
}

export function validateHookDefinition(hook: PluginHook): string | null {
  if (!hook.hooks.length) return 'hook has no handlers'
  for (const def of hook.hooks) {
    if (def.type === 'command' && !def.command) return `hook ${def.event} missing command`
    if (def.type === 'function' && !def.function) return `hook ${def.event} missing function`
  }
  return null
}

export async function executePluginHook(pluginName: string, event: HookEvent, payload: unknown): Promise<HookResult[]> {
  const records = loadedHooksByPlugin.get(pluginName) ?? []
  const results: HookResult[] = []
  const manager = new HookManager()

  for (const { hook } of records) {
    if (hook.event !== event) continue
    for (const def of hook.hooks) {
      results.push(await manager['executeHook'](def as never, {
        event,
        input: { tool_name: 'Bash', tool_input: { content: JSON.stringify(payload) } },
        context: {
          hookProfile: 'standard',
          disabledHooks: new Set(),
        },
        startTime: Date.now(),
      } as never))
    }
  }

  return results
}
