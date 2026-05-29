/**
 * /fleet command - Parallel multi-agent execution (Copilot CLI style)
 * 
 * Run the same task across multiple models in parallel and compare results.
 * Similar to GitHub Copilot CLI's /fleet feature.
 * 
 * Features:
 * - Parallel execution across multiple models
 * - Result comparison and ranking
 * - Interactive result selection
 * - Efficiency scoring (fewer tools = better)
 * 
 * Usage:
 *   /fleet "task description" --models claude,gpt4,gemini
 *   /fleet "write a binary search" --models claude-sonnet,gpt-4o
 */

import { FleetOrchestrator, type FleetConfig } from '@/ai/fleet';
import { ToolRegistry } from '@/ai/tool-registry';
import logger from '@/utils/logger';

/**
 * Default models for fleet execution
 * Matches Copilot CLI's default model set
 */
const DEFAULT_MODELS = [
  'anthropic/claude-3-5-sonnet',
  'openai/gpt-4o',
  'google/gemini-pro-1.5',
];

/**
 * Fleet command options
 */
export interface FleetCommandOptions {
  /** Task to execute */
  task: string;
  
  /** Models to use (comma-separated or array) */
  models?: string | string[];
  
  /** Max concurrent agents */
  maxConcurrency?: number;
  
  /** Timeout per agent (seconds) */
  timeout?: number;
  
  /** System prompt override */
  systemPrompt?: string;
  
  /** Show detailed comparison */
  verbose?: boolean;
}

/**
 * Execute a task across multiple models in parallel
 */
export async function cmdFleet(options: FleetCommandOptions): Promise<void> {
  const startTime = Date.now();
  
  logger.info('[Rocket] Fleet Execution Started');
  logger.info(`Task: ${options.task}`);
  
  // Parse models
  let models: string[];
  if (!options.models) {
    models = DEFAULT_MODELS;
    logger.info(`Using default models: ${models.join(', ')}`);
  } else if (typeof options.models === 'string') {
    models = options.models.split(',').map(m => m.trim());
    logger.info(`Using specified models: ${models.join(', ')}`);
  } else {
    models = options.models;
  }
  
  // Validate models
  if (models.length === 0) {
    logger.error('[X] No models specified');
    return;
  }
  
  if (models.length === 1) {
    logger.warn('Warning:  Only one model specified - fleet is most useful with 2+ models');
  }
  
  // Build fleet config
  const config: FleetConfig = {
    models,
    task: options.task,
    maxConcurrency: options.maxConcurrency,
    timeout: options.timeout ? options.timeout * 1000 : undefined,
    agentConfig: options.systemPrompt 
      ? { systemPrompt: options.systemPrompt }
      : undefined,
  };
  
  // Create orchestrator
  const toolRegistry = ToolRegistry.getInstance();
  const orchestrator = new FleetOrchestrator(toolRegistry);
  
  // Run fleet
  logger.info(`\n[Refresh] Running ${models.length} agents in parallel...\n`);
  
  try {
    const result = await orchestrator.run(config);
    
    // Print results
    printFleetResults(result, options.verbose ?? false);
    
    const duration = Date.now() - startTime;
    logger.info(`\n[OK] Fleet execution completed in ${(duration / 1000).toFixed(1)}s`);
    
  } catch (error) {
    logger.error('[X] Fleet execution failed:', error);
    throw error;
  }
}

/**
 * Print fleet results in a nice format
 */
