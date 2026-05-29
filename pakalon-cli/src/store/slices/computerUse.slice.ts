import type { StateCreator } from "zustand";

export type ScreenshotQuality = "low" | "medium" | "high";
export type ComputerUseConnectionStatus = "idle" | "connecting" | "connected" | "error";

export interface ComputerUseState {
  isActive: boolean;
  mcpServerName: string | null;
  connectionStatus: ComputerUseConnectionStatus;
  screenshotQuality: ScreenshotQuality;
  displayDimensions: { width: number; height: number } | null;
  lastAction: string | null;
  error: string | null;
  activate: (mcpServerName: string, screenshotQuality?: ScreenshotQuality) => void;
  deactivate: () => void;
  setConnectionStatus: (status: ComputerUseConnectionStatus) => void;
  setDisplay: (displayDimensions: { width: number; height: number } | null) => void;
  setLastAction: (action: string | null) => void;
  setError: (error: string | null) => void;
}

export const createComputerUseSlice: StateCreator<ComputerUseState> = (set) => ({
  isActive: false,
  mcpServerName: null,
  connectionStatus: "idle",
  screenshotQuality: "medium",
  displayDimensions: null,
  lastAction: null,
  error: null,

  activate: (mcpServerName, screenshotQuality = "medium") =>
    set({
      isActive: true,
      mcpServerName,
      connectionStatus: "connected",
      screenshotQuality,
      error: null,
    }),

  deactivate: () =>
    set({
      isActive: false,
      mcpServerName: null,
      connectionStatus: "idle",
      lastAction: null,
      error: null,
    }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setDisplay: (displayDimensions) => set({ displayDimensions }),
  setLastAction: (action) => set({ lastAction: action }),
  setError: (error) => set({ error, connectionStatus: error ? "error" : "idle" }),
});
