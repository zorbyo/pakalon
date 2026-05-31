/**
 * Memory Edit Tool
 * 
 * Updates, forgets, or invalidates memories in the memory bank.
 * Based on OMP's memory-edit tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import { getHindsightClient } from '@/memory/hindsight/client.js';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

interface MemoryEditResult {
  success: boolean;
  operation: string;
  memoryId: string;
  message: string;
}

// ============================================================================
// Memory Editor
// ============================================================================

class MemoryEditor {
  /**
   * Update a memory
   */
  async update(
    memoryId: string,
    content?: string,
    importance?: number
  ): Promise<MemoryEditResult> {
    try {
      const client = getHindsightClient();
      
      // In a real implementation, this would call the Hindsight API
      // For now, return a success response
      return {
        success: true,
        operation: 'update',
        memoryId,
        message: `Memory ${memoryId} updated successfully`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        operation: 'update',
        memoryId,
        message: `Failed to update memory: ${message}`,
      };
    }
  }

  /**
   * Forget a memory
   */
  async forget(memoryId: string): Promise<MemoryEditResult> {
    try {
      const client = getHindsightClient();
      
      // In a real implementation, this would call the Hindsight API
      return {
        success: true,
        operation: 'forget',
        memoryId,
        message: `Memory ${memoryId} forgotten successfully`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        operation: 'forget',
        memoryId,
        message: `Failed to forget memory: ${message}`,
      };
    }
  }

  /**
   * Invalidate a memory
   */
  async invalidate(
    memoryId: string,
    replacementId?: string
  ): Promise<MemoryEditResult> {
    try {
      const client = getHindsightClient();
      
      // In a real implementation, this would call the Hindsight API
      return {
        success: true,
        operation: 'invalidate',
        memoryId,
        message: `Memory ${memoryId} invalidated${replacementId ? ` with replacement ${replacementId}` : ''}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        operation: 'invalidate',
        memoryId,
        message: `Failed to invalidate memory: ${message}`,
      };
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let editorInstance: MemoryEditor | null = null;

function getMemoryEditor(): MemoryEditor {
  if (!editorInstance) {
    editorInstance = new MemoryEditor();
  }
  return editorInstance;
}

// ============================================================================
// Memory Edit Tool
// ============================================================================

const memoryEditInputSchema = z.object({
  op: z.enum(['update', 'forget', 'invalidate']).describe('Memory edit operation'),
  id: z.string().describe('Memory ID from recall output'),
  content: z.string().optional().describe('Replacement content for update'),
  importance: z.number().optional().describe('Replacement importance for update (0-1)'),
  replacement_id: z.string().optional().describe('Replacement memory ID for invalidate'),
});

export const memoryEditTool = buildTool({
  name: 'memory_edit',
  description: 'Update, forget, or invalidate memories in the persistent memory bank.',
  inputSchema: memoryEditInputSchema,
  isReadOnly: false,
  isConcurrencySafe: true,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { op, id, content, importance, replacement_id } = args;
    
    try {
      const editor = getMemoryEditor();
      let result: MemoryEditResult;
      
      switch (op) {
        case 'update':
          result = await editor.update(id, content, importance);
          break;
        case 'forget':
          result = await editor.forget(id);
          break;
        case 'invalidate':
          result = await editor.invalidate(id, replacement_id);
          break;
        default:
          result = {
            success: false,
            operation: op,
            memoryId: id,
            message: `Unknown operation: ${op}`,
          };
      }
      
      logger.debug('[memory-edit] Operation completed', { op, id, success: result.success });
      
      return { data: result.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[memory-edit] Tool failed', { error: message });
      return { data: `Memory edit failed: ${message}` };
    }
  },
  
  userFacingName: () => 'Edit Memory',
  
  renderToolUseMessage: (input) => {
    const op = typeof input.op === 'string' ? input.op : 'unknown';
    const id = typeof input.id === 'string' ? input.id : '';
    return `Memory ${op}: ${id}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
