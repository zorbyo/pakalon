import type { StateCreator } from "zustand";

export type PluginInstallationStatus = "pending" | "installing" | "installed" | "failed";

export interface PluginManagerState {
  enabled: string[];
  disabled: string[];
  commands: Record<string, string[]>;
  errors: Record<string, string>;
  installationStatus: Record<string, PluginInstallationStatus>;
  needsRefresh: boolean;
  enablePlugin: (pluginId: string) => void;
  disablePlugin: (pluginId: string) => void;
  setInstallationStatus: (pluginId: string, status: PluginInstallationStatus) => void;
  setPluginError: (pluginId: string, error: string) => void;
  markNeedsRefresh: () => void;
}

export const createPluginManagerSlice: StateCreator<PluginManagerState> = (set) => ({
  enabled: [],
  disabled: [],
  commands: {},
  errors: {},
  installationStatus: {},
  needsRefresh: false,

  enablePlugin: (pluginId) =>
    set((state) => ({
      enabled: Array.from(new Set([...state.enabled, pluginId])),
      disabled: state.disabled.filter((id) => id !== pluginId),
    })),

  disablePlugin: (pluginId) =>
    set((state) => ({
      enabled: state.enabled.filter((id) => id !== pluginId),
      disabled: Array.from(new Set([...state.disabled, pluginId])),
    })),

  setInstallationStatus: (pluginId, status) =>
    set((state) => ({
      installationStatus: {
        ...state.installationStatus,
        [pluginId]: status,
      },
    })),

  setPluginError: (pluginId, error) =>
    set((state) => ({
      errors: {
        ...state.errors,
        [pluginId]: error,
      },
    })),

  markNeedsRefresh: () => set({ needsRefresh: true }),
});
