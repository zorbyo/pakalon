/**
 * /compact command - Manual context compaction (Copilot CLI style)
 * 
 * Manually trigger context window compaction to summarize old messages
 * and free up space. Uses LLM to intelligently summarize conversation history
 * while preserving important information.
 * 
 * Features:
 * - LLM-based summarization
 * - Preserves recent messages
 * - Shows before/after stats
 * - Configurable retention
 * 
 * Usage:
 *   /compact              - Compact with defaults
 *   /compact --keep 15    - Keep last 15 messages
 *   /compact --force      - Force even if not needed
 */

import { ContextManager } from '@/ai/context-manager';
import logger from '@/utils/logger';

/**
 * Compact command options
 */
export interface CompactCommandOptions {
  /** Number of recent messages to keep (default: 10) */
  keepMessages?: number;
  
  /** Force compaction even if not needed */
  force?: boolean;
  
  /** Show detailed statistics */
  verbose?: boolean;
  
  /** Dry run - show what would be compacted */
  dryRun?: boolean;
}

/**
 * Manually compact context window
 */
export async function cmdCompact(
  contextManager: ContextManager,
  options: CompactCommandOptions = {}
): Promise<void> {
  console.log('\n╭───────────────────────────────────────────────────────────╮');
  console.log('│                 CONTEXT COMPACTION                         │');
  console.log('╰───────────────────────────────────────────────────────────╯\n');
  
  // Get current stats
  const beforeViz = contextManager.visualize();
  
  console.log('[Chart] Current Status:');
  console.log(`   Messages:  ${beforeViz.messageCount}`);
  console.log(`   Tokens:    ${beforeViz.currentTokens.toLocaleString()} (${beforeViz.percentage.toFixed(1)}%)`);
  console.log(`   Capacity:  ${beforeViz.maxTokens.toLocaleString()}\n`);
  
  // Check if compaction needed
  if (!beforeViz.needsCompaction && !options.force) {
    console.log('[OK] Compaction not needed (usage below 80%)');
    console.log('   Use --force to compact anyway.\n');
    return;
  }
  
  // Dry run
  if (options.dryRun) {
    const keepCount = options.keepMessages ?? 10;
    const toCompact = beforeViz.messageCount - keepCount;
    
    console.log('[Search] DRY RUN - Would compact:');
    console.log(`   Keep last:      ${keepCount} messages`);
    console.log(`   Summarize:      ${toCompact} older messages`);
    console.log(`   Estimated save: ~${Math.floor(toCompact * (beforeViz.currentTokens / beforeViz.messageCount))} tokens\n`);
    
    console.log('[Idea] Run without --dry-run to perform compaction\n');
    return;
  }
  
  // Perform compaction
  console.log('[Refresh] Compacting...');
  
  const startTime = Date.now();
  
  try {
    await contextManager.compact(options.keepMessages);
    
    const duration = Date.now() - startTime;
    const afterViz = contextManager.visualize();
    
    // Calculate savings
    const tokensSaved = beforeViz.currentTokens - afterViz.currentTokens;
    const messagesSaved = beforeViz.messageCount - afterViz.messageCount;
    const percentageSaved = ((tokensSaved / beforeViz.currentTokens) * 100).toFixed(1);
    
    console.log(`[OK] Compacted in ${(duration / 1000).toFixed(1)}s\n`);
    
    console.log('[Chart] Results:');
    console.log(`   Before:        ${beforeViz.messageCount} messages, ${beforeViz.currentTokens.toLocaleString()} tokens`);
    console.log(`   After:         ${afterViz.messageCount} messages, ${afterViz.currentTokens.toLocaleString()} tokens`);
    console.log(`   Saved:         ${messagesSaved} messages, ${tokensSaved.toLocaleString()} tokens (${percentageSaved}%)\n`);
    
    console.log('* Context window has been compacted!');
    console.log('   Old messages were summarized and important context preserved.\n');
    
    if (options.verbose) {
      printDetailedStats(beforeViz, afterViz);
    }
    
  } catch (error) {
    logger.error('[X] Compaction failed:', error);
    console.log('\nWarning:  Compaction failed. Your context remains unchanged.\n');
    
    if (error instanceof Error) {
      console.log(`Error: ${error.message}\n`);
    }
  }
}

