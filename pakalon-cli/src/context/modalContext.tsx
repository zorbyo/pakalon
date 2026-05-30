/**
 * Modal Context for pakalon-cli
 *
 * Provides modal state management for the TUI.
 */

import React, { createContext, useContext } from "react";

// ============================================================================
// Types
// ============================================================================

type ModalCtx = {
  rows: number;
  columns: number;
  scrollRef: React.RefObject<{ scrollTo?: (pos: number) => void } | null> | null;
};

// ============================================================================
// Context
// ============================================================================

export const ModalContext = createContext<ModalCtx | null>(null);

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to check if we're inside a modal
 */
export function useIsInsideModal(): boolean {
  return useContext(ModalContext) !== null;
}

/**
 * Hook to get modal or terminal size
 */
export function useModalOrTerminalSize(fallback: {
  rows: number;
  columns: number;
}): { rows: number; columns: number } {
  const ctx = useContext(ModalContext);
  return ctx
    ? { rows: ctx.rows, columns: ctx.columns }
    : fallback;
}

/**
 * Hook to get modal scroll ref
 */
export function useModalScrollRef(): React.RefObject<{
  scrollTo?: (pos: number) => void;
} | null> | null {
  return useContext(ModalContext)?.scrollRef ?? null;
}
