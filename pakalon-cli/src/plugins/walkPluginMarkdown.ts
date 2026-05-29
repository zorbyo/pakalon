/**
 * Walk Plugin Markdown
 *
 * Utility for recursively walking plugin directories and processing markdown files.
 * Supports stopping at skill directories and filtering duplicate paths.
 */

import path from 'path'
import { getFsImplementation } from '../utils/fsOperations.js'
import { logForDebugging } from '../utils/debug.js'

interface WalkOptions {
  stopAtSkillDir?: boolean
  logLabel?: string
}

export async function walkPluginMarkdown(
  dirPath: string,
  callback: (fullPath: string, namespace: string[]) => Promise<void>,
  options: WalkOptions = {},
): Promise<void> {
  const { stopAtSkillDir = false, logLabel = 'markdown' } = options
  const fs = getFsImplementation()

  async function walk(currentPath: string, namespace: string[]): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch (error) {
      logForDebugging(`Failed to read directory ${currentPath}: ${error}`)
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isFile()) {
        continue
      }

      const fullPath = path.join(currentPath, entry.name)

      if (entry.isDirectory()) {
        if (stopAtSkillDir && /^skill\.md$/i.test(entry.name)) {
          continue
        }

        if (stopAtSkillDir && /^skills?$/i.test(entry.name)) {
          const skillFiles = await fs.readdir(fullPath, { withFileTypes: true })
          const skillMdExists = skillFiles.some(f => /^skill\.md$/i.test(f.name))

          if (skillMdExists) {
            await callback(fullPath, namespace)
            continue
          }
        }

        const childNamespace = [...namespace, entry.name]
        await walk(fullPath, childNamespace)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        await callback(fullPath, namespace)
      }
    }
  }

  await walk(dirPath, [])
}

export async function findMarkdownFiles(
  dirPath: string,
  options: WalkOptions = {},
): Promise<string[]> {
  const files: string[] = []

  await walkPluginMarkdown(
    dirPath,
    async fullPath => {
      files.push(fullPath)
    },
    options,
  )

  return files
}

export async function countMarkdownFiles(
  dirPath: string,
  options: WalkOptions = {},
): Promise<number> {
  const files = await findMarkdownFiles(dirPath, options)
  return files.length
}