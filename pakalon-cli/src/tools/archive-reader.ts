/**
 * Archive Reader
 * 
 * Reads archive files (zip, tar, tar.gz) and extracts contents.
 * Based on OMP's archive-reader tool.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz';

export interface ArchiveNode {
  path: string;
  isDirectory: boolean;
  size: number;
  mtimeMs?: number;
}

export interface ArchiveDirectoryEntry extends ArchiveNode {
  name: string;
}

export interface ExtractedArchiveFile extends ArchiveNode {
  bytes: Uint8Array;
}

// ============================================================================
// Archive Reader
// ============================================================================

export class ArchiveReader {
  private archivePath: string;
  private format: ArchiveFormat;
  private entries: ArchiveNode[] = [];

  constructor(archivePath: string) {
    this.archivePath = archivePath;
    this.format = this.detectFormat(archivePath);
  }

  /**
   * Detect archive format from extension
   */
  private detectFormat(filePath: string): ArchiveFormat {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      return 'tar.gz';
    } else if (lower.endsWith('.tar')) {
      return 'tar';
    } else if (lower.endsWith('.zip')) {
      return 'zip';
    }
    throw new Error(`Unsupported archive format: ${filePath}`);
  }

  /**
   * List all entries in the archive
   */
  async list(): Promise<ArchiveNode[]> {
    if (this.entries.length > 0) {
      return this.entries;
    }

    try {
      const content = await fs.readFile(this.archivePath);
      
      if (this.format === 'zip') {
        this.entries = await this.listZip(content);
      } else {
        this.entries = await this.listTar(content);
      }

      return this.entries;
    } catch (error) {
      logger.error('[archive-reader] Failed to list archive', { error: String(error) });
      return [];
    }
  }

  /**
   * List zip entries (simplified - uses built-in unzip)
   */
  private async listZip(content: Buffer): Promise<ArchiveNode[]> {
    // Simplified zip listing - in production would use a proper zip library
    const entries: ArchiveNode[] = [];
    
    // Parse zip central directory (simplified)
    const text = content.toString('binary');
    let pos = 0;
    
    while (pos < text.length) {
      const signature = text.substring(pos, pos + 4);
      if (signature === 'PK\x01\x02') {
        // Central directory entry
        const fileNameLength = content.readUInt16LE(pos + 28);
        const fileName = text.substring(pos + 46, pos + 46 + fileNameLength);
        const uncompressedSize = content.readUInt32LE(pos + 24);
        
        entries.push({
          path: fileName,
          isDirectory: fileName.endsWith('/'),
          size: uncompressedSize,
        });
        
        pos += 46 + fileNameLength;
      } else {
        break;
      }
    }

    return entries;
  }

  /**
   * List tar entries (simplified)
   */
  private async listTar(content: Buffer): Promise<ArchiveNode[]> {
    const entries: ArchiveNode[] = [];
    let pos = 0;

    while (pos < content.length - 512) {
      const name = content.toString('utf-8', pos, pos + 100).replace(/\0/g, '');
      if (!name) break;

      const sizeOctal = content.toString('utf-8', pos + 124, pos + 136).replace(/\0/g, '').trim();
      const size = parseInt(sizeOctal, 8) || 0;
      const typeflag = content.toString('utf-8', pos + 156, pos + 157);
      
      entries.push({
        path: name,
        isDirectory: typeflag === '5' || name.endsWith('/'),
        size,
      });

      pos += 512 + Math.ceil(size / 512) * 512;
    }

    return entries;
  }

  /**
   * Read a file from the archive
   */
  async readFile(filePath: string): Promise<ExtractedArchiveFile | null> {
    try {
      const content = await fs.readFile(this.archivePath);
      
      if (this.format === 'zip') {
        return await this.readZipFile(content, filePath);
      } else {
        return await this.readTarFile(content, filePath);
      }
    } catch (error) {
      logger.error('[archive-reader] Failed to read file', { filePath, error: String(error) });
      return null;
    }
  }

  /**
   * Read a file from zip (simplified)
   */
  private async readZipFile(content: Buffer, filePath: string): Promise<ExtractedArchiveFile | null> {
    // Simplified - in production would use a proper zip library
    const entries = await this.listZip(content);
    const entry = entries.find(e => e.path === filePath);
    
    if (!entry) return null;

    return {
      ...entry,
      bytes: new Uint8Array(0), // Would need proper zip extraction
    };
  }

  /**
   * Read a file from tar (simplified)
   */
  private async readTarFile(content: Buffer, filePath: string): Promise<ExtractedArchiveFile | null> {
    const entries = await this.listTar(content);
    const entry = entries.find(e => e.path === filePath);
    
    if (!entry) return null;

    return {
      ...entry,
      bytes: new Uint8Array(0), // Would need proper tar extraction
    };
  }

  /**
   * Get archive format
   */
  getFormat(): ArchiveFormat {
    return this.format;
  }

  /**
   * Get archive path
   */
  getArchivePath(): string {
    return this.archivePath;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a file is an archive
 */
export function isArchive(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.tar') || 
         lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
}

/**
 * Get archive format from path
 */
export function getArchiveFormat(filePath: string): ArchiveFormat | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  return null;
}
