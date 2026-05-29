/**
 * Penpot Export Tool - SVG/JSON/.penpot Export
 * 
 * Exports Penpot wireframes to multiple formats:
 * - SVG (primary format)
 * - JSON (for programmatic access)
 * - .penpot (native Penpot format)
 */

import { tool } from "ai";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import logger from "@/utils/logger.js";

export interface ExportOptions {
  format: "svg" | "json" | "penpot" | "all";
  outputDir: string;
  quality?: "low" | "medium" | "high";
  includeMetadata?: boolean;
}

export interface ExportResult {
  success: boolean;
  exportedFiles: string[];
  errors: string[];
}

export interface PenpotShape {
  id: string;
  type: "rect" | "circle" | "text" | "image" | "group" | "frame";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills?: string[];
  strokes?: string[];
  text?: string;
  children?: PenpotShape[];
  opacity?: number;
  rotation?: number;
}

export interface PenpotFrame {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: PenpotShape[];
}

export interface PenpotFile {
  id: string;
  name: string;
  projectId: string;
  pages: PenpotPage[];
  components?: Array<{ id: string; name: string; description?: string; reference?: string }>;
  styles?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  designTokens?: Record<string, unknown>;
}

export interface PenpotPage {
  id: string;
  name: string;
  frames: PenpotFrame[];
}

class PenpotExporter {
  private outputDir: string;
  private format: ExportOptions["format"];
  private quality: ExportOptions["quality"];
  private includeMetadata: boolean;

  constructor(options: ExportOptions) {
    this.outputDir = options.outputDir;
    this.format = options.format;
    this.quality = options.quality || "medium";
    this.includeMetadata = options.includeMetadata ?? true;
  }

  async exportFromPenpotJSON(penpotData: PenpotFile): Promise<ExportResult> {
    const exportedFiles: string[] = [];
    const errors: string[] = [];

    try {
      await fs.mkdir(this.outputDir, { recursive: true });

      if (this.format === "svg" || this.format === "all") {
        const svgFiles = await this.exportToSVG(penpotData);
        exportedFiles.push(...svgFiles);
      }

      if (this.format === "json" || this.format === "all") {
        const jsonFile = await this.exportToJSON(penpotData);
        exportedFiles.push(jsonFile);
      }

      if (this.format === "penpot" || this.format === "all") {
        const penpotFile = await this.exportToPenpotFormat(penpotData);
        exportedFiles.push(penpotFile);
      }

      if (this.format === "penpot" || this.format === "all") {
        const validation = await this.validatePenpotExport(penpotData);
        if (!validation.valid) {
          errors.push(...validation.errors);
        }
      }

      return { success: true, exportedFiles, errors };
    } catch (err) {
      return { success: false, exportedFiles, errors: [String(err)] };
    }
  }

  private async exportToSVG(penpotData: PenpotFile): Promise<string[]> {
    const svgFiles: string[] = [];

    for (const page of penpotData.pages) {
      for (const frame of page.frames) {
        const svg = this.frameToSVG(frame);
        const filename = `${this.sanitizeFilename(penpotData.name)}__${this.sanitizeFilename(page.name)}__${this.sanitizeFilename(frame.name)}.svg`;
        const filepath = path.join(this.outputDir, filename);

        await fs.writeFile(filepath, svg, "utf-8");
        svgFiles.push(filepath);
        logger.info(`[Penpot] Exported SVG: ${filepath}`);
      }
    }

    return svgFiles;
  }

