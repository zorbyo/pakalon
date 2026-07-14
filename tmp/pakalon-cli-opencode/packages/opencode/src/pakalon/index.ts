export namespace Pakalon {
  export const NAME = "pakalon"
  export const VERSION = "1.0.0"
  export const DESCRIPTION = "AI-powered 6-phase development pipeline"

  export const DIR_AGENTS = ".pakalon-agents"
  export const DIR_NORMAL = ".pakalon"
  export const DIR_WIREFRAMES = "wireframes"
  export const DIR_MCP = "mcp-servers"

  export const PHASES = [
    "planning",
    "wireframe",
    "development",
    "security",
    "deployment",
    "documentation",
  ] as const

  export type Phase = (typeof PHASES)[number]
  export type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6

  export const MODES = ["plan", "edit", "auto-accept", "bypass"] as const
  export type Mode = (typeof MODES)[number]

  export const PLANS = ["free", "pro"] as const
  export type Plan = (typeof PLANS)[number]

  export const AUTH_FILE = "auth.json"
  export const CONFIG_FILE = "pakalon.json"
  export const USAGE_DB_FILE = "usage.db"

  export const DEVICE_CODE_LENGTH = 6
  export const DEVICE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

  export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1"
  export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

  export const SUPABASE_URL = process.env.PAKALON_SUPABASE_URL ?? "https://your-project.supabase.co"
  export const SUPABASE_ANON_KEY = process.env.PAKALON_SUPABASE_ANON_KEY ?? ""

  export const COLORS = {
    primary: "#6366f1",
    secondary: "#8b5cf6",
    accent: "#a78bfa",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
  }

  export const PHASE_ICONS = ["📋", "🎨", "⚙️", "🔒", "🚀", "📝"] as const

  export function phaseIcon(phase: PhaseNumber): string {
    return PHASE_ICONS[phase - 1]
  }

  export function phaseName(phase: PhaseNumber): string {
    return PHASES[phase - 1]
  }

  export function generateDeviceCode(): string {
    const chars = DEVICE_CODE_CHARS
    let code = ""
    for (let i = 0; i < DEVICE_CODE_LENGTH; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }
    return code
  }

  export function isPakalonMode(): boolean {
    return process.env.PAKALON_MODE === "1" || process.env.PAKALON === "1"
  }

  export function getWorkDir(): string {
    return process.cwd()
  }

  export function agentsDir(workdir: string): string {
    return `${workdir}/${DIR_AGENTS}/ai-agents`
  }

  export function normalDir(workdir: string): string {
    return `${workdir}/${DIR_NORMAL}`
  }

  export function phaseDir(workdir: string, phase: PhaseNumber): string {
    return `${agentsDir(workdir)}/phase-${phase}`
  }
}

export type PhaseNumber = Pakalon.PhaseNumber

// Re-export submodules
export { PhaseOrchestrator } from "./phase-orchestrator"
export { QASystem } from "./qa-system"
export { NormalMode } from "./normal-mode"
export { Phase3Subagents } from "./phase3-subagents"
export { Phase4Security } from "./phase4-security"
export { PakalonState, NormalModeState } from "./state"
export { ModeSwitcher } from "./mode-switcher"
export { TelemetryManager } from "./telemetry-manager"
export { MCPProjectConfig } from "./mcp-project"
export { WorkflowEngine, type WorkflowState, type WorkflowContext } from "./workflow"
export { ResearchEngine } from "./research"
export { PenpotIntegration } from "./penpot"
export { SubagentExecutor } from "./subagent-executor"
export { BrowserTesting } from "./browser-testing"
export { SecurityPipeline } from "./security-pipeline"
export { BackendService } from "./backend-service"
export { TUIProgress } from "./tui-progress"
export { PakalonBuild } from "./build-config"
