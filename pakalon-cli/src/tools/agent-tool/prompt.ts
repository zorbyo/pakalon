/**
 * Agent Prompt Utilities
 * Helper functions for generating agent prompts
 */
import type { AgentDefinition, Tools } from './types.js';
import type { ToolUseContext } from '@/ai/tool-registry';
import logger from '@/utils/logger.js';

export function getDefaultAgentPrompt(): string {
  return `You are a helpful AI assistant powered by Claude. You can use tools to accomplish tasks efficiently.

Guidelines:
- Be helpful, harmless, and honest
- Use appropriate tools for each task
- Provide clear explanations
- Ask clarifying questions when needed
- Be thorough but concise`;
}

export async function getAgentSystemPrompt(
  agentDefinition: AgentDefinition,
  toolUseContext: Pick<ToolUseContext, 'options'>,
  resolvedAgentModel: string,
  additionalWorkingDirectories: string[] = [],
  enabledToolNames: string[] = [],
): Promise<string> {
  if ('getSystemPrompt' in agentDefinition) {
    try {
      return agentDefinition.getSystemPrompt({ toolUseContext });
    } catch (error) {
      logger.warn(`[getAgentSystemPrompt] Error getting prompt: ${error}`);
    }
  }

  return getDefaultAgentPrompt();
}

export function enhancePromptWithContext(
  basePrompt: string,
  context: {
    userContext?: Record<string, string>;
    systemContext?: Record<string, string>;
    enabledTools?: string[];
    workingDirectories?: string[];
  },
): string {
  const parts: string[] = [basePrompt];

  if (context.userContext && Object.keys(context.userContext).length > 0) {
    parts.push('\n\n## User Context');
    for (const [key, value] of Object.entries(context.userContext)) {
      if (value) {
        parts.push(`- ${key}: ${value}`);
      }
    }
  }

  if (context.systemContext && Object.keys(context.systemContext).length > 0) {
    parts.push('\n\n## System Context');
    for (const [key, value] of Object.entries(context.systemContext)) {
      if (value) {
        parts.push(`- ${key}: ${value}`);
      }
    }
  }

  if (context.enabledTools && context.enabledTools.length > 0) {
    parts.push('\n\n## Available Tools');
    parts.push(`Tools available: ${context.enabledTools.join(', ')}`);
  }

  if (context.workingDirectories && context.workingDirectories.length > 0) {
    parts.push('\n\n## Working Directories');
    for (const dir of context.workingDirectories) {
      parts.push(`- ${dir}`);
    }
  }

  return parts.join('\n');
}

export function getSystemPromptForAgentType(
  agentType: string,
  customInstructions?: string,
): string {
  const basePrompts: Record<string, string> = {
    Explore: `You are an exploration agent. Thoroughly investigate topics, files, or codebases.

Focus on:
- Accurate, factual findings
- Relevant file paths
- Comprehensive coverage
- No speculation`,

    Plan: `You are a planning agent. Create structured execution plans.

Focus on:
- Clear, actionable steps
- Logical ordering
- Dependency tracking
- Risk identification`,

    Verification: `You are a verification agent. Review work for correctness.

Focus on:
- Accuracy verification
- Security checks
- Best practices compliance
- Constructive feedback`,

    CodeReview: `You are a code review agent. Provide detailed code review.

Focus on:
- Correctness and security
- Performance considerations
- Code style and conventions
- Actionable suggestions`,

    Refactor: `You are a refactoring agent. Improve code structure.

Focus on:
- Code clarity
- Reducing redundancy
- Maintaining behavior
- Minimal changes`,

    General: `You are a versatile AI assistant. Help with any task.

Be:
- Helpful and thorough
- Adaptable to needs
- Clear in communication`,
  };

  const basePrompt = basePrompts[agentType] || basePrompts['General'];

  if (customInstructions) {
    return `${basePrompt}

## Additional Instructions
${customInstructions}`;
  }

  return basePrompt;
}

export function generateAgentSystemPrompt(params: {
  agentType: string;
  taskDescription: string;
  constraints?: string[];
  tools?: string[];
  outputFormat?: string;
}): string {
  const { agentType, taskDescription, constraints, tools, outputFormat } = params;

  const parts: string[] = [];

  parts.push(getSystemPromptForAgentType(agentType));

  parts.push(`\n\n## Task\n${taskDescription}`);

  if (constraints && constraints.length > 0) {
    parts.push('\n\n## Constraints');
    for (const constraint of constraints) {
      parts.push(`- ${constraint}`);
    }
  }

  if (tools && tools.length > 0) {
    parts.push(`\n\n## Available Tools\n${tools.join(', ')}`);
  }

  if (outputFormat) {
    parts.push(`\n\n## Output Format\n${outputFormat}`);
  }

  return parts.join('\n');
}

export function truncatePrompt(prompt: string, maxLength: number): string {
  if (prompt.length <= maxLength) {
    return prompt;
  }

  const truncated = prompt.substring(0, maxLength - 3);
  return truncated + '...';
}

export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

export { getDefaultAgentPrompt };