/**
 * /sandbox command — View AIO Sandbox status
 *
 * Shows the current state of the AIO Sandbox container used for
 * environment-level isolation testing in the 6-phase agent pipeline.
 *
 * Usage:
 *   /sandbox status    — Show sandbox container status
 *   /sandbox logs      — Show recent sandbox container logs
 *   /sandbox destroy   — Force-destroy the sandbox container
 *   /sandbox provision — Manually provision a sandbox (advanced)
 */

import { loadSandboxState, sandboxLifecycleManager, isDockerAvailable } from '@/sandbox/index.js';
import type { CommandDefinition, CommandContext, CommandResult } from './types.js';

async function cmdSandboxStatus(projectDir: string): Promise<string> {
  const lines: string[] = ['## AIO Sandbox Status', ''];

  // Check Docker availability
  const dockerAvail = isDockerAvailable();
  lines.push(`**Docker Available:** ${dockerAvail ? 'Yes' : 'No'}`);
  if (!dockerAvail) {
    lines.push('');
    lines.push('Docker is required for sandbox provisioning.');
    lines.push('Install Docker Desktop: https://www.docker.com/products/docker-desktop/');
    return lines.join('\n');
  }

  // Load sandbox state
  const state = await loadSandboxState(projectDir);
  if (!state) {
    lines.push('');
    lines.push('**Status:** No active sandbox session found.');
    lines.push('');
    lines.push('A sandbox is provisioned automatically during Phase 3 (Development)');
    lines.push('when running the 6-phase agent pipeline (`/pakalon`).');
    return lines.join('\n');
  }

  // Check if container is still running
  const containerStatus = await sandboxLifecycleManager.getStatus(state.sandboxId, projectDir);

  lines.push('');
  lines.push(`**Session ID:** \`${state.sandboxId}\``);
  lines.push(`**Container ID:** \`${state.containerId.substring(0, 12)}...\``);
  lines.push(`**Status:** ${state.status}`);
  lines.push(`**Container Running:** ${containerStatus.available ? 'Yes' : 'No'}`);
  lines.push(`**Sandbox URL:** ${state.url}`);
  if (state.appUrl) {
    lines.push(`**Application URL:** ${state.appUrl}`);
  }
  lines.push(`**MCP Endpoint:** ${state.mcpUrl}`);
  lines.push(`**Provisioned At:** ${state.provisionedAt}`);
  lines.push(`**Deploy Status:** ${state.deployStatus ? (state.deployStatus.success ? 'deployed' : 'failed') : 'N/A'}`);
  if (state.deployStatus?.message) {
    lines.push(`**Deploy Message:** ${state.deployStatus.message}`);
  }

  if (state.testResults) {
    lines.push('');
    lines.push('### Test Results');
    lines.push(`- Total: ${state.testResults.total}`);
    lines.push(`- Passed: ${state.testResults.passed}`);
    lines.push(`- Failed: ${state.testResults.failed}`);
    lines.push(`- Duration: ${(state.testResults.duration / 1000).toFixed(1)}s`);
  }

  if (state.policyResult) {
    lines.push('');
    lines.push('### Policy Evaluation');
    lines.push(`- Passed: ${state.policyResult.passed ? 'Yes' : 'No'}`);
    lines.push(`- Score: ${state.policyResult.score}/100`);
    if (state.policyResult.reasons.length > 0) {
      lines.push('- Issues:');
      for (const reason of state.policyResult.reasons) {
        lines.push(`  - ${reason}`);
      }
    }
  }

  return lines.join('\n');
}

async function cmdSandboxDestroy(projectDir: string): Promise<string> {
  const state = await loadSandboxState(projectDir);
  if (!state) {
    return 'No active sandbox session found. Nothing to destroy.';
  }

  await sandboxLifecycleManager.destroy(state.sandboxId, projectDir);
  return `Sandbox \`${state.sandboxId}\` destroyed successfully.`;
}

async function cmdSandboxProvision(projectDir: string): Promise<string> {
  if (!isDockerAvailable()) {
    return 'Docker is required to provision the AIO Sandbox. Install Docker Desktop or Podman first.';
  }

  const existing = await loadSandboxState(projectDir);
  if (existing) {
    return `Sandbox already exists: ${existing.url} (${existing.status}). Use \`/sandbox destroy\` before provisioning a new one.`;
  }

  const session = await sandboxLifecycleManager.provision(projectDir);
  return [
    'Sandbox provisioned.',
    `- Sandbox URL: ${session.url}`,
    `- MCP Endpoint: ${session.mcpUrl}`,
    `- Application URL: ${session.appUrl}`,
    `- Container: ${session.containerId.substring(0, 12)}`,
  ].join('\n');
}

async function cmdSandboxLogs(projectDir: string): Promise<string> {
  const state = await loadSandboxState(projectDir);
  if (!state) {
    return 'No active sandbox session found.';
  }

  const logs = await sandboxLifecycleManager.getLogs(state.sandboxId, projectDir, 120);
  return logs.trim() || 'Sandbox has no recent logs.';
}

export const sandboxCommand: CommandDefinition = {
  name: 'sandbox',
  aliases: ['sandbox-status'],
  description: 'View the AIO Sandbox status (Docker-based environment isolation)',
  usage: '/sandbox [status|logs|destroy|provision]',
  category: 'advanced',
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const projectDir = context.cwd ?? process.cwd();
    const subcommand = args[0]?.toLowerCase() ?? 'status';

    try {
      switch (subcommand) {
        case 'destroy':
        case 'rm':
        case 'stop': {
          const msg = await cmdSandboxDestroy(projectDir);
          return { success: true, message: msg };
        }
        case 'provision':
        case 'start': {
          const msg = await cmdSandboxProvision(projectDir);
          return { success: true, message: msg };
        }
        case 'logs':
        case 'log': {
          const msg = await cmdSandboxLogs(projectDir);
          return { success: true, message: msg };
        }
        case 'status':
        case 'info':
        case 'show':
        default: {
          const output = await cmdSandboxStatus(projectDir);
          return { success: true, message: output };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Sandbox command failed: ${message}`, error: message };
    }
  },
};

export default sandboxCommand;
