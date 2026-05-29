/**
 * Elicitation Handler
 * Handles elicitation requests from MCP servers
 */
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export interface ElicitationRequest {
  method: string;
  params?: Record<string, unknown>;
  requestId: string;
}

export interface ElicitationResponse {
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export type ElicitationHandler = (
  request: ElicitationRequest,
) => Promise<ElicitationResponse>;

class ElicitationHandlerManager {
  private handlers: Map<string, ElicitationHandler> = new Map();

  registerHandler(method: string, handler: ElicitationHandler): void {
    this.handlers.set(method, handler);
  }

  unregisterHandler(method: string): void {
    this.handlers.delete(method);
  }

  getHandler(method: string): ElicitationHandler | undefined {
    return this.handlers.get(method);
  }

  async handleRequest(request: ElicitationRequest): Promise<ElicitationResponse> {
    const handler = this.handlers.get(request.method);

    if (!handler) {
      return {
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      };
    }

    try {
      return await handler(request);
    } catch (error) {
      return {
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      };
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

const globalElicitationHandler = new ElicitationHandlerManager();

export function getElicitationHandler(): ElicitationHandlerManager {
  return globalElicitationHandler;
}

export function registerElicitationHandler(
  method: string,
  handler: ElicitationHandler,
): void {
  globalElicitationHandler.registerHandler(method, handler);
}

export function handleElicitationRequest(
  request: ElicitationRequest,
): Promise<ElicitationResponse> {
  return globalElicitationHandler.handleRequest(request);
}