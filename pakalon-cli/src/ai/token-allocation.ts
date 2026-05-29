/**
 * User-Defined Token Percentage UI - HIL Context Allocation
 * 
 * Allows users to set custom token percentages for context allocation
 * in Human-in-the-Loop mode. New projects default to 65%, existing
 * projects to 35%.
 */

import { tool } from "ai";
import { z } from "zod";
import { useStore } from "@/store/index.js";

export interface TokenAllocationConfig {
  percentage: number;
  mode: "new_project" | "existing_project" | "custom";
  autoCalculate: boolean;
}

export interface TokenAllocationResult {
  success: boolean;
  allocated: {
    phase1: number;
    phase2: number;
    phase3: number;
    phase4: number;
    phase5: number;
    phase6: number;
  };
  totalTokens: number;
  error?: string;
}

const DEFAULT_NEW_PROJECT_PERCENTAGE = 65;
const DEFAULT_EXISTING_PROJECT_PERCENTAGE = 35;
const MIN_PERCENTAGE = 10;
const MAX_PERCENTAGE = 95;
const BUFFER_PERCENTAGE = 10;

export class TokenAllocationManager {
  private config: TokenAllocationConfig;
  private totalContextTokens: number;

  constructor(config: TokenAllocationConfig, totalContextTokens: number) {
    this.config = config;
    this.totalContextTokens = totalContextTokens;
  }

  calculateAllocation(): TokenAllocationResult {
    const usablePercentage = Math.min(
      MAX_PERCENTAGE,
      Math.max(MIN_PERCENTAGE, this.config.percentage)
    );

    const usableTokens = Math.floor(
      (usablePercentage / 100) * this.totalContextTokens
    );

    const bufferTokens = Math.floor(usableTokens * (BUFFER_PERCENTAGE / 100));
    const allocatableTokens = usableTokens - bufferTokens;

    const phases = this.calculatePhaseDistribution(allocatableTokens);

    return {
      success: true,
      allocated: phases,
      totalTokens: usableTokens,
    };
  }

  private calculatePhaseDistribution(totalTokens: number): TokenAllocationResult["allocated"] {
    const PHASE_WEIGHTS = {
      phase1: 0.20,
      phase2: 0.12,
      phase3: 0.35,
      phase4: 0.15,
      phase5: 0.10,
      phase6: 0.08,
    };

    return {
      phase1: Math.floor(totalTokens * PHASE_WEIGHTS.phase1),
      phase2: Math.floor(totalTokens * PHASE_WEIGHTS.phase2),
      phase3: Math.floor(totalTokens * PHASE_WEIGHTS.phase3),
      phase4: Math.floor(totalTokens * PHASE_WEIGHTS.phase4),
      phase5: Math.floor(totalTokens * PHASE_WEIGHTS.phase5),
      phase6: Math.floor(totalTokens * PHASE_WEIGHTS.phase6),
    };
  }

  getConfig(): TokenAllocationConfig {
    return { ...this.config };
  }

  setPercentage(percentage: number): void {
    this.config.percentage = Math.min(
      MAX_PERCENTAGE,
      Math.max(MIN_PERCENTAGE, percentage)
    );
  }

  static getRecommendedPercentage(projectDir: string): {
    percentage: number;
    mode: "new_project" | "existing_project";
  } {
    return {
      percentage: DEFAULT_NEW_PROJECT_PERCENTAGE,
      mode: "new_project",
    };
  }
}

let globalTokenManager: TokenAllocationManager | null = null;

export function initializeTokenAllocation(
  percentage: number,
  mode: "new_project" | "existing_project" | "custom",
  totalContextTokens: number
): TokenAllocationManager {
  globalTokenManager = new TokenAllocationManager(
    { percentage, mode, autoCalculate: true },
    totalContextTokens
  );
  return globalTokenManager;
}

export function getTokenAllocationManager(): TokenAllocationManager | null {
  return globalTokenManager;
}

export function calculateTokenAllocation(
  percentage: number,
  totalContextTokens: number
): TokenAllocationResult {
  const tempManager = new TokenAllocationManager(
    {
      percentage,
      mode: "custom",
      autoCalculate: true,
    },
    totalContextTokens
  );

  return tempManager.calculateAllocation();
}

export function getPhaseTokenAllocation(): TokenAllocationResult["allocated"] | null {
  if (!globalTokenManager) {
    return null;
  }
  const result = globalTokenManager.calculateAllocation();
  return result.allocated;
}

export const tokenAllocationTool = tool({
  description: "Manage user-defined token allocation percentages for HIL mode",
  parameters: z.object({
    action: z.enum(["get", "set", "calculate", "reset"]).describe("Action to perform"),
    percentage: z.number().optional().describe("Token percentage to set (10-95)"),
    totalTokens: z.number().optional().describe("Total context tokens"),
  }),
});

export function showTokenAllocationPrompt(): {
  question: string;
  choices: Array<{ id: string; label: string }>;
} {
  return {
    question: "How much of the context window would you like to allocate for this project?",
    choices: [
      {
        id: "high",
        label: `High (${DEFAULT_NEW_PROJECT_PERCENTAGE}%) - For new projects`,
      },
      {
        id: "medium",
        label: `Medium (${DEFAULT_EXISTING_PROJECT_PERCENTAGE}%) - For existing projects`,
      },
      {
        id: "custom",
        label: "Custom percentage",
      },
    ],
  };
}