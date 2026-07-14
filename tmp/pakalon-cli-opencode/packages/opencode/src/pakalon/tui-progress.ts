/**
 * Pakalon TUI Progress Display
 * 
 * Provides TUI components for:
 * - Phase progress display
 * - Model display
 * - Context usage display
 * - Mode display
 * - Command discoverability
 */

import { Log } from "../util/log"
import { Pakalon } from "./index"
import { WorkflowEngine, type WorkflowState } from "./workflow"

const log = Log.create({ service: "pakalon:tui-progress" })

export interface ProgressDisplay {
  phase: Pakalon.PhaseNumber | null
  phaseName: string
  phaseIcon: string
  state: WorkflowState
  mode: "hil" | "yolo"
  completedPhases: number[]
  nextAction: string
}

/**
 * Format progress bar
 */
function formatProgressBar(current: number, total: number, width: number = 20): string {
  const filled = Math.round((current / total) * width)
  const empty = width - filled
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${current}/${total}`
}

/**
 * Get state display text
 */
function getStateDisplay(state: WorkflowState): string {
  const stateMap: Record<WorkflowState, string> = {
    idle: "Not Started",
    phase1_qa: "Q&A Session",
    phase1_generating: "Generating Artifacts",
    phase2_ready: "Ready for Design",
    phase2_active: "Design Phase",
    phase3_ready: "Ready for Development",
    phase3_running: "Development",
    phase4_ready: "Ready for Security",
    phase4_running: "Security Scan",
    phase5_ready: "Ready for Deployment",
    phase5_running: "Deploying",
    phase6_ready: "Ready for Docs",
    phase6_running: "Writing Docs",
    completed: "Completed",
    paused: "Paused",
    error: "Error",
  }
  return stateMap[state] || state
}

/**
 * Get next action text
 */
function getNextAction(state: WorkflowState, mode: "hil" | "yolo"): string {
  const actionMap: Record<WorkflowState, string> = {
    idle: "Run /pakalon to start",
    phase1_qa: mode === "hil" ? "Answer the current question" : "Waiting for YOLO completion",
    phase1_generating: "Run /update to generate artifacts",
    phase2_ready: "Run /penpot to start design",
    phase2_active: "Complete design review",
    phase3_ready: "Run /agents to start development",
    phase3_running: "Waiting for subagents",
    phase4_ready: "Run security scan",
    phase4_running: "Waiting for scan results",
    phase5_ready: "Start deployment",
    phase5_running: "Waiting for deployment",
    phase6_ready: "Generate documentation",
    phase6_running: "Writing documentation",
    completed: "Pipeline complete! Run /pakalon to start new project",
    paused: "Run /resume to continue",
    error: "Check error and retry",
  }
  return actionMap[state] || "Unknown"
}

export namespace TUIProgress {
  /**
   * Get progress display for a project
   */
  export async function getProgress(projectPath: string): Promise<ProgressDisplay | null> {
    const status = await WorkflowEngine.getStatus(projectPath)
    if (!status) return null

    const phase = status.phase
    const phaseName = phase ? Pakalon.phaseName(phase) : "N/A"
    const phaseIcon = phase ? Pakalon.phaseIcon(phase) : "📋"

    // Determine completed phases based on state
    const completedPhases: number[] = []
    if (["phase2_ready", "phase2_active", "phase3_ready", "phase3_running", "phase4_ready", "phase4_running", "phase5_ready", "phase5_running", "phase6_ready", "phase6_running", "completed"].includes(status.state)) {
      completedPhases.push(1)
    }
    if (["phase3_ready", "phase3_running", "phase4_ready", "phase4_running", "phase5_ready", "phase5_running", "phase6_ready", "phase6_running", "completed"].includes(status.state)) {
      completedPhases.push(2)
    }
    if (["phase4_ready", "phase4_running", "phase5_ready", "phase5_running", "phase6_ready", "phase6_running", "completed"].includes(status.state)) {
      completedPhases.push(3)
    }
    if (["phase5_ready", "phase5_running", "phase6_ready", "phase6_running", "completed"].includes(status.state)) {
      completedPhases.push(4)
    }
    if (["phase6_ready", "phase6_running", "completed"].includes(status.state)) {
      completedPhases.push(5)
    }
    if (status.state === "completed") {
      completedPhases.push(6)
    }

    return {
      phase,
      phaseName,
      phaseIcon,
      state: status.state,
      mode: status.mode,
      completedPhases,
      nextAction: getNextAction(status.state, status.mode),
    }
  }

  /**
   * Format progress for TUI display
   */
  export function formatProgress(display: ProgressDisplay): string {
    let output = ""

    // Header
    output += `╔══════════════════════════════════════════════════════════════╗\n`
    output += `║  ${display.phaseIcon} PAKALON PIPELINE                                      ║\n`
    output += `╚══════════════════════════════════════════════════════════════╝\n\n`

    // Progress bar
    output += `Progress: ${formatProgressBar(display.completedPhases.length, 6)}\n\n`

    // Phase list
    output += `Phases:\n`
    for (let i = 1; i <= 6; i++) {
      const icon = display.completedPhases.includes(i) ? "✅" : 
                   display.phase === i ? "🔄" : "⬜"
      const name = Pakalon.phaseName(i as Pakalon.PhaseNumber)
      output += `  ${icon} ${Pakalon.phaseIcon(i as Pakalon.PhaseNumber)} ${name}\n`
    }
    output += "\n"

    // Current status
    output += `Current Phase: ${display.phase ? `${display.phase} - ${display.phaseName}` : "N/A"}\n`
    output += `State: ${getStateDisplay(display.state)}\n`
    output += `Mode: ${display.mode.toUpperCase()}\n`
    output += `Next: ${display.nextAction}\n`

    return output
  }

  /**
   * Format compact status for status bar
   */
  export function formatCompactStatus(display: ProgressDisplay): string {
    const icon = display.phase ? Pakalon.phaseIcon(display.phase) : "📋"
    const phase = display.phase ? `P${display.phase}` : "N/A"
    const state = getStateDisplay(display.state)
    return `${icon} Pakalon ${phase} | ${state} | ${display.mode.toUpperCase()}`
  }

  /**
   * Get mode display color
   */
  export function getModeColor(mode: "hil" | "yolo"): string {
    return mode === "hil" ? "blue" : "purple"
  }

  /**
   * Get state display color
   */
  export function getStateColor(state: WorkflowState): string {
    if (state === "error") return "red"
    if (state === "completed") return "green"
    if (state === "paused") return "yellow"
    if (state.includes("running") || state.includes("active")) return "blue"
    return "gray"
  }
}

export default TUIProgress