function printFleetResults(
  result: import('@/ai/fleet').FleetResult,
  verbose: boolean
): void {
  const { results, successCount, failureCount } = result;
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    FLEET RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log(`[OK] Success: ${successCount} / ${results.length}`);
  console.log(`[X] Failed:  ${failureCount} / ${results.length}`);
  console.log(`  Duration: ${(result.totalDuration / 1000).toFixed(1)}s\n`);
  
  // Sort by rank (lower is better)
  const sorted = [...results].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  
  // Print each result
  sorted.forEach((agentResult, index) => {
    const status = agentResult.success ? '[OK]' : '[X]';
    const rankEmoji = index === 0 ? '[FIRSTPLACEMEDAL]' : index === 1 ? '[SECONDPLACEMEDAL]' : index === 2 ? '[THIRDPLACEMEDAL]' : '  ';
    
    console.log(`${rankEmoji} ${status} ${agentResult.model}`);
    console.log(`   Duration: ${(agentResult.duration / 1000).toFixed(1)}s`);
    console.log(`   Tools used: ${agentResult.toolCallCount}`);
    console.log(`   Rank: ${agentResult.rank ?? 'N/A'}`);
    
    if (agentResult.error) {
      console.log(`   Error: ${agentResult.error}`);
    }
    
    if (verbose && agentResult.result) {
      console.log(`\n   Response:`);
      const lines = agentResult.result.finalMessage.split('\n');
      lines.slice(0, 5).forEach(line => {
        console.log(`   ${line}`);
      });
      if (lines.length > 5) {
        console.log(`   ... (${lines.length - 5} more lines)`);
      }
    }
    
    console.log('');
  });
  
  // Show best result
  const best = sorted.find(r => r.success);
  if (best) {
    console.log('───────────────────────────────────────────────────────────');
    console.log('[Trophy] BEST RESULT (Most Efficient)');
    console.log('───────────────────────────────────────────────────────────\n');
    console.log(`Model: ${best.model}`);
    console.log(`Tools: ${best.toolCallCount}`);
    console.log(`Time:  ${(best.duration / 1000).toFixed(1)}s\n`);
    
    if (best.result) {
      console.log('Response:');
      console.log(best.result.finalMessage);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

/**
 * Parse fleet command from user input
 * 
 * Examples:
 *   /fleet "write a binary search"
 *   /fleet "fix the bug" --models claude,gpt4
 *   /fleet "refactor this" --verbose
 */
export function parseFleetCommand(input: string): FleetCommandOptions | null {
  // Match: /fleet "task" [--flags]
  const match = input.match(/^\/fleet\s+["'](.+?)["']\s*(.*)?$/);
  if (!match) {
    return null;
  }
  
  const task = match[1];
  const flags = match[2] || '';
  
  const options: FleetCommandOptions = { task };
  
  // Parse --models flag
  const modelsMatch = flags.match(/--models[=\s]+([\w,\-\/]+)/);
  if (modelsMatch) {
    options.models = modelsMatch[1];
  }
  
  // Parse --timeout flag
  const timeoutMatch = flags.match(/--timeout[=\s]+(\d+)/);
  if (timeoutMatch) {
    options.timeout = parseInt(timeoutMatch[1], 10);
  }
  
  // Parse --concurrency flag
  const concurrencyMatch = flags.match(/--concurrency[=\s]+(\d+)/);
  if (concurrencyMatch) {
    options.maxConcurrency = parseInt(concurrencyMatch[1], 10);
  }
  
  // Parse --verbose flag
  if (flags.includes('--verbose') || flags.includes('-v')) {
    options.verbose = true;
  }
  
  return options;
}

/**
 * Get fleet command help text
 */
export function getFleetHelp(): string {
  return `
╭───────────────────────────────────────────────────────────╮
│                    /fleet Command                          │
│         Run tasks across multiple models in parallel       │
╰───────────────────────────────────────────────────────────╯

USAGE:
  /fleet "task description" [options]

OPTIONS:
  --models <models>      Comma-separated model list
                         Example: --models claude,gpt4,gemini
                         Default: claude-sonnet, gpt-4o, gemini-pro
  
  --timeout <seconds>    Timeout per agent (default: 300s)
  --concurrency <n>      Max concurrent agents (default: unlimited)
  --verbose, -v          Show detailed output
  --help, -h             Show this help

EXAMPLES:
  # Run with default models
  /fleet "write a binary search in TypeScript"
  
  # Compare specific models
  /fleet "fix the auth bug" --models claude-sonnet,gpt-4o
  
  # Verbose output
  /fleet "optimize this function" --verbose
  
  # Custom timeout
  /fleet "complex task" --timeout 600

FEATURES:
  [OK] Parallel execution across multiple models
  [OK] Automatic result ranking by efficiency
  [OK] Best result selection
  [OK] Performance comparison
  [OK] Timeout protection

RANKING SYSTEM:
  Agents are ranked by efficiency:
  1. Fewer tool calls = better
  2. Faster execution = better
  3. Success vs failure

The agent with the lowest tool count wins!
`;
}

export default {
  execute: cmdFleet,
  parse: parseFleetCommand,
  help: getFleetHelp,
};
