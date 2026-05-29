/**
 * Engine — Agentic Harness entry point
 *
 * Exports the HarnessEngine (master wiring layer) and SpeculationEngine
 * (pre-computation for zero-latency UX).
 */

export { HarnessEngine, wrapToolDefinition, getGlobalEngine, resetGlobalEngine } from "./HarnessEngine.js";
export type { HarnessConfig, HarnessState, ToolPoolResult } from "./HarnessEngine.js";

export { SpeculationEngine } from "./SpeculationEngine.js";
export type {
  CompletionBoundary,
  PipelinedSuggestion,
  SpeculationState,
  SpeculationConfig,
  SpeculationResult,
} from "./SpeculationEngine.js";
