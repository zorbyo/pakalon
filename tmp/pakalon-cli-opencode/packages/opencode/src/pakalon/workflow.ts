/**
 * Pakalon Workflow Engine
 * 
 * Implements Pakalon-native workflow orchestration for 6-phase pipeline.
 * This is a TypeScript state machine that manages phase progression,
 * HIL question flow, and YOLO planning flow.
 */

import { Log } from "../util/log"
import { Pakalon } from "./index"
import { PakalonState } from "./state"
import { PhaseOrchestrator } from "./phase-orchestrator"
import { QASystem } from "./qa-system"

const log = Log.create({ service: "pakalon:workflow" })

// Workflow states
export type WorkflowState = 
  | "idle"
  | "phase1_qa"
  | "phase1_generating"
  | "phase2_ready"
  | "phase2_active"
  | "phase3_ready"
  | "phase3_running"
  | "phase4_ready"
  | "phase4_running"
  | "phase5_ready"
  | "phase5_running"
  | "phase6_ready"
  | "phase6_running"
  | "completed"
  | "paused"
  | "error"

export interface WorkflowContext {
  projectPath: string
  mode: "hil" | "yolo"
  currentState: WorkflowState
  previousState: WorkflowState | null
  error: string | null
  metadata: Record<string, unknown>
}

export interface WorkflowTransition {
  from: WorkflowState
  to: WorkflowState
  condition?: (ctx: WorkflowContext) => boolean | Promise<boolean>
  action?: (ctx: WorkflowContext) => Promise<void>
}

// Define valid state transitions
const TRANSITIONS: WorkflowTransition[] = [
  // Phase 1 transitions
  { from: "idle", to: "phase1_qa" },
  { from: "phase1_qa", to: "phase1_generating", condition: (ctx) => isQAComplete(ctx.projectPath) },
  { from: "phase1_generating", to: "phase2_ready" },
  
  // Phase 2 transitions
  { from: "phase2_ready", to: "phase2_active" },
  { from: "phase2_active", to: "phase3_ready" },
  
  // Phase 3 transitions
  { from: "phase3_ready", to: "phase3_running" },
  { from: "phase3_running", to: "phase4_ready" },
  
  // Phase 4 transitions
  { from: "phase4_ready", to: "phase4_running" },
  { from: "phase4_running", to: "phase5_ready" },
  
  // Phase 5 transitions
  { from: "phase5_ready", to: "phase5_running" },
  { from: "phase5_running", to: "phase6_ready" },
  
  // Phase 6 transitions
  { from: "phase6_ready", to: "phase6_running" },
  { from: "phase6_running", to: "completed" },
  
  // Pause/Resume
  { from: "phase1_qa", to: "paused" },
  { from: "phase1_generating", to: "paused" },
  { from: "phase2_active", to: "paused" },
  { from: "phase3_running", to: "paused" },
  { from: "phase4_running", to: "paused" },
  { from: "phase5_running", to: "paused" },
  { from: "phase6_running", to: "paused" },
  { from: "paused", to: "phase1_qa" },
  { from: "paused", to: "phase1_generating" },
  { from: "paused", to: "phase2_active" },
  { from: "paused", to: "phase3_running" },
  { from: "paused", to: "phase4_running" },
  { from: "paused", to: "phase5_running" },
  { from: "paused", to: "phase6_running" },
  
  // Error handling - any state can go to error
  { from: "idle", to: "error" },
  { from: "phase1_qa", to: "error" },
  { from: "phase1_generating", to: "error" },
  { from: "phase2_ready", to: "error" },
  { from: "phase2_active", to: "error" },
  { from: "phase3_ready", to: "error" },
  { from: "phase3_running", to: "error" },
  { from: "phase4_ready", to: "error" },
  { from: "phase4_running", to: "error" },
  { from: "phase5_ready", to: "error" },
  { from: "phase5_running", to: "error" },
  { from: "phase6_ready", to: "error" },
  { from: "phase6_running", to: "error" },
]

/**
 * Check if Q&A is complete for a project
 */
