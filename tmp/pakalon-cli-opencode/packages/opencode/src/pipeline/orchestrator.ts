import { Log } from "../util/log"
import { Pipeline } from "./index"
import { Phase1Planning } from "./phase1-planning"
import { Phase2Wireframe } from "./phase2-wireframe"
import { Phase3Dev } from "./phase3-dev"
import { Phase4Security } from "./phase4-security"
import { Phase5Deploy } from "./phase5-deploy"
import { Phase6Docs } from "./phase6-docs"
import { Auditor } from "./auditor"
import { ContextManager } from "./context-manager"
import { Modes, type ExecutionMode } from "./modes"
import type { PhaseContext, PhaseResult, PipelineConfig } from "./types"
import type { PhaseNumber } from "../pakalon"

const log = Log.create({ service: "pipeline:orchestrator" })

export interface OrchestrationResult {
  pipelineId: string
  phases: Array<{ phase: number; result: PhaseResult }>
  totalTokensUsed: number
  duration: number
  success: boolean
}

export namespace Orchestrator {
  const PHASE_EXECUTORS = [
    (ctx: PhaseContext, budget: any) => Phase1Planning.execute(ctx, budget),
    (ctx: PhaseContext) => Phase2Wireframe.execute(ctx),
    (ctx: PhaseContext) => Phase3Dev.execute(ctx),
    (ctx: PhaseContext) => Phase4Security.execute(ctx),
    (ctx: PhaseContext) => Phase5Deploy.execute(ctx),
    (ctx: PhaseContext) => Phase6Docs.execute(ctx),
  ]

  export async function start(projectPath: string, config: PipelineConfig): Promise<OrchestrationResult> {
    log.info("starting orchestration", { projectPath, mode: config.mode })

    const start = Date.now()
    const pipeline = await Pipeline.init(projectPath, config)
    const phases: Array<{ phase: number; result: PhaseResult }> = []
    let totalTokens = 0

    const modeCfg = Modes.fromString(config.mode)
    const budget = ContextManager.create(config.tokenBudget)

    const startPhase = 1
    const endPhase = config.phases?.length ? Math.max(...config.phases) : 6

    for (let p = startPhase; p <= endPhase; p++) {
      if (config.phases && !config.phases.includes(p)) continue

      const ctx: PhaseContext = {
        phase: p,
        projectPath,
        mode: config.mode,
        artifacts: [],
        memory: {},
        tokenBudget: {
          total: budget.total,
          remaining: budget.phases[`phase-${p}`]?.remaining ?? 0,
        },
      }

      log.info("executing phase", { phase: p })
      await Pipeline.setPhaseStatus(pipeline.id, p as PhaseNumber, "active")

      if (Modes.requiresInput(modeCfg, p)) {
        log.info("phase requires HIL input", { phase: p })
      }

      const executor = PHASE_EXECUTORS[p - 1]
      const result = p === 1
        ? await Phase1Planning.execute(ctx, budget)
        : await (executor as (c: PhaseContext) => Promise<PhaseResult>)(ctx)

      phases.push({ phase: p, result })
      totalTokens += result.tokensUsed

      await Pipeline.recordPhaseResult(pipeline.id, p as PhaseNumber, result)
      await Pipeline.setPhaseStatus(pipeline.id, p as PhaseNumber, "completed")

      // Context enforcement: check budget after each phase
      const phaseKey = `phase-${p}`
      if (ContextManager.shouldCompress(budget, phaseKey)) {
        const usagePct = ContextManager.getUsagePct(budget, phaseKey)
        log.info("post-phase context compression triggered", { phase: p, usagePct })
        ContextManager.compress(budget, phaseKey)
        await ContextManager.save(projectPath, budget)
      }

      if (config.mode === "yolo" && config.autoAdvance !== false) {
        await Pipeline.advance(pipeline.id)
      }

      if (!result.success) {
        log.warn("phase failed", { phase: p, error: result.error })
        break
      }
    }

    const duration = Date.now() - start
    log.info("orchestration completed", { phases: phases.length, totalTokens, duration })

    return {
      pipelineId: pipeline.id,
      phases,
      totalTokensUsed: totalTokens,
      duration,
      success: phases.every((p) => p.result.success),
    }
  }

  export async function runPhase(
    projectPath: string,
    phase: PhaseNumber,
    mode: ExecutionMode,
  ): Promise<PhaseResult> {
    log.info("running single phase", { phase, mode })

    const budget = ContextManager.create()
    const phaseKey = `phase-${phase}`

    // Context enforcement: check if exhausted before starting
    if (ContextManager.shouldHalt(budget, phaseKey)) {
      const msg = `Token limit reached for Phase ${phase}. Context window exhausted.`
      log.error(msg, { phase, used: budget.phases[phaseKey]?.used, allocated: budget.phases[phaseKey]?.allocated })
      if (mode === "hil") {
        return {
          success: false,
          artifacts: [],
          error: `${msg} Options: (1) Compress & Continue (2) Switch to lighter model (3) Reduce scope`,
          tokensUsed: 0,
        }
      }
      // YOLO: auto-compress and continue
      const compressed = ContextManager.compress(budget, phaseKey)
      log.info("auto-compressed context for phase", { phase })
    }

    // Context enforcement: 80% compression trigger
    if (ContextManager.shouldCompress(budget, phaseKey)) {
      log.info("context near limit, triggering compression", {
        phase,
        usagePct: ContextManager.getUsagePct(budget, phaseKey),
      })
      ContextManager.compress(budget, phaseKey)
    }

    const ctx: PhaseContext = {
      phase,
      projectPath,
      mode,
      artifacts: [],
      memory: {},
      tokenBudget: {
        total: budget.total,
        remaining: budget.phases[phaseKey]?.remaining ?? 0,
      },
    }

    if (phase === 1) return Phase1Planning.execute(ctx, budget)
    if (phase === 2) return Phase2Wireframe.execute(ctx)
    if (phase === 3) return Phase3Dev.execute(ctx)
    if (phase === 4) return Phase4Security.execute(ctx)
    if (phase === 5) return Phase5Deploy.execute(ctx)
    if (phase === 6) return Phase6Docs.execute(ctx)

    return { success: false, artifacts: [], error: "Invalid phase", tokensUsed: 0 }
  }

  export async function runAuditor(
    projectPath: string,
    mode: ExecutionMode,
  ): Promise<ReturnType<typeof Auditor.scan>> {
    log.info("running auditor", { projectPath, mode })
    return Auditor.scan(projectPath, 3)
  }

  export async function runAuditorLoop(
    projectPath: string,
    mode: ExecutionMode,
  ): Promise<ReturnType<typeof Auditor.loop>> {
    log.info("running auditor loop", { projectPath, mode })
    return Auditor.loop(projectPath, mode)
  }

  export function getPhaseExecutor(phase: PhaseNumber) {
    return PHASE_EXECUTORS[phase - 1]
  }
}
