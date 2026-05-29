/**
 * Permissions Store Slice
 *
 * Manages tool permission state including always-allow/always-deny rules,
 * permission mode, and denial tracking.
 *
 * This extends the mode.slice.ts permission mode with the rule-based
 * permission system needed by the permission resolver.
 */

import type { StateCreator } from "zustand";
import type {
  ToolPermissionContext,
  ToolPermissionRulesBySource,
  PermissionMode,
} from "@/tools/tool-types.js";

// ============================================================================
// Types
// ============================================================================

export interface DenialTracking {
  consecutiveDenials: number;
  totalDenials: number;
  lastDeniedAt: number | null;
  lastDeniedTool: string | null;
  fallbackTriggered: boolean;
}

export interface PermissionsState {
  // Permission mode (mirrors mode slice but kept separate for the tool context)
  permissionMode: PermissionMode;

  // Rule-based permissions
  alwaysAllowRules: ToolPermissionRulesBySource;
  alwaysDenyRules: ToolPermissionRulesBySource;
  alwaysAskRules: ToolPermissionRulesBySource;

  // Denial tracking
  denialTracking: DenialTracking;

  // Session permissions (tool name → auto-allowed)
  sessionPermissions: Record<string, boolean>;

  // Stripped dangerous rules (when bypass mode is active)
  strippedDangerousRules: ToolPermissionRulesBySource | null;

  // Saved before entering plan mode
  prePlanMode: PermissionMode | null;

  // Attribution and file history tracking
  attributionState: {
    files: string[];
    toolName: string;
    timestamp: number;
  }[];
  fileHistoryState: {
    path: string;
    action: "create" | "edit" | "delete";
    timestamp: number;
  }[];

  // Actions
  setPermissionMode: (mode: PermissionMode) => void;
  setPrePlanMode: (mode: PermissionMode | null) => void;
  setAlwaysAllowRules: (rules: ToolPermissionRulesBySource) => void;
  setAlwaysDenyRules: (rules: ToolPermissionRulesBySource) => void;
  setAlwaysAskRules: (rules: ToolPermissionRulesBySource) => void;
  addAlwaysAllowRule: (source: keyof ToolPermissionRulesBySource, rule: string) => void;
  addAlwaysDenyRule: (source: keyof ToolPermissionRulesBySource, rule: string) => void;
  recordDenial: (toolName: string) => void;
  recordPermissionSuccess: () => void;
  resetDenialTracking: () => void;
  setSessionPermission: (toolName: string, allowed: boolean) => void;
  clearSessionPermissions: () => void;
  setStrippedDangerousRules: (rules: ToolPermissionRulesBySource | null) => void;
  pushAttribution: (files: string[], toolName: string, timestamp?: number) => void;
  pushFileHistory: (path: string, action: "create" | "edit" | "delete", timestamp?: number) => void;
  clearFileHistory: () => void;
  buildToolPermissionContext: () => ToolPermissionContext;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_DENIAL_TRACKING: DenialTracking = {
  consecutiveDenials: 0,
  totalDenials: 0,
  lastDeniedAt: null,
  lastDeniedTool: null,
  fallbackTriggered: false,
};

const EMPTY_RULES: ToolPermissionRulesBySource = {};

// ============================================================================
// Slice
// ============================================================================

export const createPermissionsSlice: StateCreator<PermissionsState> = (
  set,
  get,
): PermissionsState => ({
  // Default state
  permissionMode: "default" as PermissionMode,
  alwaysAllowRules: { ...EMPTY_RULES },
  alwaysDenyRules: { ...EMPTY_RULES },
  alwaysAskRules: { ...EMPTY_RULES },
  denialTracking: { ...DEFAULT_DENIAL_TRACKING },
  sessionPermissions: {},
  strippedDangerousRules: null,
  prePlanMode: null,
  attributionState: [],
  fileHistoryState: [],

  // Actions
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  setPrePlanMode: (mode) => set({ prePlanMode: mode }),

  setAlwaysAllowRules: (rules) => set({ alwaysAllowRules: rules }),
  setAlwaysDenyRules: (rules) => set({ alwaysDenyRules: rules }),
  setAlwaysAskRules: (rules) => set({ alwaysAskRules: rules }),

  addAlwaysAllowRule: (source, rule) =>
    set((state) => {
      const existing = state.alwaysAllowRules[source] ?? [];
      if (existing.includes(rule)) return state;
      return {
        alwaysAllowRules: {
          ...state.alwaysAllowRules,
          [source]: [...existing, rule],
        },
      };
    }),

  addAlwaysDenyRule: (source, rule) =>
    set((state) => {
      const existing = state.alwaysDenyRules[source] ?? [];
      if (existing.includes(rule)) return state;
      return {
        alwaysDenyRules: {
          ...state.alwaysDenyRules,
          [source]: [...existing, rule],
        },
      };
    }),

  recordDenial: (toolName) =>
    set((state) => {
      const dt = state.denialTracking;
      const consecutive = dt.consecutiveDenials + 1;
      const total = dt.totalDenials + 1;
      return {
        denialTracking: {
          consecutiveDenials: consecutive,
          totalDenials: total,
          lastDeniedAt: Date.now(),
          lastDeniedTool: toolName,
          fallbackTriggered: consecutive >= 3 || total >= 20,
        },
      };
    }),

  recordPermissionSuccess: () =>
    set((state) => ({
      denialTracking: {
        ...state.denialTracking,
        consecutiveDenials: 0,
      },
    })),

  resetDenialTracking: () => set({ denialTracking: { ...DEFAULT_DENIAL_TRACKING } }),

  setSessionPermission: (toolName, allowed) =>
    set((state) => ({
      sessionPermissions: {
        ...state.sessionPermissions,
        [toolName]: allowed,
      },
    })),

  clearSessionPermissions: () => set({ sessionPermissions: {} }),

  setStrippedDangerousRules: (rules) => set({ strippedDangerousRules: rules }),

  pushAttribution: (files, toolName, timestamp = Date.now()) =>
    set((state) => ({
      attributionState: [...state.attributionState, { files, toolName, timestamp }],
    })),

  pushFileHistory: (path, action, timestamp = Date.now()) =>
    set((state) => ({
      fileHistoryState: [...state.fileHistoryState, { path, action, timestamp }],
    })),

  clearFileHistory: () => set({ fileHistoryState: [] }),

  buildToolPermissionContext: () => {
    const state = get();
    return {
      mode: state.permissionMode,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: state.alwaysAllowRules,
      alwaysDenyRules: state.alwaysDenyRules,
      alwaysAskRules: state.alwaysAskRules,
      isBypassPermissionsModeAvailable: true,
      strippedDangerousRules: state.strippedDangerousRules ?? undefined,
    };
  },
});
