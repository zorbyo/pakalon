/**
 * Session State Management
 * 
 * Manages session state transitions and external metadata sync.
 * Handles idle/running/requires_action states and permission modes.
 */

import logger from '../utils/logger.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import type {
  SessionState,
  RequiresActionDetails,
  SessionExternalMetadata,
} from './types.js';

type SessionStateChangedListener = (
  state: SessionState,
  details?: RequiresActionDetails
) => void;

type SessionMetadataChangedListener = (
  metadata: SessionExternalMetadata
) => void;

type PermissionModeChangedListener = (mode: string) => void;

let stateListener: SessionStateChangedListener | null = null;
let metadataListener: SessionMetadataChangedListener | null = null;
let permissionModeListener: PermissionModeChangedListener | null = null;

let hasPendingAction = false;
let currentState: SessionState = 'idle';
let currentPermissionMode: string = 'normal';

/**
 * Set listener for session state changes
 */
export function setSessionStateChangedListener(cb: SessionStateChangedListener | null): void {
  stateListener = cb;
}

/**
 * Set listener for session metadata changes
 */
export function setSessionMetadataChangedListener(cb: SessionMetadataChangedListener | null): void {
  metadataListener = cb;
}

/**
 * Set listener for permission mode changes
 */
export function setPermissionModeChangedListener(cb: PermissionModeChangedListener | null): void {
  permissionModeListener = cb;
}

/**
 * Get current session state
 */
export function getSessionState(): SessionState {
  return currentState;
}

/**
 * Get current permission mode
 */
export function getPermissionMode(): string {
  return currentPermissionMode;
}

/**
 * Notify session state changed
 */
export function notifySessionStateChanged(
  state: SessionState,
  details?: RequiresActionDetails
): void {
  currentState = state;
  stateListener?.(state, details);

  if (state === 'requires_action' && details) {
    hasPendingAction = true;
    metadataListener?.({
      pending_action: details,
    });
  } else if (hasPendingAction) {
    hasPendingAction = false;
    metadataListener?.({ pending_action: null });
  }

  if (state === 'idle') {
    metadataListener?.({ task_summary: null });
  }

  if (isEnvTruthy(process.env.PAKALON_EMIT_SESSION_STATE_EVENTS)) {
    enqueueSdkEvent({
      type: 'system',
      subtype: 'session_state_changed',
      state,
    });
  }

  logger.debug(`Session state changed: ${state}`);
}

/**
 * Notify session metadata changed
 */
export function notifySessionMetadataChanged(metadata: SessionExternalMetadata): void {
  metadataListener?.(metadata);
}

/**
 * Notify permission mode changed
 */
export function notifyPermissionModeChanged(mode: string): void {
  currentPermissionMode = mode;
  permissionModeListener?.(mode);

  metadataListener?.({
    permission_mode: mode,
  });

  logger.debug(`Permission mode changed: ${mode}`);
}

/**
 * Enqueue SDK event for external listeners
 */
function enqueueSdkEvent(event: {
  type: string;
  subtype?: string;
  state?: SessionState;
}): void {
  // Event would be enqueued for processing by SDK consumers
  logger.debug(`SDK event: ${event.type}/${event.subtype}`);
}

/**
 * Reset session state (for testing)
 */
export function resetSessionState(): void {
  currentState = 'idle';
  hasPendingAction = false;
  stateListener = null;
  metadataListener = null;
  permissionModeListener = null;
}

/**
 * Create requires action details
 */
export function createRequiresActionDetails(
  toolName: string,
  actionDescription: string,
  toolUseId: string,
  requestId: string,
  input?: Record<string, unknown>
): RequiresActionDetails {
  return {
    tool_name: toolName,
    action_description: actionDescription,
    tool_use_id: toolUseId,
    request_id: requestId,
    input,
  };
}

/**
 * Check if session is in a terminal state
 */
export function isTerminalState(state: SessionState): boolean {
  return state === 'idle';
}

/**
 * Check if session requires user action
 */
export function isRequiresActionState(state: SessionState): boolean {
  return state === 'requires_action';
}

/**
 * Check if session is running
 */
export function isRunningState(state: SessionState): boolean {
  return state === 'running';
}

/**
 * Create session state change event
 */
export function createStateChangeEvent(
  from: SessionState,
  to: SessionState,
  details?: RequiresActionDetails
): { from: SessionState; to: SessionState; details?: RequiresActionDetails; timestamp: string } {
  return {
    from,
    to,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get external metadata snapshot
 */
export function getExternalMetadata(): SessionExternalMetadata {
  return {
    permission_mode: currentPermissionMode,
    pending_action: hasPendingAction ? undefined : null,
    task_summary: null,
  };
}

/**
 * Validate permission mode
 */
export function isValidPermissionMode(mode: string): boolean {
  const validModes = ['normal', 'plan', 'bypass-permissions', 'low-risk'];
  return validModes.includes(mode);
}

/**
 * Default permission mode
 */
export function getDefaultPermissionMode(): string {
  return 'normal';
}

export default {
  getSessionState,
  getPermissionMode,
  notifySessionStateChanged,
  notifySessionMetadataChanged,
  notifyPermissionModeChanged,
  setSessionStateChangedListener,
  setSessionMetadataChangedListener,
  setPermissionModeChangedListener,
  resetSessionState,
  isTerminalState,
  isRequiresActionState,
  isRunningState,
  getExternalMetadata,
};