import fs from "fs/promises";
import path from "path";
import logger from "@/utils/logger.js";

export interface DesignTokens {
  colors: Record<string, string>;
  typography: Record<string, unknown>;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  components?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function walk(node: any, tokens: DesignTokens): void {
  if (!node || typeof node !== "object") return;

  const name = String(node.name ?? node.type ?? "layer");
  const key = slug(name) || "token";

  const fills = Array.isArray(node.fills) ? node.fills : [];
  const solid = fills.find((fill: any) => fill?.type === "SOLID" && fill?.visible !== false);
  if (solid?.color) {
    const { r = 0, g = 0, b = 0 } = solid.color;
    tokens.colors[key] = `#${[r, g, b].map((v: number) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  }

  if (node.type === "TEXT") {
    tokens.typography[key] = {
      fontFamily: node.style?.fontFamily,
      fontSize: node.style?.fontSize,
      fontWeight: node.style?.fontWeight,
      lineHeight: node.style?.lineHeightPx ?? node.style?.lineHeight,
      letterSpacing: node.style?.letterSpacing,
    };
  }

  if (node.cornerRadius !== undefined) tokens.borderRadius[key] = `${node.cornerRadius}px`;
  if (node.effects?.length) tokens.shadows[key] = JSON.stringify(node.effects);

  if (typeof node.width === "number") tokens.spacing[`${key}-w`] = `${Math.round(node.width)}px`;
  if (typeof node.height === "number") tokens.spacing[`${key}-h`] = `${Math.round(node.height)}px`;

  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, tokens);
  }
}

export function extractDesignTokens(penpotData: any): DesignTokens {
  const tokens: DesignTokens = {
    colors: {},
    typography: {},
    spacing: {},
    borderRadius: {},
    shadows: {},
    components: {},
    metadata: {},
  };

  const root = penpotData?.file ?? penpotData?.data ?? penpotData;
  walk(root, tokens);

  tokens.metadata = {
    source: penpotData?.type ?? "penpot",
    extractedAt: new Date().toISOString(),
  };

  return tokens;
}

export function designTokensToCssVariables(tokens: DesignTokens): string {
  const lines: string[] = [":root {"];
  for (const [group, values] of Object.entries({
    colors: tokens.colors,
    spacing: tokens.spacing,
    borderRadius: tokens.borderRadius,
    shadows: tokens.shadows,
  })) {
    for (const [key, value] of Object.entries(values)) {
      lines.push(`  --${group}-${key}: ${value};`);
    }
  }
  lines.push("}");
  return lines.join("\n");
}

export function designTokensToTailwindConfig(tokens: DesignTokens): Record<string, unknown> {
  return {
    theme: {
      extend: {
        colors: tokens.colors,
        spacing: tokens.spacing,
        borderRadius: tokens.borderRadius,
        boxShadow: tokens.shadows,
        fontFamily: tokens.typography,
      },
    },
  };
}

export async function writeDesignTokens(outputDir: string, tokens: DesignTokens): Promise<{ jsonPath: string; cssPath: string; tailwindPath: string }> {
  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "design-tokens.json");
  const cssPath = path.join(outputDir, "design-tokens.css");
  const tailwindPath = path.join(outputDir, "design-tokens.tailwind.json");

  await fs.writeFile(jsonPath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
  await fs.writeFile(cssPath, `${designTokensToCssVariables(tokens)}\n`, "utf8");
  await fs.writeFile(tailwindPath, `${JSON.stringify(designTokensToTailwindConfig(tokens), null, 2)}\n`, "utf8");

  logger.info(`[Penpot] Design tokens written to ${outputDir}`);
  return { jsonPath, cssPath, tailwindPath };
}
