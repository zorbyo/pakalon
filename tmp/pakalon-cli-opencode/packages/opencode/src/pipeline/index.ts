import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "../pakalon"
import type { PhaseNumber } from "../pakalon"
import { FileStructure } from "./file-structure"
import { ContextManager, type TokenBudget } from "./context-manager"
import { Modes, type ModeConfig, type ExecutionMode } from "./modes"
import type { PipelineState, PipelineConfig, PhaseResult } from "./types"

const log = Log.create({ service: "pipeline" })

export interface PipelineInfo {
  id: string
  projectPath: string
  mode: ExecutionMode
  currentPhase: PhaseNumber
  status: string
  createdAt: number
}

export namespace Pipeline {
  const states = new Map<string, PipelineState>()

  export async function init(projectPath: string, config: PipelineConfig): Promise<PipelineInfo> {
    log.info("initializing pipeline", { projectPath, mode: config.mode })

    const base = await FileStructure.createPakalonAgents(projectPath)
    const modeCfg = Modes.fromString(config.mode)
    await Modes.save(projectPath, modeCfg)

    const budget = ContextManager.allocateForProject(true, config.tokenBudget)
    await ContextManager.save(projectPath, budget)

    const id = `pipeline-${Date.now()}`
    const now = Date.now()

    const state: PipelineState = {
      id,
      projectPath,
      mode: config.mode,
      currentPhase: 1,
      phases: Array.from({ length: 6 }, (_, i) => ({
        number: (i + 1) as PhaseNumber,
        status: i === 0 ? "active" : "pending",
        agents: [],
        artifacts: [],
      })),
      tokenBudget: {
        total: budget.total,
        allocated: Object.fromEntries(
          Object.entries(budget.phases).map(([k, v]) => [k, v.allocated]),
        ),
        used: Object.fromEntries(
          Object.entries(budget.phases).map(([k, v]) => [k, v.used]),
        ),
      },
      createdAt: now,
      updatedAt: now,
    }

    states.set(id, state)
    await saveState(projectPath, state)

    log.info("pipeline initialized", { id, base })
    return { id, projectPath, mode: config.mode, currentPhase: 1, status: "active", createdAt: now }
  }

  export function get(id: string): PipelineState | undefined {
    return states.get(id)
  }

  export function getByPath(projectPath: string): PipelineState | undefined {
    for (const state of states.values()) {
      if (state.projectPath === projectPath) return state
    }
    return undefined
  }

  export async function advance(id: string): Promise<PipelineState | undefined> {
    const state = states.get(id)
    if (!state) return undefined
    if (state.currentPhase >= 6) {
      state.phases[5].status = "completed"
      state.currentPhase = 6
      state.updatedAt = Date.now()
      return state
    }
    state.phases[state.currentPhase - 1].status = "completed"
    state.phases[state.currentPhase - 1].completedAt = Date.now()
    state.currentPhase++
    state.phases[state.currentPhase - 1].status = "active"
    state.phases[state.currentPhase - 1].startedAt = Date.now()
    state.updatedAt = Date.now()
    await saveState(state.projectPath, state)
    return state
  }

  export async function setPhaseStatus(
    id: string,
    phase: PhaseNumber,
    status: PipelineState["phases"][number]["status"],
  ): Promise<void> {
    const state = states.get(id)
    if (!state) return
    state.phases[phase - 1].status = status
    if (status === "completed") state.phases[phase - 1].completedAt = Date.now()
    if (status === "active") state.phases[phase - 1].startedAt = Date.now()
    state.updatedAt = Date.now()
    await saveState(state.projectPath, state)
  }

  export async function recordPhaseResult(
    id: string,
    phase: PhaseNumber,
    result: PhaseResult,
  ): Promise<void> {
    const state = states.get(id)
    if (!state) return
    state.phases[phase - 1].artifacts = result.artifacts
    state.tokenBudget.used[`phase-${phase}`] =
      (state.tokenBudget.used[`phase-${phase}`] ?? 0) + result.tokensUsed
    state.updatedAt = Date.now()
    await saveState(state.projectPath, state)
  }

  export async function listPhases(id: string): Promise<PipelineState["phases"]> {
    const state = states.get(id)
    if (!state) return []
    return state.phases
  }

  export function isActive(id: string): boolean {
    const state = states.get(id)
    return state !== undefined && state.currentPhase <= 6
  }

  export function progress(id: string): { current: number; total: number; pct: number } {
    const state = states.get(id)
    if (!state) return { current: 0, total: 6, pct: 0 }
    const completed = state.phases.filter((p) => p.status === "completed").length
    return { current: completed, total: 6, pct: Math.round((completed / 6) * 100) }
  }

  async function saveState(projectPath: string, state: PipelineState): Promise<void> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/pipeline-state.json`
    await Filesystem.writeJson(p, state)
  }

  export async function loadState(projectPath: string): Promise<PipelineState | undefined> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/pipeline-state.json`
    try {
      const data = await Filesystem.readJson<PipelineState>(p)
      states.set(data.id, data)
      return data
    } catch {
      return undefined
    }
  }
}

export { ContextManager } from "./context-manager"
export { Modes } from "./modes"
export { FileStructure } from "./file-structure"
export type { ModeConfig, ExecutionMode } from "./modes"
export type { TokenBudget } from "./context-manager"
