import { tool } from 'ai';
import { z } from 'zod';

const sleepTool = tool({
  description: 'Pause execution for a specified duration. Useful for waiting for external processes, rate limiting, or polling operations.',
  inputSchema: z.object({
    duration: z.number().min(0).max(300000).describe('Duration to sleep in milliseconds (0-300000)'),
    reason: z.string().optional().describe('Reason for the delay'),
  }),
  execute: async ({ arguments: args }) => {
    const { duration, reason } = args;

    if (duration <= 0) {
      return {
        success: true,
        duration: 0,
        message: reason ? `Skipped sleep: ${reason}` : 'No sleep needed',
      };
    }

    await new Promise((resolve) => setTimeout(resolve, duration));

    return {
      success: true,
      duration,
      reason: reason || 'Sleep completed',
      message: `Slept for ${duration}ms${reason ? `: ${reason}` : ''}`,
    };
  },
});

const waitForTool = tool({
  description: 'Wait for a specific condition to be true, checking periodically. Useful for waiting for file changes, API availability, or async operations.',
  inputSchema: z.object({
    condition: z.string().describe('JavaScript expression that evaluates to true when condition is met'),
    maxWait: z.number().optional().default(60000).describe('Maximum wait time in milliseconds'),
    checkInterval: z.number().optional().default(1000).describe('Interval between checks in milliseconds'),
  }),
  execute: async ({ arguments: args }) => {
    const { condition, maxWait = 60000, checkInterval = 1000 } = args;

    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const result = new Function(`return ${condition}`)();

        if (result) {
          const elapsed = Date.now() - startTime;
          return {
            success: true,
            conditionMet: true,
            elapsed,
            message: `Condition met after ${elapsed}ms`,
          };
        }
      } catch {
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    return {
      success: false,
      conditionMet: false,
      elapsed: maxWait,
      message: `Condition not met within ${maxWait}ms`,
      error: 'Timeout waiting for condition',
    };
  },
});

export function getAllDelayTools() {
  return {
    sleep: sleepTool,
    wait_for: waitForTool,
  };
}