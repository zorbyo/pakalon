import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Glob } from "../util/glob"
import path from "path"

const log = Log.create({ service: "plugin:manifest" })

export interface PluginManifest {
  name: string
  version: string
  description: string
  author?: string
  homepage?: string
  license?: string
  main?: string
  agents?: string[]
  skills?: string[]
  commands?: string[]
  hooks?: string[]
  rules?: string[]
  mcpServers?: string[]
  dependencies?: Record<string, string>
}

export interface InstalledPlugin {
  manifest: PluginManifest
  path: string
  enabled: boolean
  installedAt: number
}

export namespace PluginManifest {
  const PAKALON_PLUGIN_DIR = ".pakalon/plugins"

  export function validate(manifest: unknown): manifest is PluginManifest {
    if (typeof manifest !== "object" || manifest === null) return false
    const m = manifest as Record<string, unknown>
    return (
      typeof m.name === "string" &&
      typeof m.version === "string" &&
      typeof m.description === "string"
    )
  }

  export async function loadFromDir(dir: string): Promise<PluginManifest | null> {
    const manifestPath = path.join(dir, "plugin.json")
    try {
      const data = await Bun.file(manifestPath).json()
      if (!validate(data)) {
        log.warn("invalid plugin manifest", { path: manifestPath })
        return null
      }
      return data
    } catch {
      return null
    }
  }

  export async function discoverPlugins(scope: "global" | "project"): Promise<InstalledPlugin[]> {
    const baseDir = scope === "global"
      ? path.join(process.env.HOME ?? "", PAKALON_PLUGIN_DIR)
      : path.join(Instance.directory, PAKALON_PLUGIN_DIR)

    const plugins: InstalledPlugin[] = []
    const dirs = await Glob.scan("*/plugin.json", {
      cwd: baseDir,
      absolute: true,
      include: "file",
    }).catch(() => [])

    for (const manifestPath of dirs) {
      const dir = path.dirname(manifestPath)
      const manifest = await loadFromDir(dir)
      if (manifest) {
        plugins.push({
          manifest,
          path: dir,
          enabled: true,
          installedAt: Date.now(),
        })
      }
    }

    return plugins
  }

  export async function installPlugin(
    name: string,
    source: string,
    scope: "global" | "project" = "project",
  ): Promise<InstalledPlugin | null> {
    const baseDir = scope === "global"
      ? path.join(process.env.HOME ?? "", PAKALON_PLUGIN_DIR)
      : path.join(Instance.directory, PAKALON_PLUGIN_DIR)

    const pluginDir = path.join(baseDir, name)
    log.info("installing plugin", { name, source, scope, dest: pluginDir })

    // Clone or download the plugin
    try {
      const proc = Bun.spawnSync({
        cmd: ["git", "clone", "--depth", "1", source, pluginDir],
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60000,
      })

      if (proc.exitCode !== 0) {
        log.error("failed to clone plugin", { name, error: new TextDecoder().decode(proc.stderr) })
        return null
      }
    } catch (err) {
      log.error("plugin install failed", { name, error: err instanceof Error ? err.message : String(err) })
      return null
    }

    const manifest = await loadFromDir(pluginDir)
    if (!manifest) {
      log.error("plugin has no valid manifest", { name })
      return null
    }

    return {
      manifest,
      path: pluginDir,
      enabled: true,
      installedAt: Date.now(),
    }
  }

  export async function uninstallPlugin(name: string, scope: "global" | "project" = "project"): Promise<boolean> {
    const baseDir = scope === "global"
      ? path.join(process.env.HOME ?? "", PAKALON_PLUGIN_DIR)
      : path.join(Instance.directory, PAKALON_PLUGIN_DIR)

    const pluginDir = path.join(baseDir, name)
    try {
      await Bun.$`rm -rf ${pluginDir}`
      log.info("uninstalled plugin", { name })
      return true
    } catch {
      return false
    }
  }

  export function formatPluginList(plugins: InstalledPlugin[]): string {
    if (plugins.length === 0) return "No plugins installed."
    return [
      "## Installed Plugins",
      "",
      ...plugins.map(p => {
        const status = p.enabled ? "✅" : "❌"
        return `- ${status} **${p.manifest.name}** v${p.manifest.version} — ${p.manifest.description}`
      }),
    ].join("\n")
  }
}
