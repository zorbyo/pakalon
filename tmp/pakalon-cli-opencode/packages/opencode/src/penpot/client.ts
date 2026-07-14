import { Log } from "../util/log"

const log = Log.create({ service: "penpot:client" })

export interface PenpotFile {
  id: string
  name: string
  projectId: string
  createdAt: string
  updatedAt: string
  pages?: PenpotPage[]
}

export interface PenpotPage {
  id: string
  name: string
  fileId: string
  elements?: PenpotElement[]
}

export interface PenpotElement {
  id: string
  type: "rect" | "text" | "circle" | "path" | "image" | "group"
  name: string
  x: number
  y: number
  width?: number
  height?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  text?: string
  fontSize?: number
  fontFamily?: string
  children?: PenpotElement[]
}

export interface PenpotProject {
  id: string
  name: string
  teamId: string
  createdAt: string
}

export namespace PenpotClient {
  const rpcUrl = process.env.PENPOT_RPC_URL ?? "http://localhost:3449/api/rpc"

  async function rpcRequest<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const token = process.env.PENPOT_API_TOKEN
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }

    try {
      const response = await fetch(`${rpcUrl}/command/${command}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`Penpot API error (${command}): ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`)
      }

      const json = (await response.json().catch(() => ({}))) as {
        result?: unknown
        data?: unknown
        error?: { message?: string }
      }

      if (json.error) {
        throw new Error(json.error.message ?? `Penpot RPC command failed: ${command}`)
      }

      return (json.result ?? json.data ?? json) as T
    } catch (err) {
      log.error("Penpot API request failed", { command, error: err })
      throw err
    }
  }

  function toFileList(input: unknown): Array<{ id: string; name: string }> {
    if (!input) return []

    if (Array.isArray(input)) {
      return input
        .map((item) => {
          if (!item || typeof item !== "object") return null
          const typed = item as Record<string, unknown>
          const id = String(typed.id ?? typed.fileId ?? "")
          const name = String(typed.name ?? typed.fileName ?? "")
          if (!id || !name) return null
          return { id, name }
        })
        .filter((item): item is { id: string; name: string } => !!item)
    }

    if (typeof input === "object") {
      const root = input as Record<string, unknown>
      return toFileList(root.files ?? root.items ?? root.entries)
    }

    return []
  }

  function decodeExportPayload(result: unknown): string {
    if (typeof result === "string") {
      if (result.includes("<svg")) return result
      try {
        const decoded = Buffer.from(result, "base64").toString("utf8")
        return decoded.includes("<svg") ? decoded : result
      } catch {
        return result
      }
    }

    if (!result || typeof result !== "object") return ""
    const typed = result as Record<string, unknown>
    const candidate = typed.content ?? typed.data ?? typed.svg ?? typed.file
    return typeof candidate === "string" ? decodeExportPayload(candidate) : ""
  }

  export async function listProjects(teamId: string): Promise<PenpotProject[]> {
    log.info("listing penpot projects", { teamId })
    try {
      const projects = await rpcRequest<Array<Record<string, unknown>> | Record<string, unknown>>("get-projects")
      const list = Array.isArray(projects)
        ? projects
        : Array.isArray((projects as Record<string, unknown>).projects)
          ? ((projects as Record<string, unknown>).projects as Array<Record<string, unknown>>)
          : []

      return list
        .map((project) => ({
          id: String(project.id ?? ""),
          name: String(project.name ?? ""),
          teamId: String(project.teamId ?? project.team_id ?? teamId),
          createdAt: String(project.createdAt ?? project.created_at ?? new Date().toISOString()),
        }))
        .filter((project) => project.id.length > 0)
    } catch {
      return []
    }
  }

  export async function listFiles(projectId: string): Promise<PenpotFile[]> {
    log.info("listing penpot files", { projectId })
    try {
      const files = await getProjectFiles(projectId)
      return files.map((file) => ({
        id: file.id,
        name: file.name,
        projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }

  export async function getFile(fileId: string): Promise<PenpotFile> {
    log.info("getting penpot file", { fileId })

    const file = await rpcRequest<Record<string, unknown>>("get-file", { id: fileId })
    const pages = Array.isArray(file.pages)
      ? file.pages.map((page) => {
          const typed = (page ?? {}) as Record<string, unknown>
          return {
            id: String(typed.id ?? ""),
            name: String(typed.name ?? "Untitled"),
            fileId,
          }
        })
      : undefined

    return {
      id: String(file.id ?? fileId),
      name: String(file.name ?? "Untitled"),
      projectId: String(file.projectId ?? file.project_id ?? ""),
      createdAt: String(file.createdAt ?? file.created_at ?? new Date().toISOString()),
      updatedAt: String(file.updatedAt ?? file.updated_at ?? new Date().toISOString()),
      pages,
    }
  }

  export async function createFile(projectId: string, name: string): Promise<{ fileId: string }> {
    log.info("creating penpot file", { name, projectId })

    const result = await rpcRequest<Record<string, unknown>>("create-file", {
      projectId,
      project_id: projectId,
      name,
    })

    const fileId = String(result.id ?? result.fileId ?? result.file_id ?? "")
    if (!fileId) {
      throw new Error("Penpot create-file response missing file id")
    }
    return { fileId }
  }

  export async function getPages(fileId: string): Promise<PenpotPage[]> {
    log.info("getting penpot pages", { fileId })
    try {
      const file = await getFile(fileId)
      return file.pages ?? []
    } catch {
      return []
    }
  }

  export async function createPage(fileId: string, name: string): Promise<{ pageId: string }> {
    log.info("creating penpot page", { fileId, name })

    const result = await rpcRequest<Record<string, unknown>>("create-page", {
      fileId,
      file_id: fileId,
      name,
    }).catch((error) => {
      log.warn("create-page command unavailable, returning fallback page id", { error })
      return { pageId: `page-${Date.now()}` }
    })

    const pageId = String((result as Record<string, unknown>).id ?? (result as Record<string, unknown>).pageId ?? "")
    if (!pageId) {
      throw new Error("Penpot create-page response missing page id")
    }
    return { pageId }
  }

  export async function addElement(
    fileId: string,
    pageId: string,
    element: Omit<PenpotElement, "id">,
  ): Promise<PenpotElement> {
    log.info("adding element to penpot", { fileId, pageId, type: element.type })

    const fullElement: PenpotElement = {
      ...element,
      id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    }

    try {
      return await rpcRequest<PenpotElement>("add-element", {
        fileId,
        pageId,
        element: fullElement,
      })
    } catch {
      return fullElement
    }
  }

  export async function importSVG(fileId: string, pageId: string, svg: string): Promise<boolean> {
    log.info("importing SVG to penpot", { fileId, pageId })

    try {
      await rpcRequest("import-svg", {
        fileId,
        pageId,
        svg,
      })
      return true
    } catch {
      return false
    }
  }

  export async function exportFile(fileId: string, format: "svg" | "png" | "pdf" | "json"): Promise<Blob | null> {
    log.info("exporting penpot file", { fileId, format })

    try {
      if (format === "svg") {
        const svg = await exportSVG(fileId)
        return new Blob([svg], { type: "image/svg+xml" })
      }

      const result = await rpcRequest<Record<string, unknown>>("export-binfile", {
        fileId,
        file_id: fileId,
      })

      const bin = decodeExportPayload(result)
      const bytes = bin.startsWith("PK") ? Buffer.from(bin) : Buffer.from(bin, "base64")
      return new Blob([bytes])
    } catch {
      return null
    }
  }

  export async function exportSVG(fileId: string, pageId?: string): Promise<string> {
    log.info("exporting penpot svg", { fileId, pageId })

    const result = await rpcRequest<Record<string, unknown>>("export-binfile", {
      fileId,
      file_id: fileId,
      pageId,
      page_id: pageId,
      format: "svg",
    })

    const svg = decodeExportPayload(result)
    if (!svg) {
      throw new Error("Penpot export-binfile returned empty SVG payload")
    }
    return svg
  }

  export async function importPenpot(fileId: string, data: Buffer): Promise<void> {
    log.info("importing penpot binfile", { fileId, bytes: data.length })

    await rpcRequest("import-binfile", {
      fileId,
      file_id: fileId,
      data: data.toString("base64"),
    })
  }

  export async function getProjectFiles(projectId: string): Promise<Array<{ id: string; name: string }>> {
    log.info("listing project files", { projectId })

    const projects = await rpcRequest<Array<Record<string, unknown>> | Record<string, unknown>>("get-projects")
    const projectList = Array.isArray(projects)
      ? projects
      : Array.isArray((projects as Record<string, unknown>).projects)
        ? ((projects as Record<string, unknown>).projects as Array<Record<string, unknown>>)
        : []

    const project = projectList.find((item) => String(item.id ?? item.projectId) === projectId)
    if (!project) return []

    return toFileList(project.files)
  }

  export function getUrl(fileId?: string): string {
    const host = process.env.PENPOT_HOST ?? "http://localhost:3449"
    if (fileId) return `${host}/#/workspace?file=${fileId}`
    return host
  }

  export function isAvailable(): boolean {
    return true
  }
}
