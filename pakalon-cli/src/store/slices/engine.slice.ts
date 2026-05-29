/**
 * Engine Store Slice
 *
 * Tracks the HarnessEngine singleton lifecycle.
 * Uses a standalone Zustand store (NOT part of the persisted AppStore)
 * to avoid putting class instances or non-serializable state through
 * Zustand's persist middleware.
 *
 * The HarnessEngine instance lives in the global singleton
 * (getGlobalEngine / resetGlobalEngine), not in the store.
 */

import { create } from "zustand";

// ============================================================================
// Types
// ============================================================================

export type EngineStatus = "uninitialized" | "initializing" | "ready" | "error";

export interface EngineState {
  /** Lifecycle status of the global HarnessEngine. */
  engineStatus: EngineStatus;

  /** Error message if initialization failed. */
  engineError: string | null;

  /** Number of loaded skill commands (updated after init). */
  skillCount: number;

  /** Number of loaded tool definitions (updated after init). */
  toolCount: number;

  // Actions
  /** Initialize the global HarnessEngine singleton. */
  initializeEngine: (rootDir?: string) => Promise<void>;

  /** Reset engine status (for error recovery or testing). */
  resetEngine: () => void;
}

// ============================================================================
// Standalone Store
// ============================================================================

export const useEngineStore = create<EngineState>()((set, get) => ({
  engineStatus: "uninitialized",
  engineError: null,
  skillCount: 0,
  toolCount: 0,

  initializeEngine: async (rootDir?: string) => {
    const current = get().engineStatus;
    if (current === "initializing" || current === "ready") return;

    set({ engineStatus: "initializing", engineError: null });

    try {
      const { getGlobalEngine } = await import("@/engine/HarnessEngine.js");
      const engine = await getGlobalEngine(
        rootDir ? { rootDir } : undefined,
      );

      set({
        engineStatus: "ready",
        skillCount: engine.getSkillCommands().length,
        toolCount: engine.getState().toolCount,
        engineError: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        engineStatus: "error",
        engineError: message,
        skillCount: 0,
        toolCount: 0,
      });
    }
  },

  resetEngine: () => {
    set({
      engineStatus: "uninitialized",
      engineError: null,
      skillCount: 0,
      toolCount: 0,
    });
  },
}));
