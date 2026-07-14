/**
 * Pakalon State Manager
 * 
 * Handles persistence of Pakalon pipeline state to disk.
 * State is stored in .pakalon/state.json for normal mode
 * and .pakalon-agents/state.json for Pakalon mode.
 */

import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "./index"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "pakalon:state" })

// Schema version for migrations
const SCHEMA_VERSION = 1

export interface PakalonState {
  version: number
  mode: "hil" | "yolo"
  currentPhase: Pakalon.PhaseNumber
  phaseStatus: {
    [K in Pakalon.PhaseNumber]: "pending" | "in_progress" | "completed"
  }
  qa: {
    mode: "hil" | "yolo"
    currentIndex: number
    responses: Record<string, string>
    complete: boolean
  } | null
  artifacts: {
    phase1: string[]
    phase2: string[]
    phase3: string[]
    phase4: string[]
    phase5: string[]
    phase6: string[]
  }
  subagents: {
    [key: string]: {
      status: "pending" | "running" | "completed" | "failed"
      outputPath?: string
      completedAt?: string
    }
  }
  metadata: {
    createdAt: string
    updatedAt: string
    projectPath: string
    prompt?: string
  }
}

export interface NormalModeState {
  version: number
  initialized: boolean
  artifacts: {
    plan: boolean
    tasks: boolean
    userStories: boolean
    contextManagement: boolean
    skills: boolean
  }
  metadata: {
    createdAt: string
    updatedAt: string
    projectPath: string
  }
}

/**
 * Get default Pakalon state
 */
function getDefaultPakalonState(projectPath: string, mode: "hil" | "yolo"): PakalonState {
  const now = new Date().toISOString()
  return {
    version: SCHEMA_VERSION,
    mode,
    currentPhase: 1,
    phaseStatus: {
      1: "in_progress",
      2: "pending",
      3: "pending",
      4: "pending",
      5: "pending",
      6: "pending",
    },
    qa: null,
    artifacts: {
      phase1: [],
      phase2: [],
      phase3: [],
      phase4: [],
      phase5: [],
      phase6: [],
    },
    subagents: {},
    metadata: {
      createdAt: now,
      updatedAt: now,
      projectPath,
    },
  }
}

/**
 * Get default normal mode state
 */
function getDefaultNormalModeState(projectPath: string): NormalModeState {
  const now = new Date().toISOString()
  return {
    version: SCHEMA_VERSION,
    initialized: false,
    artifacts: {
      plan: false,
      tasks: false,
      userStories: false,
      contextManagement: false,
      skills: false,
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
      projectPath,
    },
  }
}

/**
 * State paths
 */
function getPakalonStatePath(projectPath: string): string {
  return path.join(projectPath, Pakalon.DIR_AGENTS, "state.json")
}

function getNormalStatePath(projectPath: string): string {
  return path.join(projectPath, Pakalon.DIR_NORMAL, "state.json")
}

export namespace PakalonState {
  const memoryCache = new Map<string, PakalonState>()

  /**
   * Load state from disk
   */
  export async function load(projectPath: string): Promise<PakalonState | null> {
    // Check memory cache first
    const cached = memoryCache.get(projectPath)
    if (cached) return cached

    const statePath = getPakalonStatePath(projectPath)
    try {
      const content = await fs.readFile(statePath, "utf-8")
      const state = JSON.parse(content) as PakalonState
      
      // Validate and migrate if needed
      const migrated = await migrate(state, projectPath)
      memoryCache.set(projectPath, migrated)
      return migrated
    } catch {
      return null
    }
  }

  /**
   * Save state to disk
   */
  export async function save(projectPath: string, state: PakalonState): Promise<void> {
    state.metadata.updatedAt = new Date().toISOString()
    
    const statePath = getPakalonStatePath(projectPath)
    const stateDir = path.dirname(statePath)
    
    await fs.mkdir(stateDir, { recursive: true })
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8")
    
    memoryCache.set(projectPath, state)
    log.info("State saved", { projectPath, phase: state.currentPhase })
  }

  /**
   * Initialize new state
   */
  export async function init(projectPath: string, mode: "hil" | "yolo", prompt?: string): Promise<PakalonState> {
    const state = getDefaultPakalonState(projectPath, mode)
    if (prompt) state.metadata.prompt = prompt
    
    await save(projectPath, state)
    log.info("State initialized", { projectPath, mode })
    return state
  }

  /**
   * Get or create state
   */
  export async function getOrCreate(projectPath: string, mode: "hil" | "yolo" = "hil"): Promise<PakalonState> {
    const existing = await load(projectPath)
    if (existing) return existing
    return init(projectPath, mode)
  }

