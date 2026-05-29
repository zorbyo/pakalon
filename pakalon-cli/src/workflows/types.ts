/**
 * Workflow Types for Pakalon CLI
 */

export type StepType = "prompt" | "shell" | "mcp" | "tool";

export interface WorkflowStep {
  type: StepType;
  content?: string;
  command?: string;
  tool?: string;
  toolInput?: Record<string, unknown>;
  label?: string;
}

export interface WorkflowSchedule {
  cron: string;
  description?: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  prompts: string[];
  schedule?: WorkflowSchedule;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  lastUsedAt?: string;
}

export interface WorkflowResult {
  ok: boolean;
  error?: string;
  results: string[];
  stepResults: Array<{
    step: WorkflowStep;
    index: number;
    result?: string;
    error?: string;
  }>;
}

export interface WorkflowStorage {
  workflows: Workflow[];
}
