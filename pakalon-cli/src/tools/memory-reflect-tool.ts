/**
 * Memory Reflect Tool
 * 
 * Uses Hindsight memories to answer a question.
 * Based on OMP's memory-reflect tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import { getHindsightClient } from '@/memory/hindsight/client.js';
import logger from '@/utils/logger.js';

const reflectInputSchema = z.object({
  question: z.string().describe('The question to answer using stored memories'),
  maxSources: z.number().optional().default(5).describe('Maximum number of source memories to use'),
});

export const memoryReflectTool = buildTool({
  name: 'reflect',
  description: 'Answer a question using relevant memories from the persistent memory bank.',
  inputSchema: reflectInputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { question, maxSources } = args;
    
    try {
      const client = getHindsightClient();
      
      // Check if Hindsight is available
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        return {
          data: 'Hindsight memory server is not available. Cannot reflect on question.',
        };
      }
      
      // Reflect on the question
      const result = await client.reflect(question, { maxSources });
      
      // Format the answer with sources
      let answer = result.answer;
      
      if (result.sources.length > 0) {
        const sourcesList = result.sources.map((source, index) => {
          const category = (source.metadata as any)?.category || 'unknown';
          const preview = source.content.length > 100 
            ? source.content.slice(0, 100) + '...' 
            : source.content;
          return `[${index + 1}] (${category}) ${preview}`;
        }).join('\n');
        
        answer += `\n\nSources (${result.sources.length} memories used):\n${sourcesList}`;
      }
      
      answer += `\n\nConfidence: ${(result.confidence * 100).toFixed(0)}%`;
      
      logger.debug('[memory-reflect] Reflected on question', { 
        question: question.slice(0, 50),
        sourcesCount: result.sources.length,
        confidence: result.confidence 
      });
      
      return {
        data: answer,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[memory-reflect] Failed to reflect', { error: message });
      
      return {
        data: `Failed to reflect on question: ${message}`,
      };
    }
  },
  
  userFacingName: () => 'Reflect on Memories',
  
  renderToolUseMessage: (input) => {
    const question = typeof input.question === 'string' ? input.question : '';
    const preview = question.length > 50 ? question.slice(0, 50) + '...' : question;
    return `Reflecting: ${preview}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
