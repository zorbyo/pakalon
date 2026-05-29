/**
 * Agent SDK entry point for external agent development.
 */

export type { AgentColorName, AgentIsolation, AgentMemoryScope, AgentSource, AgentToolInput, AgentMcpServerSpec, AgentHooksSettings, BaseAgentDefinition, BuiltInAgentDefinition, CustomAgentDefinition, PluginAgentDefinition, AgentDefinition, ToolCallEvent, ToolResultEvent } from "../agents/types.js";
export type { PermissionMode as InternalPermissionMode, EffortValue, QuerySource } from "../agents/types.js";
export type { ToolPermissionContext as InternalToolPermissionContext, ToolResult as InternalToolResult, ToolUseContext as InternalToolUseContext, ToolProgressData, ToolInputJSONSchema, ValidationResult, ToolResultBlockParam, ToolUseBlockParam, PermissionResult, ToolPermissionRulesBySource, AdditionalWorkingDirectory } from "../tools/tool-types.js";
export type { Diagnostic as ExistingLSPDiagnostic, SymbolLocation as ExistingLSPLocation, DefinitionResult, ReferencesResult, CodeActionResult, SemanticTokensResult, LSPClient } from "../lsp/index.js";

export interface AgentContext {
  sessionId: string;
  projectDir: string;
  userPrompt: string;
  config: AgentConfig;
  tools: Tool[];
  memory: AgentMemory;
}

export interface AgentConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
  allowedTools?: string[];
  permissionMode: "hil" | "yolo" | "auto-accept";
}

export interface AgentMemory {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AgentResult {
  success: boolean;
  output: string;
  filesCreated: string[];
  filesModified: string[];
  tokensUsed: number;
  duration: number;
}

export interface Tool<TSchema = unknown, TOutput = unknown> {
  name: string;
  description: string;
  parameters: TSchema;
  execute(params: TSchema, context: ToolContext): Promise<TOutput>;
  isReadOnly?: boolean;
  isDestructive?: boolean;
  isConcurrencySafe?: boolean;
}

export interface ToolContext {
  sessionId: string;
  projectDir: string;
  userConfirmed?: boolean;
}

export interface LSPDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "information" | "hint";
  message: string;
  source?: string;
}

export interface LSPLocation {
  file: string;
  line: number;
  column: number;
}

export interface UsageRecord {
  tokens: number;
  requests: number;
  cost?: number;
  model?: string;
}

export interface SystemInfo {
  cliVersion?: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  cwd: string;
  homeDir: string;
}

import { getAllTools } from "../tools/index.js";
import { AgentInstance, createMemoryStore } from "./agent-instance.js";

export async function createAgent(config: AgentConfig): Promise<AgentInstance> {
  const tools = (getAllTools() as unknown as Tool[]) ?? [];
  return new AgentInstance(config, tools, createMemoryStore());
}

export async function runAgent(agent: AgentInstance, prompt: string): Promise<AgentResult> {
  return agent.run(prompt);
}

export async function getAvailableTools(): Promise<Tool[]> {
  return (getAllTools() as unknown as Tool[]) ?? [];
}

export async function getSystemInfo(): Promise<SystemInfo> {
  return {
    cliVersion: process.env.npm_package_version,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? "",
  };
}

export { AgentInstance } from "./agent-instance.js";
