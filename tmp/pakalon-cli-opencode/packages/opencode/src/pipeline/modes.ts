import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "../pakalon"

const log = Log.create({ service: "pipeline:modes" })

export type ExecutionMode = "hil" | "yolo"

export interface ModeConfig {
  mode: ExecutionMode
  autoAdvance: boolean
  requireApproval: boolean
  skipPhases: number[]
  maxIterations: number
}

export namespace Modes {
  export function hil(): ModeConfig {
    return {
      mode: "hil",
      autoAdvance: false,
      requireApproval: true,
      skipPhases: [],
      maxIterations: 1,
    }
  }

  export function yolo(): ModeConfig {
    return {
      mode: "yolo",
      autoAdvance: true,
      requireApproval: false,
      skipPhases: [],
      maxIterations: 10,
    }
  }

  export function fromString(mode: string): ModeConfig {
    return mode === "yolo" ? yolo() : hil()
  }

  export function requiresInput(cfg: ModeConfig, phase: number): boolean {
    if (cfg.mode === "yolo") return false
    if (cfg.skipPhases.includes(phase)) return false
    return cfg.requireApproval
  }

  export function canAutoAdvance(cfg: ModeConfig): boolean {
    return cfg.autoAdvance
  }

  export async function save(projectPath: string, cfg: ModeConfig): Promise<void> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/mode.json`
    await Filesystem.writeJson(p, cfg)
    log.info("saved mode config", { mode: cfg.mode })
  }

  export async function load(projectPath: string): Promise<ModeConfig> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/mode.json`
    try {
      const data = await Filesystem.readJson<ModeConfig>(p)
      return data
    } catch {
      return hil()
    }
  }

  export function description(cfg: ModeConfig): string {
    if (cfg.mode === "yolo") return "YOLO mode: fully automated, no user input required"
    return "HIL mode: human-in-the-loop, requires approval at each phase"
  }
}
