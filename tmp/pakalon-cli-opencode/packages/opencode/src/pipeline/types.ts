import z from "zod"

export const PhaseStatus = z.enum([
  "pending",
  "active",
  "paused",
  "completed",
  "failed",
  "skipped",
])
export type PhaseStatus = z.infer<typeof PhaseStatus>

export const AgentState = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.number(),
  subAgent: z.number().optional(),
  status: PhaseStatus,
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  error: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
})
export type AgentState = z.infer<typeof AgentState>

export const PipelineState = z.object({
  id: z.string(),
  projectPath: z.string(),
  mode: z.enum(["hil", "yolo"]),
  currentPhase: z.number().min(1).max(6),
  phases: z.array(
    z.object({
      number: z.number().min(1).max(6),
      status: PhaseStatus,
      startedAt: z.number().optional(),
      completedAt: z.number().optional(),
      agents: z.array(AgentState),
      artifacts: z.array(z.string()),
    }),
  ),
  tokenBudget: z.object({
    total: z.number(),
    allocated: z.record(z.string(), z.number()),
    used: z.record(z.string(), z.number()),
  }),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type PipelineState = z.infer<typeof PipelineState>

export const PipelineConfig = z.object({
  mode: z.enum(["hil", "yolo"]),
  phases: z.array(z.number().min(1).max(6)).optional(),
  model: z.string().optional(),
  tokenBudget: z.number().optional(),
  penpotEnabled: z.boolean().optional(),
  securityEnabled: z.boolean().optional(),
  autoAdvance: z.boolean().optional(),
})
export type PipelineConfig = z.infer<typeof PipelineConfig>

export interface PhaseContext {
  phase: number
  projectPath: string
  mode: "hil" | "yolo"
  artifacts: string[]
  memory: Record<string, unknown>
  tokenBudget: {
    total: number
    remaining: number
  }
}

export interface PhaseResult {
  success: boolean
  artifacts: string[]
  nextPhase?: number
  error?: string
  tokensUsed: number
}

export interface SubAgentConfig {
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  model?: string
}

export const PHASE_1_ARTIFACTS = [
  "plan.md",
  "tasks.md",
  "design.md",
  "phase-1.md",
  "agent-skills.md",
  "prd.md",
  "Database_schema.md",
  "API_reference.md",
  "risk-assessment.md",
  "user-stories.md",
  "technical-spec.md",
  "competitive-analysis.md",
  "constraints-and-tradeoffs.md",
  "context_management.md",
] as const

export const PHASE_2_ARTIFACTS = [
  "phase-2.md",
  "Wireframe_generated.svg",
  "Wireframe_generated.penpot",
] as const

export const PHASE_3_ARTIFACTS = [
  "auditor.md",
  "subagent-1.md",
  "subagent-2.md",
  "subagent-3.md",
  "subagent-4.md",
  "subagent-5.md",
  "execution_log.md",
] as const

export const PHASE_4_ARTIFACTS = [
  "subagent-1.md",
  "subagent-2.md",
  "subagent-3.md",
  "subagent-4.md",
  "subagent-5.md",
  "blackbox_testing.xml",
  "whitebox_testing.xml",
] as const

export const PHASE_5_ARTIFACTS = ["phase-5.md"] as const

export const PHASE_6_ARTIFACTS = ["phase-6.md"] as const
