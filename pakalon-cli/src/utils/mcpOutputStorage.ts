/**
 * MCP Output Storage and Truncation Utilities
 *
 * Handles:
 * - Large output truncation to prevent context overflow
 * - Binary content persistence to disk
 * - Image resizing/downsampling for MCP responses
 * - Content size estimation and validation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import logger from '@/utils/logger.js';

// Configuration constants
export const DEFAULT_MAX_OUTPUT_SIZE = 100_000; // 100KB
export const DEFAULT_TRUNCATION_THRESHOLD = 50_000; // 50KB
export const DEFAULT_BINARY_STORAGE_DIR = '.pakalon-mcp-binary';
export const DEFAULT_IMAGE_MAX_WIDTH = 800;
export const DEFAULT_IMAGE_MAX_HEIGHT = 600;
export const IMAGE_QUALITY = 0.8;

export interface TruncationResult {
  truncated: boolean;
  originalSize: number;
  finalSize: number;
  storedFilePath?: string;
  placeholderText: string;
}

export interface BinaryContentResult {
  persisted: boolean;
  filePath?: string;
  mimeType?: string;
  size: number;
  error?: string;
}

export interface ImageResizeResult {
  resized: boolean;
  originalWidth?: number;
  originalHeight?: number;
  newWidth?: number;
  newHeight?: number;
  outputPath?: string;
  error?: string;
}

export interface MCPToolResult {
  content: string | unknown[];
  needsTruncation: boolean;
  estimatedTokens: number;
  isBinary: boolean;
  binaryFilePath?: string;
}

// Supported binary MIME types
const BINARY_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'application/octet-stream',
]);

// Image MIME types that can be resized
const RESIZEABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/**
 * Get the binary storage directory path
 */
export function getBinaryStorageDir(): string {
  return path.join(process.cwd(), DEFAULT_BINARY_STORAGE_DIR);
}

/**
 * Estimate token count from text content
 * Uses a rough approximation: 1 token ≈ 4 characters
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if content needs truncation based on size
 */
export function contentNeedsTruncation(content: unknown, maxSize = DEFAULT_TRUNCATION_THRESHOLD): boolean {
  if (typeof content === 'string') {
    return content.length > maxSize;
  }
  if (Array.isArray(content)) {
    const totalLength = content.reduce((sum, item) => {
      if (typeof item === 'object' && item !== null && 'text' in item) {
        return sum + String((item as { text: string }).text).length;
      }
      return sum + JSON.stringify(item).length;
    }, 0);
    return totalLength > maxSize;
  }
  return JSON.stringify(content).length > maxSize;
}

/**
 * Truncate MCP content if it exceeds the maximum size
 */
export async function truncateMcpContentIfNeeded(
  content: unknown,
  maxSize = DEFAULT_MAX_OUTPUT_SIZE,
  options: {
    storeBinary?: boolean;
    toolUseId?: string;
    serverName?: string;
  } = {}
): Promise<TruncationResult> {
  const originalText = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  const originalSize = originalText.length;

  if (originalSize <= maxSize) {
    return {
      truncated: false,
      originalSize,
      finalSize: originalSize,
      placeholderText: originalText,
    };
  }

  const { storeBinary = true, toolUseId, serverName } = options;

  // Generate truncation placeholder
  const truncatedText = originalText.slice(0, maxSize);
  const placeholder = `${truncatedText}\n\n[Output truncated - ${originalSize.toLocaleString()} chars total. Use Read tool to access full content]`;

  let storedFilePath: string | undefined;

  if (storeBinary && toolUseId) {
    try {
      const storageDir = getBinaryStorageDir();
      await fs.mkdir(storageDir, { recursive: true });

      const fileName = `${toolUseId}-${randomUUID()}.txt`;
      storedFilePath = path.join(storageDir, fileName);

      await fs.writeFile(storedFilePath, originalText, 'utf-8');
      logger.debug(`[mcp/output] Persisted truncated content to ${storedFilePath}`);
    } catch (err) {
      logger.warn(`[mcp/output] Failed to persist truncated content: ${err}`);
    }
  }

  return {
    truncated: true,
    originalSize,
    finalSize: placeholder.length,
    storedFilePath,
    placeholderText: placeholder,
  };
}

/**
 * Persist binary content to disk and return reference
 */
