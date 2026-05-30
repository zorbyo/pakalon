/**
 * FPS Metrics Context for pakalon-cli
 *
 * Provides FPS (frames per second) metrics tracking for the TUI.
 */

import React, { createContext, useContext } from "react";

// ============================================================================
// Types
// ============================================================================

export type FpsMetrics = {
  fps: number;
  frameTime: number;
  jank: boolean;
};

type FpsMetricsGetter = () => FpsMetrics | undefined;

// ============================================================================
// Context
// ============================================================================

const FpsMetricsContext = createContext<FpsMetricsGetter | undefined>(
  undefined
);

// ============================================================================
// Provider
// ============================================================================

type Props = {
  getFpsMetrics: FpsMetricsGetter;
  children: React.ReactNode;
};

export function FpsMetricsProvider({ getFpsMetrics, children }: Props) {
  return (
    <FpsMetricsContext.Provider value={getFpsMetrics}>
      {children}
    </FpsMetricsContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to get FPS metrics getter function
 */
export function useFpsMetrics(): FpsMetricsGetter | undefined {
  return useContext(FpsMetricsContext);
}
