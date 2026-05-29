import type { StateCreator } from "zustand";

export type MCPConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface MCPServerConnectionState {
  name: string;
  status: MCPConnectionStatus;
  tools: string[];
  resources: string[];
  error?: string;
}

export interface MCPConnectionState {
  connectionStatus: MCPConnectionStatus;
  servers: Record<string, MCPServerConnectionState>;
  activeConnections: number;
  lastConnectionError: string | null;
  autoReconnect: boolean;
  connectServer: (serverId: string, name?: string) => void;
  disconnectServer: (serverId: string) => void;
  updateServerStatus: (
    serverId: string,
    status: MCPConnectionStatus,
    updates?: Partial<MCPServerConnectionState>,
  ) => void;
  setConnectionError: (error: string | null) => void;
  setAutoReconnect: (enabled: boolean) => void;
}

function getActiveConnections(servers: Record<string, MCPServerConnectionState>): number {
  return Object.values(servers).filter((server) => server.status === "connected").length;
}

export const createMcpConnectionSlice: StateCreator<MCPConnectionState> = (set) => ({
  connectionStatus: "disconnected",
  servers: {},
  activeConnections: 0,
  lastConnectionError: null,
  autoReconnect: true,

  connectServer: (serverId, name) =>
    set((state) => {
      const servers = {
        ...state.servers,
        [serverId]: {
          name: name ?? state.servers[serverId]?.name ?? serverId,
          status: "connecting" as const,
          tools: state.servers[serverId]?.tools ?? [],
          resources: state.servers[serverId]?.resources ?? [],
          error: undefined,
        },
      };
      return {
        connectionStatus: "connecting",
        servers,
        activeConnections: getActiveConnections(servers),
        lastConnectionError: null,
      };
    }),

  disconnectServer: (serverId) =>
    set((state) => {
      const server = state.servers[serverId];
      if (!server) return state;
      const servers = {
        ...state.servers,
        [serverId]: {
          ...server,
          status: "disconnected" as const,
          error: undefined,
        },
      };
      return {
        connectionStatus: "disconnected",
        servers,
        activeConnections: getActiveConnections(servers),
      };
    }),

  updateServerStatus: (serverId, status, updates = {}) =>
    set((state) => {
      const existing = state.servers[serverId];
      const servers = {
        ...state.servers,
        [serverId]: {
          name: updates.name ?? existing?.name ?? serverId,
          status,
          tools: updates.tools ?? existing?.tools ?? [],
          resources: updates.resources ?? existing?.resources ?? [],
          error: updates.error ?? existing?.error,
        },
      };
      return {
        connectionStatus: status === "error" ? "error" : status,
        servers,
        activeConnections: getActiveConnections(servers),
        lastConnectionError: status === "error" ? (updates.error ?? existing?.error ?? null) : state.lastConnectionError,
      };
    }),

  setConnectionError: (error) =>
    set({
      connectionStatus: error ? "error" : "disconnected",
      lastConnectionError: error,
    }),

  setAutoReconnect: (enabled) => set({ autoReconnect: enabled }),
});
