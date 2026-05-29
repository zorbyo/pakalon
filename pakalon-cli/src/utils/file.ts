/**
 * File Utilities
 *
 * Common file operation utilities used by the plugin system.
 */

import fs from 'fs/promises'
import path from 'path'

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
  const content = await fs.readFile(filePath, encoding)
  return typeof content === 'string' ? content : content.toString(encoding)
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8')
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath)
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2))
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function removeDir(dirPath: string, options?: { force?: boolean }): Promise<void> {
  await fs.rm(dirPath, { recursive: options?.force ?? true, force: options?.force ?? true })
}

export async function copyFile(src: string, dest: string): Promise<void> {
  await fs.copyFile(src, dest)
}

export async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

export async function isFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile()
  } catch {
    return false
  }
}

export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath)
  return stats.size
}

export async function getModifiedTime(filePath: string): Promise<Date> {
  const stats = await fs.stat(filePath)
  return stats.mtime
}

export function resolvePath(...parts: string[]): string {
  return path.resolve(...parts)
}

export function joinPath(...parts: string[]): string {
  return path.join(...parts)
}

export function dirname(filePath: string): string {
  return path.dirname(filePath)
}

export function basename(filePath: string, ext?: string): string {
  return path.basename(filePath, ext)
}

export function relativePath(from: string, to: string): string {
  return path.relative(from, to)
}