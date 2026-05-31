/**
 * Context Inspection - /context and /usage commands
 * 
 * /context prints a per-bucket breakdown of the live window: system prompt,
 * system tools, system context, skills, messages, the auto-compact buffer,
 * and remaining slack. Each bucket gets an ASCII bar and a token count.
 * 
 * /usage reports provider rate-limit headroom against the active credential.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextBucket {
  name: string;
  tokens: number;
  percentage: number;
  color: 'green' | 'yellow' | 'red' | 'gray';
}

export interface ContextReport {
  buckets: ContextBucket[];
  totalTokens: number;
  maxTokens: number;
  remaining: number;
  timestamp: string;
}

export interface UsageReport {
  provider: string;
  model: string;
  rateLimitRemaining: number;
  rateLimitReset: string;
  tokensUsed: number;
  tokensLimit: number;
  cost: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Token Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token count from text
 * Rough approximation: 1 token ≈ 4 characters for English text
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Simple approximation: 1 token per 4 characters
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Context Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze the current context window
 */
export function analyzeContext(options: {
  systemPrompt?: string;
  tools?: string;
  messages?: Array<{ role: string; content: string }>;
  skills?: string;
  maxTokens?: number;
}): ContextReport {
  const {
    systemPrompt = '',
    tools = '',
    messages = [],
    skills = '',
    maxTokens = 200000,
  } = options;

  // Calculate tokens for each bucket
  const systemTokens = estimateTokens(systemPrompt);
  const toolsTokens = estimateTokens(tools);
  const skillsTokens = estimateTokens(skills);
  
  // Messages tokens
  let messagesTokens = 0;
  for (const msg of messages) {
    messagesTokens += estimateTokens(msg.content);
  }
  
  // System context (calculated separately)
  const systemContextTokens = Math.floor(maxTokens * 0.05); // 5% for system context
  
  // Auto-compact buffer (10% of max)
  const compactBufferTokens = Math.floor(maxTokens * 0.10);
  
  // Remaining slack
  const totalUsed = systemTokens + toolsTokens + systemContextTokens + skillsTokens + messagesTokens + compactBufferTokens;
  const remaining = Math.max(0, maxTokens - totalUsed);

  // Build buckets
  const buckets: ContextBucket[] = [
    {
      name: 'System Prompt',
      tokens: systemTokens,
      percentage: (systemTokens / maxTokens) * 100,
      color: systemTokens > maxTokens * 0.3 ? 'red' : systemTokens > maxTokens * 0.2 ? 'yellow' : 'green',
    },
    {
      name: 'System Tools',
      tokens: toolsTokens,
      percentage: (toolsTokens / maxTokens) * 100,
      color: toolsTokens > maxTokens * 0.2 ? 'red' : toolsTokens > maxTokens * 0.1 ? 'yellow' : 'green',
    },
    {
      name: 'System Context',
      tokens: systemContextTokens,
      percentage: (systemContextTokens / maxTokens) * 100,
      color: 'gray',
    },
    {
      name: 'Skills',
      tokens: skillsTokens,
      percentage: (skillsTokens / maxTokens) * 100,
      color: skillsTokens > maxTokens * 0.1 ? 'red' : skillsTokens > maxTokens * 0.05 ? 'yellow' : 'green',
    },
    {
      name: 'Messages',
      tokens: messagesTokens,
      percentage: (messagesTokens / maxTokens) * 100,
      color: messagesTokens > maxTokens * 0.5 ? 'red' : messagesTokens > maxTokens * 0.3 ? 'yellow' : 'green',
    },
    {
      name: 'Auto-Compact Buffer',
      tokens: compactBufferTokens,
      percentage: (compactBufferTokens / maxTokens) * 100,
      color: 'gray',
    },
    {
      name: 'Remaining Slack',
      tokens: remaining,
      percentage: (remaining / maxTokens) * 100,
      color: remaining < maxTokens * 0.1 ? 'red' : remaining < maxTokens * 0.2 ? 'yellow' : 'green',
    },
  ];

  return {
    buckets,
    totalTokens: totalUsed,
    maxTokens,
    remaining,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format context report as ASCII with bars
 */
export function formatContextReport(report: ContextReport): string {
  const lines: string[] = [];
  
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║                    CONTEXT WINDOW BREAKDOWN                ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');
  
  // Header
  lines.push(`${'Bucket'.padEnd(25)} ${'Tokens'.padStart(10)} ${'%'.padStart(8)}  ${'Bar'.padEnd(40)}`);
  lines.push('─'.repeat(90));
  
  for (const bucket of report.buckets) {
    const barLength = 40;
    const filled = Math.round((bucket.percentage / 100) * barLength);
    const empty = barLength - filled;
    
    const colorChar = bucket.color === 'red' ? '█' : 
                      bucket.color === 'yellow' ? '▓' : 
                      bucket.color === 'green' ? '░' : '·';
    
    const bar = colorChar.repeat(filled) + '·'.repeat(empty);
    
    lines.push(
      `${bucket.name.padEnd(25)} ${bucket.tokens.toLocaleString().padStart(10)} ${(bucket.percentage.toFixed(1) + '%').padStart(8)}  [${bar}]`
    );
  }
  
  lines.push('─'.repeat(90));
  lines.push(
    `${'TOTAL'.padEnd(25)} ${report.totalTokens.toLocaleString().padStart(10)} ${((report.totalTokens / report.maxTokens) * 100).toFixed(1).padStart(7)}%`
  );
  lines.push(
    `${'REMAINING'.padEnd(25)} ${report.remaining.toLocaleString().padStart(10)} ${((report.remaining / report.maxTokens) * 100).toFixed(1).padStart(7)}%`
  );
  lines.push('');
  lines.push(`Max tokens: ${report.maxTokens.toLocaleString()}`);
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push('');
  
  // Warning if close to limit
  if (report.remaining < report.maxTokens * 0.1) {
    lines.push('⚠️  WARNING: Context window is critically low! Consider running /compact.');
  } else if (report.remaining < report.maxTokens * 0.2) {
    lines.push('⚡ NOTE: Context window is getting full. Auto-compact will trigger soon.');
  }
  
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Usage Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze provider usage and rate limits
 */
export function analyzeUsage(options: {
  provider?: string;
  model?: string;
  rateLimitRemaining?: number;
  rateLimitReset?: string;
  tokensUsed?: number;
  tokensLimit?: number;
  cost?: number;
}): UsageReport {
  return {
    provider: options.provider || 'unknown',
    model: options.model || 'unknown',
    rateLimitRemaining: options.rateLimitRemaining ?? -1,
    rateLimitReset: options.rateLimitReset || 'unknown',
    tokensUsed: options.tokensUsed ?? 0,
    tokensLimit: options.tokensLimit ?? 0,
    cost: options.cost ?? 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format usage report
 */
export function formatUsageReport(report: UsageReport): string {
  const lines: string[] = [];
  
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║                   PROVIDER USAGE REPORT                    ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');
  
  lines.push(`Provider: ${report.provider}`);
  lines.push(`Model: ${report.model}`);
  lines.push('');
  
  // Rate limit info
  if (report.rateLimitRemaining >= 0) {
    lines.push(`Rate Limit Remaining: ${report.rateLimitRemaining.toLocaleString()}`);
    lines.push(`Rate Limit Resets: ${report.rateLimitReset}`);
  } else {
    lines.push('Rate Limit: Not available');
  }
  lines.push('');
  
  // Token usage
  if (report.tokensLimit > 0) {
    const usedPercent = (report.tokensUsed / report.tokensLimit) * 100;
    lines.push(`Tokens Used: ${report.tokensUsed.toLocaleString()} / ${report.tokensLimit.toLocaleString()} (${usedPercent.toFixed(1)}%)`);
    
    // Progress bar
    const barLength = 40;
    const filled = Math.round((usedPercent / 100) * barLength);
    const empty = barLength - filled;
    const bar = '█'.repeat(filled) + '·'.repeat(empty);
    lines.push(`[${bar}]`);
  } else {
    lines.push(`Tokens Used: ${report.tokensUsed.toLocaleString()}`);
  }
  lines.push('');
  
  // Cost
  if (report.cost > 0) {
    lines.push(`Estimated Cost: $${report.cost.toFixed(4)}`);
  }
  
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push('');
  
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const contextInspectionToolDefinition = {
  name: 'context_inspection',
  description: 'Analyze context window usage and provider rate limits',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['context', 'usage'],
        description: 'Action to perform',
      },
      systemPrompt: { type: 'string', description: 'System prompt text' },
      tools: { type: 'string', description: 'Tool definitions text' },
      messages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string' },
            content: { type: 'string' },
          },
        },
        description: 'Conversation messages',
      },
      skills: { type: 'string', description: 'Skills definitions text' },
      maxTokens: { type: 'number', description: 'Maximum context window size' },
      provider: { type: 'string', description: 'Provider name' },
      model: { type: 'string', description: 'Model name' },
      rateLimitRemaining: { type: 'number', description: 'Rate limit remaining' },
      rateLimitReset: { type: 'string', description: 'Rate limit reset time' },
      tokensUsed: { type: 'number', description: 'Tokens used' },
      tokensLimit: { type: 'number', description: 'Token limit' },
      cost: { type: 'number', description: 'Estimated cost' },
    },
    required: ['action'],
  },
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input: Record<string, unknown>) {
    const action = input.action as string;

    if (action === 'context') {
      const report = analyzeContext({
        systemPrompt: input.systemPrompt as string,
        tools: input.tools as string,
        messages: input.messages as Array<{ role: string; content: string }>,
        skills: input.skills as string,
        maxTokens: input.maxTokens as number,
      });
      return {
        report,
        formatted: formatContextReport(report),
      };
    }

    if (action === 'usage') {
      const report = analyzeUsage({
        provider: input.provider as string,
        model: input.model as string,
        rateLimitRemaining: input.rateLimitRemaining as number,
        rateLimitReset: input.rateLimitReset as string,
        tokensUsed: input.tokensUsed as number,
        tokensLimit: input.tokensLimit as number,
        cost: input.cost as number,
      });
      return {
        report,
        formatted: formatUsageReport(report),
      };
    }

    return { error: `Unknown action: ${action}` };
  },
};

export default {
  analyzeContext,
  formatContextReport,
  analyzeUsage,
  formatUsageReport,
  estimateTokens,
  contextInspectionToolDefinition,
};
