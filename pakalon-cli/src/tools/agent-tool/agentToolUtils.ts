/**
 * Agent Tool Utilities
 * Helper functions for agent tool operations
 */
import type { Tool, Tools } from '@/ai/tool-registry';
import type { AgentDefinition, PermissionMode, ResolvedAgentTools } from './types.js';
import {
  ALL_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
} from './constants.js';
import logger from '@/utils/logger.js';

export function filterToolsForAgent({
  tools,
  isBuiltIn,
  isAsync = false,
  permissionMode,
}: {
  tools: Tools;
  isBuiltIn: boolean;
  isAsync?: boolean;
  permissionMode?: PermissionMode;
}): Tools {
  return tools.filter(tool => {
    if (tool.name.startsWith('mcp__')) {
      return true;
    }

    if (ALL_AGENT_DISALLOWED_TOOLS.has(tool.name)) {
      return false;
    }

    if (!isBuiltIn && CUSTOM_AGENT_DISALLOWED_TOOLS.has(tool.name)) {
      return false;
    }

    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(tool.name)) {
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
  availableTools: Tools,
  isAsync = false,
): ResolvedAgentTools {
  const { tools: agentTools, disallowedTools, source, permissionMode } = agentDefinition;

  const filteredAvailableTools = filterToolsForAgent({
    tools: availableTools,
    isBuiltIn: source === 'built-in',
    isAsync,
    permissionMode,
  });

  const disallowedToolSet = new Set(disallowedTools ?? []);

  const allowedAvailableTools = filteredAvailableTools.filter(
    tool => !disallowedToolSet.has(tool.name),
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

  const availableToolMap = new Map<string, Tool>();
  for (const tool of allowedAvailableTools) {
    availableToolMap.set(tool.name, tool);
  }

  const validTools: string[] = [];
  const invalidTools: string[] = [];
  const resolved: Tool[] = [];
  const resolvedToolsSet = new Set<Tool>();

  for (const toolSpec of agentTools ?? []) {
    const toolName = toolSpec;
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
  };
}

export function countToolUses(messages: any[]): number {
  let count = 0;
  for (const m of messages) {
    if (m.type === 'assistant') {
      for (const block of m.message?.content ?? []) {
        if (block.type === 'tool_use') {
          count++;
        }
      }
    }
  }
  return count;
}

export function getLastToolUseName(message: any): string | undefined {
  if (message.type !== 'assistant') return undefined;
  const block = message.message?.content?.findLast?.((b: any) => b.type === 'tool_use');
  return block?.type === 'tool_use' ? block.name : undefined;
}

export function getLastAssistantMessage(messages: any[]): any | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === 'assistant') {
      return messages[i];
    }
  }
  return undefined;
}

export function extractTextContent(
  content: Array<{ type: string; text?: string }>,
  separator = '\n',
): string {
  return content
    .filter(block => block.type === 'text' && block.text)
    .map(block => block.text)
    .join(separator);
}

export function createProgressTracker() {
  return {
    toolUseCount: 0,
    tokenCount: 0,
    lastActivity: null as { activityDescription: string; timestamp: number } | null,
  };
}

export function getProgressUpdate(tracker: ReturnType<typeof createProgressTracker>) {
  return {
    toolUseCount: tracker.toolUseCount,
    tokenCount: tracker.tokenCount,
    lastActivity: tracker.lastActivity,
  };
}

export function updateProgressFromMessage(
  tracker: ReturnType<typeof createProgressTracker>,
  message: any,
  resolveActivity: (toolName: string) => string,
  tools: Tools,
): void {
  if (message.type === 'assistant') {
    const content = message.message?.content ?? [];
    for (const block of content) {
      if (block.type === 'tool_use') {
        tracker.toolUseCount++;
        tracker.lastActivity = {
          activityDescription: resolveActivity(block.name),
          timestamp: Date.now(),
        };
      }
    }
  }

  if (message.type === 'stream_event' && message.event?.type === 'usage') {
    tracker.tokenCount += message.event.tokens ?? 0;
  }
}

export function createActivityDescriptionResolver(tools: Tools) {
  const toolNames = new Set(tools.map(t => t.name));

  return (toolName: string): string => {
    if (!toolNames.has(toolName)) {
      return `Using ${toolName}`;
    }

    const descriptions: Record<string, string> = {
      Read: 'Reading files',
      Write: 'Writing files',
      Edit: 'Editing files',
      Bash: 'Running shell commands',
      Glob: 'Searching files',
      Grep: 'Searching code',
      WebSearch: 'Searching the web',
      WebFetch: 'Fetching web content',
      TodoWrite: 'Updating tasks',
      NotebookEdit: 'Editing notebooks',
    };

    return descriptions[toolName] ?? `Using ${toolName}`;
  };
}

export function finalizeAgentTool(
  agentMessages: any[],
  agentId: string,
  metadata: {
    prompt: string;
    resolvedAgentModel: string;
    isBuiltInAgent: boolean;
    startTime: number;
    agentType: string;
    isAsync: boolean;
  },
): any {
  const lastAssistantMessage = getLastAssistantMessage(agentMessages);

  if (!lastAssistantMessage) {
    throw new Error('No assistant messages found');
  }

  let content = (lastAssistantMessage.message?.content ?? []).filter(
    (block: any) => block.type === 'text',
  );

  if (content.length === 0) {
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const m = agentMessages[i];
      if (m?.type !== 'assistant') continue;
      const textBlocks = (m.message?.content ?? []).filter((b: any) => b.type === 'text');
      if (textBlocks.length > 0) {
        content = textBlocks;
        break;
      }
    }
  }

  const totalTokens =
    lastAssistantMessage.message?.usage?.output_tokens ?? 0;
  const totalToolUseCount = countToolUses(agentMessages);

  return {
    agentId,
    agentType: metadata.agentType,
    content,
    totalDurationMs: Date.now() - metadata.startTime,
    totalTokens,
    totalToolUseCount,
    usage: lastAssistantMessage.message?.usage ?? {},
  };
}

export function extractPartialResult(messages: any[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.type !== 'assistant') continue;
    const text = extractTextContent(m.message?.content ?? [], '\n');
    if (text) {
      return text;
    }
  }
  return undefined;
}

export { resolveAgentTools, filterToolsForAgent };
export type { ResolvedAgentTools };