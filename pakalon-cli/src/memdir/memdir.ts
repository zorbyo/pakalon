/**
 * Memory Directory (memdir)
 *
 * Manages memory files and nested memory attachments.
 * Provides functionality for CLAUDE.md and other memory-related operations.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '@/utils/logger.js';

export interface MemoryFile {
  path: string;
  content: string;
  lastModified: number;
  size: number;
}

export interface MemoryPathOptions {
  projectRoot?: string;
  memoryDir?: string;
  autoCreate?: boolean;
}

const DEFAULT_MEMORY_DIR = '.memdir';

class MemoryDirectoryManager {
  private projectRoot: string;
  private memoryDir: string;
  private files: Map<string, MemoryFile> = new Map();
  private loaded = false;

  constructor(projectRoot: string, memoryDir?: string) {
    this.projectRoot = projectRoot;
    this.memoryDir = memoryDir ?? path.join(projectRoot, DEFAULT_MEMORY_DIR);
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
      await this.scanMemoryFiles();
      this.loaded = true;
      logger.debug(`[memdir] Initialized with ${this.files.size} memory files`);
    } catch (error) {
      logger.error(`[memdir] Failed to initialize: ${error}`);
    }
  }

  async scanMemoryFiles(): Promise<void> {
    try {
      const entries = await fs.readdir(this.memoryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = path.join(this.memoryDir, entry.name);
          await this.loadMemoryFile(filePath);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(`[memdir] Failed to scan: ${error}`);
      }
    }
  }

  private async loadMemoryFile(filePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const relativePath = path.relative(this.projectRoot, filePath);

      this.files.set(relativePath, {
        path: filePath,
        content,
        lastModified: stats.mtimeMs,
        size: stats.size,
      });
    } catch (error) {
      logger.error(`[memdir] Failed to load ${filePath}: ${error}`);
    }
  }

  async getMemoryFile(relativePath: string): Promise<MemoryFile | null> {
    if (!this.loaded) {
      await this.initialize();
    }
    return this.files.get(relativePath) ?? null;
  }

  async getAllMemoryFiles(): Promise<MemoryFile[]> {
    if (!this.loaded) {
      await this.initialize();
    }
    return Array.from(this.files.values());
  }

  async updateMemoryFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(this.projectRoot, relativePath);

    await fs.writeFile(fullPath, content, 'utf-8');

    const stats = await fs.stat(fullPath);
    const relPath = path.relative(this.projectRoot, fullPath);

    this.files.set(relPath, {
      path: fullPath,
      content,
      lastModified: stats.mtimeMs,
      size: stats.size,
    });

    logger.debug(`[memdir] Updated memory file: ${relPath}`);
  }

  async deleteMemoryFile(relativePath: string): Promise<void> {
    const fullPath = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(this.projectRoot, relativePath);

    try {
      await fs.unlink(fullPath);
      const relPath = path.relative(this.projectRoot, fullPath);
      this.files.delete(relPath);
      logger.debug(`[memdir] Deleted memory file: ${relPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  hasMemoryFile(relativePath: string): boolean {
    return this.files.has(relativePath);
  }

  getMemoryFileContent(relativePath: string): string | null {
    return this.files.get(relativePath)?.content ?? null;
  }

  async createMemoryFromPrompt(
    name: string,
    prompt: string,
    options?: { append?: boolean; timestamp?: boolean },
  ): Promise<string> {
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const filePath = path.join(this.memoryDir, fileName);

    let content = prompt;
    if (options?.timestamp) {
      content = `---\nCreated: ${new Date().toISOString()}\n---\n\n${prompt}`;
    }

    if (options?.append) {
      const existing = await this.getMemoryFileContent(fileName);
      if (existing) {
        content = existing + '\n\n' + content;
      }
    }

    await this.updateMemoryFile(filePath, content);

    logger.info(`[memdir] Created memory file: ${fileName}`);

    return fileName;
  }

  getMemoryStats(): {
    fileCount: number;
    totalSize: number;
    files: Array<{ name: string; size: number; lastModified: number }>;
  } {
    const files = Array.from(this.files.values()).map(f => ({
      name: path.relative(this.projectRoot, f.path),
      size: f.size,
      lastModified: f.lastModified,
    }));

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    return {
      fileCount: this.files.size,
      totalSize,
      files,
    };
  }
}

let globalMemdir: MemoryDirectoryManager | null = null;

export function initializeMemoryDirectory(
  projectRoot: string,
  memoryDir?: string,
): MemoryDirectoryManager {
  globalMemdir = new MemoryDirectoryManager(projectRoot, memoryDir);
  return globalMemdir;
}

export function getMemoryDirectory(): MemoryDirectoryManager | null {
  return globalMemdir;
}

export async function loadMemoryPrompt(
  projectRoot: string,
  options?: MemoryPathOptions,
): Promise<string[]> {
  const memdir = new MemoryDirectoryManager(
    projectRoot,
    options?.memoryDir,
  );

  await memdir.initialize();

  const memoryFiles = await memdir.getAllMemoryFiles();
  const prompts: string[] = [];

  for (const file of memoryFiles) {
    if (file.path.includes('CLAUDE.md') || file.path.includes('MEMORY.md')) {
      prompts.push(file.content);
    }
  }

  return prompts;
}

export function hasAutoMemPathOverride(): boolean {
  return process.env.PAKALON_MEMDIR_PATH !== undefined;
}

export function getMemdirPath(projectRoot: string): string {
  return process.env.PAKALON_MEMDIR_PATH ?? path.join(projectRoot, DEFAULT_MEMORY_DIR);
}

export { MemoryDirectoryManager };
export type { MemoryFile, MemoryPathOptions };