function isQAComplete(projectPath: string): boolean {
  return QASystem.isComplete(projectPath)
}

/**
 * Get the workflow state from persisted state
 */
function getWorkflowState(state: Awaited<ReturnType<typeof PakalonState.load>>): WorkflowState {
  if (!state) return "idle"
  
  if (state.phaseStatus[6] === "completed") return "completed"
  
  // Check current phase status
  const phase = state.currentPhase
  const status = state.phaseStatus[phase]
  
  if (status === "pending") {
    // Map phase to ready state
    switch (phase) {
      case 1: return state.qa ? "phase1_qa" : "idle"
      case 2: return "phase2_ready"
      case 3: return "phase3_ready"
      case 4: return "phase4_ready"
      case 5: return "phase5_ready"
      case 6: return "phase6_ready"
    }
  }
  
  if (status === "in_progress") {
    // Map phase to running state
    switch (phase) {
      case 1: return state.qa && !state.qa.complete ? "phase1_qa" : "phase1_generating"
      case 2: return "phase2_active"
      case 3: return "phase3_running"
      case 4: return "phase4_running"
      case 5: return "phase5_running"
      case 6: return "phase6_running"
    }
  }
  
  return "idle"
}

export namespace WorkflowEngine {
  const contexts = new Map<string, WorkflowContext>()

  /**
   * Initialize workflow context
   */
  export async function init(projectPath: string, mode: "hil" | "yolo"): Promise<WorkflowContext> {
    const persistedState = await PakalonState.load(projectPath)
    const currentState = getWorkflowState(persistedState)
    
    const ctx: WorkflowContext = {
      projectPath,
      mode,
      currentState,
      previousState: null,
      error: null,
      metadata: {},
    }
    
    contexts.set(projectPath, ctx)
    log.info("Workflow initialized", { projectPath, mode, currentState })
    return ctx
  }

  /**
   * Get workflow context
   */
  export async function getContext(projectPath: string): Promise<WorkflowContext | null> {
    const cached = contexts.get(projectPath)
    if (cached) return cached
    
    // Load from persisted state
    const persistedState = await PakalonState.load(projectPath)
    if (!persistedState) return null
    
    return init(projectPath, persistedState.mode)
  }

  /**
   * Check if a transition is valid
   */
  function canTransition(from: WorkflowState, to: WorkflowState): boolean {
    return TRANSITIONS.some(t => t.from === from && t.to === to)
  }

  /**
   * Execute a state transition
   */
  export async function transition(
    projectPath: string,
    to: WorkflowState
  ): Promise<WorkflowContext | null> {
    const ctx = await getContext(projectPath)
    if (!ctx) return null

    // Check if transition is valid
    if (!canTransition(ctx.currentState, to)) {
      log.error("Invalid transition", { from: ctx.currentState, to })
      return null
    }

    // Find the transition definition
    const transitionDef = TRANSITIONS.find(t => t.from === ctx.currentState && t.to === to)
    
    // Check condition if exists
    if (transitionDef?.condition) {
      const canProceed = await transitionDef.condition(ctx)
      if (!canProceed) {
        log.info("Transition condition not met", { from: ctx.currentState, to })
        return null
      }
    }

    // Execute action if exists
    if (transitionDef?.action) {
      try {
        await transitionDef.action(ctx)
      } catch (error) {
        log.error("Transition action failed", { error })
        ctx.error = error instanceof Error ? error.message : String(error)
        ctx.previousState = ctx.currentState
        ctx.currentState = "error"
        contexts.set(projectPath, ctx)
        return ctx
      }
    }

    // Update state
    ctx.previousState = ctx.currentState
    ctx.currentState = to
    contexts.set(projectPath, ctx)
    
    log.info("State transition", { from: ctx.previousState, to })
    return ctx
  }

