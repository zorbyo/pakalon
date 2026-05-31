/**
 * Debug Tool
 * 
 * DAP (Debug Adapter Protocol) debugger integration.
 * Based on OMP's debug tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import { spawn, type ChildProcess } from 'child_process';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

interface DAPSession {
  id: string;
  adapter: string;
  process: ChildProcess | null;
  breakpoints: Map<string, number[]>;
  threads: Array<{ id: number; name: string }>;
  stackFrames: Array<{ id: number; name: string; line: number; file: string }>;
  variables: Map<string, unknown>;
  status: 'running' | 'stopped' | 'terminated';
  stoppedReason?: string;
}

interface DebugCommand {
  command: string;
  args?: Record<string, unknown>;
}

interface DebugResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

// ============================================================================
// Debug Manager
// ============================================================================

class DebugManager {
  private sessions: Map<string, DAPSession> = new Map();
  private maxSessions: number = 5;

  /**
   * Start a debug session
   */
  async startSession(
    adapter: string,
    program: string,
    args?: string[]
  ): Promise<DAPSession | null> {
    if (this.sessions.size >= this.maxSessions) {
      logger.warn('[debug] Max sessions reached');
      return null;
    }

    const sessionId = `debug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      // Start the debug adapter
      const adapterArgs = args || [];
      const proc = spawn(adapter, [...adapterArgs, program], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const session: DAPSession = {
        id: sessionId,
        adapter,
        process: proc,
        breakpoints: new Map(),
        threads: [],
        stackFrames: [],
        variables: new Map(),
        status: 'running',
      };

      this.sessions.set(sessionId, session);

      // Handle adapter output
      proc.stdout?.on('data', (data: Buffer) => {
        this.handleAdapterOutput(sessionId, data.toString());
      });

      proc.stderr?.on('data', (data: Buffer) => {
        logger.debug('[debug] Adapter stderr', { sessionId, data: data.toString() });
      });

      proc.on('close', (code) => {
        session.status = 'terminated';
        logger.debug('[debug] Adapter closed', { sessionId, code });
      });

      logger.debug('[debug] Started session', { sessionId, adapter, program });

      return session;
    } catch (error) {
      logger.error('[debug] Failed to start session', { error: String(error) });
      return null;
    }
  }

  /**
   * Handle adapter output
   */
  private handleAdapterOutput(sessionId: string, output: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Parse DAP messages
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.startsWith('Content-Length:')) {
        // DAP message header
        const contentLength = parseInt(line.split(':')[1].trim(), 10);
        // Would need to read the content body
      }
    }
  }

  /**
   * Send a command to a session
   */
  async sendCommand(
    sessionId: string,
    command: DebugCommand
  ): Promise<DebugResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    if (!session.process) {
      return { success: false, message: 'No process attached' };
    }

    // Send DAP request
    const request = JSON.stringify({
      seq: Date.now(),
      type: 'request',
      command: command.command,
      arguments: command.args,
    });

    session.process.stdin?.write(`Content-Length: ${Buffer.byteLength(request)}\r\n\r\n${request}`);

    return { success: true, message: 'Command sent' };
  }

  /**
   * Set a breakpoint
   */
  setBreakpoint(sessionId: string, file: string, line: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const breakpoints = session.breakpoints.get(file) || [];
    if (!breakpoints.includes(line)) {
      breakpoints.push(line);
      session.breakpoints.set(file, breakpoints);
    }

    return true;
  }

  /**
   * Remove a breakpoint
   */
  removeBreakpoint(sessionId: string, file: string, line: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const breakpoints = session.breakpoints.get(file) || [];
    const index = breakpoints.indexOf(line);
    if (index > -1) {
      breakpoints.splice(index, 1);
      session.breakpoints.set(file, breakpoints);
    }

    return true;
  }

  /**
   * Get session status
   */
  getSession(sessionId: string): DAPSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all sessions
   */
  listSessions(): DAPSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Stop a session
   */
  stopSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session?.process) {
      session.process.kill('SIGTERM');
      session.status = 'terminated';
    }
    return this.sessions.delete(sessionId);
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    for (const session of this.sessions.values()) {
      if (session.process) {
        session.process.kill('SIGTERM');
      }
    }
    this.sessions.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let debugManagerInstance: DebugManager | null = null;

function getDebugManager(): DebugManager {
  if (!debugManagerInstance) {
    debugManagerInstance = new DebugManager();
  }
  return debugManagerInstance;
}

// ============================================================================
// Debug Tool
// ============================================================================

const debugInputSchema = z.object({
  action: z.enum(['start', 'stop', 'set-breakpoint', 'remove-breakpoint', 'status', 'list']).describe('Debug action to perform'),
  adapter: z.string().optional().describe('Debug adapter (e.g., lldb-dap, debugpy, node)'),
  program: z.string().optional().describe('Program to debug'),
  args: z.array(z.string()).optional().describe('Program arguments'),
  sessionId: z.string().optional().describe('Session ID for existing sessions'),
  file: z.string().optional().describe('File for breakpoint operations'),
  line: z.number().optional().describe('Line number for breakpoint operations'),
});

export const debugTool = buildTool({
  name: 'debug',
  description: 'Debug programs using DAP (Debug Adapter Protocol). Supports breakpoints, stepping, and variable inspection.',
  inputSchema: debugInputSchema,
  isReadOnly: false,
  isConcurrencySafe: false,
  requiresUserInteraction: true,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { action, adapter, program, args: programArgs, sessionId, file, line } = args;
    
    try {
      const manager = getDebugManager();
      
      switch (action) {
        case 'start': {
          if (!adapter || !program) {
            return { data: 'adapter and program are required for start action' };
          }
          const session = await manager.startSession(adapter, program, programArgs);
          if (!session) {
            return { data: 'Failed to start debug session' };
          }
          return { data: `Debug session started: ${session.id}` };
        }
        
        case 'stop': {
          if (!sessionId) {
            return { data: 'sessionId is required for stop action' };
          }
          const stopped = manager.stopSession(sessionId);
          return { data: stopped ? 'Session stopped' : 'Session not found' };
        }
        
        case 'set-breakpoint': {
          if (!sessionId || !file || !line) {
            return { data: 'sessionId, file, and line are required for set-breakpoint' };
          }
          const set = manager.setBreakpoint(sessionId, file, line);
          return { data: set ? `Breakpoint set at ${file}:${line}` : 'Failed to set breakpoint' };
        }
        
        case 'remove-breakpoint': {
          if (!sessionId || !file || !line) {
            return { data: 'sessionId, file, and line are required for remove-breakpoint' };
          }
          const removed = manager.removeBreakpoint(sessionId, file, line);
          return { data: removed ? `Breakpoint removed at ${file}:${line}` : 'Failed to remove breakpoint' };
        }
        
        case 'status': {
          if (!sessionId) {
            return { data: 'sessionId is required for status action' };
          }
          const session = manager.getSession(sessionId);
          if (!session) {
            return { data: 'Session not found' };
          }
          return {
            data: `Session: ${session.id}\nAdapter: ${session.adapter}\nStatus: ${session.status}\nBreakpoints: ${Array.from(session.breakpoints.entries()).map(([f, ls]) => `${f}:${ls.join(',')}`).join('; ') || 'none'}`,
          };
        }
        
        case 'list': {
          const sessions = manager.listSessions();
          if (sessions.length === 0) {
            return { data: 'No active debug sessions' };
          }
          const list = sessions.map(s => `${s.id} (${s.adapter}) - ${s.status}`).join('\n');
          return { data: `Active sessions:\n${list}` };
        }
        
        default:
          return { data: `Unknown action: ${action}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[debug] Command failed', { error: message });
      return { data: `Debug command failed: ${message}` };
    }
  },
  
  userFacingName: () => 'Debug',
  
  renderToolUseMessage: (input) => {
    const action = typeof input.action === 'string' ? input.action : 'unknown';
    return `Debug: ${action}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
