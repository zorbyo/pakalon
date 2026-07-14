import z from "zod"

export const AgentRole = z.enum([
  "planner",
  "designer",
  "developer",
  "tester",
  "reviewer",
  "deployer",
  "documenter",
  "auditor",
  "custom",
])
export type AgentRole = z.infer<typeof AgentRole>

export const AgentInfo = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  role: AgentRole,
  color: z.string(),
  tools: z.array(z.string()),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  enabled: z.boolean().default(true),
  createdAt: z.number(),
  parentId: z.string().optional(),
})
export type AgentInfo = z.infer<typeof AgentInfo>

export const TeamInfo = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  agents: z.array(AgentInfo),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type TeamInfo = z.infer<typeof TeamInfo>

export const AgentTask = z.object({
  id: z.string(),
  agentId: z.string(),
  description: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  result: z.string().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
})
export type AgentTask = z.infer<typeof AgentTask>

export const AGENT_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#a78bfa",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
] as const
