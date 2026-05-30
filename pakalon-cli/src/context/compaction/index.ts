/**
 * Compaction Module
 *
 * Provides multiple compaction strategies for context management:
 * - Snip-Compact: Remove repeated command patterns
 * - Reactive-Compact: Retry after compaction on prompt-too-long errors
 * - Context-Collapse: Progressive collapse with commit-log style staging
 * - Auto-Compact: Automatic compaction at threshold
 * - Micro-Compact: Per-tool-result budget compaction
 */

export { snipCompact, detectRepetitions, applySnipCompact } from './snipCompact.js';
export type { SnipCompactOptions, SnipGroup, SnipCompactResult } from './snipCompact.js';

export { reactiveCompact, isPromptTooLongError, applyReactiveCompact, extractTokenUsage } from './reactiveCompact.js';
export type { ReactiveCompactOptions, ReactiveCompactResult, CompactableMessage } from './reactiveCompact.js';

export { contextCollapse } from './contextCollapse.js';
export type { ContextCollapseOptions, CollapsibleMessage, CollapseStage, CommitLogEntry, ContextCollapseResult } from './contextCollapse.js';

// Re-export for convenience
export { default as snipCompactFn } from './snipCompact.js';
export { default as reactiveCompactFn } from './reactiveCompact.js';
export { default as contextCollapseFn } from './contextCollapse.js';