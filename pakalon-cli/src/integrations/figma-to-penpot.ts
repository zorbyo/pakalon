import fs from "fs/promises";
import path from "path";
import logger from "@/utils/logger.js";
import type { PenpotFile, PenpotFrame, PenpotShape } from "@/penpot/export.js";

export interface FigmaToPenpotResult {
  success: boolean;
  outputDir: string;
  penpotFilePath: string;
  jsonPath: string;
  svgPreviewPaths: string[];
  designTokens: {
    colors: Record<string, string>;
    typography: Record<string, unknown>;
    spacing: Record<string, string>;
  };
  errors: string[];
}

function slug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "untitled";
}

function rgbaToHex(color: { r?: number; g?: number; b?: number; a?: number } | undefined): string | undefined {
  if (!color) return undefined;
  const r = Math.round((color.r ?? 0) * 255);
  const g = Math.round((color.g ?? 0) * 255);
  const b = Math.round((color.b ?? 0) * 255);
  const a = color.a;
  const hex = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  return a !== undefined && a < 1 ? `#${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}` : `#${hex}`;
}

function nodeToShape(node: any): PenpotShape | null {
  const box = node.absoluteBoundingBox ?? node.absoluteRenderBounds;
  if (!box) return null;

  const fills = Array.isArray(node.fills)
    ? node.fills.map((fill: any) => rgbaToHex(fill?.color)).filter(Boolean)
    : [];
  const strokes = Array.isArray(node.strokes)
    ? node.strokes.map((stroke: any) => rgbaToHex(stroke?.color)).filter(Boolean)
    : [];

  const common: PenpotShape = {
    id: node.id,
    name: node.name ?? node.type ?? "layer",
    type: node.type === "TEXT" ? "text" : node.type === "ELLIPSE" ? "circle" : node.type === "FRAME" ? "frame" : node.type === "GROUP" ? "group" : "rect",
    x: box.x ?? 0,
    y: box.y ?? 0,
    width: box.width ?? 0,
    height: box.height ?? 0,
    fills: fills.length ? fills : undefined,
    strokes: strokes.length ? strokes : undefined,
    text: typeof node.characters === "string" ? node.characters : undefined,
    opacity: typeof node.opacity === "number" ? node.opacity : undefined,
    rotation: typeof node.rotation === "number" ? node.rotation : undefined,
  };

  if (Array.isArray(node.children) && node.children.length > 0) {
    common.children = node.children.map(nodeToShape).filter(Boolean) as PenpotShape[];
  }

  return common;
}

export function collectFigmaDesignTokens(figmaData: any): FigmaToPenpotResult["designTokens"] {
  const colors: Record<string, string> = {};
  const typography: Record<string, unknown> = {};
  const spacing: Record<string, string> = {};

  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;

    const name = String(node.name ?? node.type ?? "layer");
    const fills = Array.isArray(node.fills) ? node.fills : [];
    const solid = fills.find((fill: any) => fill?.type === "SOLID" && fill?.visible !== false);
    const color = rgbaToHex(solid?.color);
    if (color && !colors[slug(name)]) colors[slug(name)] = color;

    if (node.type === "TEXT") {
      typography[slug(name)] = {
        fontFamily: node.style?.fontFamily,
        fontSize: node.style?.fontSize,
        fontWeight: node.style?.fontWeight,
        lineHeight: node.style?.lineHeightPx ?? node.style?.lineHeight,
        letterSpacing: node.style?.letterSpacing,
      };
    }

    if (typeof node.absoluteBoundingBox?.height === "number") {
      spacing[slug(`${name}-h`)] = `${Math.round(node.absoluteBoundingBox.height)}px`;
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };

  walk(figmaData?.document ?? figmaData);
  return { colors, typography, spacing };
}

export async function convertFigmaToPenpot(figmaData: any, outputDir: string): Promise<FigmaToPenpotResult> {
  await fs.mkdir(outputDir, { recursive: true });

  const fileName = slug(figmaData?.name ?? figmaData?.document?.name ?? "figma-design");
  const penpotFile: PenpotFile = {
    id: figmaData?.key ?? fileName,
    name: figmaData?.name ?? figmaData?.document?.name ?? "Figma Design",
    projectId: figmaData?.projectId ?? fileName,
    pages: [],
  };

  const document = figmaData?.document ?? {};
  const pageNodes = Array.isArray(document.children) ? document.children : [];
  const svgPreviewPaths: string[] = [];

  penpotFile.pages = pageNodes.map((page: any, index: number) => {
    const pageName = page?.name ?? `Page ${index + 1}`;
    const frames = Array.isArray(page?.children)
      ? page.children.filter((node: any) => node?.type === "FRAME").map((frame: any, frameIndex: number): PenpotFrame => ({
          id: frame.id ?? `${page.id ?? index}-${frameIndex}`,
          name: frame.name ?? `Frame ${frameIndex + 1}`,
          x: frame.absoluteBoundingBox?.x ?? 0,
          y: frame.absoluteBoundingBox?.y ?? 0,
          width: frame.absoluteBoundingBox?.width ?? 0,
          height: frame.absoluteBoundingBox?.height ?? 0,
          children: (frame.children ?? []).map(nodeToShape).filter(Boolean) as PenpotShape[],
        }))
      : [];

    return {
      id: page.id ?? `${fileName}-page-${index}`,
      name: pageName,
      frames,
    };
  });

  const designTokens = collectFigmaDesignTokens(figmaData);
  const jsonPath = path.join(outputDir, `${fileName}.json`);
  const penpotFilePath = path.join(outputDir, `${fileName}.penpot`);

  const bundle = {
    type: "penpot",
    version: "1.1",
    exportedAt: new Date().toISOString(),
    source: "figma",
    data: penpotFile,
    designTokens,
    metadata: {
      sourceFile: figmaData?.name ?? null,
      key: figmaData?.key ?? null,
    },
  };

  await fs.writeFile(jsonPath, `${JSON.stringify({ ...bundle, format: "json" }, null, 2)}\n`, "utf8");
  await fs.writeFile(penpotFilePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  logger.info(`[Figma→Penpot] Converted ${figmaData?.name ?? "design"} → ${penpotFilePath}`);

  return {
    success: true,
    outputDir,
    penpotFilePath,
    jsonPath,
    svgPreviewPaths,
    designTokens,
    errors: [],
  };
}
