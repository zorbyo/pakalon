export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  tool: string;
  args: Record<string, unknown>;
  condition?: string;
  onError?: 'continue' | 'stop' | 'retry';
  retryCount?: number;
  timeout?: number;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  version?: string;
  steps: WorkflowStep[];
  variables?: Record<string, string>;
  timeout?: number;
  retryOnError?: boolean;
  tags?: string[];
}

export interface WorkflowExecution {
  id: string;
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep?: number;
  startedAt?: string;
  completedAt?: string;
  results: Map<string, unknown>;
  errors: Map<number, string>;
}

export interface WorkflowResult {
  success: boolean;
  workflowName: string;
  executedSteps: number;
  totalSteps: number;
  results: Record<string, unknown>;
  errors: Array<{ step: number; error: string }>;
  duration: number;
  output?: string;
}

export interface WorkflowListItem {
  name: string;
  description?: string;
  version?: string;
  steps: number;
}

export interface WorkflowProgress {
  step: number;
  total: number;
  stepName: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
}

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowExecutionContext {
  id: string;
  workflowName: string;
  status: WorkflowStatus;
  currentStep: number;
  startedAt: Date;
  completedAt?: Date;
  results: Record<string, unknown>;
  errors: Array<{ step: number; error: string }>;
  progressCallbacks: Set<(progress: WorkflowProgress) => void>;
}

export interface WorkflowToolInput {
  workflow: string;
  context?: Record<string, string>;
  wait?: boolean;
}

export interface ListWorkflowsInput {
  includeDescription?: boolean;
}

export interface ShowWorkflowInput {
  workflow: string;
  includeSteps?: boolean;
}

export interface WorkflowToolOutput {
  success: boolean;
  workflowName: string;
  executedSteps: number;
  totalSteps: number;
  results: Record<string, unknown>;
  errors: Array<{ step: number; error: string }>;
  duration: number;
  output?: string;
}

export interface ListWorkflowsOutput {
  success: boolean;
  workflows: WorkflowListItem[];
  count: number;
}

export interface ShowWorkflowOutput {
  success: boolean;
  workflow?: {
    name: string;
    description?: string;
    version?: string;
    steps: Array<{
      id: string;
      name: string;
      tool: string;
      args: Record<string, unknown>;
      condition?: string;
      onError?: string;
    }>;
    variables?: Record<string, string>;
    timeout?: number;
  };
  error?: string;
}