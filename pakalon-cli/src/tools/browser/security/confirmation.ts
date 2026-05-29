/**
 * Confirmation policy for potentially dangerous browser actions.
 */
export interface ActionConfirmation {
  /** Actions that always require confirmation, e.g. `eval`, `download`, `open`. */
  confirmActions?: string[];
  /** When enabled, all actions require confirmation. */
  requireConfirmation?: boolean;
}

function normalizeAction(action: string): string {
  return action.trim().toLowerCase();
}

/**
 * Determines whether an action should require user confirmation.
 */
export function requiresConfirmation(action: string, config: ActionConfirmation): boolean {
  if (config.requireConfirmation) {
    return true;
  }

  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) {
    return false;
  }

  return (config.confirmActions ?? []).some((item) => normalizeAction(item) === normalizedAction);
}
