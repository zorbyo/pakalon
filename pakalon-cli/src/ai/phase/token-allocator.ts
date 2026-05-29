/**
 * Phase Token Allocator
 *
 * Provides token allocation strategies for the 6-phase autonomous build pipeline.
 * Each phase has different token requirements based on its workload.
 *
 * Token Allocation Strategy:
 * - Phase 1 (Planning): Research-heavy, needs more context for web search results
 * - Phase 2 (Wireframes): Design-heavy, moderate tokens for Penpot/Figma data
 * - Phase 3 (Frontend): Code generation, needs more output tokens
 * - Phase 4 (Backend): Code generation, needs more output tokens
 * - Phase 5 (CI/CD): Configuration-heavy, moderate tokens
 * - Phase 6 (Docs): Text generation, moderate tokens
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhaseTokenAllocation {
  phase: number;
  phaseName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  priority: "high" | "medium" | "low";
}

export interface PhaseBudgetConfig {
  /** Total available context window (typically 200k for Claude) */
  totalContext: number;
  /** Reserve tokens for system overhead */
  systemReserve?: number;
  /** Multiplier for safety margin */
  safetyMargin?: number;
}

export interface PhaseAllocations {
  allocations: PhaseTokenAllocation[];
  totalInput: number;
  totalOutput: number;
  unallocated: number;
}

// ---------------------------------------------------------------------------
// Default Token Budgets per Phase
// ---------------------------------------------------------------------------

/**
 * Default token allocations based on phase requirements.
 * These can be overridden per-project based on complexity.
 */
export const DEFAULT_PHASE_ALLOCATIONS: Record<number, { input: number; output: number; priority: "high" | "medium" | "low" }> = {
  1: { input: 40000, output: 8000, priority: "high" },   // Planning - research-heavy
  2: { input: 30000, output: 6000, priority: "medium" }, // Wireframes - design data
  3: { input: 35000, output: 12000, priority: "high" },  // Frontend - code generation
  4: { input: 35000, output: 12000, priority: "high" },  // Backend - code generation
  5: { input: 20000, output: 4000, priority: "medium" }, // CI/CD - config files
  6: { input: 25000, output: 6000, priority: "low" },    // Docs - text generation
};

const PHASE_NAMES: Record<number, string> = {
  1: "Planning",
  2: "Wireframes",
  3: "Frontend",
  4: "Backend",
  5: "CI/CD",
  6: "Documentation",
};

// ---------------------------------------------------------------------------
// Token Allocation Calculator
// ---------------------------------------------------------------------------

/**
 * Calculate token allocations for all phases based on total context budget.
 */
