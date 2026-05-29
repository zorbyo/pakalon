import { tool } from 'ai';
import { z } from 'zod';
import type { CoreMessage } from 'ai';
import { useStore } from '@/store/index.js';

export interface SnipResult {
  success: boolean;
  originalCount: number;
  snippedCount: number;
  remainingCount: number;
  savedTokens?: number;
}

export async function snipConversationHistory(
  messages: CoreMessage[],
  options?: {
    maxMessages?: number;
    preserveSystem?: boolean;
    preserveLastN?: number;
  }
): Promise<{
  messages: CoreMessage[];
  result: SnipResult;
}> {
  const { maxMessages = 50, preserveSystem = true, preserveLastN = 5 } = options || {};

  if (messages.length <= maxMessages) {
    return {
      messages,
      result: {
        success: true,
        originalCount: messages.length,
        snippedCount: 0,
        remainingCount: messages.length,
      },
    };
  }

  let systemMessages: CoreMessage[] = [];
  let otherMessages: CoreMessage[] = [];

  if (preserveSystem) {
    systemMessages = messages.filter((m) => m.role === 'system');
    otherMessages = messages.filter((m) => m.role !== 'system');
  } else {
    otherMessages = [...messages];
  }

  const preserveLast = otherMessages.slice(-preserveLastN);
  const toSnip = otherMessages.slice(0, -preserveLastN);

  const snippedCount = toSnip.length;
  const remainingMessages = [...systemMessages, ...toSnip.slice(0, Math.ceil(maxMessages / 2)), ...preserveLast];

  const originalCount = messages.length;
  const remainingCount = remainingMessages.length;

  return {
    messages: remainingMessages,
    result: {
      success: true,
      originalCount,
      snippedCount,
      remainingCount,
      savedTokens: Math.round((snippedCount / originalCount) * 1000),
    },
  };
}

const snipTool = tool({
  description: 'Snip/summarize the conversation history to reduce context size while preserving important context. Useful when the conversation becomes too long.',
  inputSchema: z.object({
    maxMessages: z.number().optional().default(50).describe('Maximum number of messages to keep'),
    preserveSystem: z.boolean().optional().default(true).describe('Preserve system message'),
    preserveLastN: z.number().optional().default(5).describe('Number of recent messages to always preserve'),
  }),
  execute: async ({ arguments: args }) => {
    const { permissionMode } = useStore.getState();

    if (permissionMode === 'plan') {
      return {
        success: false,
        error: 'Cannot snip history in plan mode',
      };
    }

    const messages = useStore.getState().messages || [];

    const { result } = await snipConversationHistory(messages, {
      maxMessages: args.maxMessages,
      preserveSystem: args.preserveSystem,
      preserveLastN: args.preserveLastN,
    });

    return result;
  },
});

export function getSnipTools() {
  return {
    snip: snipTool,
  };
}

export { snipConversationHistory };