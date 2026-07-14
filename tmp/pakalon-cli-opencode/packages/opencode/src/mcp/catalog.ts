import { Log } from "../util/log"

export interface CatalogEntry {
  name: string
  description: string
  command: string
  args: string[]
  installCommand?: string
  category: string
}

export namespace MCPCatalog {
  const log = Log.create({ service: "mcp:catalog" })
  const url = "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md"

  function slug(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }

  function parseInstall(link: string, name: string): { command: string; args: string[]; installCommand?: string } {
    if (link.includes("npmjs.com/package/")) {
      const pkg = link.split("npmjs.com/package/")[1]?.split(/[?#]/)[0]
      if (pkg) {
        return {
          command: "npx",
          args: ["-y", pkg],
          installCommand: `npx -y ${pkg}`,
        }
      }
    }

    const id = slug(name)
    return {
      command: "npx",
      args: ["-y", `@modelcontextprotocol/server-${id}`],
      installCommand: `npx -y @modelcontextprotocol/server-${id}`,
    }
  }

  function parseRef(link: string, name: string) {
    if (!link.startsWith("src/")) return parseInstall(link, name)
    const id = link.split("src/")[1]?.split(/[/?#]/)[0]
    if (!id) return parseInstall(link, name)
    return {
      command: "npx",
      args: ["-y", `@modelcontextprotocol/server-${id}`],
      installCommand: `npx -y @modelcontextprotocol/server-${id}`,
    }
  }

  function parse(text: string): CatalogEntry[] {
    const lines = text.split("\n")
    const out: CatalogEntry[] = []
    let h2 = "general"
    let h3 = ""

    for (const line of lines) {
      const two = line.match(/^##\s+(.+)$/)
      if (two) {
        h2 = two[1].trim().replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim().toLowerCase()
        h3 = ""
        continue
      }

      const three = line.match(/^###\s+(.+)$/)
      if (three) {
        h3 = three[1]
          .trim()
          .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
          .trim()
          .toLowerCase()
        continue
      }

      const item = line.match(
        /^-\s+(?:<img[^>]*>\s*)?\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*[—–-]\s*(.+)$/,
      )
      if (!item) continue

      const name = item[1].trim()
      const link = item[2].trim()
      const description = item[3].trim()
      const tool = h2.includes("reference") ? parseRef(link, name) : parseInstall(link, name)
      const category = h3 || h2 || "general"
      out.push({
        name,
        description,
        command: tool.command,
        args: tool.args,
        installCommand: tool.installCommand,
        category,
      })
    }

    return out
  }

  export async function fetchCatalog() {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`failed to fetch MCP catalog: ${res.status}`)
    const text = await res.text()
    const list = parse(text)
    log.info("catalog fetched", { count: list.length })
    return list
  }

  export async function searchCatalog(query: string) {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const all = await fetchCatalog()
    return all.filter((x) => {
      return (
        x.name.toLowerCase().includes(q) ||
        x.description.toLowerCase().includes(q) ||
        x.category.toLowerCase().includes(q)
      )
    })
  }

  export async function getServerInfo(name: string) {
    const key = name.trim().toLowerCase()
    if (!key) return undefined
    const all = await fetchCatalog()
    return all.find((x) => x.name.toLowerCase() === key)
  }

  export function formatCatalogList(servers: CatalogEntry[]) {
    if (!servers.length) return "No catalog servers found"
    return servers
      .map((x) => {
        const run = x.installCommand ? `\n  run: ${x.installCommand}` : ""
        return `- ${x.name} [${x.category}]\n  ${x.description}${run}`
      })
      .join("\n")
  }
}
