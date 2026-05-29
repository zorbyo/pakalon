/**
 * Memory Scan Utility
 *
 * Scans project directories for memory files, analyzing their content,
 * structure, and health. Provides detailed reports on memory file status.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import logger from '../../utils/logger.js'
import { detectMemoryFiles, type DetectedMemoryFile } from '../../utils/memoryFileDetection.js'
import { getMemoryAgeInfo, type MemoryAgeInfo } from './memoryAge.js'

export interface MemoryScanResult {
  files: ScannedMemoryFile[]
  summary: MemoryScanSummary
  healthScore: number
}

export interface ScannedMemoryFile {
  detected: DetectedMemoryFile
  age: MemoryAgeInfo
  size: number
  lineCount: number
  hasFrontmatter: boolean
  isEmpty: boolean
  error: string | null
}

export interface MemoryScanSummary {
  totalFiles: number
  totalSize: number
  totalLines: number
  emptyFiles: number
  staleFiles: number
  filesWithErrors: number
  avgLinesPerFile: number
  newestFile: string | null
  oldestFile: string | null
}

export async function scanMemoryFiles(
  projectRoot: string,
  options: {
    maxDepth?: number
    includeContent?: boolean
  } = {},
): Promise<MemoryScanResult> {
  const { maxDepth = 5, includeContent = false } = options

  const detected = await detectMemoryFiles(projectRoot, { maxDepth })
  const scanned: ScannedMemoryFile[] = []
  let totalSize = 0
  let totalLines = 0
  let emptyFiles = 0
  let staleFiles = 0
  let filesWithErrors = 0
  let newestFile: string | null = null
  let oldestFile: string | null = null
  let newestTime = 0
  let oldestTime = Infinity

  for (const file of detected) {
    const scannedFile = await scanSingleFile(file, includeContent)
    scanned.push(scannedFile)

    if (scannedFile.error) {
      filesWithErrors++
    } else {
      totalSize += scannedFile.size
      totalLines += scannedFile.lineCount

      if (scannedFile.isEmpty) {
        emptyFiles++
      }
      if (scannedFile.age.isStale) {
        staleFiles++
      }

      const mtime = scannedFile.detected.type !== 'project-root'
        ? Date.now()
        : Date.now()

      if (mtime > newestTime) {
        newestTime = mtime
        newestFile = file.path
      }
      if (mtime < oldestTime) {
        oldestTime = mtime
        oldestFile = file.path
      }
    }
  }

  const healthScore = calculateHealthScore(scanned)

  const summary: MemoryScanSummary = {
    totalFiles: scanned.length,
    totalSize,
    totalLines,
    emptyFiles,
    staleFiles,
    filesWithErrors,
    avgLinesPerFile: scanned.length > 0 ? totalLines / scanned.length : 0,
    newestFile,
    oldestFile,
  }

  logger.info('[memory-scan] Scan complete', {
    files: summary.totalFiles,
    healthScore,
    stale: staleFiles,
    errors: filesWithErrors,
  })

  return {
    files: scanned,
    summary,
    healthScore,
  }
}

async function scanSingleFile(
  detected: DetectedMemoryFile,
  includeContent: boolean,
): Promise<ScannedMemoryFile> {
  try {
    const stats = await fs.stat(detected.path)
    const content = includeContent
      ? await fs.readFile(detected.path, 'utf-8')
      : ''

    const lineCount = content
      ? content.split('\n').length
      : estimateLineCount(stats.size)

    const hasFrontmatter = content
      ? /^---\r?\n/.test(content)
      : false

    const isEmpty = stats.size === 0 || (content && !content.trim())

    const age = getMemoryAgeInfo(stats.mtimeMs)

    return {
      detected,
      age,
      size: stats.size,
      lineCount,
      hasFrontmatter,
      isEmpty,
      error: null,
    }
  } catch (error) {
    return {
      detected,
      age: getMemoryAgeInfo(0),
      size: 0,
      lineCount: 0,
      hasFrontmatter: false,
      isEmpty: true,
      error: String(error),
    }
  }
}

function estimateLineCount(sizeBytes: number): number {
  const avgLineLength = 60
  return Math.max(1, Math.floor(sizeBytes / avgLineLength))
}

function calculateHealthScore(files: ScannedMemoryFile[]): number {
  if (files.length === 0) return 0

  let score = 100

  const emptyRatio = files.filter(f => f.isEmpty).length / files.length
  score -= emptyRatio * 30

  const staleRatio = files.filter(f => f.age.isStale).length / files.length
  score -= staleRatio * 20

  const errorRatio = files.filter(f => f.error).length / files.length
  score -= errorRatio * 40

  const noFrontmatter = files.filter(
    f => !f.error && !f.isEmpty && !f.hasFrontmatter,
  ).length / files.length
  score -= noFrontmatter * 10

  return Math.max(0, Math.min(100, Math.round(score)))
}

export async function getMemoryHealthReport(
  projectRoot: string,
): Promise<{
  score: number
  grade: string
  recommendations: string[]
}> {
  const result = await scanMemoryFiles(projectRoot)
  const recommendations: string[] = []

  if (result.summary.emptyFiles > 0) {
    recommendations.push(
      `Remove or populate ${result.summary.emptyFiles} empty memory file(s)`,
    )
  }

  if (result.summary.staleFiles > 0) {
    recommendations.push(
      `Review ${result.summary.staleFiles} stale memory file(s) for relevance`,
    )
  }

  if (result.summary.filesWithErrors > 0) {
    recommendations.push(
      `Fix ${result.summary.filesWithErrors} memory file(s) with errors`,
    )
  }

  const filesWithoutFrontmatter = result.files.filter(
    f => !f.error && !f.isEmpty && !f.hasFrontmatter,
  ).length

  if (filesWithoutFrontmatter > 0) {
    recommendations.push(
      `Add frontmatter metadata to ${filesWithoutFrontmatter} file(s)`,
    )
  }

  if (result.summary.totalFiles === 0) {
    recommendations.push('Create a CLAUDE.md or PAKALON.md memory file')
  }

  return {
    score: result.healthScore,
    grade: getGrade(result.healthScore),
    recommendations,
  }
}

function getGrade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}
