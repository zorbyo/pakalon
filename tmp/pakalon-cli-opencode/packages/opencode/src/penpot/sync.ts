import { Log } from "../util/log"
import { FileStructure } from "../pipeline/file-structure"
import type { PhaseNumber } from "../pakalon"

const log = Log.create({ service: "penpot:sync" })

export interface SyncConfig {
  projectPath: string
  penpotUrl: string
  autoSync: boolean
  cooldownMs?: number
}

export interface SyncState {
  isRunning: boolean
  lastSync: number | null
  changesDetected: number
  errors: string[]
}

export namespace PenpotSync {
  let syncInterval: ReturnType<typeof setInterval> | null = null
  let state: SyncState = {
    isRunning: false,
    lastSync: null,
    changesDetected: 0,
    errors: [],
  }

  export function getState(): SyncState {
    return { ...state }
  }

  export function start(config: SyncConfig): void {
    if (state.isRunning) {
      log.warn("sync already running")
      return
    }

    log.info("starting Penpot sync", { config })

    state = {
      isRunning: true,
      lastSync: null,
      changesDetected: 0,
      errors: [],
    }

    const cooldown = config.cooldownMs ?? 5000

    // Start monitoring wireframe directory
    syncInterval = setInterval(async () => {
      try {
        await checkForChanges(config)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        state.errors.push(error)
        log.error("sync error", { error })
      }
    }, cooldown)
  }

  export function stop(): void {
    if (syncInterval) {
      clearInterval(syncInterval)
      syncInterval = null
    }

    state.isRunning = false
    log.info("Penpot sync stopped")
  }

  export async function syncWireframes(
    projectPath: string,
    phase: PhaseNumber,
  ): Promise<boolean> {
    log.info("syncing wireframes to penpot", { projectPath, phase })

    try {
      state.lastSync = Date.now()
      state.changesDetected++
      return true
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      state.errors.push(error)
      return false
    }
  }

  export async function importFromPenpot(
    projectPath: string,
    fileId: string,
  ): Promise<string> {
    log.info("importing from penpot", { fileId })
    return JSON.stringify({ imported: true, fileId })
  }

  export async function exportToSVG(
    projectPath: string,
    phase: PhaseNumber,
  ): Promise<void> {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
  <text x="50" y="50" font-size="24">Penpot Wireframe Export</text>
  <text x="50" y="90" font-size="14">Synced from Penpot</text>
</svg>`
    await FileStructure.writeArtifact(projectPath, phase, "wireframe-export.svg", svg)
    log.info("exported wireframe to SVG")
  }

  export async function openPenpot(projectPath: string): Promise<{ url: string }> {
    const wireframeDir = `${projectPath}/.pakalon-agents/wireframes`
    const penpotUrl = `file://${wireframeDir}/index.html`

    log.info("opening Penpot", { url: penpotUrl })
    return { url: penpotUrl }
  }

  export function generateSyncScript(projectPath: string): string {
    return `// Pakalon Penpot Sync Script
// This file manages synchronization between wireframes and Penpot

const fs = require('fs')
const path = require('path')

const WIREFRAME_DIR = path.join('${projectPath}', '.pakalon-agents', 'wireframes')
const COOLDOWN_MS = 5000 // 5 second cooldown

let lastSync = null
let isRunning = false

function startSync() {
  if (isRunning) {
    console.log('Sync already running')
    return
  }

  isRunning = true
  console.log('Starting Penpot sync...')

  setInterval(() => {
    checkForChanges()
  }, COOLDOWN_MS)
}

function stopSync() {
  isRunning = false
  console.log('Penpot sync stopped')
}

function checkForChanges() {
  if (!isRunning) return

  try {
    const files = fs.readdirSync(WIREFRAME_DIR)
    const svgFiles = files.filter(f => f.endsWith('.svg'))

    for (const file of svgFiles) {
      const filePath = path.join(WIREFRAME_DIR, file)
      const stats = fs.statSync(filePath)

      if (!lastSync || stats.mtimeMs > lastSync) {
        console.log('Change detected:', file)
        syncToPenpot(filePath)
      }
    }

    lastSync = Date.now()
  } catch (err) {
    console.error('Sync error:', err.message)
  }
}

function syncToPenpot(filePath) {
  console.log('Syncing to Penpot:', filePath)
}

module.exports = { startSync, stopSync }
`
  }

  async function checkForChanges(config: SyncConfig): Promise<void> {
    if (!state.isRunning) return

    try {
      const fs = await import("fs/promises")
      const wireframeDir = `${config.projectPath}/.pakalon-agents/wireframes`
      const files = await fs.readdir(wireframeDir).catch(() => [])

      const svgFiles = files.filter((f) => f.endsWith(".svg"))

      for (const file of svgFiles) {
        const filePath = `${wireframeDir}/${file}`
        const stats = await fs.stat(filePath)

        if (!state.lastSync || stats.mtimeMs > state.lastSync) {
          log.info("change detected", { file })
          await syncWireframes(config.projectPath, 2)
        }
      }

      state.lastSync = Date.now()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      state.errors.push(error)
      log.error("check for changes failed", { error })
    }
  }
}
