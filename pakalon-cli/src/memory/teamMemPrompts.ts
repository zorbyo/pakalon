/**
 * Team Memory Prompts
 *
 * Provides prompt building for combined auto + team memory mode.
 */

import {
  MEMORY_DRIFT_CAVEAT,
  MEMORY_FRONTMATTER_EXAMPLE,
  TRUSTING_RECALL_SECTION,
  TYPES_SECTION_COMBINED,
  WHAT_NOT_TO_SAVE_SECTION,
} from './types.js'
import { getAutoMemPath } from './paths.js'
import { getTeamMemPath } from './teamMemPaths.js'
import { buildSearchingPastContextSection } from './memdir.js'

/**
 * Build the combined prompt when both auto memory and team memory are enabled.
 */
export function buildCombinedMemoryPrompt(
  extraGuidelines?: string[],
  skipIndex = false,
): string {
  const autoDir = getAutoMemPath()
  const teamDir = getTeamMemPath()

  const howToSave = skipIndex
    ? [
        '## How to save memories',
        '',
        'Write each memory to its own file in the chosen directory (private or team, per the type scope guidance) using this frontmatter format:',
        '',
        ...MEMORY_FRONTMATTER_EXAMPLE,
        '',
        '- Keep the name, description, and type fields in memory files up-to-date with the content',
        '- Organize memory semantically by topic, not chronologically',
        '- Update or remove memories that turn out to be wrong or outdated',
      ]
    : [
        '## How to save memories',
        '',
        'Saving a memory is a two-step process:',
        '',
        '**Step 1** — write the memory to its own file in the chosen directory (private or team) using this frontmatter format:',
        '',
        ...MEMORY_FRONTMATTER_EXAMPLE,
        '',
        '**Step 2** — add a pointer to that file in the same directory MEMORY.md index. Each entry should be one line, under ~150 characters: `- [Title](file.md) — one-line hook`.',
        '',
        '- Both MEMORY.md indexes are loaded into your context — lines after 200 will be truncated, so keep them concise',
        '- Keep the name, description, and type fields in memory files up-to-date',
        '- Do not write duplicate memories. First check for existing memories before writing new ones.',
      ]

  const lines: string[] = [
    '# Memory',
    '',
    `You have a persistent, file-based memory system with two directories: a private directory at \`${autoDir}\` and a shared team directory at \`${teamDir}\`. Both directories already exist — write to them directly with the Write tool.`,
    '',
    'You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work.',
    '',
    'If the user explicitly asks you to remember something, save it immediately. If they ask to forget something, find and remove the relevant entry.',
    '',
    '## Memory scope',
    '',
    'There are two scope levels:',
    '',
    `- private: memories that are private between you and the current user. Stored at the root \`${autoDir}\`.`,
    `- team: memories that are shared with all users who work within this project. Stored at \`${teamDir}\`.`,
    '',
    ...TYPES_SECTION_COMBINED,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '- You MUST avoid saving sensitive data within shared team memories.',
    '',
    ...howToSave,
    '',
    '## When to access memories',
    '- When memories (personal or team) seem relevant, or the user references prior work.',
    '- You MUST access memory when the user explicitly asks you to check, recall, or remember.',
    '- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty.',
    MEMORY_DRIFT_CAVEAT,
    '',
    ...TRUSTING_RECALL_SECTION,
    '',
    '## Memory and other forms of persistence',
    '- When to use a plan instead of memory: If you are about to start a non-trivial implementation task, reach alignment with the user on your approach using a Plan.',
    '- When to use tasks instead of memory: When you need to break work into discrete steps or keep track of progress, use tasks instead of saving to memory.',
    ...(extraGuidelines ?? []),
    '',
    ...buildSearchingPastContextSection(autoDir),
  ]

  return lines.join('\n')
}