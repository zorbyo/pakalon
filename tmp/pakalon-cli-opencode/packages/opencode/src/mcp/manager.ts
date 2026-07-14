import os from "os"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { MCPCatalog } from "./catalog"

export interface MCPServerInfo {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled: boolean
  scope: "global" | "project"
  description?: string
  installedAt: string
}

export namespace MCPManager {
  const log = Log.create({ service: "mcp:manager" })

  type Scope = "global" | "project"
  type Data = { servers: MCPServerInfo[] }

  function now() {
    return new Date().toISOString()
  }

  function slug(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }

  async function read(scope: Scope): Promise<Data> {
    const p = getConfigPath(scope)
    const exists = await Filesystem.exists(p)
    if (!exists) return { servers: [] }
    const json = await Filesystem.readJson<unknown>(p).catch(() => ({}))
    if (Array.isArray(json)) return { servers: json as MCPServerInfo[] }
    if (typeof json !== "object" || json === null) return { servers: [] }
    const raw = (json as { servers?: unknown }).servers
    if (!Array.isArray(raw)) return { servers: [] }
    return { servers: raw as MCPServerInfo[] }
  }

  async function write(scope: Scope, data: Data) {
    const p = getConfigPath(scope)
    await Filesystem.writeJson(p, data)
  }

  function find(list: MCPServerInfo[], name: string) {
    const key = name.trim().toLowerCase()
    return list.findIndex((x) => x.name.toLowerCase() === key)
  }

  export function getConfigPath(scope: Scope) {
    if (scope === "global") return path.join(os.homedir(), ".pakalon", "mcp.json")
    return path.join(process.cwd(), ".pakalon", "mcp.json")
  }

  export async function addServer(
    name: string,
    command: string,
    args?: string[],
    env?: Record<string, string>,
    scope: Scope = "project",
  ) {
    const n = name.trim()
    const cmd = command.trim()
    if (!n) throw new Error("server name is required")
    if (!cmd) throw new Error("server command is required")
    const data = await read(scope)
    const i = find(data.servers, n)
    const item: MCPServerInfo = {
      name: n,
      command: cmd,
      args: args?.length ? args : undefined,
      env,
      enabled: true,
      scope,
      installedAt: now(),
    }
    if (i === -1) {
      data.servers.push(item)
      await write(scope, data)
      log.info("mcp server added", { name: n, scope })
      return item
    }
    const next = { ...data.servers[i], ...item, installedAt: data.servers[i].installedAt ?? now() }
    data.servers[i] = next
    await write(scope, data)
    log.info("mcp server updated", { name: n, scope })
    return next
  }

  export async function removeServer(name: string, scope: Scope) {
    const data = await read(scope)
    const i = find(data.servers, name)
    if (i === -1) return false
    data.servers.splice(i, 1)
    await write(scope, data)
    log.info("mcp server removed", { name, scope })
    return true
  }

  export async function listServers(scope?: Scope) {
    if (scope) return read(scope).then((x) => x.servers)
    const [g, p] = await Promise.all([read("global"), read("project")])
    return [...g.servers, ...p.servers]
  }

  async function set(name: string, enabled: boolean) {
    const scopes: Scope[] = ["project", "global"]
    for (const scope of scopes) {
      const data = await read(scope)
      const i = find(data.servers, name)
      if (i === -1) continue
      data.servers[i] = { ...data.servers[i], enabled }
      await write(scope, data)
      log.info("mcp server toggled", { name, scope, enabled })
      return data.servers[i]
    }
    return undefined
  }

  export function enableServer(name: string) {
    return set(name, true)
  }

  export function disableServer(name: string) {
    return set(name, false)
  }

  export async function installFromCatalog(url: string) {
    const q = url.trim()
    if (!q) throw new Error("catalog server url or name is required")

    const list = await MCPCatalog.fetchCatalog()
    const key = slug(q.split("/").pop() || q)
    const hit = list.find((x) => {
      const n = slug(x.name)
      if (n === key) return true
      if (x.installCommand && x.installCommand.toLowerCase().includes(q.toLowerCase())) return true
      return x.name.toLowerCase() === q.toLowerCase()
    })

    if (!hit) throw new Error(`catalog entry not found: ${q}`)

    return addServer(hit.name, hit.command, hit.args, undefined, "global")
  }

  export function formatServerList(servers: MCPServerInfo[]) {
    if (!servers.length) return "No MCP servers configured"
    return servers
      .map((x) => {
        const icon = x.enabled ? "✓" : "○"
        const argv = x.args?.length ? ` ${x.args.join(" ")}` : ""
        const desc = x.description ? `\n  ${x.description}` : ""
        return `${icon} ${x.name} [${x.scope}]\n  ${x.command}${argv}${desc}`
      })
      .join("\n")
  }
}
