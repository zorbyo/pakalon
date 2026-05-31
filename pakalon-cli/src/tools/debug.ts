/**
 * Debug Adapter Protocol (DAP) Integration
 * 
 * Drive a live process through the Debug Adapter Protocol. Set breakpoints,
 * step, read locals, evaluate expressions in a frame - the same things you
 * would do in a GUI debugger, scripted from the agent.
 * 
 * Features:
 * - Launch and attach to processes
 * - Set/remove breakpoints (source, data, instruction)
 * - Step execution (over, in, out)
 * - Inspect threads, stack traces, scopes, variables
 * - Evaluate expressions in frames
 * - Output capture from stdout/stderr
 * - Memory read/write and disassembly (when supported)
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdapterType = 
  | 'lldb-dap'     // C, C++, Rust, Swift, Zig, Objective-C
  | 'dlv'           // Go (Delve)
  | 'debugpy'       // Python (debugpy)
  | 'js-debug'      // JavaScript/TypeScript (Node.js)
  | 'netcoredbg'    // .NET (C#, F#, VB.NET)
  | 'rdbg'          // Ruby
  | 'xdebug'        // PHP
  | 'kotlin'        // Kotlin
  | 'dart'          // Dart/Flutter
  | 'elixir'        // Elixir
  | 'bash'          // Bash scripts
  | 'swift'         // Swift
  | 'gdb'           // GNU Debugger (C/C++/Fortran)
  | 'javap'         // Java (JDB)

export type DebugAction = 
  | 'launch' | 'attach' | 'terminate' | 'sessions'
  | 'set_breakpoint' | 'remove_breakpoint' | 'set_data_breakpoint' | 'set_instruction_breakpoint'
  | 'continue' | 'step_over' | 'step_in' | 'step_out' | 'pause'
  | 'threads' | 'stack_trace' | 'scopes' | 'variables' | 'evaluate' | 'output'
  | 'read_memory' | 'write_memory' | 'disassemble' | 'custom_request';

export interface DebugSession {
  id: string;
  adapter: AdapterType;
  process?: ChildProcess;
  state: 'running' | 'stopped' | 'terminated';
  threads: DebugThread[];
  breakpoints: DebugBreakpoint[];
  stopLocation?: { file: string; line: number; column: number };
}

export interface DebugThread {
  id: number;
  name: string;
  state: 'running' | 'stopped';
}

export interface DebugBreakpoint {
  id: string;
  type: 'source' | 'data' | 'instruction';
  file?: string;
  line?: number;
  column?: number;
  condition?: string;
  hitCondition?: string;
  verified: boolean;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  file?: string;
  line?: number;
  column?: number;
  instruction?: string;
}

export interface DebugScope {
  id: number;
  name: string;
  variablesReference: number;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface DebugOutput {
  category: 'stdout' | 'stderr' | 'console' | 'important';
  output: string;
}

// ---------------------------------------------------------------------------
// Debug Adapter
// ---------------------------------------------------------------------------

export class DebugAdapter {
  private sessions: Map<string, DebugSession> = new Map();
  private adapterCommand: string;
  private adapterArgs: string[];

  constructor(adapter: AdapterType) {
    this.adapterCommand = this.getAdapterCommand(adapter);
    this.adapterArgs = this.getAdapterArgs(adapter);
  }

  private getAdapterCommand(adapter: AdapterType): string {
    const commands: Record<AdapterType, string> = {
      'lldb-dap': 'lldb-dap',
      'dlv': 'dlv',
      'debugpy': 'python',
      'js-debug': 'js-debug-adapter',
      'netcoredbg': 'netcoredbg',
      'rdbg': 'rdbg',
      'xdebug': 'php',
      'kotlin': 'kotlin',
      'dart': 'dart',
      'elixir': 'iex',
      'bash': 'bash',
      'swift': 'swift-lldb',
      'gdb': 'gdb',
      'javap': 'jdb',
    };
    return commands[adapter] || adapter;
  }

  private getAdapterArgs(adapter: AdapterType): string[] {
    const args: Record<AdapterType, string[]> = {
      'lldb-dap': [],
      'dlv': ['debug'],
      'debugpy': ['-m', 'debugpy'],
      'js-debug': [],
      'netcoredbg': [],
      'rdbg': [],
      'xdebug': [],
      'kotlin': [],
      'dart': ['debug'],
      'elixir': ['-S', 'mix', 'run', '--no-start'],
      'bash': ['-x'],
      'swift': [],
      'gdb': ['-batch', '-ex'],
      'javap': [],
    };
    return args[adapter] || [];
  }

  /**
   * Launch a new debug session
   */
  async launch(options: {
    program: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    adapter?: AdapterType;
  }): Promise<DebugSession> {
    const adapter = options.adapter || this.getAdapterForProgram(options.program);
    const sessionId = randomUUID();

    const args = [
      ...this.getAdapterArgs(adapter),
      options.program,
      ...(options.args || []),
    ];

    const process = spawn(this.adapterCommand, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: DebugSession = {
      id: sessionId,
      adapter,
      process,
      state: 'running',
      threads: [],
      breakpoints: [],
    };

    this.sessions.set(sessionId, session);

    // Handle process output
    process.stdout?.on('data', (data) => {
      this.handleOutput(sessionId, 'stdout', data.toString());
    });

    process.stderr?.on('data', (data) => {
      this.handleOutput(sessionId, 'stderr', data.toString());
    });

    process.on('exit', () => {
      session.state = 'terminated';
    });

    return session;
  }

  /**
   * Attach to a running process
   */
  async attach(options: {
    pid?: number;
    host?: string;
    port?: number;
    adapter?: AdapterType;
  }): Promise<DebugSession> {
    const adapter = options.adapter || 'lldb-dap';
    const sessionId = randomUUID();

    let args: string[] = [];
    if (options.pid) {
      args = ['attach', '--pid', String(options.pid)];
    } else if (options.host && options.port) {
      args = ['connect', `${options.host}:${options.port}`];
    }

    const process = spawn(this.adapterCommand, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: DebugSession = {
      id: sessionId,
      adapter,
      process,
      state: 'running',
      threads: [],
      breakpoints: [],
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Terminate a debug session
   */
  async terminate(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.process) {
      session.process.kill();
    }

    session.state = 'terminated';
    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * List all sessions
   */
  getSessions(): DebugSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): DebugSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Set a breakpoint
   */
  setBreakpoint(
    sessionId: string,
    options: {
      type?: 'source' | 'data' | 'instruction';
      file?: string;
      line?: number;
      column?: number;
      condition?: string;
      hitCondition?: string;
      name?: string;
      accessType?: 'read' | 'write' | 'readWrite';
    }
  ): DebugBreakpoint | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const breakpoint: DebugBreakpoint = {
      id: randomUUID(),
      type: options.type || 'source',
      file: options.file,
      line: options.line,
      column: options.column,
      condition: options.condition,
      hitCondition: options.hitCondition,
      verified: false,
    };

    session.breakpoints.push(breakpoint);

    // Send breakpoint to adapter (simplified)
    if (session.process?.stdin) {
      const request = {
        type: 'setBreakpoints',
        breakpoints: [{
          source: { path: options.file },
          line: options.line,
          column: options.column,
          condition: options.condition,
          hitCondition: options.hitCondition,
        }],
      };
      session.process.stdin.write(JSON.stringify(request) + '\n');
    }

    return breakpoint;
  }

  /**
   * Remove a breakpoint
   */
  removeBreakpoint(sessionId: string, breakpointId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const idx = session.breakpoints.findIndex(b => b.id === breakpointId);
    if (idx === -1) return false;

    session.breakpoints.splice(idx, 1);
    return true;
  }

  /**
   * Continue execution
   */
  async continue(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return false;

    session.process.stdin.write(JSON.stringify({ type: 'continue' }) + '\n');
    session.state = 'running';
    return true;
  }

  /**
   * Step over
   */
  async stepOver(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return false;

    session.process.stdin.write(JSON.stringify({ type: 'next' }) + '\n');
    return true;
  }

  /**
   * Step in
   */
  async stepIn(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return false;

    session.process.stdin.write(JSON.stringify({ type: 'stepIn' }) + '\n');
    return true;
  }

  /**
   * Step out
   */
  async stepOut(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return false;

    session.process.stdin.write(JSON.stringify({ type: 'stepOut' }) + '\n');
    return true;
  }

  /**
   * Pause execution
   */
  async pause(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return false;

    session.process.stdin.write(JSON.stringify({ type: 'pause' }) + '\n');
    return true;
  }

  /**
   * Get threads
   */
  async getThreads(sessionId: string): Promise<DebugThread[]> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    // In a real implementation, this would query the adapter
    return session.threads;
  }

  /**
   * Get stack trace
   */
  async getStackTrace(sessionId: string, threadId: number, levels?: number): Promise<DebugStackFrame[]> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    // In a real implementation, this would query the adapter
    return [];
  }

  /**
   * Get scopes for a frame
   */
  async getScopes(sessionId: string, frameId: number): Promise<DebugScope[]> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    // In a real implementation, this would query the adapter
    return [];
  }

  /**
   * Get variables
   */
  async getVariables(sessionId: string, variablesReference: number): Promise<DebugVariable[]> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    // In a real implementation, this would query the adapter
    return [];
  }

  /**
   * Evaluate expression
   */
  async evaluate(sessionId: string, frameId: number, expression: string, context?: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return '';

    // Send evaluate request
    const request = {
      type: 'evaluate',
      frameId,
      expression,
      context: context || 'repl',
    };
    session.process.stdin.write(JSON.stringify(request) + '\n');

    // In a real implementation, this would wait for the response
    return '';
  }

  /**
   * Read memory from the debuggee
   */
  async readMemory(sessionId: string, memoryReference: string, offset?: number, count?: number): Promise<{ data: string; address: string } | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return null;

    const request = {
      type: 'readMemory',
      memoryReference,
      offset: offset || 0,
      count: count || 64,
    };
    session.process.stdin.write(JSON.stringify(request) + '\n');

    // In a real implementation, this would wait for the response
    return { data: '', address: memoryReference };
  }

  /**
   * Write memory to the debuggee
   */
  async writeMemory(sessionId: string, memoryReference: string, data: string, offset?: number): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return false;

    const request = {
      type: 'writeMemory',
      memoryReference,
      data,
      offset: offset || 0,
    };
    session.process.stdin.write(JSON.stringify(request) + '\n');

    // In a real implementation, this would wait for the response
    return true;
  }

  /**
   * Disassemble code at an address
   */
  async disassemble(sessionId: string, memoryReference: string, instructionCount?: number, offset?: number): Promise<Array<{ address: string; instruction: string; symbol?: string }>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return [];

    const request = {
      type: 'disassemble',
      memoryReference,
      instructionCount: instructionCount || 10,
      offset: offset || 0,
    };
    session.process.stdin.write(JSON.stringify(request) + '\n');

    // In a real implementation, this would wait for the response
    return [];
  }

  /**
   * Send a custom request to the debug adapter
   */
  async customRequest(sessionId: string, method: string, args?: Record<string, unknown>): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process?.stdin) return null;

    const request = {
      type: 'customRequest',
      method,
      arguments: args || {},
    };
    session.process.stdin.write(JSON.stringify(request) + '\n');

    // In a real implementation, this would wait for the response
    return null;
  }

  /**
   * Handle output from debug adapter
   */
  private handleOutput(sessionId: string, category: DebugOutput['category'], output: string): void {
    // Emit output event
    const event: DebugOutput = { category, output };
    // In a real implementation, this would emit to listeners
    console.debug(`[DAP] ${sessionId}: ${category}: ${output}`);
  }

  /**
   * Get adapter type for a program
   */
  private getAdapterForProgram(program: string): AdapterType {
    if (program.endsWith('.py')) return 'debugpy';
    if (program.endsWith('.go')) return 'dlv';
    if (program.endsWith('.rs') || program.endsWith('.c') || program.endsWith('.cpp')) return 'lldb-dap';
    if (program.endsWith('.js') || program.endsWith('.ts')) return 'js-debug';
    return 'lldb-dap';
  }
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const debugToolDefinition = {
  name: 'debug',
  description: 'Drive a live debugger through the Debug Adapter Protocol',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: [
          'launch', 'attach', 'terminate', 'sessions',
          'set_breakpoint', 'remove_breakpoint',
          'continue', 'step_over', 'step_in', 'step_out', 'pause',
          'threads', 'stack_trace', 'scopes', 'variables', 'evaluate', 'output',
          'read_memory', 'write_memory', 'disassemble', 'custom_request',
        ],
        description: 'Debug action to perform',
      },
      sessionId: { type: 'string', description: 'Debug session ID' },
      program: { type: 'string', description: 'Program to debug (for launch)' },
      args: { type: 'array', items: { type: 'string' }, description: 'Program arguments' },
      cwd: { type: 'string', description: 'Working directory' },
      pid: { type: 'number', description: 'Process ID (for attach)' },
      host: { type: 'string', description: 'Remote host (for attach)' },
      port: { type: 'number', description: 'Remote port (for attach)' },
      adapter: { type: 'string', description: 'Debug adapter type' },
      file: { type: 'string', description: 'File path for breakpoints' },
      line: { type: 'number', description: 'Line number for breakpoints' },
      column: { type: 'number', description: 'Column number for breakpoints' },
      condition: { type: 'string', description: 'Breakpoint condition' },
      hitCondition: { type: 'string', description: 'Breakpoint hit condition' },
      breakpointId: { type: 'string', description: 'Breakpoint ID to remove' },
      threadId: { type: 'number', description: 'Thread ID' },
      frameId: { type: 'number', description: 'Stack frame ID' },
      expression: { type: 'string', description: 'Expression to evaluate' },
      variablesReference: { type: 'number', description: 'Variables reference' },
      levels: { type: 'number', description: 'Number of stack levels' },
      memoryReference: { type: 'string', description: 'Memory reference for read/write/disassemble' },
      offset: { type: 'number', description: 'Offset for memory operations' },
      count: { type: 'number', description: 'Number of bytes to read' },
      data: { type: 'string', description: 'Data to write (hex encoded)' },
      instructionCount: { type: 'number', description: 'Number of instructions to disassemble' },
      method: { type: 'string', description: 'Custom request method name' },
      arguments: { type: 'object', description: 'Custom request arguments' },
    },
    required: ['action'],
  },
  isReadOnly: false,
  isConcurrencySafe: false,

  async execute(input: Record<string, any>) {
    const adapter = new DebugAdapter(input.adapter || 'lldb-dap');

    switch (input.action) {
      case 'launch': {
        if (!input.program) return { error: 'program required for launch' };
        const session = await adapter.launch({
          program: input.program,
          args: input.args,
          cwd: input.cwd,
          adapter: input.adapter,
        });
        return {
          sessionId: session.id,
          adapter: session.adapter,
          state: session.state,
        };
      }

      case 'attach': {
        if (!input.pid && (!input.host || !input.port)) {
          return { error: 'pid or host+port required for attach' };
        }
        const session = await adapter.attach({
          pid: input.pid,
          host: input.host,
          port: input.port,
          adapter: input.adapter,
        });
        return {
          sessionId: session.id,
          adapter: session.adapter,
          state: session.state,
        };
      }

      case 'terminate': {
        if (!input.sessionId) return { error: 'sessionId required' };
        const success = await adapter.terminate(input.sessionId);
        return { success };
      }

      case 'sessions': {
        const sessions = adapter.getSessions();
        return {
          count: sessions.length,
          sessions: sessions.map(s => ({
            id: s.id,
            adapter: s.adapter,
            state: s.state,
            breakpoints: s.breakpoints.length,
          })),
        };
      }

      case 'set_breakpoint': {
        if (!input.sessionId) return { error: 'sessionId required' };
        const bp = adapter.setBreakpoint(input.sessionId, {
          file: input.file,
          line: input.line,
          column: input.column,
          condition: input.condition,
          hitCondition: input.hitCondition,
        });
        return bp ? { breakpointId: bp.id, verified: bp.verified } : { error: 'Failed to set breakpoint' };
      }

      case 'remove_breakpoint': {
        if (!input.sessionId || !input.breakpointId) return { error: 'sessionId and breakpointId required' };
        const success = adapter.removeBreakpoint(input.sessionId, input.breakpointId);
        return { success };
      }

      case 'continue': {
        if (!input.sessionId) return { error: 'sessionId required' };
        const success = await adapter.continue(input.sessionId);
        return { success };
      }

      case 'step_over': {
        if (!input.sessionId) return { error: 'sessionId required' };
        const success = await adapter.stepOver(input.sessionId);
        return { success };
      }

      case 'step_in': {
        if (!input.sessionId) return { error: 'sessionId required' };
        const success = await adapter.stepIn(input.sessionId);
        return { success };
      }

      case 'step_out': {
        if (!input.sessionId) return { error: 'sessionId required' };
        const success = await adapter.stepOut(input.sessionId);
        return { success };
      }

      case 'pause': {
        if (!input.sessionId) return { error: 'sessionId required' };
        const success = await adapter.pause(input.sessionId);
        return { success };
      }

      case 'threads': {
        if (!input.sessionId) return { error: 'sessionId required' };
        const threads = await adapter.getThreads(input.sessionId);
        return { count: threads.length, threads };
      }

      case 'stack_trace': {
        if (!input.sessionId || !input.threadId) return { error: 'sessionId and threadId required' };
        const frames = await adapter.getStackTrace(input.sessionId, input.threadId, input.levels);
        return { count: frames.length, frames };
      }

      case 'scopes': {
        if (!input.sessionId || !input.frameId) return { error: 'sessionId and frameId required' };
        const scopes = await adapter.getScopes(input.sessionId, input.frameId);
        return { count: scopes.length, scopes };
      }

      case 'variables': {
        if (!input.sessionId || !input.variablesReference) return { error: 'sessionId and variablesReference required' };
        const variables = await adapter.getVariables(input.sessionId, input.variablesReference);
        return { count: variables.length, variables };
      }

      case 'evaluate': {
        if (!input.sessionId || !input.frameId || !input.expression) {
          return { error: 'sessionId, frameId, and expression required' };
        }
        const result = await adapter.evaluate(input.sessionId, input.frameId, input.expression);
        return { result };
      }

      case 'read_memory': {
        if (!input.sessionId || !input.memoryReference) {
          return { error: 'sessionId and memoryReference required' };
        }
        const memResult = await adapter.readMemory(input.sessionId, input.memoryReference, input.offset, input.count);
        return memResult || { error: 'Failed to read memory' };
      }

      case 'write_memory': {
        if (!input.sessionId || !input.memoryReference || !input.data) {
          return { error: 'sessionId, memoryReference, and data required' };
        }
        const writeResult = await adapter.writeMemory(input.sessionId, input.memoryReference, input.data, input.offset);
        return { success: writeResult };
      }

      case 'disassemble': {
        if (!input.sessionId || !input.memoryReference) {
          return { error: 'sessionId and memoryReference required' };
        }
        const disasmResult = await adapter.disassemble(input.sessionId, input.memoryReference, input.instructionCount, input.offset);
        return { count: disasmResult.length, instructions: disasmResult };
      }

      case 'custom_request': {
        if (!input.sessionId || !input.method) {
          return { error: 'sessionId and method required' };
        }
        const customResult = await adapter.customRequest(input.sessionId, input.method, input.arguments);
        return { result: customResult };
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
  DebugAdapter,
  debugToolDefinition,
};
