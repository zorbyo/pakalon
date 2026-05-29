/**
 * Coordinator Mode Type Definitions
 * 
 * Types for the coordinator mode implementation that enables
 * multi-agent orchestration with worker agents.
 */

export type SessionMode = 'coordinator' | 'normal' | undefined;

export interface CoordinatorModeConfig {
  enabled: boolean;
  simpleMode?: boolean;
  scratchpadDir?: string;
}

export interface CoordinatorContext {
  workerToolsContext: string;
  mcpServers?: string[];
}

export interface WorkerToolContext {
  availableTools: string[];
  internalTools: string[];
  simpleModeTools: string[];
}

export interface TaskNotification {
  taskId: string;
  status: 'completed' | 'failed' | 'killed';
  summary: string;
  result?: string;
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
}

export interface WorkerSpawnConfig {
  description: string;
  subagent_type: 'worker' | 'verification';
  prompt: string;
  model?: string;
}

export interface WorkerCapabilities {
  tools: string[];
  mcpTools: boolean;
  skills: boolean;
  simpleMode: boolean;
}