  /**
   * Start Phase 1 Q&A
   */
  export async function startPhase1QA(projectPath: string, prompt: string): Promise<WorkflowContext | null> {
    const ctx = await getContext(projectPath)
    if (!ctx) return null

    // Initialize pipeline if needed
    if (ctx.currentState === "idle") {
      await PhaseOrchestrator.initState(projectPath, ctx.mode)
      await PhaseOrchestrator.ensureDirectoryStructure(projectPath)
    }

    // Start Q&A
    QASystem.init(projectPath, ctx.mode, prompt)
    
    return transition(projectPath, "phase1_qa")
  }

  /**
   * Submit Q&A answer
   */
  export async function submitAnswer(
    projectPath: string,
    answer: string
  ): Promise<{ ctx: WorkflowContext | null; nextQuestion: ReturnType<typeof QASystem.current> }> {
    const nextQuestion = QASystem.answer(projectPath, answer)
    
    // Check if Q&A is complete
    if (QASystem.isComplete(projectPath)) {
      const ctx = await transition(projectPath, "phase1_generating")
      return { ctx, nextQuestion: null }
    }
    
    const ctx = await getContext(projectPath)
    return { ctx, nextQuestion }
  }

  /**
   * Generate Phase 1 artifacts
   */
  export async function generatePhase1Artifacts(
    projectPath: string,
    prompt: string
  ): Promise<WorkflowContext | null> {
    const responses = QASystem.getResponses(projectPath)
    
    // Generate artifacts
    await PhaseOrchestrator.generatePhase1Artifacts(projectPath, prompt, responses)
    
    // Update persisted state
    await PakalonState.updatePhaseStatus(projectPath, 1, "completed")
    
    return transition(projectPath, "phase2_ready")
  }

  /**
   * Get available transitions from current state
   */
  export async function getAvailableTransitions(projectPath: string): Promise<WorkflowState[]> {
    const ctx = await getContext(projectPath)
    if (!ctx) return []
    
    return TRANSITIONS
      .filter(t => t.from === ctx.currentState)
      .map(t => t.to)
  }

  /**
   * Get current phase number
   */
  export async function getCurrentPhase(projectPath: string): Promise<Pakalon.PhaseNumber | null> {
    const ctx = await getContext(projectPath)
    if (!ctx) return null
    
    const stateToPhase: Record<WorkflowState, Pakalon.PhaseNumber | null> = {
      idle: null,
      phase1_qa: 1,
      phase1_generating: 1,
      phase2_ready: 2,
      phase2_active: 2,
      phase3_ready: 3,
      phase3_running: 3,
      phase4_ready: 4,
      phase4_running: 4,
      phase5_ready: 5,
      phase5_running: 5,
      phase6_ready: 6,
      phase6_running: 6,
      completed: null,
      paused: null,
      error: null,
    }
    
    return stateToPhase[ctx.currentState]
  }

  /**
   * Pause workflow
   */
  export async function pause(projectPath: string): Promise<WorkflowContext | null> {
    return transition(projectPath, "paused")
  }

  /**
   * Resume workflow
   */
  export async function resume(projectPath: string): Promise<WorkflowContext | null> {
    const ctx = await getContext(projectPath)
    if (!ctx || ctx.currentState !== "paused") return null
    
    // Determine which state to resume to based on phase
    const phase = await getCurrentPhase(projectPath)
    if (!phase) return null
    
    const phaseToState: Record<Pakalon.PhaseNumber, WorkflowState> = {
      1: "phase1_qa",
      2: "phase2_active",
      3: "phase3_running",
      4: "phase4_running",
      5: "phase5_running",
      6: "phase6_running",
    }
    
    return transition(projectPath, phaseToState[phase])
  }

  /**
   * Get workflow status summary
   */
  export async function getStatus(projectPath: string): Promise<{
    state: WorkflowState
    phase: Pakalon.PhaseNumber | null
    mode: "hil" | "yolo"
    availableTransitions: WorkflowState[]
  } | null> {
    const ctx = await getContext(projectPath)
    if (!ctx) return null
    
    return {
      state: ctx.currentState,
      phase: await getCurrentPhase(projectPath),
      mode: ctx.mode,
      availableTransitions: await getAvailableTransitions(projectPath),
    }
  }
}

export default WorkflowEngine