  private frameToSVG(frame: PenpotFrame): string {
    const { width, height } = frame;
    let content = "";

    const sortedChildren = [...frame.children].sort((a, b) => {
      const zOrder: Record<string, number> = { frame: 0, group: 1, rect: 2, circle: 3, text: 4, image: 5 };
      return (zOrder[a.type] || 0) - (zOrder[b.type] || 0);
    });

    for (const shape of sortedChildren) {
      content += this.shapeToSVGElement(shape);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${this.escapeXML(frame.name)}</title>
  <desc>Exported from Pakalon</desc>
  <style>
    .shape { stroke-width: 1px; }
    .text { font-family: system-ui, sans-serif; }
  </style>
  <g id="frame-${this.escapeXML(frame.name)}">
    ${content}
  </g>
</svg>`;
  }

  private shapeToSVGElement(shape: PenpotShape): string {
    const { type, name, x, y, width, height, fills, strokes, text, opacity } = shape;

    const fill = fills?.[0] || "none";
    const stroke = strokes?.[0] || "none";
    const opacityAttr = opacity !== undefined ? ` opacity="${opacity}"` : "";
    const classAttr = ` class="shape${type === "text" ? " text" : ""}"`;

    switch (type) {
      case "rect":
        return `  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}"${opacityAttr}${classAttr}/>\n`;

      case "circle":
        const rx = width / 2;
        const ry = height / 2;
        return `  <ellipse cx="${x + rx}" cy="${y + ry}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}"${opacityAttr}${classAttr}/>\n`;

      case "text":
        const escapedText = this.escapeXML(text || "");
        const fontSize = Math.min(width, height) * 0.1;
        return `  <text x="${x}" y="${y + fontSize}" font-size="${fontSize}" fill="${fill}"${opacityAttr}${classAttr}>${escapedText}</text>\n`;

      case "image":
        return `  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ccc" stroke="${stroke}"${opacityAttr}${classAttr}/>\n`;

      case "frame":
        let frameContent = `  <g id="frame-${this.escapeXML(name)}" transform="translate(${x}, ${y})">\n`;
        if (shape.children) {
          for (const child of shape.children) {
            frameContent += `    ${this.shapeToSVGElement(child).trim()}\n`;
          }
        }
        frameContent += `  </g>\n`;
        return frameContent;

      case "group":
        let groupContent = `  <g id="group-${this.escapeXML(name)}">\n`;
        if (shape.children) {
          for (const child of shape.children) {
            groupContent += `    ${this.shapeToSVGElement(child).trim()}\n`;
          }
        }
        groupContent += `  </g>\n`;
        return groupContent;

      default:
        return `  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}"${opacityAttr}${classAttr}/>\n`;
    }
  }

  private async exportToJSON(penpotData: PenpotFile): Promise<string> {
    const filename = `${this.sanitizeFilename(penpotData.name)}.json`;
    const filepath = path.join(this.outputDir, filename);

    const exportData = {
      ...penpotData,
      exportedAt: new Date().toISOString(),
      exportedBy: "pakalon",
      version: "1.0",
      metadata: {
        ...penpotData.metadata,
        includeMetadata: this.includeMetadata,
        quality: this.quality,
      },
    };

    await fs.writeFile(filepath, JSON.stringify(exportData, null, 2), "utf-8");
    logger.info(`[Penpot] Exported JSON: ${filepath}`);

    return filepath;
  }

  private async exportToPenpotFormat(penpotData: PenpotFile): Promise<string> {
    const filename = `${this.sanitizeFilename(penpotData.name)}.penpot`;
    const filepath = path.join(this.outputDir, filename);

    const penpotFormat = {
      ...this.includeMetadata ? {
        type: "penpot",
        version: "1.0",
        exportedAt: new Date().toISOString(),
        exportedBy: "pakalon",
      } : {},
      file: penpotData,
      components: penpotData.components ?? [],
      styles: penpotData.styles ?? {},
      metadata: penpotData.metadata ?? {},
      designTokens: penpotData.designTokens ?? {},
    };

    await fs.writeFile(filepath, JSON.stringify(penpotFormat, null, 2), "utf-8");
    logger.info(`[Penpot] Exported .penpot: ${filepath}`);

    return filepath;
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private async validatePenpotExport(penpotData: PenpotFile): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const probe = await this.exportToPenpotFormat(penpotData);
      const raw = await fs.readFile(probe, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed.file?.pages) errors.push("Penpot export missing pages");
      if (!parsed.type || parsed.type !== "penpot") errors.push("Penpot export missing native type");
    } catch (error) {
      errors.push(`Penpot validation failed: ${String(error)}`);
    }

    return { valid: errors.length === 0, errors };
  }
}

let globalExporter: PenpotExporter | null = null;

export async function initializePenpotExporter(options: ExportOptions): Promise<PenpotExporter> {
  globalExporter = new PenpotExporter(options);
  await fs.mkdir(options.outputDir, { recursive: true });
  return globalExporter;
}

export function getPenpotExporter(): PenpotExporter | null {
  return globalExporter;
}

export async function exportPenpotDesign(
  penpotData: PenpotFile,
  options: ExportOptions
): Promise<ExportResult> {
  const exporter = new PenpotExporter(options);
  return exporter.exportFromPenpotJSON(penpotData);
}

export const penpotExportTool = tool({
  description: "Export Penpot wireframes to SVG, JSON, or .penpot format",
  parameters: z.object({
    action: z.enum(["export", "init"]).describe("Export action"),
    format: z.enum(["svg", "json", "penpot", "all"]).optional().describe("Export format"),
    outputDir: z.string().optional().describe("Output directory"),
    penpotData: z.any().optional().describe("Penpot data to export"),
    quality: z.enum(["low", "medium", "high"]).optional().describe("Export quality"),
  }),
});