/**
 * Print detailed statistics
 */
function printDetailedStats(
  before: ReturnType<ContextManager['visualize']>,
  after: ReturnType<ContextManager['visualize']>
): void {
  console.log('───────────────────────────────────────────────────────────');
  console.log('[ChartUp] DETAILED STATISTICS');
  console.log('───────────────────────────────────────────────────────────\n');
  
  console.log('Message Breakdown:');
  console.log('                Before    After    Saved');
  console.log(`   User:        ${before.userMessages}         ${after.userMessages}        ${before.userMessages - after.userMessages}`);
  console.log(`   Assistant:   ${before.assistantMessages}         ${after.assistantMessages}        ${before.assistantMessages - after.assistantMessages}`);
  console.log(`   Tool:        ${before.toolMessages}         ${after.toolMessages}        ${before.toolMessages - after.toolMessages}`);
  console.log(`   System:      ${before.systemMessages}         ${after.systemMessages}        ${before.systemMessages - after.systemMessages}\n`);
  
  console.log('Token Usage:');
  console.log(`   Percentage:  ${before.percentage.toFixed(1)}%     ${after.percentage.toFixed(1)}%`);
  console.log(`   Available:   ${(before.maxTokens - before.currentTokens).toLocaleString()} → ${(after.maxTokens - after.currentTokens).toLocaleString()}\n`);
}

/**
 * Parse compact command from user input
 */
export function parseCompactCommand(input: string): CompactCommandOptions | null {
  if (!input.startsWith('/compact')) {
    return null;
  }
  
  const options: CompactCommandOptions = {};
  
  // Parse --keep flag
  const keepMatch = input.match(/--keep[=\s]+(\d+)/);
  if (keepMatch) {
    options.keepMessages = parseInt(keepMatch[1], 10);
  }
  
  // Parse flags
  if (input.includes('--force') || input.includes('-f')) {
    options.force = true;
  }
  
  if (input.includes('--verbose') || input.includes('-v')) {
    options.verbose = true;
  }
  
  if (input.includes('--dry-run')) {
    options.dryRun = true;
  }
  
  return options;
}

/**
 * Get compact command help text
 */
export function getCompactHelp(): string {
  return `
╭───────────────────────────────────────────────────────────╮
│                   /compact Command                         │
│         Manually compact context window                    │
╰───────────────────────────────────────────────────────────╯

USAGE:
  /compact [options]

OPTIONS:
  --keep <n>             Keep last N messages (default: 10)
  --force, -f            Force even if not needed
  --verbose, -v          Show detailed statistics
  --dry-run              Preview without compacting
  --help, -h             Show this help

EXAMPLES:
  # Compact with defaults
  /compact
  
  # Keep last 15 messages
  /compact --keep 15
  
  # Force compaction
  /compact --force
  
  # Preview what would be compacted
  /compact --dry-run
  
  # Verbose output
  /compact --verbose

HOW IT WORKS:
  1. Identifies old messages to summarize
  2. Uses Claude Haiku for fast summarization
  3. Replaces old messages with summary
  4. Preserves recent messages and system prompts
  5. Frees up context window space

WHEN TO USE:
  • Context usage above 80%
  • Before long conversations
  • When you see "context full" warnings
  • To speed up inference (fewer tokens)

AUTO-COMPACTION:
  Pakalon automatically compacts at 80% capacity.
  Use this command to compact earlier or with custom settings.
`;
}

export default {
  execute: cmdCompact,
  parse: parseCompactCommand,
  help: getCompactHelp,
};
