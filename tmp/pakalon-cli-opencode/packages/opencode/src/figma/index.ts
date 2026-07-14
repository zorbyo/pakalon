import { Log } from "../util/log"

const log = Log.create({ service: "figma" })

export interface FigmaFile {
  name: string
  lastModified: string
  version: string
  pages: FigmaPage[]
}

export interface FigmaPage {
  id: string
  name: string
  frames: FigmaFrame[]
}

export interface FigmaFrame {
  id: string
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  fills: string[]
  children: FigmaFrame[]
}

export namespace FigmaImport {
  export async function fetchFile(fileKey: string, token: string): Promise<FigmaFile | null> {
    log.info("fetching figma file", { fileKey })
    try {
      const resp = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
        headers: { "X-Figma-Token": token },
      })
      if (!resp.ok) {
        log.error("figma API error", { status: resp.status })
        return null
      }
      const data = await resp.json()
      return parseFigmaFile(data)
    } catch (err) {
      log.error("figma fetch failed", { error: err instanceof Error ? err.message : String(err) })
      return null
    }
  }

  function parseFigmaFile(data: any): FigmaFile {
    const pages: FigmaPage[] = []
    for (const page of data.document?.children ?? []) {
      const frames: FigmaFrame[] = []
      for (const frame of page.children ?? []) {
        frames.push(parseFrame(frame))
      }
      pages.push({ id: page.id, name: page.name, frames })
    }
    return {
      name: data.name,
      lastModified: data.lastModified,
      version: data.version,
      pages,
    }
  }

  function parseFrame(node: any): FigmaFrame {
    const fills: string[] = []
    for (const fill of node.fills ?? []) {
      if (fill.type === "SOLID" && fill.color) {
        const r = Math.round(fill.color.r * 255)
        const g = Math.round(fill.color.g * 255)
        const b = Math.round(fill.color.b * 255)
        fills.push(`rgb(${r},${g},${b})`)
      }
    }

    const children: FigmaFrame[] = []
    for (const child of node.children ?? []) {
      children.push(parseFrame(child))
    }

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      x: node.absoluteBoundingBox?.x ?? 0,
      y: node.absoluteBoundingBox?.y ?? 0,
      width: node.absoluteBoundingBox?.width ?? 0,
      height: node.absoluteBoundingBox?.height ?? 0,
      fills,
      children,
    }
  }

  export function toWireframeSVG(file: FigmaFile): string {
    const page = file.pages[0]
    if (!page) return ""

    const frames = page.frames
    const maxX = Math.max(...frames.map(f => f.x + f.width), 1200)
    const maxY = Math.max(...frames.map(f => f.y + f.height), 800)

    const elements: string[] = []
    for (const frame of frames) {
      elements.push(`  <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="${frame.fills[0] ?? '#f1f5f9'}" stroke="#cbd5e1" stroke-width="1" rx="8"/>`)
      elements.push(`  <text x="${frame.x + 10}" y="${frame.y + 24}" font-family="system-ui" font-size="14" fill="#334155">${frame.name}</text>`)
      for (const child of frame.children.slice(0, 10)) {
        elements.push(`  <rect x="${child.x}" y="${child.y}" width="${child.width}" height="${child.height}" fill="${child.fills[0] ?? '#e2e8f0'}" stroke="#94a3b8" stroke-width="1" rx="4"/>`)
        if (child.name) {
          elements.push(`  <text x="${child.x + 6}" y="${child.y + 18}" font-family="system-ui" font-size="12" fill="#64748b">${child.name}</text>`)
        }
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxX} ${maxY}" width="${maxX}" height="${maxY}">
  <style>
    rect { opacity: 0.95; }
    text { pointer-events: none; }
  </style>
  ${elements.join("\n  ")}
</svg>`
  }

  export function formatFileInfo(file: FigmaFile): string {
    return [
      `# Figma File: ${file.name}`,
      "",
      `**Last Modified:** ${file.lastModified}`,
      `**Version:** ${file.version}`,
      `**Pages:** ${file.pages.length}`,
      "",
      "## Pages",
      ...file.pages.map(p => `- **${p.name}**: ${p.frames.length} frames`),
    ].join("\n")
  }
}
