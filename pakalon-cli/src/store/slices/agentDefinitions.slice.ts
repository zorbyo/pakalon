import type { StateCreator } from "zustand";

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  color?: string;
  [key: string]: unknown;
}

export interface AgentDefinitionsState {
  agents: AgentDefinition[];
  isLoading: boolean;
  lastLoaded: number | null;
  loadError: string | null;
  setAgents: (agents: AgentDefinition[]) => void;
  setLoading: (isLoading: boolean) => void;
  setLoadError: (error: string | null) => void;
}

export const createAgentDefinitionsSlice: StateCreator<AgentDefinitionsState> = (set) => ({
  agents: [],
  isLoading: false,
  lastLoaded: null,
  loadError: null,

  setAgents: (agents) =>
    set({
      agents,
      isLoading: false,
      lastLoaded: Date.now(),
      loadError: null,
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setLoadError: (error) => set({ loadError: error, isLoading: false }),
});
