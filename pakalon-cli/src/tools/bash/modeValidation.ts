/**
 * Mode Validation
 * Validates bash commands based on the current permission mode
 */
import type { PermissionMode } from '@/tools/agent-tool/types';
import { classifyBashPermission } from './bashPermissions.js';
import { isDestructive } from './destructiveCommandWarning.js';
import { requiresWritePermission } from './readOnlyValidation.js';
import { shouldUseSandbox } from './shouldUseSandbox.js';
import logger from '@/utils/logger.js';

export interface ModeValidationResult {
  allowed: boolean;
  requiresPrompt: boolean;
  reason: string;
  modeOverride?: PermissionMode;
}

export function validateCommandForMode(
  command: string,
  mode: PermissionMode,
): ModeValidationResult {
  switch (mode) {
    case 'bypassPermissions':
      return {
        allowed: true,
        requiresPrompt: false,
        reason: 'All commands allowed in bypassPermissions mode',
      };

    case 'acceptEdits':
      return validateAcceptEditsMode(command);

    case 'auto':
      return validateAutoMode(command);

    case 'ask':
      return validateAskMode(command);

    case 'bubble':
      return validateBubbleMode(command);

    case 'plan':
      return validatePlanMode(command);

    case 'restrictToolUse':
      return validateRestrictMode(command);

    default:
      return {
        allowed: false,
        requiresPrompt: true,
        reason: `Unknown permission mode: ${mode}`,
      };
  }
}

function validateAcceptEditsMode(command: string): ModeValidationResult {
  const isDestructiveCmd = isDestructive(command);

  if (isDestructiveCmd) {
    return {
      allowed: true,
      requiresPrompt: true,
      reason: 'Destructive commands still require confirmation in acceptEdits mode',
      modeOverride: 'ask',
    };
  }

  return {
    allowed: true,
    requiresPrompt: false,
    reason: 'All non-destructive commands allowed in acceptEdits mode',
  };
}

function validateAutoMode(command: string): ModeValidationResult {
  const permissionDecision = classifyBashPermission(
    { command },
    'auto',
  );

  if (permissionDecision.riskLevel === 'critical') {
    return {
      allowed: true,
      requiresPrompt: true,
      reason: 'Critical risk commands require confirmation',
      modeOverride: 'ask',
    };
  }

  if (permissionDecision.riskLevel === 'high') {
    return {
      allowed: true,
      requiresPrompt: true,
      reason: permissionDecision.reason,
    };
  }

  return {
    allowed: true,
    requiresPrompt: permissionDecision.requiresPrompt,
    reason: 'Auto mode handles permissions automatically',
  };
}

function validateAskMode(command: string): ModeValidationResult {
  const writeCheck = requiresWritePermission(command);

  if (!writeCheck.allowed) {
    return {
      allowed: true,
      requiresPrompt: true,
      reason: writeCheck.reason,
    };
  }

  return {
    allowed: true,
    requiresPrompt: true,
    reason: 'Ask mode requires confirmation for all commands',
  };
}

function validateBubbleMode(command: string): ModeValidationResult {
  const sandboxDecision = shouldUseSandbox(command, 'bubble');

  if (sandboxDecision.shouldSandbox) {
    return {
      allowed: true,
      requiresPrompt: true,
      reason: `${sandboxDecision.reason} - sandbox ${sandboxDecision.sandboxType} may be used`,
    };
  }

  return {
    allowed: true,
    requiresPrompt: false,
    reason: 'Bubble mode allows commands without prompt if safe',
  };
}

function validatePlanMode(command: string): ModeValidationResult {
  const writeCheck = requiresWritePermission(command);

  if (writeCheck.requiresWrite) {
    return {
      allowed: false,
      requiresPrompt: false,
      reason: `Write operations not allowed in plan mode: ${writeCheck.reason}`,
    };
  }

  return {
    allowed: true,
    requiresPrompt: false,
    reason: 'Read-only operations allowed in plan mode',
  };
}

function validateRestrictMode(command: string): ModeValidationResult {
  const writeCheck = requiresWritePermission(command);

  if (writeCheck.requiresWrite) {
    return {
      allowed: false,
      requiresPrompt: false,
      reason: `Write operations restricted: ${writeCheck.reason}`,
    };
  }

  return {
    allowed: true,
    requiresPrompt: true,
    reason: 'Restricted mode - all operations require confirmation',
  };
}

export function canModeSkipPrompt(mode: PermissionMode): boolean {
  return mode === 'bypassPermissions' || mode === 'acceptEdits';
}

export function doesModeAllowWrite(mode: PermissionMode): boolean {
  return mode === 'bypassPermissions' || mode === 'acceptEdits' || mode === 'ask';
}

export function getModeDisplayName(mode: PermissionMode): string {
  const names: Record<PermissionMode, string> = {
    bypassPermissions: 'Bypass (Allow All)',
    acceptEdits: 'Accept Edits',
    auto: 'Auto',
    ask: 'Ask (Confirm Each)',
    bubble: 'Bubble',
    plan: 'Plan Mode',
    restrictToolUse: 'Restrict',
  };

  return names[mode] || mode;
}

export function getNextMode(currentMode: PermissionMode): PermissionMode {
  const modeOrder: PermissionMode[] = [
    'ask',
    'bubble',
    'auto',
    'acceptEdits',
    'bypassPermissions',
    'plan',
    'restrictToolUse',
  ];

  const currentIndex = modeOrder.indexOf(currentMode);
  if (currentIndex === -1 || currentIndex === modeOrder.length - 1) {
    return modeOrder[0];
  }

  return modeOrder[currentIndex + 1];
}