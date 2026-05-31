/**
 * /usage command - Report provider rate-limit headroom
 * 
 * /usage reports provider rate-limit headroom against the active credential.
 * When a turn stalls, check /usage before reaching for /compact to rule out
 * a quota wall - the retry path handles that automatically.
 * 
 * Features:
 * - Provider rate-limit status
 * - Token usage vs limits
 * - Request counts
 * - Retry-after hints
 */

import type { Command } from '../commands.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitInfo {
  provider: string;
  model: string;
  requestsLimit: number;
  requestsRemaining: number;
  requestsReset: number; // Unix timestamp
  tokensLimit: number;
  tokensRemaining: number;
  tokensReset: number; // Unix timestamp
}

export interface UsageBreakdown {
  totalRequests: number;
  totalTokens: number;
  byModel: Array<{
    model: string;
    requests: number;
    tokens: number;
  }>;
  rateLimits: RateLimitInfo[];
}

// ---------------------------------------------------------------------------
// Usage Command
// ---------------------------------------------------------------------------

function getPromptContent(): string {
  return `## Usage Analysis

You are analyzing the current provider usage and rate limits.

### What to show:
1. **Total Usage** - Total requests and tokens used
2. **By Model** - Breakdown per model
3. **Rate Limits** - Current rate limit status for each provider
4. **Headroom** - Available quota before hitting limits

### Example output:
\`\`\`
USAGE STATUS
═══════════════════════════════════════════════════════════

Total Requests: 142
Total Tokens:   1,234,567

BY MODEL:
  claude-3.5-sonnet    89 requests    890,123 tokens
  gpt-4o               34 requests    234,567 tokens
  claude-3-haiku       19 requests    109,877 tokens

RATE LIMITS:
  OpenAI
    Requests: 45/50 remaining (resets in 12m)
    Tokens:   1.2M/1.5M remaining (resets in 45m)
  
  Anthropic
    Requests: 38/40 remaining (resets in 8m)
    Tokens:   890K/1M remaining (resets in 32m)

STATUS: ✅ OK - All providers within limits
\`\`\`

### Analysis:
- Check if any provider is near its limit
- Warn if remaining < 20%
- Suggest model switching if one provider is throttled
- Show retry-after if rate limited

Provide the usage breakdown in the format above.`;
}

const usageCommand: Command = {
  type: 'prompt',
  name: 'usage',
  description: 'Show provider rate-limit headroom and usage stats',
  progressMessage: 'checking usage',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(): Promise<Array<{ type: string; text: string }>> {
    const promptContent = getPromptContent();
    return [{ type: 'text', text: promptContent }];
  },
};

// ---------------------------------------------------------------------------
// Formatting Utilities
// ---------------------------------------------------------------------------

export function formatUsageBreakdown(usage: UsageBreakdown): string {
  const lines: string[] = [];
  
  lines.push('USAGE STATUS');
  lines.push('═'.repeat(60));
  lines.push('');
  lines.push(`Total Requests: ${usage.totalRequests.toLocaleString()}`);
  lines.push(`Total Tokens:   ${usage.totalTokens.toLocaleString()}`);
  lines.push('');
  
  // By model
  lines.push('BY MODEL:');
  for (const model of usage.byModel) {
    const name = model.model.padEnd(25);
    const requests = `${model.requests} requests`.padStart(15);
    const tokens = `${model.tokens.toLocaleString()} tokens`.padStart(20);
    lines.push(`  ${name} ${requests} ${tokens}`);
  }
  lines.push('');
  
  // Rate limits
  lines.push('RATE LIMITS:');
  for (const limit of usage.rateLimits) {
    lines.push(`  ${limit.provider}`);
    
    const reqPct = (limit.requestsRemaining / limit.requestsLimit) * 100;
    const reqStatus = reqPct < 20 ? '⚠️' : '✅';
    const reqReset = formatResetTime(limit.requestsReset);
    lines.push(`    Requests: ${limit.requestsRemaining}/${limit.requestsLimit} remaining (${reqStatus} resets in ${reqReset})`);
    
    const tokPct = (limit.tokensRemaining / limit.tokensLimit) * 100;
    const tokStatus = tokPct < 20 ? '⚠️' : '✅';
    const tokReset = formatResetTime(limit.tokensReset);
    const tokRemaining = limit.tokensRemaining >= 1000000
      ? `${(limit.tokensRemaining / 1000000).toFixed(1)}M`
      : `${(limit.tokensRemaining / 1000).toFixed(0)}K`;
    const tokLimit = limit.tokensLimit >= 1000000
      ? `${(limit.tokensLimit / 1000000).toFixed(1)}M`
      : `${(limit.tokensLimit / 1000).toFixed(0)}K`;
    lines.push(`    Tokens:   ${tokRemaining}/${tokLimit} remaining (${tokStatus} resets in ${tokReset})`);
  }
  lines.push('');
  
  // Overall status
  const allOk = usage.rateLimits.every(l => 
    l.requestsRemaining / l.requestsLimit > 0.2 &&
    l.tokensRemaining / l.tokensLimit > 0.2
  );
  
  lines.push(`STATUS: ${allOk ? '✅ OK - All providers within limits' : '⚠️ WARNING - Some providers near limits'}`);
  
  return lines.join('\n');
}

function formatResetTime(resetTimestamp: number): string {
  const now = Date.now() / 1000;
  const diff = resetTimestamp - now;
  
  if (diff <= 0) return 'now';
  
  const minutes = Math.floor(diff / 60);
  const seconds = Math.floor(diff % 60);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default usageCommand;
export { formatUsageBreakdown };