  /**
   * Update phase status
   */
  export async function updatePhaseStatus(
    projectPath: string,
    phase: Pakalon.PhaseNumber,
    status: "pending" | "in_progress" | "completed"
  ): Promise<PakalonState | null> {
    const state = await load(projectPath)
    if (!state) return null

    state.phaseStatus[phase] = status
    
    // If completing a phase, advance to next
    if (status === "completed" && phase < 6) {
      state.currentPhase = (phase + 1) as Pakalon.PhaseNumber
      state.phaseStatus[state.currentPhase] = "in_progress"
    }
    
    await save(projectPath, state)
    return state
  }

  /**
   * Update Q&A state
   */
  export async function updateQA(
    projectPath: string,
    qa: PakalonState["qa"]
  ): Promise<PakalonState | null> {
    const state = await load(projectPath)
    if (!state) return null

    state.qa = qa
    await save(projectPath, state)
    return state
  }

  /**
   * Add artifact to phase
   */
  export async function addArtifact(
    projectPath: string,
    phase: Pakalon.PhaseNumber,
    artifactPath: string
  ): Promise<PakalonState | null> {
    const state = await load(projectPath)
    if (!state) return null

    const phaseKey = `phase${phase}` as keyof typeof state.artifacts
    if (!state.artifacts[phaseKey].includes(artifactPath)) {
      state.artifacts[phaseKey].push(artifactPath)
    }
    
    await save(projectPath, state)
    return state
  }

  /**
   * Update subagent status
   */
  export async function updateSubagent(
    projectPath: string,
    subagentId: string,
    status: PakalonState["subagents"][string]
  ): Promise<PakalonState | null> {
    const state = await load(projectPath)
    if (!state) return null

    state.subagents[subagentId] = status
    await save(projectPath, state)
    return state
  }

  /**
   * Migrate state to current schema version
   */
  async function migrate(state: PakalonState, projectPath: string): Promise<PakalonState> {
    if (state.version === SCHEMA_VERSION) return state

    log.info("Migrating state", { from: state.version, to: SCHEMA_VERSION })

    // Add migration logic here as schema evolves
    // For now, just update version
    state.version = SCHEMA_VERSION
    await save(projectPath, state)
    
    return state
  }

  /**
   * Delete state
   */
  export async function clear(projectPath: string): Promise<void> {
    const statePath = getPakalonStatePath(projectPath)
    try {
      await fs.unlink(statePath)
    } catch {}
    memoryCache.delete(projectPath)
    log.info("State cleared", { projectPath })
  }

  /**
   * Check if state exists
   */
  export async function exists(projectPath: string): Promise<boolean> {
    const statePath = getPakalonStatePath(projectPath)
    try {
      await fs.access(statePath)
      return true
    } catch {
      return false
    }
  }
}

export namespace NormalModeState {
  const memoryCache = new Map<string, NormalModeState>()

  /**
   * Load state from disk
   */
  export async function load(projectPath: string): Promise<NormalModeState | null> {
    const cached = memoryCache.get(projectPath)
    if (cached) return cached

    const statePath = getNormalStatePath(projectPath)
    try {
      const content = await fs.readFile(statePath, "utf-8")
      const state = JSON.parse(content) as NormalModeState
      memoryCache.set(projectPath, state)
      return state
    } catch {
      return null
    }
  }

  /**
   * Save state to disk
   */
  export async function save(projectPath: string, state: NormalModeState): Promise<void> {
    state.metadata.updatedAt = new Date().toISOString()
    
    const statePath = getNormalStatePath(projectPath)
    const stateDir = path.dirname(statePath)
    
    await fs.mkdir(stateDir, { recursive: true })
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8")
    
    memoryCache.set(projectPath, state)
    log.info("Normal mode state saved", { projectPath })
  }

  /**
   * Initialize new state
   */
  export async function init(projectPath: string): Promise<NormalModeState> {
    const state = getDefaultNormalModeState(projectPath)
    await save(projectPath, state)
    return state
  }

  /**
   * Get or create state
   */
  export async function getOrCreate(projectPath: string): Promise<NormalModeState> {
    const existing = await load(projectPath)
    if (existing) return existing
    return init(projectPath)
  }

  /**
   * Mark artifact as generated
   */
  export async function markArtifact(
    projectPath: string,
    artifact: keyof NormalModeState["artifacts"]
  ): Promise<NormalModeState | null> {
    const state = await load(projectPath)
    if (!state) return null

    state.artifacts[artifact] = true
    state.initialized = Object.values(state.artifacts).some(v => v)
    
    await save(projectPath, state)
    return state
  }

  /**
   * Clear state
   */
  export async function clear(projectPath: string): Promise<void> {
    const statePath = getNormalStatePath(projectPath)
    try {
      await fs.unlink(statePath)
    } catch {}
    memoryCache.delete(projectPath)
  }
}

export default { PakalonState, NormalModeState }
