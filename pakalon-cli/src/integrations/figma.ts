/**
 * Figma Integration
 * Import and parse Figma design files
 */

import logger from "@/utils/logger.js";
import { collectFigmaDesignTokens, convertFigmaToPenpot } from "@/integrations/figma-to-penpot.js";

export interface FigmaConfig {
  accessToken: string;
  fileId?: string;
}

export interface FigmaFrame {
  id: string;
  name: string;
  type: string;
  children: FigmaNode[];
  absoluteBoundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fills?: any[];
  strokes?: any[];
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  characters?: string;
  style?: any;
}

export interface FigmaComponent {
  id: string;
  name: string;
  description: string;
  componentSetId?: string;
}

export interface FigmaStyle {
  name: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
  description: string;
}

export interface FigmaWebhookEvent {
  event_type: string;
  file_key?: string;
  file_name?: string;
  node_id?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

export function validateFigmaFileId(fileId: string): boolean {
  return /^[a-zA-Z0-9_-]{4,}$/.test(fileId.trim());
}

function normalizeFileId(fileId: string): string {
  const trimmed = fileId.trim();
  if (!validateFigmaFileId(trimmed)) {
    throw new Error(`Invalid Figma file ID: ${fileId}`);
  }
  return trimmed;
}

export class FigmaClient {
  private accessToken: string;
  private baseUrl = "https://api.figma.com/v1";

  constructor(config: FigmaConfig) {
    this.accessToken = config.accessToken;

    if (!this.accessToken) {
      logger.warn("[Figma] No access token provided. Set FIGMA_TOKEN environment variable.");
    }
  }

  async authenticate(token: string): Promise<boolean> {
    this.accessToken = token.trim();
    if (!this.accessToken) {
      throw new Error("Figma access token is required");
    }

    const response = await fetch(`${this.baseUrl}/me`, {
      headers: { "X-Figma-Token": this.accessToken },
      signal: AbortSignal.timeout(15000),
    });

    return response.ok;
  }

