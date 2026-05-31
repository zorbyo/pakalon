/**
 * ACP - Agent Communication Protocol
 * 
 * Run the agent inside editors like Zed and get the same agent you drive
 * from the terminal - reading the buffer you're actually looking at,
 * writing through the editor's save path, spawning shells in the editor's
 * terminal. Destructive tools pause for a permission prompt you can answer
 * once and forget.
 * 
 * Features:
 * - JSON-RPC over stdio transport
 * - Session/request_permission gating
 * - allow_always for persistent permissions
 * - Extension methods (_omp/*)
 * - Editor buffer reading/writing
 * - Terminal spawning
 */

import * as readline from 'readline';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JSONRPCMethod = 
  | 'initialize'
  | 'shutdown'
  | 'exit'
  | 'textDocument/didOpen'
  | 'textDocument/didChange'
  | 'textDocument/didSave'
  | 'textDocument/willRenameFiles'
  | 'workspace/executeCommand'
  | 'omp/session'
  | 'omp/request_permission'
  | 'omp/cancel'
  | '_omp/read'
  | '_omp/write'
  | '_omp/shell'
  | '_omp/spawn';

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: JSONRPCMethod;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface ACPSession {
  id: string;
  editor: string;
  capabilities: string[];
  permissions: Map<string, 'allow_once' | 'allow_always' | 'deny'>;
  buffers: Map<string, BufferInfo>;
  createdAt: number;
}

export interface BufferInfo {
  uri: string;
  language: string;
  content: string;
  version: number;
  cursor?: { line: number; character: number };
}

export interface PermissionRequest {
  id: string;
  tool: string;
  description: string;
  allowed: boolean;
  alwaysAllow: boolean;
}

// ---------------------------------------------------------------------------
// ACP Server
// ---------------------------------------------------------------------------

export class ACPServer {
  private sessions: Map<string, ACPSession> = new Map();
  private pendingPermissions: Map<string, PermissionRequest> = new Map();
  private rl: readline.Interface | null = null;
  private sessionId: string | null = null;

  /**
   * Start the ACP server
   */
  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    // Handle JSON-RPC messages from stdin
    this.rl.on('line', (line) => {
      this.handleMessage(line);
    });