export function calculatePhaseAllocations(config: PhaseBudgetConfig): PhaseAllocations {
  const {
    totalContext,
    systemReserve = 10000,
    safetyMargin = 0.9,
  } = config;

  // Available tokens after system reserve
  const availableTokens = Math.floor((totalContext - systemReserve) * safetyMargin);

  // Calculate total required tokens from defaults
  let totalRequired = 0;
  const defaultAllocations: PhaseTokenAllocation[] = [];

  for (const [phaseStr, defaults] of Object.entries(DEFAULT_PHASE_ALLOCATIONS)) {
    const phase = parseInt(phaseStr, 10);
    const inputTokens = defaults.input;
    const outputTokens = defaults.output;

    totalRequired += inputTokens + outputTokens;

    defaultAllocations.push({
      phase,
      phaseName: PHASE_NAMES[phase],
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      priority: defaults.priority,
    });
  }

  // Scale allocations if we don't have enough tokens
  const scaleFactor = availableTokens / totalRequired;
  const allocations: PhaseTokenAllocation[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  for (const alloc of defaultAllocations) {
    const scaledInput = Math.floor(alloc.inputTokens * scaleFactor);
    const scaledOutput = Math.floor(alloc.outputTokens * scaleFactor);

    allocations.push({
      ...alloc,
      inputTokens: scaledInput,
      outputTokens: scaledOutput,
      totalTokens: scaledInput + scaledOutput,
    });

    totalInput += scaledInput;
    totalOutput += scaledOutput;
  }

  return {
    allocations,
    totalInput,
    totalOutput,
    unallocated: totalContext - totalInput - totalOutput - systemReserve,
  };
}

/**
 * Get token allocation for a specific phase.
 */
export function getPhaseAllocation(phase: number, config?: PhaseBudgetConfig): PhaseTokenAllocation | null {
  if (phase < 1 || phase > 6) {
    logger.warn(`[phase-tokens] Invalid phase: ${phase}`);
    return null;
  }

  const allocations = calculatePhaseAllocations(config ?? { totalContext: 200000 });
  return allocations.allocations.find((a) => a.phase === phase) ?? null;
}

/**
 * Get input/output limits for a specific phase.
 */
export function getPhaseTokenLimits(
  phase: number,
  config?: PhaseBudgetConfig
): { input: number; output: number } | null {
  const allocation = getPhaseAllocation(phase, config);
  if (!allocation) return null;

  return {
    input: allocation.inputTokens,
    output: allocation.outputTokens,
  };
}

// ---------------------------------------------------------------------------
// Phase Budget Tracker
// ---------------------------------------------------------------------------

/**
 * Tracks token usage per phase during execution.
 */
export class PhaseBudgetTracker {
  private phaseUsage: Map<number, { input: number; output: number }> = new Map();
  private allocations: PhaseTokenAllocation[];

  constructor(config?: PhaseBudgetConfig) {
    const result = calculatePhaseAllocations(config ?? { totalContext: 200000 });
    this.allocations = result.allocations;
  }

  /**
   * Record token usage for a phase.
   */
  recordUsage(phase: number, inputUsed: number, outputUsed: number): void {
    const current = this.phaseUsage.get(phase) ?? { input: 0, output: 0 };
    this.phaseUsage.set(phase, {
      input: current.input + inputUsed,
      output: current.output + outputUsed,
    });
  }

  /**
   * Get remaining tokens for a phase.
   */
  getRemaining(phase: number): { input: number; output: number } | null {
    const allocation = this.allocations.find((a) => a.phase === phase);
    if (!allocation) return null;

    const usage = this.phaseUsage.get(phase) ?? { input: 0, output: 0 };
    return {
      input: Math.max(0, allocation.inputTokens - usage.input),
      output: Math.max(0, allocation.outputTokens - usage.output),
    };
  }

  /**
   * Check if a phase is within budget.
   */
  isWithinBudget(phase: number): boolean {
    const remaining = this.getRemaining(phase);
    if (!remaining) return false;
    return remaining.input > 0 && remaining.output > 0;
  }

  /**
   * Get budget status for all phases.
   */
  getStatus(): Array<{
    phase: number;
    phaseName: string;
    inputUsed: number;
    inputTotal: number;
    outputUsed: number;
    outputTotal: number;
    percentUsed: number;
  }> {
    return this.allocations.map((alloc) => {
      const usage = this.phaseUsage.get(alloc.phase) ?? { input: 0, output: 0 };
      const totalUsed = usage.input + usage.output;
      const totalAllocated = alloc.inputTokens + alloc.outputTokens;

      return {
        phase: alloc.phase,
        phaseName: alloc.phaseName,
        inputUsed: usage.input,
        inputTotal: alloc.inputTokens,
        outputUsed: usage.output,
        outputTotal: alloc.outputTokens,
        percentUsed: Math.round((totalUsed / totalAllocated) * 100),
      };
    });
  }

  /**
   * Get warning if any phase is running low on budget.
   */
  getWarnings(): string[] {
    const warnings: string[] = [];

    for (const alloc of this.allocations) {
      const remaining = this.getRemaining(alloc.phase);
      if (!remaining) continue;

      const totalRemaining = remaining.input + remaining.output;
      const totalAllocated = alloc.inputTokens + alloc.outputTokens;
      const percentRemaining = (totalRemaining / totalAllocated) * 100;

      if (percentRemaining < 20) {
        warnings.push(
          `Phase ${alloc.phase} (${alloc.phaseName}) is at ${percentRemaining.toFixed(0)}% remaining - consider compacting`
        );
      }
    }

    return warnings;
  }
}

// ---------------------------------------------------------------------------
// Convenience Exports
// ---------------------------------------------------------------------------

export const phaseTokenAllocator = {
  calculate: calculatePhaseAllocations,
  getPhaseAllocation,
  getPhaseTokenLimits,
  createTracker: (config?: PhaseBudgetConfig) => new PhaseBudgetTracker(config),
};