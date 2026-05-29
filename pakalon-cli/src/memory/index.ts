/**
 * Memory System
 *
 * Provides persistent memory across sessions with support for:
 * - Individual memory (private)
 * - Team memory (shared)
 * - Memory scanning and relevance search
 * - Memory age tracking
 */

export * from './types.js'
export * from './memdir.js'
export * from './paths.js'
export * from './teamMemPaths.js'
export * from './teamMemPrompts.js'
export * from './memoryScan.js'
export * from './findRelevantMemories.js'
export * from './memoryAge.js'
export * from './ensureMemoryDirExists.js'
export * from './store.js'
export * from './mem0-adapter.js'
export * from './vector-store.js'
export * from './hybrid-adapter.js'
export * from './extractMemories.js'
export * from './autoDream.js'

import {
  type MemoryType,
  MEMORY_TYPES,
  parseMemoryType,
  MEMORY_FRONTMATTER_EXAMPLE,
} from './types.js'

export type { MemoryType }

import {
  buildMemoryLines,
  buildMemoryPrompt,
  loadMemoryPrompt,
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
  truncateEntrypointContent,
  type EntrypointTruncation,
  DIR_EXISTS_GUIDANCE,
  DIRS_EXIST_GUIDANCE,
} from './memdir.js'

import {
  isAutoMemoryEnabled,
  getAutoMemPath,
  getAutoMemEntrypoint,
  getMemoryBaseDir,
  isAutoMemPath,
} from './paths.js'

import {
  isTeamMemoryEnabled,
  getTeamMemPath,
  getTeamMemEntrypoint,
  isTeamMemPath,
  isTeamMemFile,
  type PathTraversalError,
} from './teamMemPaths.js'

import { buildCombinedMemoryPrompt } from './teamMemPrompts.js'

import {
  type MemoryHeader,
  scanMemoryFiles,
  formatMemoryManifest,
} from './memoryScan.js'

import {
  type RelevantMemory,
  findRelevantMemories,
} from './findRelevantMemories.js'

import {
  memoryAgeDays,
  memoryAge,
  memoryFreshnessText,
  memoryFreshnessNote,
} from './memoryAge.js'

import { ensureMemoryDirExists } from './ensureMemoryDirExists.js'
import { createHybridMem0Client } from './hybrid-adapter.js'

export {
  buildMemoryLines,
  buildMemoryPrompt,
  loadMemoryPrompt,
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
  truncateEntrypointContent,
  type EntrypointTruncation,
  DIR_EXISTS_GUIDANCE,
  DIRS_EXIST_GUIDANCE,
  isAutoMemoryEnabled,
  getAutoMemPath,
  getAutoMemEntrypoint,
  getMemoryBaseDir,
  isAutoMemPath,
  isTeamMemoryEnabled,
  getTeamMemPath,
  getTeamMemEntrypoint,
  isTeamMemPath,
  isTeamMemFile,
  type PathTraversalError,
  buildCombinedMemoryPrompt,
  type MemoryHeader,
  scanMemoryFiles,
  formatMemoryManifest,
  type RelevantMemory,
  findRelevantMemories,
  memoryAgeDays,
  memoryAge,
  memoryFreshnessText,
  memoryFreshnessNote,
  ensureMemoryDirExists,
  MEMORY_TYPES,
  parseMemoryType,
  MEMORY_FRONTMATTER_EXAMPLE,
  createHybridMem0Client,
}