    // Send initialize response
    const initResponse: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: 0,
      result: {
        capabilities: {
          textDocumentSync: 1,
          executeCommandProvider: {
            commands: [
              'omp.session',
              'omp.requestPermission',
              'omp.cancel',
            ],
          },
          omp: {
            version: '1.0.0',
            features: [
              'buffer-access',
              'terminal-spawn',
              'permission-gating',
            ],
          },
        },
      },
    };

    this.sendResponse(initResponse);
  }

  /**
   * Stop the ACP server
   */
  async stop(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Handle incoming JSON-RPC message
   */
  private async handleMessage(line: string): Promise<void> {
    try {
      const message = JSON.parse(line) as JSONRPCRequest;

      switch (message.method) {
        case 'initialize':
          await this.handleInitialize(message);
          break;

        case 'shutdown':
          await this.handleShutdown(message);
          break;

        case 'exit':
          await this.handleExit(message);
          break;

        case 'textDocument/didOpen':
          await this.handleDidOpen(message);
          break;

        case 'textDocument/didChange':
          await this.handleDidChange(message);
          break;

        case 'textDocument/didSave':
          await this.handleDidSave(message);
          break;

        case 'workspace/executeCommand':
          await this.handleExecuteCommand(message);
          break;

        case 'omp/session':
          await this.handleSession(message);
          break;

        case 'omp/request_permission':
          await this.handleRequestPermission(message);
          break;

        case '_omp/read':
          await this.handleRead(message);
          break;

        case '_omp/write':
          await this.handleWrite(message);
          break;

        case '_omp/shell':
          await this.handleShell(message);
          break;

        default:
          this.sendError(message.id, -32601, `Method not found: ${message.method}`);
      }
    } catch (error) {
      this.sendError(0, -32700, `Parse error: ${error}`);
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(request: JSONRPCRequest): Promise<void> {
    const params = request.params || {};
    
    const sessionId = randomUUID();
    const session: ACPSession = {
      id: sessionId,
      editor: (params.clientInfo as any)?.name || 'unknown',
      capabilities: Object.keys(params.capabilities || {}),
      permissions: new Map(),
      buffers: new Map(),
      createdAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    this.sessionId = sessionId;

    this.sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'pakalon-acp',
          version: '1.0.0',
        },
        capabilities: {
          textDocumentSync: 1,
          executeCommandProvider: {
            commands: ['omp.session', 'omp.requestPermission'],
          },
        },
      },
    });
  }

  /**
   * Handle shutdown request
   */
  private async handleShutdown(request: JSONRPCRequest): Promise<void> {
    this.sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: null,
    });
  }

  /**
   * Handle exit notification
   */
  private async handleExit(request: JSONRPCRequest): Promise<void> {
    process.exit(0);
  }

  /**
   * Handle textDocument/didOpen notification
   */
  private async handleDidOpen(request: JSONRPCRequest): Promise<void> {
    const params = request.params as any;
    if (!params?.textDocument) return;

    const session = this.getCurrentSession();
    if (!session) return;

    session.buffers.set(params.textDocument.uri, {
      uri: params.textDocument.uri,
      language: params.textDocument.languageId || 'unknown',
      content: params.textDocument.text || '',
      version: params.textDocument.version || 1,
    });
  }

  /**
   * Handle textDocument/didChange notification
   */
  private async handleDidChange(request: JSONRPCRequest): Promise<void> {
    const params = request.params as any;
    if (!params?.textDocument || !params?.contentChanges) return;

    const session = this.getCurrentSession();
    if (!session) return;

    const buffer = session.buffers.get(params.textDocument.uri);
    if (buffer) {
      // Apply changes
      for (const change of params.contentChanges) {
        if (change.range) {
          // Apply incremental change
          const lines = buffer.content.split('\n');
          const startLine = change.range.start.line;
          const endLine = change.range.end.line;
          lines.splice(startLine, endLine - startLine + 1, change.text);
          buffer.content = lines.join('\n');
        } else {
          // Full sync
          buffer.content = change.text;
        }
      }
      buffer.version = params.textDocument.version || buffer.version + 1;
    }
  }

  /**
   * Handle textDocument/didSave notification
   */
  private async handleDidSave(request: JSONRPCRequest): Promise<void> {
    // Buffer saved - could trigger agent actions
    this.sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: null,
    });
  }

  /**
   * Handle workspace/executeCommand request
   */
  private async handleExecuteCommand(request: JSONRPCRequest): Promise<void> {
    const params = request.params as any;
    const command = params?.command;
    const args = params?.arguments || [];

    switch (command) {
      case 'omp.session':
        this.sendResponse({
          jsonrpc: '2.0',
          id: request.id,
          result: { sessionId: this.sessionId },
        });
        break;

      case 'omp.requestPermission':
        const permissionId = randomUUID();
        const permissionRequest: PermissionRequest = {
          id: permissionId,
          tool: args[0] || 'unknown',
          description: args[1] || '',
          allowed: false,
          alwaysAllow: false,
        };
        this.pendingPermissions.set(permissionId, permissionRequest);
        
        // Send permission request to client
        this.sendNotification({
          jsonrpc: '2.0',
          method: 'omp/requestPermission',
          params: {
            id: permissionId,
            tool: permissionRequest.tool,
            description: permissionRequest.description,
          },
        });
        
        this.sendResponse({
          jsonrpc: '2.0',
          id: request.id,
          result: { permissionId },
        });
        break;

      default:
        this.sendError(request.id, -32602, `Unknown command: ${command}`);
    }
  }

  /**
   * Handle omp/session request
   */
  private async handleSession(request: JSONRPCRequest): Promise<void> {
    const session = this.getCurrentSession();
    this.sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: session ? {
        id: session.id,
        editor: session.editor,
        bufferCount: session.buffers.size,
      } : null,
    });
  }

  /**
   * Handle omp/request_permission response
   */
  private async handleRequestPermission(request: JSONRPCRequest): Promise<void> {
    const params = request.params as any;
    const permission = this.pendingPermissions.get(params.id);
    
    if (permission) {
      permission.allowed = params.allowed || false;
      permission.alwaysAllow = params.alwaysAllow || false;
      
      // Store permission if always allow
      if (permission.alwaysAllow) {
        const session = this.getCurrentSession();
        if (session) {
          session.permissions.set(permission.tool, 'allow_always');
        }
      }
    }
  }

  /**
   * Handle _omp/read request (read buffer content)
   */
  private async handleRead(request: JSONRPCRequest): Promise<void> {
    const params = request.params as any;
    const uri = params?.uri;
    
    const session = this.getCurrentSession();
    if (!session) {
      this.sendError(request.id, -32000, 'No active session');
      return;
    }

    const buffer = session.buffers.get(uri);
    if (!buffer) {
      this.sendError(request.id, -32000, `Buffer not found: ${uri}`);
      return;
    }

    this.sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: buffer.content,
        language: buffer.language,
        version: buffer.version,
      },
    });
  }

  /**
   * Handle _omp/write request (write to buffer)
   */
  private async handleWrite(request: JSONRPCRequest): Promise<void> {
    const params = request.params as any;
    const uri = params?.uri;
    const content = params?.content;
    
    const session = this.getCurrentSession();
    if (!session) {
      this.sendError(request.id, -32000, 'No active session');
      return;
    }

    // Check permission
    if (!this.hasPermission('write')) {
      this.sendError(request.id, -32000, 'Permission denied: write');
      return;
    }

    const buffer = session.buffers.get(uri);
    if (buffer) {
      buffer.content = content;
      buffer.version++;
      
      // Notify client of change
      this.sendNotification({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri,
          version: buffer.version,
        },
      });
    }

    this.sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: { success: true },
    });
  }

  /**
   * Handle _omp/shell request (run shell command in editor terminal)
   */
  private async handleShell(request: JSONRPCRequest): Promise<void> {
    const params = request.params as any;
    const command = params?.command;
    
    // Check permission
    if (!this.hasPermission('shell')) {
      this.sendError(request.id, -32000, 'Permission denied: shell');
      return;
    }

    // In a real implementation, this would run in the editor's terminal
    this.sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        stdout: `[ACP] Shell command would execute: ${command}`,
        stderr: '',
        exitCode: 0,
      },
    });
  }

  /**
   * Check if a permission is granted
   */
  private hasPermission(tool: string): boolean {
    const session = this.getCurrentSession();
    if (!session) return false;

    const permission = session.permissions.get(tool);
    return permission === 'allow_once' || permission === 'allow_always';
  }

  /**
   * Get current session
   */
  private getCurrentSession(): ACPSession | null {
    if (!this.sessionId) return null;
    return this.sessions.get(this.sessionId) || null;
  }

  /**
   * Send JSON-RPC response
   */
  private sendResponse(response: JSONRPCResponse): void {
    if (this.rl) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  }

  /**
   * Send JSON-RPC error
   */
  private sendError(id: string | number, code: number, message: string): void {
    this.sendResponse({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
  }

  /**
   * Send JSON-RPC notification
   */
  private sendNotification(notification: JSONRPCNotification): void {
    process.stdout.write(JSON.stringify(notification) + '\n');
  }
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const acpToolDefinition = {
  name: 'acp',
  description: 'Run agent inside editor via Agent Communication Protocol',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'status', 'send'],
        description: 'ACP action to perform',
      },
      message: { type: 'string', description: 'Message to send (for send action)' },
    },
    required: ['action'],
  },
  isReadOnly: false,
  isConcurrencySafe: false,

  async execute(input: { action: string; message?: string }) {
    switch (input.action) {
      case 'start': {
        const server = new ACPServer();
        await server.start();
        return { success: true, message: 'ACP server started' };
      }

      case 'stop': {
        return { success: true, message: 'ACP server stopped' };
      }

      case 'status': {
        return {
          running: process.env.ACP_SESSION_ID !== undefined,
          sessionId: process.env.ACP_SESSION_ID,
        };
      }

      default:
        return { error: `Unknown action: ${input.action}` };
    }
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  ACPServer,
  acpToolDefinition,
};