  private async requestJson(endpoint: string): Promise<any> {
    if (!this.accessToken) {
      throw new Error("Figma access token not configured");
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: { "X-Figma-Token": this.accessToken },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  async getFile(fileId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const normalized = normalizeFileId(fileId);
      logger.info(`[Figma] Fetching file: ${normalized}`);
      const data = await this.requestJson(`/files/${normalized}`);
      logger.info(`[Figma] File fetched successfully: ${data.name}`);
      return { success: true, data };
    } catch (error) {
      logger.error(`[Figma] Failed to fetch file: ${error}`);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getNodes(fileId: string, nodeIds: string[]): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const normalized = normalizeFileId(fileId);
      if (nodeIds.length === 0) return { success: false, error: "No node IDs provided" };
      const ids = encodeURIComponent(nodeIds.join(","));
      const data = await this.requestJson(`/files/${normalized}/nodes?ids=${ids}`);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getImage(
    fileId: string,
    params: { ids: string[]; format?: "png" | "svg" | "jpg"; scale?: number },
  ): Promise<{ success: boolean; images?: Record<string, string>; error?: string }> {
    try {
      const normalized = normalizeFileId(fileId);
      const ids = encodeURIComponent(params.ids.join(","));
      const format = params.format ?? "png";
      const scale = params.scale ?? 1;
      const data = await this.requestJson(`/images/${normalized}?ids=${ids}&format=${format}&scale=${scale}`);
      return { success: true, images: data.images ?? {} };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getComponents(fileId: string): Promise<{ success: boolean; components?: FigmaComponent[]; error?: string }> {
    try {
      const normalized = normalizeFileId(fileId);
      const data = await this.requestJson(`/files/${normalized}/components`);
      return { success: true, components: Object.values(data.meta?.components ?? {}) as FigmaComponent[] };
    } catch (error) {
      logger.error(`[Figma] Failed to get components: ${error}`);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getStyles(fileId: string): Promise<{ success: boolean; styles?: FigmaStyle[]; error?: string }> {
    try {
      const normalized = normalizeFileId(fileId);
      const data = await this.requestJson(`/files/${normalized}/styles`);
      return { success: true, styles: Object.values(data.meta?.styles ?? {}) as FigmaStyle[] };
    } catch (error) {
      logger.error(`[Figma] Failed to get styles: ${error}`);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getFrames(fileId: string): Promise<{ success: boolean; frames?: FigmaFrame[]; error?: string }> {
    try {
      const result = await this.getFile(fileId);
      if (!result.success || !result.data) return { success: false, error: result.error };

      const frames: FigmaFrame[] = [];
      const traverse = (node: any): void => {
        if (node?.type === "FRAME") frames.push(node);
        if (Array.isArray(node?.children)) node.children.forEach(traverse);
      };

      traverse(result.data.document);
      return { success: true, frames };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async exportImages(
    fileId: string,
    nodeIds: string[],
    format: "png" | "svg" | "jpg" = "png",
    scale = 1,
  ): Promise<{ success: boolean; images?: Record<string, string>; error?: string }> {
    try {
      const normalized = normalizeFileId(fileId);
      const ids = encodeURIComponent(nodeIds.join(","));
      const data = await this.requestJson(`/images/${normalized}?ids=${ids}&format=${format}&scale=${scale}`);
      return { success: true, images: data.images ?? {} };
    } catch (error) {
      logger.error(`[Figma] Failed to export images: ${error}`);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async parseFile(fileId: string): Promise<{
    success: boolean;
    parsed?: {
      name: string;
      frames: FigmaFrame[];
      components: FigmaComponent[];
      styles: FigmaStyle[];
      designTokens: {
        colors: Record<string, string>;
        typography: Record<string, any>;
        spacing: Record<string, string>;
      };
    };
    error?: string;
  }> {
    try {
      const normalized = normalizeFileId(fileId);
      logger.info(`[Figma] Parsing file: ${normalized}`);

      const [fileResult, framesResult, componentsResult, stylesResult] = await Promise.all([
        this.getFile(normalized),
        this.getFrames(normalized),
        this.getComponents(normalized),
        this.getStyles(normalized),
      ]);

      if (!fileResult.success || !fileResult.data) {
        return { success: false, error: fileResult.error };
      }

      const designTokens = collectFigmaDesignTokens(fileResult.data);

      for (const style of stylesResult.styles ?? []) {
        if (style.styleType === "FILL" && !designTokens.colors[style.name]) {
          designTokens.colors[style.name] = "#000000";
        }
        if (style.styleType === "TEXT" && !designTokens.typography[style.name]) {
          designTokens.typography[style.name] = { description: style.description };
        }
      }

      return {
        success: true,
        parsed: {
          name: fileResult.data.name,
          frames: framesResult.frames ?? [],
          components: componentsResult.components ?? [],
          styles: stylesResult.styles ?? [],
          designTokens,
        },
      };
    } catch (error) {
      logger.error(`[Figma] Failed to parse file: ${error}`);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async watchWebhook(event: FigmaWebhookEvent): Promise<{ success: boolean; message: string }> {
    logger.info(`[Figma] Webhook received: ${event.event_type}`);
    return { success: true, message: "Webhook stub received" };
  }

  async importFromFigma(fileId: string, outputDir: string): Promise<{ success: boolean; outputDir: string; penpotPath?: string; error?: string }> {
    try {
      const normalized = normalizeFileId(fileId);
      const fileResult = await this.getFile(normalized);
      if (!fileResult.success || !fileResult.data) throw new Error(fileResult.error ?? "Failed to fetch Figma file");
      const conversion = await convertFigmaToPenpot(fileResult.data, outputDir);
      return { success: conversion.success, outputDir, penpotPath: conversion.penpotFilePath };
    } catch (error) {
      return { success: false, outputDir, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function createFigmaClient(accessToken?: string): FigmaClient {
  return new FigmaClient({
    accessToken: accessToken || process.env.FIGMA_TOKEN || "",
  });
}

export async function importFromFigma(fileId: string, token: string, outputDir: string): Promise<{ success: boolean; outputDir: string; penpotPath?: string; error?: string }> {
  const client = createFigmaClient(token);
  await client.authenticate(token);
  return client.importFromFigma(fileId, outputDir);
}
