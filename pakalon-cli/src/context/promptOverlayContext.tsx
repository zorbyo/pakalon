/**
 * Prompt Overlay Context for pakalon-cli
 *
 * Manages overlay state for prompt-related dialogs.
 */

import React, { createContext, useCallback, useContext, useState } from "react";

// ============================================================================
// Types
// ============================================================================

type PromptOverlayState = {
  isOpen: boolean;
  prompt: string;
  onSubmit: ((value: string) => void) | null;
  onCancel: (() => void) | null;
};

type PromptOverlayContextType = {
  state: PromptOverlayState;
  openPrompt: (options: {
    prompt: string;
    onSubmit: (value: string) => void;
    onCancel?: () => void;
  }) => void;
  closePrompt: () => void;
};

// ============================================================================
// Context
// ============================================================================

const PromptOverlayContext = createContext<PromptOverlayContextType | null>(
  null
);

// ============================================================================
// Provider
// ============================================================================

type Props = {
  children: React.ReactNode;
};

export function PromptOverlayProvider({ children }: Props) {
  const [state, setState] = useState<PromptOverlayState>({
    isOpen: false,
    prompt: "",
    onSubmit: null,
    onCancel: null,
  });

  const openPrompt = useCallback(
    (options: {
      prompt: string;
      onSubmit: (value: string) => void;
      onCancel?: () => void;
    }) => {
      setState({
        isOpen: true,
        prompt: options.prompt,
        onSubmit: options.onSubmit,
        onCancel: options.onCancel ?? null,
      });
    },
    []
  );

  const closePrompt = useCallback(() => {
    setState({
      isOpen: false,
      prompt: "",
      onSubmit: null,
      onCancel: null,
    });
  }, []);

  return (
    <PromptOverlayContext.Provider value={{ state, openPrompt, closePrompt }}>
      {children}
    </PromptOverlayContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access prompt overlay functionality
 */
export function usePromptOverlay(): PromptOverlayContextType {
  const context = useContext(PromptOverlayContext);
  if (!context) {
    throw new Error(
      "usePromptOverlay must be used within a PromptOverlayProvider"
    );
  }
  return context;
}
