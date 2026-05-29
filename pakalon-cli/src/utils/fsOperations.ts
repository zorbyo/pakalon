/**
 * File System Operations
 *
 * Provides a unified filesystem interface for plugin operations.
 */

import fs from 'fs/promises'
import path from 'path'

export interface FsImplementation {
  readFile(path: string, options?: { encoding?: string; flag?: string }): Promise<string | Buffer>
  writeFile(path: string, data: string | Buffer, options?: { encoding?: string; flag?: string }): Promise<void>
  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<fs.Dirent[] | string[]>
  stat(path: string): Promise<fs.Stats>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  copyFile(src: string, dest: string): Promise<void>
  unlink(path: string): Promise<void>
  rmdir(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  rename(src: string, dest: string): Promise<void>
  access(path: string, mode?: number): Promise<void>
  exists(path: string): Promise<boolean>
}

class NodeFsImplementation implements FsImplementation {
  async readFile(filePath: string, options?: { encoding?: string; flag?: string }): Promise<string | Buffer> {
    return fs.readFile(filePath, options)
  }

  async writeFile(filePath: string, data: string | Buffer, options?: { encoding?: string; flag?: string }): Promise<void> {
    return fs.writeFile(filePath, data, options)
  }

  async readdir(dirPath: string, options?: { withFileTypes?: boolean }): Promise<fs.Dirent[] | string[]> {
    return fs.readdir(dirPath, options)
  }

  async stat(filePath: string): Promise<fs.Stats> {
    return fs.stat(filePath)
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<string> {
    return fs.mkdir(dirPath, options)
  }

  async rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    return fs.rm(filePath, options)
  }

  async copyFile(src: string, dest: string): Promise<void> {
    return fs.copyFile(src, dest)
  }

  async unlink(filePath: string): Promise<void> {
    return fs.unlink(filePath)
  }

  async rmdir(dirPath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    return fs.rmdir(dirPath, options)
  }

  async rename(src: string, dest: string): Promise<void> {
    return fs.rename(src, dest)
  }

  async access(filePath: string, mode?: number): Promise<void> {
    return fs.access(filePath, mode)
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}

let fsInstance: FsImplementation | null = null

export function getFsImplementation(): FsImplementation {
  if (!fsInstance) {
    fsInstance = new NodeFsImplementation()
  }
  return fsInstance
}

export function setFsImplementation(fs: FsImplementation): void {
  fsInstance = fs
}

const loadedPathsTracker = new Map<string, Set<string>>()

export function isDuplicatePath(fs: FsImplementation, filePath: string, loadedPaths: Set<string>): boolean {
  if (loadedPaths.has(filePath)) {
    return true
  }
  loadedPaths.add(filePath)
  return false
}

export function resetLoadedPaths(): void {
  loadedPathsTracker.clear()
}

export async function readFileRange(
  filePath: string,
  offset: number,
  maxBytes: number,
): Promise<{ content: string; bytesRead: number } | null> {
  try {
    const fh = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(maxBytes);
      const { bytesRead } = await fh.read(buffer, 0, maxBytes, offset);
      if (bytesRead === 0) {
        return null;
      }
      return {
        content: buffer.toString('utf8', 0, bytesRead),
        bytesRead,
      };
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

export async function tailFile(
  filePath: string,
  maxBytes: number,
): Promise<{ content: string; bytesTotal: number; bytesRead: number }> {
  try {
    const stats = await fs.stat(filePath);
    const bytesTotal = stats.size;
    if (bytesTotal === 0) {
      return { content: '', bytesTotal: 0, bytesRead: 0 };
    }
    const startOffset = Math.max(0, bytesTotal - maxBytes);
    const bytesToRead = bytesTotal - startOffset;
    const fh = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await fh.read(buffer, 0, bytesToRead, startOffset);
      return {
        content: buffer.toString('utf8', 0, bytesRead),
        bytesTotal,
        bytesRead,
      };
    } finally {
      await fh.close();
    }
  } catch {
    return { content: '', bytesTotal: 0, bytesRead: 0 };
  }
}