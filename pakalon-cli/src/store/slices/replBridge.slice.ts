import type { StateCreator } from "zustand";

export type ReplBridgeMode = "chat" | "plan" | "edit" | "agent";
export type ReplBridgeStatusLineType = "info" | "success" | "error" | "warning";

export interface ReplBridgeState {
  isConnected: boolean;
  sessionId: string | null;
  mode: ReplBridgeMode;
  inputHistory: string[];
  inputHistoryIndex: number;
  currentInput: string;
  cursorPosition: number;
  isStreaming: boolean;
  lastResponseTime: number | null;
  statusLine: string;
  statusLineType: ReplBridgeStatusLineType;
  statusLineTimeout: ReturnType<typeof setTimeout> | null;
  connect: (sessionId: string) => void;
  disconnect: () => void;
  setMode: (mode: ReplBridgeMode) => void;
  pushHistory: (input: string) => void;
  setInput: (input: string) => void;
  setCursor: (cursorPosition: number) => void;
  setStreaming: (isStreaming: boolean) => void;
  setStatusLine: (statusLine: string, type?: ReplBridgeStatusLineType, timeoutMs?: number) => void;
}

export const createReplBridgeSlice: StateCreator<ReplBridgeState> = (set, get) => ({
  isConnected: false,
  sessionId: null,
  mode: "chat",
  inputHistory: [],
  inputHistoryIndex: -1,
  currentInput: "",
  cursorPosition: 0,
  isStreaming: false,
  lastResponseTime: null,
  statusLine: "",
  statusLineType: "info",
  statusLineTimeout: null,

  connect: (sessionId) => set({ isConnected: true, sessionId }),

  disconnect: () => {
    const timeout = get().statusLineTimeout;
    if (timeout) clearTimeout(timeout);
    set({
      isConnected: false,
      sessionId: null,
      isStreaming: false,
      statusLine: "",
      statusLineType: "info",
      statusLineTimeout: null,
    });
  },

  setMode: (mode) => set({ mode }),

  pushHistory: (input) =>
    set((state) => ({
      inputHistory: [...state.inputHistory, input],
      inputHistoryIndex: state.inputHistory.length + 1,
    })),

  setInput: (input) =>
    set((state) => ({
      currentInput: input,
      cursorPosition: Math.min(state.cursorPosition, input.length),
    })),

  setCursor: (cursorPosition) => set({ cursorPosition }),

  setStreaming: (isStreaming) =>
    set(() => ({
      isStreaming,
      lastResponseTime: isStreaming ? null : Date.now(),
    })),

  setStatusLine: (statusLine, type = "info", timeoutMs = 0) => {
    const previous = get().statusLineTimeout;
    if (previous) clearTimeout(previous);
    if (!timeoutMs) {
      set({ statusLine, statusLineType: type, statusLineTimeout: null });
      return;
    }
    const timeout = setTimeout(() => {
      set({ statusLine: "", statusLineType: "info", statusLineTimeout: null });
    }, timeoutMs);
    set({ statusLine, statusLineType: type, statusLineTimeout: timeout });
  },
});
