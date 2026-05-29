/**
 * Background Housekeeping
 * Periodic maintenance tasks for session cleanup, cache management, and resource optimization
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import logger from './logger.js'

export interface HousekeepingTask {
  name: string
  intervalMs: number
  enabled: boolean
  run: () => Promise<void> | void
  lastRun?: Date
  lastError?: string
}

export interface HousekeepingStats {
  tasksRun: number
  tasksFailed: number
  lastRunAt?: Date
  totalDurationMs: number
}

export interface CleanupOptions {
  maxSessionAgeDays?: number
  maxLogSizeMB?: number
  maxCacheSizeMB?: number
  dryRun?: boolean
}

export interface CleanupResult {
  sessionsRemoved: number
  logsRemoved: number
  cacheCleared: number
  spaceFreedBytes: number
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'pakalon')
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions')
const LOGS_DIR = path.join(CONFIG_DIR, 'logs')
const CACHE_DIR = path.join(CONFIG_DIR, 'cache')
const ACTIVITY_DIR = path.join(CONFIG_DIR, 'activity')

class BackgroundHousekeeping {
  private tasks: Map<string, HousekeepingTask> = new Map()
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map()
  private stats: HousekeepingStats = {
    tasksRun: 0,
    tasksFailed: 0,
    totalDurationMs: 0,
  }
  private isRunning = false

  registerTask(task: HousekeepingTask): void {
    this.tasks.set(task.name, task)
    logger.debug(`[Housekeeping] Registered task: ${task.name}`)
  }

  startTask(name: string): boolean {
    const task = this.tasks.get(name)
    if (!task) {
      logger.warn(`[Housekeeping] Task not found: ${name}`)
      return false
    }

    if (!task.enabled) {
      logger.debug(`[Housekeeping] Task disabled: ${name}`)
      return false
    }

    const intervalId = setInterval(async () => {
      await this.executeTask(task)
    }, task.intervalMs)

    this.intervals.set(name, intervalId)
    logger.info(`[Housekeeping] Started task: ${name} (every ${task.intervalMs}ms)`)

    return true
  }

  stopTask(name: string): void {
    const intervalId = this.intervals.get(name)
    if (intervalId) {
      clearInterval(intervalId)
      this.intervals.delete(name)
      logger.info(`[Housekeeping] Stopped task: ${name}`)
    }
  }

  stopAll(): void {
    for (const name of this.intervals.keys()) {
      this.stopTask(name)
    }
    logger.info('[Housekeeping] All tasks stopped')
  }

  async runOnce(name?: string): Promise<void> {
    if (this.isRunning) {
      logger.warn('[Housekeeping] Already running, skipping')
      return
    }

    this.isRunning = true
    const startTime = Date.now()

    try {
      if (name) {
        const task = this.tasks.get(name)
        if (task) {
          await this.executeTask(task)
        }
      } else {
        for (const task of this.tasks.values()) {
          if (task.enabled) {
            await this.executeTask(task)
          }
        }
      }
    } finally {
      this.isRunning = false
      this.stats.lastRunAt = new Date()
      this.stats.totalDurationMs += Date.now() - startTime
    }
  }

  private async executeTask(task: HousekeepingTask): Promise<void> {
    const taskStart = Date.now()

    try {
      await task.run()
      task.lastRun = new Date()
      task.lastError = undefined
      this.stats.tasksRun++

      logger.debug(`[Housekeeping] Task completed: ${task.name} (${Date.now() - taskStart}ms)`)
    } catch (error) {
      task.lastError = error instanceof Error ? error.message : String(error)
      this.stats.tasksFailed++

      logger.error(`[Housekeeping] Task failed: ${task.name} - ${task.lastError}`)
    }
  }

  getStats(): HousekeepingStats {
    return { ...this.stats }
  }

  getTaskStatus(name: string): HousekeepingTask | undefined {
    return this.tasks.get(name)
  }

  listTasks(): HousekeepingTask[] {
    return Array.from(this.tasks.values())
  }
}

const globalHousekeeping = new BackgroundHousekeeping()

export function getHousekeeping(): BackgroundHousekeeping {
  return globalHousekeeping
}

export function registerDefaultTasks(): void {
  globalHousekeeping.registerTask({
    name: 'cleanup-old-sessions',
    intervalMs: 24 * 60 * 60 * 1000,
    enabled: true,
    run: () => cleanupOldSessions({ maxSessionAgeDays: 30 }),
  })

  globalHousekeeping.registerTask({
    name: 'cleanup-logs',
    intervalMs: 12 * 60 * 60 * 1000,
    enabled: true,
    run: () => cleanupLogs({ maxLogSizeMB: 100 }),
  })

  globalHousekeeping.registerTask({
    name: 'cleanup-cache',
    intervalMs: 6 * 60 * 60 * 1000,
    enabled: true,
    run: () => cleanupCache({ maxCacheSizeMB: 500 }),
  })

  globalHousekeeping.registerTask({
    name: 'cleanup-activity',
    intervalMs: 24 * 60 * 60 * 1000,
    enabled: true,
    run: () => cleanupActivityLogs({ maxAgeDays: 7 }),
  })
}

export function startDefaultTasks(): void {
  registerDefaultTasks()

  for (const task of globalHousekeeping.listTasks()) {
    globalHousekeeping.startTask(task.name)
  }

  logger.info('[Housekeeping] Default tasks started')
}

export async function cleanupOldSessions(options: CleanupOptions = {}): Promise<CleanupResult> {
  const { maxSessionAgeDays = 30, dryRun = false } = options
  const cutoffDate = new Date(Date.now() - maxSessionAgeDays * 24 * 60 * 60 * 1000)

  let sessionsRemoved = 0
  let spaceFreedBytes = 0

  if (!fs.existsSync(SESSIONS_DIR)) {
    return { sessionsRemoved: 0, logsRemoved: 0, cacheCleared: 0, spaceFreedBytes: 0 }
  }

  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'))

  for (const file of files) {
    const filePath = path.join(SESSIONS_DIR, file)
    const stats = fs.statSync(filePath)

    if (stats.mtime < cutoffDate) {
      if (!dryRun) {
        fs.unlinkSync(filePath)
      }
      sessionsRemoved++
      spaceFreedBytes += stats.size
    }
  }

  if (sessionsRemoved > 0) {
    logger.info(`[Housekeeping] Removed ${sessionsRemoved} old sessions (${formatBytes(spaceFreedBytes)})`)
  }

  return {
    sessionsRemoved,
    logsRemoved: 0,
    cacheCleared: 0,
    spaceFreedBytes,
  }
}

export async function cleanupLogs(options: CleanupOptions = {}): Promise<CleanupResult> {
  const { maxLogSizeMB = 100, dryRun = false } = options
  const maxLogSizeBytes = maxLogSizeMB * 1024 * 1024

  let logsRemoved = 0
  let spaceFreedBytes = 0

  if (!fs.existsSync(LOGS_DIR)) {
    return { sessionsRemoved: 0, logsRemoved: 0, cacheCleared: 0, spaceFreedBytes: 0 }
  }

  const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'))
  const fileStats = files.map(f => ({
    name: f,
    path: path.join(LOGS_DIR, f),
    size: fs.statSync(path.join(LOGS_DIR, f)).size,
    mtime: fs.statSync(path.join(LOGS_DIR, f)).mtime,
  }))

  fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime())

  let totalSize = fileStats.reduce((sum, f) => sum + f.size, 0)

  for (const file of fileStats) {
    if (totalSize <= maxLogSizeBytes) break

    if (!dryRun) {
      fs.unlinkSync(file.path)
    }
    logsRemoved++
    spaceFreedBytes += file.size
    totalSize -= file.size
  }

  if (logsRemoved > 0) {
    logger.info(`[Housekeeping] Removed ${logsRemoved} log files (${formatBytes(spaceFreedBytes)})`)
  }

  return {
    sessionsRemoved: 0,
    logsRemoved,
    cacheCleared: 0,
    spaceFreedBytes,
  }
}

export async function cleanupCache(options: CleanupOptions = {}): Promise<CleanupResult> {
  const { maxCacheSizeMB = 500, dryRun = false } = options
  const maxCacheSizeBytes = maxCacheSizeMB * 1024 * 1024

  let cacheCleared = 0
  let spaceFreedBytes = 0

  if (!fs.existsSync(CACHE_DIR)) {
    return { sessionsRemoved: 0, logsRemoved: 0, cacheCleared: 0, spaceFreedBytes: 0 }
  }

  const files = getAllFiles(CACHE_DIR)
  const fileStats = files.map(f => ({
    path: f,
    size: fs.statSync(f).size,
    mtime: fs.statSync(f).mtime,
  }))

  fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime())

  let totalSize = fileStats.reduce((sum, f) => sum + f.size, 0)

  for (const file of fileStats) {
    if (totalSize <= maxCacheSizeBytes) break

    if (!dryRun) {
      fs.unlinkSync(file.path)
    }
    cacheCleared++
    spaceFreedBytes += file.size
    totalSize -= file.size
  }

  if (cacheCleared > 0) {
    logger.info(`[Housekeeping] Cleared ${cacheCleared} cache files (${formatBytes(spaceFreedBytes)})`)
  }

  return {
    sessionsRemoved: 0,
    logsRemoved: 0,
    cacheCleared,
    spaceFreedBytes,
  }
}

export async function cleanupActivityLogs(options: { maxAgeDays?: number; dryRun?: boolean } = {}): Promise<CleanupResult> {
  const { maxAgeDays = 7, dryRun = false } = options
  const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)

  let logsRemoved = 0
  let spaceFreedBytes = 0

  if (!fs.existsSync(ACTIVITY_DIR)) {
    return { sessionsRemoved: 0, logsRemoved: 0, cacheCleared: 0, spaceFreedBytes: 0 }
  }

  const files = fs.readdirSync(ACTIVITY_DIR).filter(f => f.endsWith('.json'))

  for (const file of files) {
    const filePath = path.join(ACTIVITY_DIR, file)
    const stats = fs.statSync(filePath)

    if (stats.mtime < cutoffDate) {
      if (!dryRun) {
        fs.unlinkSync(filePath)
      }
      logsRemoved++
      spaceFreedBytes += stats.size
    }
  }

  if (logsRemoved > 0) {
    logger.info(`[Housekeeping] Removed ${logsRemoved} activity logs (${formatBytes(spaceFreedBytes)})`)
  }

  return {
    sessionsRemoved: 0,
    logsRemoved,
    cacheCleared: 0,
    spaceFreedBytes,
  }
}

export async function runFullCleanup(options: CleanupOptions = {}): Promise<CleanupResult> {
  const results = await Promise.all([
    cleanupOldSessions(options),
    cleanupLogs(options),
    cleanupCache(options),
    cleanupActivityLogs({ maxAgeDays: options.maxSessionAgeDays, dryRun: options.dryRun }),
  ])

  return {
    sessionsRemoved: results[0]!.sessionsRemoved,
    logsRemoved: results[0]!.logsRemoved + results[1]!.logsRemoved + results[3]!.logsRemoved,
    cacheCleared: results[2]!.cacheCleared,
    spaceFreedBytes: results.reduce((sum, r) => sum + r.spaceFreedBytes, 0),
  }
}

function getAllFiles(dir: string): string[] {
  const files: string[] = []

  function traverse(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)

      if (entry.isDirectory()) {
        traverse(fullPath)
      } else {
        files.push(fullPath)
      }
    }
  }

  traverse(dir)
  return files
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

export function getDirectorySizes(): Record<string, number> {
  const dirs = [SESSIONS_DIR, LOGS_DIR, CACHE_DIR, ACTIVITY_DIR]
  const sizes: Record<string, number> = {}

  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      const files = getAllFiles(dir)
      sizes[dir] = files.reduce((sum, f) => sum + fs.statSync(f).size, 0)
    } else {
      sizes[dir] = 0
    }
  }

  return sizes
}
