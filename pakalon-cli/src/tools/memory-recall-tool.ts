/**
 * Memory Recall Tool
 * 
 * Recalls relevant memories from the Hindsight memory bank.
 * Based on OMP's memory-recall tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import { getHindsightClient } from '@/memory/hindsight/client.js';
import logger from '@/utils/logger.js';

const recallInputSchema = z.object({
  query: z.string().describe('The query to search for relevant memories'),
  maxResults: z.number().optional().default(5).describe('Maximum number of memories to return'),
  maxTokens: z.number().optional().describe('Maximum tokens for recalled content'),
});

export const memoryRecallTool = buildTool({
  name: 'recall',
  description: 'Recall relevant memories from the persistent memory bank based on a query.',
  inputSchema: recallInputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { query, maxResults, maxTokens } = args;
    
    try {
      const client = getHindsightClient();
      
      // Check if Hindsight is available
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        return {
          data: 'Hindsight memory server is not available. No memories recalled.',
        };
      }
      
      // Recall memories
      const result = await client.recall(query, {
        maxTokens: maxTokens || 4000,
      });
      
      if (result.memories.length === 0) {
        return {
          data: 'No relevant memories found for the query.',
        };
      }
      
      // Format memories for display
      const formattedMemories = result.memories.slice(0, maxResults).map((memory, index) => {
        const category = (memory.metadata as any)?.category || 'unknown';
        const preview = memory.content.length > 200 
          ? memory.content.slice(0, 200) + '...' 
          : memory.content;
        return `[${index + 1}] (${category}) ${preview}`;
      }).join('\n\n');
      
      const summary = `Found ${result.memories.length} relevant memories (${result.totalTokens} tokens):\n\n${formattedMemories}`;
      
      logger.debug('[memory-recall] Recalled memories', { 
        query: query.slice(0, 50),
        count: result.memories.length,
        totalTokens: result.totalTokens 
      });
      
      return {
        data: summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[memory-recall] Failed to recall memories', { error: message });
      
      return {
        data: `Failed to recall memories: ${message}`,
      };
    }
  },
  
  userFacingName: () => 'Recall Memories',
  
  renderToolUseMessage: (input) => {
    const query = typeof input.query === 'string' ? input.query : '';
    const preview = query.length > 50 ? query.slice(0, 50) + '...' : query;
    return `Recalling: ${preview}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
