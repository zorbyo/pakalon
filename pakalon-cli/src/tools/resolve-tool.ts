/**
 * Resolve Tool
 * 
 * Preview/apply semantics for tool results.
 * Based on OMP's resolve tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

interface PendingAction {
  id: string;
  toolName: string;
  label: string;
  apply: (reason: string, extra?: Record<string, unknown>) => Promise<string>;
  reject?: (reason: string, extra?: Record<string, unknown>) => Promise<string>;
  createdAt: number;
}

// ============================================================================
// Resolve Manager
// ============================================================================

class ResolveManager {
  private pendingActions: Map<string, PendingAction> = new Map();

  /**
   * Queue a pending action
   */
  queue(action: PendingAction): void {
    this.pendingActions.set(action.id, action);
    logger.debug('[resolve] Queued action', { id: action.id, toolName: action.toolName });
  }

  /**
   * Apply a pending action
   */
  async apply(
    actionId: string,
    reason: string,
    extra?: Record<string, unknown>
  ): Promise<string> {
    const action = this.pendingActions.get(actionId);
    if (!action) {
      return `Action ${actionId} not found`;
    }

    try {
      const result = await action.apply(reason, extra);
      this.pendingActions.delete(actionId);
      logger.debug('[resolve] Applied action', { id: actionId });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[resolve] Apply failed', { id: actionId, error: message });
      return `Failed to apply action: ${message}`;
    }
  }

  /**
   * Reject a pending action
   */
  async reject(
    actionId: string,
    reason: string,
    extra?: Record<string, unknown>
  ): Promise<string> {
    const action = this.pendingActions.get(actionId);
    if (!action) {
      return `Action ${actionId} not found`;
    }

    if (!action.reject) {
      this.pendingActions.delete(actionId);
      return `Action ${actionId} rejected (no reject handler)`;
    }

    try {
      const result = await action.reject(reason, extra);
      this.pendingActions.delete(actionId);
      logger.debug('[resolve] Rejected action', { id: actionId });
      return result || `Action ${actionId} rejected`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[resolve] Reject failed', { id: actionId, error: message });
      return `Failed to reject action: ${message}`;
    }
  }

  /**
   * Get pending action
   */
  getPending(actionId: string): PendingAction | undefined {
    return this.pendingActions.get(actionId);
  }

  /**
   * List all pending actions
   */
  listPending(): PendingAction[] {
    return Array.from(this.pendingActions.values());
  }

  /**
   * Clear all pending actions
   */
  clear(): void {
    this.pendingActions.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: ResolveManager | null = null;

function getResolveManager(): ResolveManager {
  if (!managerInstance) {
    managerInstance = new ResolveManager();
  }
  return managerInstance;
}

// ============================================================================
// Resolve Tool
// ============================================================================

const resolveInputSchema = z.object({
  action: z.enum(['apply', 'discard']).describe('Resolve action'),
  reason: z.string().describe('Reason for action'),
  action_id: z.string().optional().describe('Pending action ID'),
  extra: z.record(z.unknown()).optional().describe('Extra metadata'),
});

export const resolveTool = buildTool({
  name: 'resolve',
  description: 'Apply or discard pending preview actions.',
  inputSchema: resolveInputSchema,
  isReadOnly: false,
  isConcurrencySafe: false,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { action, reason, action_id, extra } = args;
    
    try {
      const manager = getResolveManager();
      
      if (!action_id) {
        // If no action_id, try to get the most recent pending action
        const pending = manager.listPending();
        if (pending.length === 0) {
          return { data: 'No pending actions to resolve' };
        }
        
        const latestAction = pending[pending.length - 1];
        const id = latestAction.id;
        
        if (action === 'apply') {
          return { data: await manager.apply(id, reason, extra) };
        } else {
          return { data: await manager.reject(id, reason, extra) };
        }
      }
      
      if (action === 'apply') {
        return { data: await manager.apply(action_id, reason, extra) };
      } else {
        return { data: await manager.reject(action_id, reason, extra) };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[resolve] Tool failed', { error: message });
      return { data: `Resolve failed: ${message}` };
    }
  },
  
  userFacingName: () => 'Resolve',
  
  renderToolUseMessage: (input) => {
    const action = typeof input.action === 'string' ? input.action : 'unknown';
    const reason = typeof input.reason === 'string' ? input.reason : '';
    return `Resolve ${action}: ${reason.slice(0, 50)}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
