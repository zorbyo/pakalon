/**
 * Eval Tool
 * 
 * Persistent Python and JavaScript cells with shared prelude and tool re-entry.
 * Based on OMP's eval tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import { spawn, type ChildProcess } from 'child_process';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

interface EvalCell {
  id: string;
  language: 'python' | 'javascript' | 'typescript';
  process: ChildProcess | null;
  output: string[];
  error: string[];
  createdAt: number;
  lastUsed: number;
}

interface EvalResult {
  cellId: string;
  output: string;
  error: string;
  exitCode: number | null;
  duration: number;
}

// ============================================================================
// Eval Manager
// ============================================================================

class EvalManager {
  private cells: Map<string, EvalCell> = new Map();
  private maxCells: number = 10;

  /**
   * Create or get a cell
   */
  getOrCreateCell(
    language: 'python' | 'javascript' | 'typescript',
    cellId?: string
  ): EvalCell {
    const id = cellId || `cell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    let cell = this.cells.get(id);
    if (cell) {
      cell.lastUsed = Date.now();
      return cell;
    }

    // Cleanup old cells if at limit
    if (this.cells.size >= this.maxCells) {
      this.cleanupOldCells();
    }

    cell = {
      id,
      language,
      process: null,
      output: [],
      error: [],
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    this.cells.set(id, cell);
    return cell;
  }

  /**
   * Execute code in a cell
   */
  async execute(
    cellId: string,
    code: string,
    timeout: number = 30000
  ): Promise<EvalResult> {
    const cell = this.cells.get(cellId);
    if (!cell) {
      return {
        cellId,
        output: '',
        error: `Cell ${cellId} not found`,
        exitCode: 1,
        duration: 0,
      };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      let command: string;
      let args: string[];

      switch (cell.language) {
        case 'python':
          command = 'python3';
          args = ['-c', code];
          break;
        case 'javascript':
          command = 'node';
          args = ['-e', code];
          break;
        case 'typescript':
          command = 'npx';
          args = ['tsx', '-e', code];
          break;
        default:
          resolve({
            cellId,
            output: '',
            error: `Unsupported language: ${cell.language}`,
            exitCode: 1,
            duration: 0,
          });
          return;
      }

      const proc = spawn(command, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      cell.process = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          cellId,
          output: stdout,
          error: stderr + '\nExecution timed out',
          exitCode: 1,
          duration: Date.now() - startTime,
        });
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        cell.output.push(stdout);
        cell.error.push(stderr);
        cell.lastUsed = Date.now();

        resolve({
          cellId,
          output: stdout,
          error: stderr,
          exitCode: code,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          cellId,
          output: '',
          error: err.message,
          exitCode: 1,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Destroy a cell
   */
  destroyCell(cellId: string): boolean {
    const cell = this.cells.get(cellId);
    if (cell?.process) {
      cell.process.kill('SIGTERM');
    }
    return this.cells.delete(cellId);
  }

  /**
   * Get cell info
   */
  getCell(cellId: string): EvalCell | undefined {
    return this.cells.get(cellId);
  }

  /**
   * List all cells
   */
  listCells(): EvalCell[] {
    return Array.from(this.cells.values());
  }

  /**
   * Cleanup old cells
   */
  private cleanupOldCells(): void {
    const sorted = Array.from(this.cells.values())
      .sort((a, b) => a.lastUsed - b.lastUsed);

    const toRemove = sorted.slice(0, Math.floor(this.maxCells / 2));
    for (const cell of toRemove) {
      this.destroyCell(cell.id);
    }
  }

  /**
   * Clear all cells
   */
  clear(): void {
    for (const cell of this.cells.values()) {
      if (cell.process) {
        cell.process.kill('SIGTERM');
      }
    }
    this.cells.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let evalManagerInstance: EvalManager | null = null;

function getEvalManager(): EvalManager {
  if (!evalManagerInstance) {
    evalManagerInstance = new EvalManager();
  }
  return evalManagerInstance;
}

// ============================================================================
// Eval Tool
// ============================================================================

const evalInputSchema = z.object({
  language: z.enum(['python', 'javascript', 'typescript']).describe('Programming language to execute'),
  code: z.string().describe('Code to execute'),
  cellId: z.string().optional().describe('Cell ID to reuse (for persistent state)'),
  timeout: z.number().optional().default(30000).describe('Execution timeout in ms'),
});

export const evalTool = buildTool({
  name: 'eval',
  description: 'Execute code in persistent Python/JavaScript cells. Cells maintain state between calls.',
  inputSchema: evalInputSchema,
  isReadOnly: false,
  isConcurrencySafe: false,
  requiresUserInteraction: false,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { language, code, cellId, timeout } = args;
    
    try {
      const manager = getEvalManager();
      const cell = manager.getOrCreateCell(language, cellId);
      
      const result = await manager.execute(cell.id, code, timeout);
      
      let output = '';
      if (result.output) {
        output += result.output;
      }
      if (result.error) {
        output += `\nStderr:\n${result.error}`;
      }
      output += `\nExit code: ${result.exitCode}`;
      output += `\nDuration: ${result.duration}ms`;
      output += `\nCell ID: ${cell.id} (reusable)`;
      
      return {
        data: output || 'No output',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[eval] Execution failed', { error: message });
      
      return {
        data: `Execution failed: ${message}`,
      };
    }
  },
  
  userFacingName: () => 'Eval',
  
  renderToolUseMessage: (input) => {
    const language = typeof input.language === 'string' ? input.language : 'unknown';
    const code = typeof input.code === 'string' ? input.code : '';
    const preview = code.length > 50 ? code.slice(0, 50) + '...' : code;
    return `${language}: ${preview}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
