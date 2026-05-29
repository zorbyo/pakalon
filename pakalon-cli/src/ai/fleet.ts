/**
 * Fleet System - Parallel Agent Execution
 * 
 * Implements Copilot CLI's /fleet command for running multiple agents in parallel.
 * Supports:
 * - Parallel execution across multiple models
 * - Result aggregation and comparison
 * - User selection of best result
 * - Model comparison mode
 * 
 * This enables faster execution and model comparison.
 */

import { AgentRuntime, type AgentConfig, type AgentResult } from './agent-runtime';
import { ToolRegistry } from './tool-registry';
import logger from '@/utils/logger';

/**
 * Fleet execution configuration
 */
export interface FleetConfig {
  /** Models to run in parallel */
  models: string[];
  
  /** Task/prompt to execute */
  task: string;
  
  /** Base agent configuration */
  agentConfig?: Partial<AgentConfig>;
  
  /** Max concurrent agents (default: unlimited) */
  maxConcurrency?: number;
  
  /** Timeout for each agent (ms, default: 300000 = 5min) */
  timeout?: number;
}

/**
 * Fleet execution result
 */
export interface FleetResult {
  /** Results from each agent */
  results: FleetAgentResult[];
  
  /** Total execution time */
  totalDuration: number;
  
  /** Number of agents that succeeded */
  successCount: number;
  
  /** Number of agents that failed */
  failureCount: number;
}

/**
 * Individual agent result in fleet
 */
export interface FleetAgentResult {
  /** Model used */
  model: string;
  
  /** Agent result */
  result?: AgentResult;
  
  /** Error if failed */
  error?: string;
  
  /** Execution time */
  duration: number;
  
  /** Status */
  status: 'success' | 'failed' | 'timeout';
}

/**
 * Fleet Orchestrator
 * 
 * Manages parallel agent execution.
 */
