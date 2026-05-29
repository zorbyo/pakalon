import fs from "fs/promises";
import path from "path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// URL Parsing
// ---------------------------------------------------------------------------

/**
 * Extract file key from various Figma URL formats:
 * - https://www.figma.com/file/abc123/MyFile
 * - https://www.figma.com/design/abc123/MyFile
 * - https://figma.com/file/abc123/MyFile
 * - abc123 (raw key)
 */
export function parseFigmaUrlOrKey(input: string): string | null {
  // If it doesn't contain slashes, assume it's a raw file key
  if (!input.includes("/")) {
    // Validate it's a likely Figma key (alphanumeric, 20+ chars)
    if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) {
      return input;
    }
    return null;
  }

  // Try to extract from URL
  const urlMatch = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FigmaComponentData {
  id: string;
  name: string;
  type: string;
  description: string;
  properties: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export interface FigmaImportResult {
  fileKey: string;
  name: string;
  components: FigmaComponentData[];
  raw: unknown;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function walkFigmaNodes(node: Record<string, unknown>, out: FigmaComponentData[]): void {
  const children = Array.isArray(node.children) ? node.children : [];
  const type = String(node.type ?? "UNKNOWN");
  const name = String(node.name ?? "Unnamed");
  const description = String(node.description ?? node.componentPropertyDefinitions?.description ?? "");

  if (["COMPONENT", "COMPONENT_SET", "FRAME", "INSTANCE", "SECTION"].includes(type)) {
    out.push({
      id: String(node.id ?? name),
      name,
      type,
      description,
      properties: {
        layoutMode: node.layoutMode,
        fills: node.fills,
        strokes: node.strokes,
        effects: node.effects,
        characters: node.characters,
        componentPropertyDefinitions: node.componentPropertyDefinitions,
      },
      styles: {
        styles: node.styles,
        styleId: node.styleId,
      },
    });
  }

  for (const child of children) {
    walkFigmaNodes(toObject(child), out);
  }
}

export async function figmaImportFile(fileKey: string, accessToken: string): Promise<FigmaImportResult> {
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { "X-Figma-Token": accessToken },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Figma API error: HTTP ${response.status}`);
  }

  const raw = await response.json() as Record<string, unknown>;
  const document = toObject(raw.document);
  const components: FigmaComponentData[] = [];
  walkFigmaNodes(document, components);

  return {
    fileKey,
    name: String(raw.name ?? "Figma File"),
    components,
    raw,
  };
}

export function figmaExtractComponents(fileData: unknown): FigmaComponentData[] {
  const raw = toObject(fileData as Record<string, unknown>);
  const document = toObject(raw.document);
  const components: FigmaComponentData[] = [];
  walkFigmaNodes(document, components);
  return components;
}

export function figmaGenerateDesignDoc(components: FigmaComponentData[]): string {
  const lines = ["# Figma Design Import", "", "## Components", ""];

  for (const component of components) {
    lines.push(`### ${component.name}`);
    lines.push(`- ID: ${component.id}`);
    lines.push(`- Type: ${component.type}`);
    if (component.description) lines.push(`- Description: ${component.description}`);
    const propertyEntries = Object.entries(component.properties).filter(([, value]) => value !== undefined);
    if (propertyEntries.length) {
      lines.push("- Properties:");
      for (const [key, value] of propertyEntries) {
        lines.push(`  - ${key}: ${JSON.stringify(value)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export const figmaImportFileSchema = z.object({
  fileKey: z.string().min(1),
  accessToken: z.string().min(1),
});

export const figmaExtractComponentsSchema = z.object({
  fileData: z.record(z.string(), z.unknown()),
});

export const figmaGenerateDesignDocSchema = z.object({
  components: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    description: z.string(),
    properties: z.record(z.unknown()),
    styles: z.record(z.unknown()),
  })),
});

export const figma_import_file = {
  name: "figma_import_file",
  description: "Import a Figma file and extract components. Accepts either a Figma URL (https://www.figma.com/file/...) or a raw file key.",
  inputSchema: figmaImportFileSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(input: { fileKey: string; accessToken: string }): Promise<FigmaImportResult> {
    return figmaImportFile(input.fileKey, input.accessToken);
  },
};

// ---------------------------------------------------------------------------
// Unified Figma Import Tool (accepts URL or key)
// ---------------------------------------------------------------------------

export const figmaImportToolSchema = z.object({
  /** Figma file URL (e.g., https://www.figma.com/file/abc123/...) or raw file key */
  fileUrlOrKey: z.string().min(1).describe("Figma file URL or raw file key"),
  /** Figma access token (or set FIGMA_ACCESS_TOKEN env var) */
  accessToken: z.string().optional().describe("Figma access token (falls back to FIGMA_ACCESS_TOKEN env var)"),
  /** Whether to generate design.md documentation */
  generateDocs: z.boolean().optional().default(true).describe("Generate design.md documentation"),
});

export const figma_import = {
  name: "figma_import",
  description: "Import a Figma file by URL or file key, extract components, and optionally generate design documentation. Supports Figma URLs, design URLs, and raw file keys.",
  inputSchema: figmaImportToolSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(input: { fileUrlOrKey: string; accessToken?: string; generateDocs?: boolean }): Promise<{
    success: boolean;
    fileKey?: string;
    fileName?: string;
    components?: FigmaComponentData[];
    designDoc?: { path?: string; markdown: string };
    error?: string;
  }> {
    try {
      // Parse URL or use key directly
      const fileKey = parseFigmaUrlOrKey(input.fileUrlOrKey);
      if (!fileKey) {
        return {
          success: false,
          error: `Invalid Figma URL or file key: "${input.fileUrlOrKey}". Expected formats: https://www.figma.com/file/KEY/... or raw KEY`,
        };
      }

      // Get access token from input or environment
      const accessToken = input.accessToken ?? process.env.FIGMA_ACCESS_TOKEN;
      if (!accessToken) {
        return {
          success: false,
          error: "Figma access token required. Pass it as 'accessToken' or set FIGMA_ACCESS_TOKEN env var.",
        };
      }

      // Import the file
      const result = await figmaImportFile(fileKey, accessToken);

      // Generate design doc if requested
      let designDoc: { path?: string; markdown: string } | undefined;
      if (input.generateDocs !== false && result.components.length > 0) {
        designDoc = {
          markdown: figmaGenerateDesignDoc(result.components),
        };
        const outputDir = path.join(process.cwd(), ".pakalon-agents", "figma");
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, "design.md");
        await fs.writeFile(outputPath, designDoc.markdown, "utf8");
        designDoc.path = outputPath;
      }

      return {
        success: true,
        fileKey: result.fileKey,
        fileName: result.name,
        components: result.components,
        designDoc,
      };
    } catch (err) {
      return {
        success: false,
        error: String(err),
      };
    }
  },
};

export const figma_extract_components = {
  name: "figma_extract_components",
  description: "Extract structured component data from Figma file JSON",
  inputSchema: figmaExtractComponentsSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(input: { fileData: Record<string, unknown> }): Promise<FigmaComponentData[]> {
    return figmaExtractComponents(input.fileData);
  },
};

export const figma_generate_design_doc = {
  name: "figma_generate_design_doc",
  description: "Generate a design.md document from extracted Figma components",
  inputSchema: figmaGenerateDesignDocSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(input: { components: FigmaComponentData[] }): Promise<{ path?: string; markdown: string }> {
    const markdown = figmaGenerateDesignDoc(input.components);
    const outputDir = path.join(process.cwd(), ".pakalon-agents", "figma");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "design.md");
    await fs.writeFile(outputPath, markdown, "utf8");
    return { path: outputPath, markdown };
  },
};
