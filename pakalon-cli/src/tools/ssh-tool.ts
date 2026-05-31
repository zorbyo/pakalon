/**
 * SSH Tool
 * 
 * Remote command execution via SSH.
 * Based on OMP's ssh tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '@/utils/logger.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

interface SSHConfig {
  host: string;
  port?: number;
  user?: string;
  keyFile?: string;
  timeout?: number;
}

interface SSHResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
}

// ============================================================================
// SSH Manager
// ============================================================================

class SSHManager {
  private configs: Map<string, SSHConfig> = new Map();

  /**
   * Register an SSH host configuration
   */
  registerHost(name: string, config: SSHConfig): void {
    this.configs.set(name, config);
    logger.debug('[ssh] Registered host', { name, host: config.host });
  }

  /**
   * Unregister an SSH host
   */
  unregisterHost(name: string): boolean {
    return this.configs.delete(name);
  }

  /**
   * Execute a command on a remote host
   */
  async execute(hostName: string, command: string, timeout: number = 30000): Promise<SSHResult> {
    const config = this.configs.get(hostName);
    if (!config) {
      return {
        stdout: '',
        stderr: `Host '${hostName}' not configured`,
        exitCode: 1,
        duration: 0,
      };
    }

    const startTime = Date.now();

    try {
      const sshArgs = this.buildSSHArgs(config);
      const fullCommand = `ssh ${sshArgs} ${config.user ? `${config.user}@` : ''}${config.host} ${JSON.stringify(command)}`;
      
      const { stdout, stderr } = await execAsync(fullCommand, {
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Build SSH arguments
   */
  private buildSSHArgs(config: SSHConfig): string {
    const args: string[] = [];

    if (config.port) {
      args.push(`-p ${config.port}`);
    }

    if (config.keyFile) {
      args.push(`-i ${config.keyFile}`);
    }

    args.push('-o StrictHostKeyChecking=no');
    args.push('-o ConnectTimeout=10');

    return args.join(' ');
  }

  /**
   * List registered hosts
   */
  listHosts(): SSHConfig[] {
    return Array.from(this.configs.entries()).map(([name, config]) => ({
      ...config,
      name,
    }));
  }

  /**
   * Clear all hosts
   */
  clear(): void {
    this.configs.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let sshManagerInstance: SSHManager | null = null;

function getSSHManager(): SSHManager {
  if (!sshManagerInstance) {
    sshManagerInstance = new SSHManager();
    
    // Register hosts from environment
    const sshHosts = process.env.SSH_HOSTS;
    if (sshHosts) {
      try {
        const hosts = JSON.parse(sshHosts);
        for (const [name, config] of Object.entries(hosts)) {
          sshManagerInstance.registerHost(name, config as SSHConfig);
        }
      } catch (error) {
        logger.warn('[ssh] Failed to parse SSH_HOSTS', { error: String(error) });
      }
    }
  }
  return sshManagerInstance;
}

// ============================================================================
// SSH Tool
// ============================================================================

const sshInputSchema = z.object({
  action: z.enum(['execute', 'register', 'list']).describe('SSH action to perform'),
  host: z.string().describe('Host name or address'),
  command: z.string().optional().describe('Command to execute'),
  port: z.number().optional().describe('SSH port'),
  user: z.string().optional().describe('SSH user'),
  keyFile: z.string().optional().describe('Path to SSH key file'),
  timeout: z.number().optional().default(30000).describe('Command timeout in ms'),
});

export const sshTool = buildTool({
  name: 'ssh',
  description: 'Execute commands on remote hosts via SSH.',
  inputSchema: sshInputSchema,
  isReadOnly: false,
  isConcurrencySafe: false,
  requiresUserInteraction: false,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { action, host, command, port, user, keyFile, timeout } = args;
    
    try {
      const manager = getSSHManager();
      
      switch (action) {
        case 'execute': {
          if (!command) {
            return { data: 'command is required for execute action' };
          }
          const result = await manager.execute(host, command, timeout);
          
          let output = '';
          if (result.stdout) {
            output += result.stdout;
          }
          if (result.stderr) {
            output += `\nStderr:\n${result.stderr}`;
          }
          output += `\nExit code: ${result.exitCode}`;
          output += `\nDuration: ${result.duration}ms`;
          
          return { data: output || 'No output' };
        }
        
        case 'register': {
          manager.registerHost(host, {
            host,
            port,
            user,
            keyFile,
          });
          return { data: `Host '${host}' registered` };
        }
        
        case 'list': {
          const hosts = manager.listHosts();
          if (hosts.length === 0) {
            return { data: 'No registered hosts' };
          }
          const list = hosts.map((h: any) => `${h.name || h.host}:${h.port || 22} (${h.user || 'default'})`).join('\n');
          return { data: `Registered hosts:\n${list}` };
        }
        
        default:
          return { data: `Unknown action: ${action}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[ssh] Command failed', { error: message });
      return { data: `SSH command failed: ${message}` };
    }
  },
  
  userFacingName: () => 'SSH',
  
  renderToolUseMessage: (input) => {
    const action = typeof input.action === 'string' ? input.action : 'unknown';
    const host = typeof input.host === 'string' ? input.host : '';
    return `SSH ${action}: ${host}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