export class FleetOrchestrator {
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry?: ToolRegistry) {
    this.toolRegistry = toolRegistry || new ToolRegistry();
  }

  /**
   * Run fleet of agents in parallel
   */
  async run(config: FleetConfig): Promise<FleetResult> {
    const startTime = Date.now();

    logger.info(`Fleet starting with ${config.models.length} models...`);
    logger.info(`Models: ${config.models.join(', ')}`);

    const results: FleetAgentResult[] = [];

    // Run agents with concurrency control
    const maxConcurrency = config.maxConcurrency || config.models.length;
    const chunks = this.chunkArray(config.models, maxConcurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map((model) => this.runSingleAgent(model, config))
      );
      results.push(...chunkResults);
    }

    const totalDuration = Date.now() - startTime;
    const successCount = results.filter((r) => r.status === 'success').length;
    const failureCount = results.filter((r) => r.status !== 'success').length;

    logger.info(
      `Fleet completed: ${successCount} succeeded, ${failureCount} failed (${totalDuration}ms)`
    );

    return {
      results,
      totalDuration,
      successCount,
      failureCount,
    };
  }

  /**
   * Run a single agent with timeout
   */
  private async runSingleAgent(
    model: string,
    config: FleetConfig
  ): Promise<FleetAgentResult> {
    const startTime = Date.now();

    logger.info(`Fleet agent starting: ${model}`);

    try {
      // Create agent with autonomous mode (no user prompts)
      const agent = new AgentRuntime(
        {
          model,
          mode: 'autonomous',
          allowAll: true, // Fleet runs without permission prompts
          maxTokens: config.agentConfig?.maxTokens || 128000,
          maxSteps: config.agentConfig?.maxSteps || 50,
          systemPrompt: config.agentConfig?.systemPrompt,
        },
        this.toolRegistry
      );

      // Run with timeout
      const timeout = config.timeout || 300000; // 5 min default
      const result = await this.runWithTimeout(
        agent.run(config.task),
        timeout
      );

      const duration = Date.now() - startTime;

      logger.info(
        `Fleet agent completed: ${model} (${duration}ms, ${result.toolCallsExecuted} tools)`
      );

      return {
        model,
        result,
        duration,
        status: 'success',
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const isTimeout = error instanceof Error && error.message.includes('timeout');

      logger.error(`Fleet agent failed: ${model} - ${error}`);

      return {
        model,
        error: error instanceof Error ? error.message : String(error),
        duration,
        status: isTimeout ? 'timeout' : 'failed',
      };
    }
  }

  /**
   * Run promise with timeout
   */
  private async runWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Agent timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * Chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Compare results and rank by quality
   */
  rankResults(results: FleetAgentResult[]): FleetAgentResult[] {
    return results
      .filter((r) => r.status === 'success' && r.result)
      .sort((a, b) => {
        // Rank by: fewer tool calls = more efficient
        const aTools = a.result?.toolCallsExecuted || 0;
        const bTools = b.result?.toolCallsExecuted || 0;
        
        if (aTools !== bTools) {
          return aTools - bTools;
        }
        
        // If same tool calls, rank by speed
        return a.duration - b.duration;
      });
  }

  /**
   * Get best result from fleet
   */
  getBestResult(results: FleetAgentResult[]): FleetAgentResult | null {
    const ranked = this.rankResults(results);
    return ranked[0] || null;
  }

  /**
   * Format fleet results for display
   */
  formatResults(fleetResult: FleetResult): string {
    const lines: string[] = [];

    lines.push('═══════════════════════════════════════════');
    lines.push('          Fleet Execution Results          ');
    lines.push('═══════════════════════════════════════════');
    lines.push('');
    lines.push(`Total Duration: ${fleetResult.totalDuration}ms`);
    lines.push(`Success: ${fleetResult.successCount} / ${fleetResult.results.length}`);
    lines.push('');

    // Sort by status (success first)
    const sorted = [...fleetResult.results].sort((a, b) => {
      if (a.status === 'success' && b.status !== 'success') return -1;
      if (a.status !== 'success' && b.status === 'success') return 1;
      return a.duration - b.duration;
    });

    sorted.forEach((result, i) => {
      lines.push(`─────────────────────────────────────────`);
      lines.push(`Agent ${i + 1}: ${result.model}`);
      lines.push(`Status: ${result.status}`);
      lines.push(`Duration: ${result.duration}ms`);

      if (result.status === 'success' && result.result) {
        lines.push(`Tools Used: ${result.result.toolCallsExecuted}`);
        lines.push(`Tokens: ${result.result.tokensUsed}`);
        lines.push('');
        lines.push('Response (preview):');
        const preview = result.result.finalResponse.slice(0, 200);
        lines.push(`  ${preview}${result.result.finalResponse.length > 200 ? '...' : ''}`);
      } else if (result.error) {
        lines.push(`Error: ${result.error}`);
      }
    });

    lines.push('═══════════════════════════════════════════');

    return lines.join('\n');
  }
}

/**
 * Quick fleet execution helper
 */
export async function runFleet(
  task: string,
  models?: string[]
): Promise<FleetResult> {
  const defaultModels = [
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o',
    'google/gemini-pro-1.5',
  ];

  const orchestrator = new FleetOrchestrator();
  
  return orchestrator.run({
    task,
    models: models || defaultModels,
  });
}

/**
 * Fleet execution with model comparison
 */
export async function compareModels(
  task: string,
  models: string[]
): Promise<{
  fleetResult: FleetResult;
  ranked: FleetAgentResult[];
  best: FleetAgentResult | null;
  comparison: string;
}> {
  const orchestrator = new FleetOrchestrator();
  const fleetResult = await orchestrator.run({ task, models });
  const ranked = orchestrator.rankResults(fleetResult.results);
  const best = orchestrator.getBestResult(fleetResult.results);

  const comparison = orchestrator.formatResults(fleetResult);

  return {
    fleetResult,
    ranked,
    best,
    comparison,
  };
}
