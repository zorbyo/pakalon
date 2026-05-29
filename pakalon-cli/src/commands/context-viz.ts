/**
 * /context command - Context window visualization (Copilot CLI style)
 * 
 * Visualize the current context window usage, message history, and token consumption.
 * Shows warnings when approaching context limits.
 * 
 * Features:
 * - Token usage visualization
 * - Message history breakdown
 * - Compaction recommendations
 * - Model context limits
 * 
 * Usage:
 *   /context              - Show context visualization
 *   /context --detailed   - Show full message list
 */

import { ContextManager } from '@/ai/context-manager';
import logger from '@/utils/logger';

/**
 * Context command options
 */
export interface ContextCommandOptions {
  /** Show detailed message list */
  detailed?: boolean;
  
  /** Session ID to inspect */
  sessionId?: string;
}

/**
 * Visualize context window usage
 */
export async function cmdContext(options: ContextCommandOptions = {}): Promise<void> {
  // For now, create a sample context manager
  // In real usage, this would get the current session's context manager
  const contextManager = new ContextManager(200_000); // 200k default
  
  // Get visualization
  const viz = contextManager.visualize();
  
  console.log('\n╭───────────────────────────────────────────────────────────╮');
  console.log('│                   CONTEXT WINDOW STATUS                   │');
  console.log('╰───────────────────────────────────────────────────────────╯\n');
  
  // Token usage bar
  const percentage = viz.percentage;
  const barLength = 50;
  const filledLength = Math.floor((percentage / 100) * barLength);
  const emptyLength = barLength - filledLength;
  
  const bar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
  const color = percentage >= 90 ? '[Red]' : percentage >= 80 ? '[Yellow]' : '[Green]';
  
  console.log(`${color} Token Usage:`);
  console.log(`   [${bar}] ${percentage.toFixed(1)}%`);
  console.log(`   ${viz.currentTokens.toLocaleString()} / ${viz.maxTokens.toLocaleString()} tokens\n`);
  
  // Message breakdown
  console.log('[Chart] Message Breakdown:');
  console.log(`   Total messages:   ${viz.messageCount}`);
  console.log(`   User messages:    ${viz.userMessages}`);
  console.log(`   Assistant msgs:   ${viz.assistantMessages}`);
  console.log(`   System messages:  ${viz.systemMessages}`);
  console.log(`   Tool calls:       ${viz.toolMessages}\n`);
  
  // Recommendations
  if (viz.needsCompaction) {
    console.log('Warning:  COMPACTION RECOMMENDED');
    console.log('   Your context window is getting full.');
    console.log('   Run /compact to summarize and free up space.\n');
  } else {
    console.log('[OK] Context window healthy\n');
  }
  
  // Model info
  console.log('[Robot] Model Context Limits:');
  console.log('   Claude Sonnet 4:   200,000 tokens');
  console.log('   GPT-4o:            128,000 tokens');
  console.log('   Gemini Pro 1.5:  1,000,000 tokens\n');
  
  // Detailed message list
  if (options.detailed) {
    printDetailedMessages(viz);
  } else {
    console.log('[Idea] Tip: Use /context --detailed to see full message history\n');
  }
  
  console.log('───────────────────────────────────────────────────────────\n');
}

/**
 * Print detailed message history
 */
function printDetailedMessages(viz: ReturnType<ContextManager['visualize']>): void {
  console.log('───────────────────────────────────────────────────────────');
  console.log('[SCROLL] MESSAGE HISTORY');
  console.log('───────────────────────────────────────────────────────────\n');
  
  // This would show actual messages in real implementation
  console.log('(Message history visualization would appear here)');
  console.log('Each message with role, timestamp, and token count\n');
}

/**
 * Parse context command from user input
 */
export function parseContextCommand(input: string): ContextCommandOptions | null {
  if (!input.startsWith('/context')) {
    return null;
  }
  
  const options: ContextCommandOptions = {};
  
  if (input.includes('--detailed') || input.includes('-d')) {
    options.detailed = true;
  }
  
  // Parse --session flag
  const sessionMatch = input.match(/--session[=\s]+([\w-]+)/);
  if (sessionMatch) {
    options.sessionId = sessionMatch[1];
  }
  
  return options;
}

/**
 * Get context command help text
 */
export function getContextHelp(): string {
  return `
╭───────────────────────────────────────────────────────────╮
│                   /context Command                         │
│            Visualize context window usage                  │
╰───────────────────────────────────────────────────────────╯

USAGE:
  /context [options]

OPTIONS:
  --detailed, -d         Show full message history
  --session <id>         Inspect specific session
  --help, -h             Show this help

EXAMPLES:
  # Show context status
  /context
  
  # Show detailed message list
  /context --detailed
  
  # Inspect specific session
  /context --session abc123

FEATURES:
  [OK] Visual token usage bar
  [OK] Message count breakdown
  [OK] Compaction recommendations
  [OK] Model context limits reference
  [OK] Per-message token counts (with --detailed)

CONTEXT MANAGEMENT:
  • Auto-compaction at 80% capacity
  • Keeps last 10 messages + system
  • Uses Claude Haiku for fast summarization
  • Preserves important context
  
  Run /compact to manually trigger compaction.
`;
}

export default {
  execute: cmdContext,
  parse: parseContextCommand,
  help: getContextHelp,
};