export async function persistBinaryContent(
  content: Buffer | Uint8Array,
  mimeType: string,
  options: {
    toolUseId?: string;
    serverName?: string;
    customFileName?: string;
  } = {}
): Promise<BinaryContentResult> {
  const { toolUseId, serverName, customFileName } = options;

  try {
    const storageDir = getBinaryStorageDir();
    await fs.mkdir(storageDir, { recursive: true });

    const ext = getExtensionForMimeType(mimeType);
    const baseName = customFileName || `${toolUseId || randomUUID()}-${Date.now()}`;
    const fileName = `${baseName}${ext}`;
    const filePath = path.join(storageDir, fileName);

    await fs.writeFile(filePath, content);
    logger.debug(`[mcp/output] Persisted binary content (${mimeType}) to ${filePath}`);

    return {
      persisted: true,
      filePath,
      mimeType,
      size: content.length,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[mcp/output] Failed to persist binary content: ${errorMsg}`);
    return {
      persisted: false,
      size: content.length,
      error: errorMsg,
    };
  }
}

/**
 * Resize an image to fit within max dimensions while preserving aspect ratio
 */
export async function resizeImage(
  inputPath: string,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    outputPath?: string;
  } = {}
): Promise<ImageResizeResult> {
  const { maxWidth = DEFAULT_IMAGE_MAX_WIDTH, maxHeight = DEFAULT_IMAGE_MAX_HEIGHT, outputPath } = options;

  try {
    const data = await fs.readFile(inputPath);
    const metadata = await getImageMetadata(data, inputPath);

    if (!metadata) {
      return { resized: false, error: 'Could not read image metadata' };
    }

    const { width, height, mimeType } = metadata;

    // Check if resize is needed
    if (width <= maxWidth && height <= maxHeight) {
      return {
        resized: false,
        originalWidth: width,
        originalHeight: height,
      };
    }

    // Calculate new dimensions preserving aspect ratio
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    const newWidth = Math.round(width * ratio);
    const newHeight = Math.round(height * ratio);

    // Generate output path if not provided
    const finalOutputPath = outputPath || inputPath.replace(/(\.[^.]+)$/, `-resized$1`);
    const ext = path.extname(finalOutputPath);

    // For JPEG and PNG, we can resize using sharp or similar
    // For other formats, we'll just copy with metadata
    if (RESIZEABLE_IMAGE_TYPES.has(mimeType)) {
      // Use native sharp if available
      try {
        const sharpModule = await import('sharp');
        const image = sharpModule.default(data);
        await image
          .resize(newWidth, newHeight, { fit: 'inside' })
          .toFile(finalOutputPath);
      } catch {
        // Sharp not available, just copy original
        await fs.copyFile(inputPath, finalOutputPath);
      }
    } else {
      await fs.copyFile(inputPath, finalOutputPath);
    }

    logger.debug(`[mcp/output] Resized image from ${width}x${height} to ${newWidth}x${newHeight}`);

    return {
      resized: true,
      originalWidth: width,
      originalHeight: height,
      newWidth,
      newHeight,
      outputPath: finalOutputPath,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { resized: false, error: errorMsg };
  }
}

/**
 * Get image metadata (width, height, mime type)
 */
async function getImageMetadata(
  data: Buffer,
  filePath: string
): Promise<{ width: number; height: number; mimeType: string } | null> {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = getMimeTypeForExtension(ext);

    // Parse basic image headers
    if (ext === '.png' && data.length > 24) {
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      return { width, height, mimeType };
    }
    if ((ext === '.jpg' || ext === '.jpeg') && data.length > 2) {
      // JPEG - basic dimension reading is complex, use sharp if available
      try {
        const sharpModule = await import('sharp');
        const metadata = await sharpModule.default(data).metadata();
        return {
          width: metadata.width || 0,
          height: metadata.height || 0,
          mimeType,
        };
      } catch {
        return { width: 0, height: 0, mimeType };
      }
    }
    if (ext === '.gif' && data.length > 24) {
      const width = data.readUInt16LE(6);
      const height = data.readUInt16LE(8);
      return { width, height, mimeType };
    }
    if (ext === '.webp' && data.length > 30) {
      // WebP header parsing is complex, use sharp if available
      try {
        const sharpModule = await import('sharp');
        const metadata = await sharpModule.default(data).metadata();
        return {
          width: metadata.width || 0,
          height: metadata.height || 0,
          mimeType,
        };
      } catch {
        return { width: 0, height: 0, mimeType };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get MIME type for file extension
 */
function getMimeTypeForExtension(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
  };
  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Get file extension for MIME type
 */
function getExtensionForMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/octet-stream': '.bin',
  };
  return extensions[mimeType] || '.bin';
}

/**
 * Check if content is binary based on MIME type
 */
export function isBinaryMimeType(mimeType: string): boolean {
  return BINARY_MIME_TYPES.has(mimeType);
}

/**
 * Check if a file is a resizeable image
 */
export function isResizeableImage(mimeType: string): boolean {
  return RESIZEABLE_IMAGE_TYPES.has(mimeType);
}

/**
 * Process MCP tool result and handle truncation/binary/persistence
 */
export async function processMcpToolResult(
  result: unknown,
  options: {
    toolUseId?: string;
    serverName?: string;
    maxOutputSize?: number;
    maxTokens?: number;
  } = {}
): Promise<MCPToolResult> {
  const { toolUseId, serverName, maxOutputSize = DEFAULT_MAX_OUTPUT_SIZE, maxTokens } = options;

  // Handle string results
  if (typeof result === 'string') {
    const needsTruncation = result.length > maxOutputSize;
    let finalContent = result;
    let truncated = false;

    if (needsTruncation) {
      const truncResult = await truncateMcpContentIfNeeded(result, maxOutputSize, {
        storeBinary: true,
        toolUseId,
        serverName,
      });
      finalContent = truncResult.placeholderText;
      truncated = truncResult.truncated;
    }

    const estimatedTokensValue = estimateTokens(finalContent);

    // Check token budget if specified
    if (maxTokens && estimatedTokensValue > maxTokens) {
      const truncResult = await truncateMcpContentIfNeeded(finalContent, Math.floor(maxTokens * 4), {
        storeBinary: true,
        toolUseId,
        serverName,
      });
      finalContent = truncResult.placeholderText;
      truncated = true;
    }

    return {
      content: finalContent,
      needsTruncation: truncated,
      estimatedTokens: estimateTokens(finalContent),
      isBinary: false,
    };
  }

  // Handle array content (MCP responses are often arrays)
  if (Array.isArray(result)) {
    let flatText = '';
    let hasBinary = false;
    let binaryFilePath: string | undefined;

    for (const item of result) {
      if (typeof item === 'object' && item !== null) {
        const itemRecord = item as Record<string, unknown>;
        if (itemRecord.type === 'text' && typeof itemRecord.text === 'string') {
          flatText += itemRecord.text + '\n';
        } else if (itemRecord.type === 'image' && itemRecord.data) {
          hasBinary = true;
          // Handle binary image data
          if (toolUseId) {
            try {
              const buffer = Buffer.from(String(itemRecord.data), 'base64');
              const mimeType = (itemRecord.mimeType as string) || 'image/png';
              const persistResult = await persistBinaryContent(buffer, mimeType, {
                toolUseId,
                serverName,
              });
              if (persistResult.persisted && persistResult.filePath) {
                binaryFilePath = persistResult.filePath;
              }
            } catch {
              // Ignore binary persistence errors
            }
          }
        } else {
          flatText += JSON.stringify(item) + '\n';
        }
      }
    }

    const needsTruncation = flatText.length > maxOutputSize;
    let finalContent = flatText;

    if (needsTruncation) {
      const truncResult = await truncateMcpContentIfNeeded(flatText, maxOutputSize, {
        storeBinary: true,
        toolUseId,
        serverName,
      });
      finalContent = truncResult.placeholderText;
    }

    return {
      content: result,
      needsTruncation,
      estimatedTokens: estimateTokens(finalContent),
      isBinary: hasBinary,
      binaryFilePath,
    };
  }

  // Handle other result types
  const jsonText = JSON.stringify(result, null, 2);
  return {
    content: jsonText,
    needsTruncation: jsonText.length > maxOutputSize,
    estimatedTokens: estimateTokens(jsonText),
    isBinary: false,
  };
}

/**
 * Get content size estimate for a result
 */
export function getContentSizeEstimate(result: unknown): number {
  if (typeof result === 'string') {
    return result.length;
  }
  if (Array.isArray(result)) {
    return result.reduce((sum, item) => {
      if (typeof item === 'object' && item !== null && 'text' in item) {
        return sum + String((item as { text: string }).text).length;
      }
      return sum + JSON.stringify(item).length;
    }, 0);
  }
  return JSON.stringify(result).length;
}

/**
 * Format large output instructions for display
 */
export function getLargeOutputInstructions(result: MCPToolResult): string {
  if (!result.needsTruncation) {
    return '';
  }

  const lines = [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '[Paperclip] Large output was truncated. To view the complete content:',
    '',
  ];

  if (result.binaryFilePath) {
    lines.push(`  • Read file: ${result.binaryFilePath}`);
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', '');

  return lines.join('\n');
}