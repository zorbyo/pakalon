import type { StateCreator } from "zustand";

export interface PromptSuggestionState {
  suggestions: string[];
  selectedIndex: number;
  isVisible: boolean;
  refreshTrigger: number;
  setSuggestions: (suggestions: string[]) => void;
  selectSuggestion: (index: number) => void;
  show: () => void;
  hide: () => void;
  refresh: () => void;
}

export const createPromptSuggestionSlice: StateCreator<PromptSuggestionState> = (set, get) => ({
  suggestions: [],
  selectedIndex: -1,
  isVisible: false,
  refreshTrigger: 0,

  setSuggestions: (suggestions) =>
    set({
      suggestions,
      selectedIndex: suggestions.length > 0 ? Math.min(get().selectedIndex, suggestions.length - 1) : -1,
    }),

  selectSuggestion: (index) =>
    set((state) => ({
      selectedIndex:
        state.suggestions.length === 0 ? -1 : Math.max(0, Math.min(index, state.suggestions.length - 1)),
    })),

  show: () => set({ isVisible: true }),
  hide: () => set({ isVisible: false }),
  refresh: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 })),
});
