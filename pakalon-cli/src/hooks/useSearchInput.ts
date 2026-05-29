/**
 * Search Input Hook
 *
 * Comprehensive search input handler with cursor management, kill ring,
 * yank/paste support, and full keyboard navigation. Designed for use
 * in search dialogs, command palettes, and filter inputs.
 */

import { useCallback, useState } from 'react';

import { KeyboardEvent } from '../ink/events/keyboard-event.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- backward-compat bridge
import { useInput } from '../ink.js';
import {
  Cursor,
  getLastKill,
  pushToKillRing,
  recordYank,
  resetKillAccumulation,
  resetYankState,
  updateYankLength,
  yankPop,
} from '../utils/Cursor.js';
import { useTerminalSize } from './useTerminalSize.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface UseSearchInputOptions {
  /** Whether the search input is active and should capture keys */
  isActive: boolean;
  /** Called when search is committed (Enter/down arrow) */
  onExit: (query: string) => void;
  /** Called when search is cancelled (Escape). When provided,
   * single-Esc calls this directly. When absent, Esc clears
   * non-empty query first, then exits on empty. */
  onCancel?: () => void;
  /** Called when up arrow is pressed (e.g., navigate to previous result) */
  onExitUp?: () => void;
  /** Column width for cursor wrapping (defaults to terminal width) */
  columns?: number;
  /** Ctrl+key combinations to pass through without handling */
  passthroughCtrlKeys?: string[];
  /** Initial query value */
  initialQuery?: string;
  /** Backspace on empty query calls onCancel ?? onExit.
   * Set false to prevent backspace from exiting. */
  backspaceExitsOnEmpty?: boolean;
  /** Called when query changes */
  onQueryChange?: (query: string) => void;
  /** Called when cursor offset changes */
  onCursorChange?: (offset: number) => void;
}

