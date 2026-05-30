/**
 * Overlay Context for pakalon-cli
 *
 * Overlay tracking for Escape key coordination.
 *
 * This solves the problem of escape key handling when overlays (like Select with onCancel)
 * are open. The CancelRequestHandler needs to know when an overlay is active so it doesn't
 * cancel requests when the user just wants to dismiss the overlay.
 */

import { useCallback, useEffect, useState } from "react";

// ============================================================================
// Types
// ============================================================================

type OverlayState = {
  activeOverlays: Set<string>;
};

// ============================================================================
// Module State
// ============================================================================

// Non-modal overlays that shouldn't disable TextInput focus
const NON_MODAL_OVERLAYS = new Set(["autocomplete"]);

// Global overlay state
let overlayState: OverlayState = {
  activeOverlays: new Set(),
};

let overlayListeners: Array<() => void> = [];

function notifyOverlayListeners() {
  for (const listener of overlayListeners) {
    listener();
  }
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to register a component as an active overlay.
 * Automatically registers on mount and unregisters on unmount.
 *
 * @param id - Unique identifier for this overlay (e.g., 'select', 'multi-select')
 * @param enabled - Whether to register (default: true)
 */
export function useRegisterOverlay(id: string, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    overlayState.activeOverlays.add(id);
    notifyOverlayListeners();

    return () => {
      overlayState.activeOverlays.delete(id);
      notifyOverlayListeners();
    };
  }, [id, enabled]);
}

/**
 * Hook to check if any overlay is currently active.
 * This is reactive - the component will re-render when the overlay state changes.
 */
export function useIsOverlayActive(): boolean {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const listener = () => forceUpdate({});
    overlayListeners.push(listener);
    return () => {
      overlayListeners = overlayListeners.filter((l) => l !== listener);
    };
  }, []);

  return overlayState.activeOverlays.size > 0;
}

/**
 * Hook to check if any modal overlay is currently active.
 * Modal overlays are overlays that should capture all input (like Select dialogs).
 * Non-modal overlays (like autocomplete) don't disable TextInput focus.
 */
export function useIsModalOverlayActive(): boolean {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const listener = () => forceUpdate({});
    overlayListeners.push(listener);
    return () => {
      overlayListeners = overlayListeners.filter((l) => l !== listener);
    };
  }, []);

  for (const id of overlayState.activeOverlays) {
    if (!NON_MODAL_OVERLAYS.has(id)) {
      return true;
    }
  }
  return false;
}

/**
 * Get current overlay state (non-reactive)
 */
export function getActiveOverlays(): Set<string> {
  return new Set(overlayState.activeOverlays);
}
