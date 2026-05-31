/**
 * Memory Retain Tool
 * 
 * Retains facts and information in the Hindsight memory bank.
 * Based on OMP's memory-retain tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import { getHindsightClient } from '@/memory/hindsight/client.js';
import logger from '@/utils/logger.js';

const retainInputSchema = z.object({
  content: z.string().describe('The content to retain in memory'),
  category: z.enum(['fact', 'decision', 'preference', 'pattern', 'context', 'project'])
    .optional()
    .describe('Category of the memory'),
  metadata: z.record(z.unknown()).optional()
    .describe('Additional metadata to attach to the memory'),
});

export const memoryRetainTool = buildTool({
  name: 'retain',
  description: 'Retain a fact or piece of information in the persistent memory bank for future recall.',
  inputSchema: retainInputSchema,
  isReadOnly: false,
  isConcurrencySafe: true,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { content, category, metadata } = args;
    
    try {
      const client = getHindsightClient();
      
      // Check if Hindsight is available
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        return {
          data: 'Hindsight memory server is not available. Memory not retained.',
        };
      }
      
      // Retain the memory
      const memory = await client.retain(content, {
        metadata: {
          ...metadata,
          category: category || 'context',
          sessionId: ctx.options.querySource,
          agentId: ctx.agentId?.id,
        },
      });
      
      logger.debug('[memory-retain] Retained memory', { 
        id: memory.id, 
        category: category || 'context',
        contentLength: content.length 
      });
      
      return {
        data: `Memory retained successfully (ID: ${memory.id}). Category: ${category || 'context'}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[memory-retain] Failed to retain memory', { error: message });
      
      return {
        data: `Failed to retain memory: ${message}`,
      };
    }
  },
  
  userFacingName: () => 'Retain Memory',
  
  renderToolUseMessage: (input) => {
    const content = typeof input.content === 'string' ? input.content : '';
    const preview = content.length > 50 ? content.slice(0, 50) + '...' : content;
    return `Retaining: ${preview}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