export interface UseSearchInputReturn {
  query: string;
  setQuery: (q: string) => void;
  cursorOffset: number;
  setCursorOffset: (offset: number) => void;
  handleKeyDown: (e: KeyboardEvent) => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Key Detection
// ──────────────────────────────────────────────────────────────────────────────

const KILL_KEYS = new Set(['k', 'u', 'w']);
const META_BACKSPACE = 'backspace';

const UNHANDLED_SPECIAL_KEYS = new Set([
  'pageup',
  'pagedown',
  'insert',
  'wheelup',
  'wheeldown',
  'mouse',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6',
  'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
]);

function isKillKey(e: KeyboardEvent): boolean {
  if (e.ctrl && KILL_KEYS.has(e.key.toLowerCase())) return true;
  if (e.meta && e.key === META_BACKSPACE) return true;
  return false;
}

function isYankKey(e: KeyboardEvent): boolean {
  return (e.ctrl || e.meta) && e.key === 'y';
}

// ──────────────────────────────────────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────────────────────────────────────

export function useSearchInput({
  isActive,
  onExit,
  onCancel,
  onExitUp,
  columns,
  passthroughCtrlKeys = [],
  initialQuery = '',
  backspaceExitsOnEmpty = true,
  onQueryChange,
  onCursorChange,
}: UseSearchInputOptions): UseSearchInputReturn {
  const { columns: terminalColumns } = useTerminalSize();
  const effectiveColumns = columns ?? terminalColumns;

  const [query, setQueryState] = useState(initialQuery);
  const [cursorOffset, setCursorOffsetState] = useState(initialQuery.length);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    setCursorOffsetState(q.length);
    onQueryChange?.(q);
    onCursorChange?.(q.length);
  }, [onQueryChange, onCursorChange]);

  const setCursorOffset = useCallback((offset: number) => {
    setCursorOffsetState(offset);
    onCursorChange?.(offset);
  }, [onCursorChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent): void => {
    if (!isActive) return;

    const cursor = Cursor.fromText(query, effectiveColumns, cursorOffset);

    if (e.ctrl && passthroughCtrlKeys.includes(e.key.toLowerCase())) {
      return;
    }

    if (!isKillKey(e)) {
      resetKillAccumulation();
    }

    if (!isYankKey(e)) {
      resetYankState();
    }

    // Exit: Enter or down arrow
    if (e.key === 'return' || e.key === 'down') {
      e.preventDefault();
      onExit(query);
      return;
    }

    // Exit up
    if (e.key === 'up') {
      e.preventDefault();
      onExitUp?.();
      return;
    }

    // Escape: cancel or clear
    if (e.key === 'escape') {
      e.preventDefault();
      if (onCancel) {
        onCancel();
      } else if (query.length > 0) {
        setQueryState('');
        setCursorOffsetState(0);
      } else {
        onExit(query);
      }
      return;
    }

    // Backspace
    if (e.key === 'backspace') {
      e.preventDefault();
      if (e.meta) {
        const { cursor: newCursor, killed } = cursor.deleteWordBefore();
        pushToKillRing(killed, 'prepend');
        setQueryState(newCursor.text);
        setCursorOffsetState(newCursor.offset);
        return;
      }
      if (query.length === 0) {
        if (backspaceExitsOnEmpty) (onCancel ?? onExit)(query);
        return;
      }
      const newCursor = cursor.backspace();
      setQueryState(newCursor.text);
      setCursorOffsetState(newCursor.offset);
      return;
    }

    // Delete
    if (e.key === 'delete') {
      e.preventDefault();
      const newCursor = cursor.del();
      setQueryState(newCursor.text);
      setCursorOffsetState(newCursor.offset);
      return;
    }

    // Arrow keys with word jump
    if (e.key === 'left' && (e.ctrl || e.meta || e.fn)) {
      e.preventDefault();
      const newCursor = cursor.prevWord();
      setCursorOffsetState(newCursor.offset);
      return;
    }
    if (e.key === 'right' && (e.ctrl || e.meta || e.fn)) {
      e.preventDefault();
      const newCursor = cursor.nextWord();
      setCursorOffsetState(newCursor.offset);
      return;
    }

    // Plain arrow keys
    if (e.key === 'left') {
      e.preventDefault();
      const newCursor = cursor.left();
      setCursorOffsetState(newCursor.offset);
      return;
    }
    if (e.key === 'right') {
      e.preventDefault();
      const newCursor = cursor.right();
      setCursorOffsetState(newCursor.offset);
      return;
    }

    // Home/End
    if (e.key === 'home') {
      e.preventDefault();
      setCursorOffsetState(0);
      return;
    }
    if (e.key === 'end') {
      e.preventDefault();
      setCursorOffsetState(query.length);
      return;
    }

    // Ctrl bindings
    if (e.ctrl) {
      e.preventDefault();
      switch (e.key.toLowerCase()) {
        case 'a':
          setCursorOffsetState(0);
          return;
        case 'e':
          setCursorOffsetState(query.length);
          return;
        case 'b':
          setCursorOffsetState(cursor.left().offset);
          return;
        case 'f':
          setCursorOffsetState(cursor.right().offset);
          return;
        case 'd': {
          if (query.length === 0) {
            (onCancel ?? onExit)(query);
            return;
          }
          const newCursor = cursor.del();
          setQueryState(newCursor.text);
          setCursorOffsetState(newCursor.offset);
          return;
        }
        case 'h': {
          if (query.length === 0) {
            if (backspaceExitsOnEmpty) (onCancel ?? onExit)(query);
            return;
          }
          const newCursor = cursor.backspace();
          setQueryState(newCursor.text);
          setCursorOffsetState(newCursor.offset);
          return;
        }
        case 'k': {
          const { cursor: newCursor, killed } = cursor.deleteToLineEnd();
          pushToKillRing(killed, 'append');
          setQueryState(newCursor.text);
          setCursorOffsetState(newCursor.offset);
          return;
        }
        case 'u': {
          const { cursor: newCursor, killed } = cursor.deleteToLineStart();
          pushToKillRing(killed, 'prepend');
          setQueryState(newCursor.text);
          setCursorOffsetState(newCursor.offset);
          return;
        }
        case 'w': {
          const { cursor: newCursor, killed } = cursor.deleteWordBefore();
          pushToKillRing(killed, 'prepend');
          setQueryState(newCursor.text);
          setCursorOffsetState(newCursor.offset);
          return;
        }
        case 'y': {
          const text = getLastKill();
          if (text.length > 0) {
            const startOffset = cursor.offset;
            const newCursor = cursor.insert(text);
            recordYank(startOffset, text.length);
            setQueryState(newCursor.text);
            setCursorOffsetState(newCursor.offset);
          }
          return;
        }
        case 'g':
        case 'c':
          if (onCancel) {
            onCancel();
            return;
          }
      }
      return;
    }

    // Meta bindings
    if (e.meta) {
      e.preventDefault();
      switch (e.key.toLowerCase()) {
        case 'b':
          setCursorOffsetState(cursor.prevWord().offset);
          return;
        case 'f':
          setCursorOffsetState(cursor.nextWord().offset);
          return;
        case 'd': {
          const newCursor = cursor.deleteWordAfter();
          setQueryState(newCursor.text);
          setCursorOffsetState(newCursor.offset);
          return;
        }
        case 'y': {
          const popResult = yankPop();
          if (popResult) {
            const { text, start, length } = popResult;
            const before = query.slice(0, start);
            const after = query.slice(start + length);
            const newText = before + text + after;
            const newOffset = start + text.length;
            updateYankLength(text.length);
            setQueryState(newText);
            setCursorOffsetState(newOffset);
          }
          return;
        }
      }
      return;
    }

    // Tab: ignore
    if (e.key === 'tab') {
      return;
    }

    // Regular character input (supports multi-char for batched writes)
    if (e.key.length >= 1 && !UNHANDLED_SPECIAL_KEYS.has(e.key)) {
      e.preventDefault();
      const newCursor = cursor.insert(e.key);
      setQueryState(newCursor.text);
      setCursorOffsetState(newCursor.offset);
    }
  }, [
    isActive,
    query,
    cursorOffset,
    effectiveColumns,
    onExit,
    onCancel,
    onExitUp,
    passthroughCtrlKeys,
    backspaceExitsOnEmpty,
    setQuery,
    setCursorOffset,
  ]);

  // Backward-compat bridge: subscribe via useInput for consumers that
  // don't yet wire handleKeyDown to <Box onKeyDown>
  useInput(
    (_input, _key, event) => {
      handleKeyDown(new KeyboardEvent(event.keypress));
    },
    { isActive },
  );

  return { query, setQuery, cursorOffset, handleKeyDown };
}
