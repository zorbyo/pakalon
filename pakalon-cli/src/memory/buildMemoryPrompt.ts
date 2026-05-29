/**
 * Build Memory Prompt
 *
 * Re-exports from memdir.ts for backwards compatibility.
 */

export {
  buildMemoryLines,
  buildMemoryPrompt,
  loadMemoryPrompt,
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
  truncateEntrypointContent,
  type EntrypointTruncation,
  DIR_EXISTS_GUIDANCE,
  DIRS_EXIST_GUIDANCE,
} from './memdir.js'

export { buildSearchingPastContextSection } from './memdir.js'