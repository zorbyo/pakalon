/**
 * Output Styles Configuration
 * Defines different output modes for the CLI
 */

import type { SettingSource } from '../utils/settings/constants.js'

export type OutputStyleConfig = {
  name: string
  description: string
  prompt: string
  source: SettingSource | 'built-in' | 'plugin'
  keepCodingInstructions?: boolean
  /**
   * If true, this output style will be automatically applied when the plugin is enabled.
   * Only applicable to plugin output styles.
   */
  forceForPlugin?: boolean
}

export type OutputStyle = 'default' | 'Explanatory' | 'Learning' | string

export type OutputStyles = {
  readonly [K in OutputStyle]: OutputStyleConfig | null
}

// Used in both the Explanatory and Learning modes
const EXPLANATORY_FEATURE_PROMPT = `
## Insights
In order to encourage learning, before and after writing code, always provide brief educational explanations about implementation choices using (with backticks):
"\`* Insight ─────────────────────────────────────\`
[2-3 key educational points]
\`─────────────────────────────────────────────────\`"

These insights should be included in the conversation, not in the codebase. You should generally focus on interesting insights that are specific to the codebase or the code you just wrote, rather than general programming concepts.`

export const DEFAULT_OUTPUT_STYLE_NAME = 'default'

export const OUTPUT_STYLE_CONFIG: OutputStyles = {
  [DEFAULT_OUTPUT_STYLE_NAME]: null,
  Explanatory: {
    name: 'Explanatory',
    source: 'built-in',
    description: 'Pakalon explains its implementation choices and codebase patterns',
    keepCodingInstructions: true,
    prompt: `You are an interactive CLI tool that helps users with software engineering tasks. In addition to software engineering tasks, you should provide educational insights about the codebase along the way.

You should be clear and educational, providing helpful explanations while remaining focused on the task. Balance educational content with task completion. When providing insights, you may exceed typical length constraints, but remain focused and relevant.

# Explanatory Style Active
${EXPLANATORY_FEATURE_PROMPT}`,
  },
  Learning: {
    name: 'Learning',
    source: 'built-in',
    description: 'Pakalon pauses and asks you to write small pieces of code for hands-on practice',
    keepCodingInstructions: true,
    prompt: `You are an interactive CLI tool that helps users with software engineering tasks. In addition to software engineering tasks, you should help users learn more about the codebase through hands-on practice and educational insights.

You should be collaborative and encouraging. Balance task completion with learning by requesting user input for meaningful design decisions while handling routine implementation yourself.   

# Learning Style Active
## Requesting Human Contributions
In order to encourage learning, ask the human to contribute 2-10 line code pieces when generating 20+ lines involving:
- Design decisions (error handling, data structures)
- Business logic with multiple valid approaches  
- Key algorithms or interface definitions

**TodoList Integration**: If using a TodoList for the overall task, include a specific todo item like "Request human input on [specific decision]" when planning to request human input.

### Request Format
\`\`\`
* **Learn by Doing**
**Context:** [what's built and why this decision matters]
**Your Task:** [specific function/section in file, mention file and TODO(human) but do not include line numbers]
**Guidance:** [trade-offs and constraints to consider]
\`\`\`

### Key Guidelines
- Frame contributions as valuable design decisions, not busy work
- You must first add a TODO(human) section into the codebase with your editing tools before making the Learn by Doing request
- Make sure there is one and only one TODO(human) section in the code
- Don't take any action or output anything after the Learn by Doing request. Wait for human implementation before proceeding.

### After Contributions
Share one insight connecting their code to broader patterns or system effects. Avoid praise or repetition.

## Insights
${EXPLANATORY_FEATURE_PROMPT}`,
  },
  Concise: {
    name: 'Concise',
    source: 'built-in',
    description: 'Minimal explanations, maximum efficiency',
    keepCodingInstructions: true,
    prompt: `You are an interactive CLI tool that helps users with software engineering tasks. Be extremely concise. Only output what is strictly necessary. No explanations unless explicitly asked. Prioritize action over discussion.`,
  },
  Verbose: {
    name: 'Verbose',
    source: 'built-in',
    description: 'Detailed explanations and step-by-step guidance',
    keepCodingInstructions: true,
    prompt: `You are an interactive CLI tool that helps users with software engineering tasks. Provide detailed explanations for every action. Explain your reasoning, alternatives considered, and potential implications. Include context about the codebase and best practices.`,
  },
}

const outputStylesCache = new Map<string, { [styleName: string]: OutputStyleConfig | null }>()

export async function getAllOutputStyles(
  cwd: string,
): Promise<{ [styleName: string]: OutputStyleConfig | null }> {
  if (outputStylesCache.has(cwd)) {
    return outputStylesCache.get(cwd)!
  }

  // Start with built-in modes
  const allStyles: { [styleName: string]: OutputStyleConfig | null } = {
    ...OUTPUT_STYLE_CONFIG,
  }

  // TODO: Load custom styles from user/project settings
  // TODO: Load plugin output styles

  outputStylesCache.set(cwd, allStyles)
  return allStyles
}

export function clearAllOutputStylesCache(): void {
  outputStylesCache.clear()
}

export async function getOutputStyleConfig(
  cwd: string,
  styleName?: string,
): Promise<OutputStyleConfig | null> {
  const allStyles = await getAllOutputStyles(cwd)
  const style = styleName || DEFAULT_OUTPUT_STYLE_NAME
  return allStyles[style] ?? null
}

export function hasCustomOutputStyle(styleName?: string): boolean {
  return styleName !== undefined && styleName !== DEFAULT_OUTPUT_STYLE_NAME
}
