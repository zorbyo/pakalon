/**
 * Pakalon Penpot Integration
 * 
 * Handles Penpot design tool integration for Phase 2:
 * - Docker lifecycle management
 * - Project-aware design mapping
 * - Sync bridge for wireframes
 * - Export/import capabilities
 */

import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Pakalon } from "./index"
import fs from "fs/promises"
import path from "path"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)
const log = Log.create({ service: "pakalon:penpot" })

export interface PenpotConfig {
  dockerComposePath?: string
  port: number
  apiUrl: string
  projectId?: string
  fileId?: string
}

export interface PenpotProject {
  id: string
  name: string
  fileId?: string
  lastSync?: number
}

export interface PenpotSyncResult {
  success: boolean
  exportedFiles: string[]
  error?: string
}

export namespace PenpotIntegration {
  const DEFAULT_CONFIG: PenpotConfig = {
    port: 9001,
    apiUrl: "http://localhost:9001/api",
  }

  let config: PenpotConfig = { ...DEFAULT_CONFIG }

  /**
   * Initialize Penpot integration
   */
  export async function init(customConfig?: Partial<PenpotConfig>): Promise<void> {
    config = { ...DEFAULT_CONFIG, ...customConfig }
    log.info("Penpot integration initialized", { config })
  }

  /**
   * Check if Penpot is running
   */
  export async function isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${config.apiUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Start Penpot using Docker
   */
  export async function start(): Promise<{ success: boolean; message: string }> {
    try {
      // Check if Docker is available
      try {
        await execAsync("docker --version")
      } catch {
        return { success: false, message: "Docker is not installed or not in PATH" }
      }

      // Check if already running
      if (await isRunning()) {
        return { success: true, message: "Penpot is already running" }
      }

      // Create docker-compose if needed
      const composePath = config.dockerComposePath || path.join(Instance.worktree, "docker-compose.penpot.yml")
      await createDockerCompose(composePath)

      // Start Penpot
      log.info("Starting Penpot with Docker Compose")
      await execAsync(`docker-compose -f ${composePath} up -d`, {
        cwd: Instance.worktree,
      })

      // Wait for Penpot to be ready
      let attempts = 0
      while (attempts < 30) {
        if (await isRunning()) {
          return { success: true, message: "Penpot started successfully" }
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
        attempts++
      }

      return { success: false, message: "Penpot failed to start within timeout" }
    } catch (error) {
      log.error("Failed to start Penpot", { error })
      return { 
        success: false, 
        message: error instanceof Error ? error.message : String(error) 
      }
    }
  }

  /**
   * Stop Penpot
   */
  export async function stop(): Promise<{ success: boolean; message: string }> {
    try {
      const composePath = config.dockerComposePath || path.join(Instance.worktree, "docker-compose.penpot.yml")
      
      await execAsync(`docker-compose -f ${composePath} down`, {
        cwd: Instance.worktree,
      })

      return { success: true, message: "Penpot stopped successfully" }
    } catch (error) {
      log.error("Failed to stop Penpot", { error })
      return { 
        success: false, 
        message: error instanceof Error ? error.message : String(error) 
      }
    }
  }

  /**
   * Create docker-compose file for Penpot
   */
  async function createDockerCompose(composePath: string): Promise<void> {
    const compose = `
version: "3.8"

services:
  penpot-frontend:
    image: "penpotapp/frontend:latest"
    ports:
      - "${config.port}:80"
    volumes:
      - penpot_assets:/opt/data/assets
    depends_on:
      - penpot-backend
      - penpot-exporter

  penpot-backend:
    image: "penpotapp/backend:latest"
    volumes:
      - penpot_assets:/opt/data/assets
    environment:
      - PENPOT_FLAGS=enable-registration enable-login-with-password
      - PENPOT_DATABASE_URI=postgresql://penpot-postgres/penpot
      - PENPOT_REDIS_URI=redis://penpot-redis/0
      - PENPOT_ASSETS_STORAGE_BACKEND=assets-fs
      - PENPOT_STORAGE_ASSETS_FS_DIRECTORY=/opt/data/assets
    depends_on:
      - penpot-postgres
      - penpot-redis

  penpot-exporter:
    image: "penpotapp/exporter:latest"
    environment:
      - PENPOT_PUBLIC_URI=http://penpot-frontend
      - PENPOT_REDIS_URI=redis://penpot-redis/0

  penpot-postgres:
    image: "postgres:15"
    volumes:
      - penpot_postgres:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=penpot
      - POSTGRES_USER=penpot
      - POSTGRES_PASSWORD=penpot

  penpot-redis:
    image: "redis:7"

volumes:
  penpot_assets:
  penpot_postgres:
`.trim()

    await fs.writeFile(composePath, compose, "utf-8")
    log.info("Created Penpot docker-compose file", { path: composePath })
  }

  /**
   * Get Penpot project for current worktree
   */
  export async function getProject(): Promise<PenpotProject | null> {
    const workdir = Instance.worktree
    const projectPath = path.join(workdir, Pakalon.DIR_AGENTS, "phase-2", "penpot-project.json")
    
    try {
      const content = await fs.readFile(projectPath, "utf-8")
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * Save Penpot project reference
   */
  export async function saveProject(project: PenpotProject): Promise<void> {
    const workdir = Instance.worktree
    const projectPath = path.join(workdir, Pakalon.DIR_AGENTS, "phase-2", "penpot-project.json")
    
    await fs.mkdir(path.dirname(projectPath), { recursive: true })
    await fs.writeFile(projectPath, JSON.stringify(project, null, 2), "utf-8")
    
    log.info("Saved Penpot project", { project })
  }

  /**
   * Open Penpot in browser
   */
  export async function openInBrowser(projectId?: string): Promise<string> {
    const url = projectId 
      ? `${config.apiUrl.replace("/api", "")}/#/design/${projectId}`
      : `${config.apiUrl.replace("/api", "")}`
    
    log.info("Opening Penpot in browser", { url })
    return url
  }

  /**
   * Export designs from Penpot
   */
  export async function exportDesigns(projectId: string): Promise<PenpotSyncResult> {
    try {
      const workdir = Instance.worktree
      const exportDir = path.join(workdir, Pakalon.DIR_AGENTS, "phase-2", "exports")
      await fs.mkdir(exportDir, { recursive: true })

      // This would call Penpot's export API
      // For now, create placeholder files
      const exportedFiles: string[] = []
      
      // Export SVG
      const svgPath = path.join(exportDir, "wireframe.svg")
      await fs.writeFile(svgPath, "<!-- Penpot SVG export placeholder -->", "utf-8")
      exportedFiles.push(svgPath)

      // Export JSON
      const jsonPath = path.join(exportDir, "wireframe.json")
      await fs.writeFile(jsonPath, JSON.stringify({ placeholder: true }, null, 2), "utf-8")
      exportedFiles.push(jsonPath)

      log.info("Exported Penpot designs", { projectId, files: exportedFiles })
      
      return { success: true, exportedFiles }
    } catch (error) {
      log.error("Failed to export Penpot designs", { error })
      return { 
        success: false, 
        exportedFiles: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Import designs to Penpot
   */
  export async function importDesigns(files: string[]): Promise<PenpotSyncResult> {
    try {
      // This would call Penpot's import API
      log.info("Importing designs to Penpot", { files })
      
      return { success: true, exportedFiles: files }
    } catch (error) {
      log.error("Failed to import designs to Penpot", { error })
      return { 
        success: false, 
        exportedFiles: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Get Penpot status
   */
  export async function getStatus(): Promise<{
    running: boolean
    url: string
    project: PenpotProject | null
  }> {
    return {
      running: await isRunning(),
      url: `${config.apiUrl.replace("/api", "")}`,
      project: await getProject(),
    }
  }
}

export default PenpotIntegration
