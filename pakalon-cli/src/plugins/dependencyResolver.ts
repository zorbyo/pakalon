/**
 * Plugin dependency resolution.
 */

import type { DependencyRef, Plugin } from './types.js'

export type DependencyGraph = Map<string, Set<string>>

export class DependencyError extends Error {
  constructor(
    message: string,
    public readonly pluginName: string,
    public readonly dependency?: string,
  ) {
    super(message)
    this.name = 'DependencyError'
  }
}

function depsOf(plugin: Plugin): string[] {
  return (plugin.manifest.dependencies ?? []).map((dep: DependencyRef) => dep.name)
}

export function validateDependencyGraph(plugins: Plugin[]): DependencyGraph {
  const graph: DependencyGraph = new Map()
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const byName = new Map(plugins.map(plugin => [plugin.manifest.name, plugin] as const))

  const visit = (name: string, stack: string[]): void => {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      const cycle = [...stack, name].join(' -> ')
      throw new DependencyError(`Dependency cycle detected: ${cycle}`, name)
    }

    visiting.add(name)
    const plugin = byName.get(name)
    const deps = new Set<string>(plugin ? depsOf(plugin) : [])
    graph.set(name, deps)

    for (const dep of deps) {
      if (byName.has(dep)) visit(dep, [...stack, name])
    }

    visiting.delete(name)
    visited.add(name)
  }

  for (const plugin of plugins) visit(plugin.manifest.name, [])
  return graph
}

export function checkDependencyConflicts(
  pluginName: string,
  deps: DependencyRef[] | undefined,
  installed: Plugin[],
): DependencyError[] {
  const installedNames = new Set(installed.filter(p => p.status !== 'disabled').map(p => p.manifest.name))
  const errors: DependencyError[] = []

  for (const dep of deps ?? []) {
    if (!installedNames.has(dep.name)) {
      errors.push(new DependencyError(`Missing dependency ${dep.name}`, pluginName, dep.name))
    }
  }

  return errors
}

export function resolveDependencies(pluginName: string, allPlugins: Plugin[]): string[] {
  const graph = validateDependencyGraph(allPlugins)
  const resolved: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const walk = (name: string): void => {
    if (visited.has(name)) return
    if (visiting.has(name)) throw new DependencyError(`Dependency cycle detected at ${name}`, name)
    visiting.add(name)

    for (const dep of graph.get(name) ?? []) {
      if (graph.has(dep)) walk(dep)
    }

    visiting.delete(name)
    visited.add(name)
    resolved.push(name)
  }

  walk(pluginName)
  return resolved
}
