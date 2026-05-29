import type {
  AgentDefinition,
  ResolvedAgentTools,
  AgentToolResult,
  PermissionMode,
} from './types.js';
import {
  ALL_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  IN_PROCESS_TEAMMATE_ALLOWED_TOOLS,
  AGENT_TOOL_NAME,
} from './constants.js';

export function filterToolsForAgent({
  tools,
  isBuiltIn,
  isAsync = false,
  permissionMode,
}: {
  tools: string[];
  isBuiltIn: boolean;
  isAsync?: boolean;
  permissionMode?: PermissionMode;
}): string[] {
  return tools.filter((tool) => {
    if (tool.startsWith('mcp__')) {
      return true;
    }

    if (tool === 'ExitPlanMode' && permissionMode === 'plan') {
      return true;
    }

    if (ALL_AGENT_DISALLOWED_TOOLS.has(tool)) {
      return false;
    }

    if (!isBuiltIn && CUSTOM_AGENT_DISALLOWED_TOOLS.has(tool)) {
      return false;
    }

    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(tool)) {
      return false;
    }

    return true;
  });
}

export function resolveAgentTools(
  agentDefinition: Pick<
    AgentDefinition,
    'tools' | 'disallowedTools' | 'source' | 'permissionMode'
  >,
  availableTools: string[],
  isAsync = false,
  isMainThread = false
): ResolvedAgentTools {
  const { tools: agentTools, disallowedTools, source, permissionMode } = agentDefinition;

  const filteredAvailableTools = isMainThread
    ? availableTools
    : filterToolsForAgent({
        tools: availableTools,
        isBuiltIn: source === 'built-in',
        isAsync,
        permissionMode,
      });

  const disallowedToolSet = new Set(disallowedTools ?? []);

  const allowedAvailableTools = filteredAvailableTools.filter(
    (tool) => !disallowedToolSet.has(tool)
  );

  const hasWildcard =
    agentTools === undefined || (agentTools.length === 1 && agentTools[0] === '*');

  if (hasWildcard) {
    return {
      hasWildcard: true,
      validTools: [],
      invalidTools: [],
      resolvedTools: allowedAvailableTools,
    };
  }

  const availableToolMap = new Map<string, string>();
  for (const tool of allowedAvailableTools) {
    availableToolMap.set(tool, tool);
  }

  const validTools: string[] = [];
  const invalidTools: string[] = [];
  const resolvedToolsSet = new Set<string>();
  const resolved: string[] = [];
  let allowedAgentTypes: string[] | undefined;

  for (const toolSpec of agentTools ?? []) {
    const toolName = toolSpec;

    if (toolName === AGENT_TOOL_NAME) {
      if (!isMainThread) {
        validTools.push(toolSpec);
        continue;
      }
    }

    const tool = availableToolMap.get(toolName);
    if (tool) {
      validTools.push(toolSpec);
      if (!resolvedToolsSet.has(tool)) {
        resolved.push(tool);
        resolvedToolsSet.add(tool);
      }
    } else {
      invalidTools.push(toolSpec);
    }
  }

  return {
    hasWildcard: false,
    validTools,
    invalidTools,
    resolvedTools: resolved,
    allowedAgentTypes,
  };
}

export function countToolUses(
  messages: Array<{ type: string; message?: { content?: Array<{ type: string }> } }>
): number {
  let count = 0;
  for (const m of messages) {
    if (m.type === 'assistant' && m.message?.content) {
      for (const block of m.message.content) {
        if (block.type === 'tool_use') {
          count++;
        }
      }
    }
  }
  return count;
}

export interface FinalizeAgentToolMetadata {
  prompt: string;
  resolvedAgentModel: string;
  isBuiltInAgent: boolean;
  startTime: number;
  agentType: string;
  isAsync: boolean;
}

export function finalizeAgentTool(
  agentId: string,
  content: Array<{ type: 'text'; text: string }>,
  metadata: FinalizeAgentToolMetadata,
  toolUseCount: number,
  durationMs: number,
  totalTokens: number,
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }
): AgentToolResult {
  return {
    success: true,
    agentId,
    agentType: metadata.agentType,
    output: content.map((c) => c.text).join('\n'),
    totalToolUseCount: toolUseCount,
    totalDurationMs: durationMs,
    totalTokens,
    agentName: metadata.agentType,
    background: metadata.isAsync,
  };
}

export function getLastToolUseName(
  message: { type?: string; message?: { content?: Array<{ type: string; name?: string }> } }
): string | undefined {
  if (message.type !== 'assistant') return undefined;
  const content = message.message?.content;
  if (!content) return undefined;
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (block?.type === 'tool_use') {
      return block.name;
    }
  }
  return undefined;
}

export function extractTextContent(
  content: Array<{ type: string; text?: string }>,
  separator = '\n'
): string | undefined {
  const texts = content.filter((c) => c.type === 'text' && c.text).map((c) => c.text!);
  return texts.length > 0 ? texts.join(separator) : undefined;
}

export function extractPartialResult(
  messages: Array<{ type?: string; message?: { content?: Array<{ type: string; text?: string }> } }>
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.type !== 'assistant') continue;
    const text = extractTextContent(m.message?.content ?? [], '\n');
    if (text) {
      return text;
    }
  }
  return undefined;
}

export function hasRequiredMcpServers(
  agent: AgentDefinition,
  availableServers: string[]
): boolean {
  if (!agent.requiredMcpServers || agent.requiredMcpServers.length === 0) {
    return true;
  }

  return agent.requiredMcpServers.every((pattern) =>
    availableServers.some((server) => server.toLowerCase().includes(pattern.toLowerCase()))
  );
}

export function filterAgentsByMcpRequirements(
  agents: AgentDefinition[],
  availableServers: string[]
): AgentDefinition[] {
  return agents.filter((agent) => hasRequiredMcpServers(agent, availableServers));
}