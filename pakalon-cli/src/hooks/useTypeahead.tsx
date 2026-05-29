/**
 * Typeahead Hook
 *
 * Provides typeahead/autocomplete functionality for search inputs
 * with debounced suggestions, keyboard navigation, and inline ghost text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface TypeaheadSuggestion {
  id: string;
  displayText: string;
  description?: string;
  metadata?: Record<string, unknown>;
  category?: string;
}

export interface TypeaheadState {
  suggestions: TypeaheadSuggestion[];
  selectedIndex: number;
  isLoading: boolean;
  hasSuggestions: boolean;
  ghostText?: string;
  ghostTextFull?: string;
}

export interface UseTypeaheadOptions<T = unknown> {
  /** Current input value */
  value: string;
  /** Cursor position in the input */
  cursorOffset?: number;
  /** Fetch suggestions function */
  fetchSuggestions: (query: string, cursorOffset: number) => Promise<TypeaheadSuggestion[]>;
  /** Debounce delay in ms (default: 100) */
  debounceMs?: number;
  /** Minimum characters before triggering suggestions */
  minChars?: number;
  /** Maximum number of suggestions to show */
  maxSuggestions?: number;
  /** Enable inline ghost text */
  enableGhostText?: boolean;
  /** Called when a suggestion is accepted */
  onAccept?: (suggestion: TypeaheadSuggestion) => void;
  /** Called when input changes with accepted suggestion */
  onInputChange?: (value: string) => void;
  /** Suppress suggestions */
  suppressSuggestions?: boolean;
  /** Token extractor - extracts the token to search for at cursor */
  extractToken?: (value: string, cursorOffset: number) => { token: string; startPos: number; endPos: number } | null;
  /** Custom filter function */
  filterSuggestions?: (suggestions: TypeaheadSuggestion[], query: string) => TypeaheadSuggestion[];
}

export interface UseTypeaheadReturn {
  state: TypeaheadState;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  acceptSuggestion: () => boolean;
  dismissSuggestions: () => void;
  applyGhostText: () => boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// Default Token Extractor
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_TOKEN_RE = /[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*$/u;

function defaultExtractToken(
  value: string,
  cursorOffset: number,
): { token: string; startPos: number; endPos: number } | null {
  if (!value || cursorOffset === 0) return null;

  const beforeCursor = value.substring(0, cursorOffset);
  const match = beforeCursor.match(DEFAULT_TOKEN_RE);

  if (!match || match[0].length === 0) return null;

  const startPos = cursorOffset - match[0].length;
  return {
    token: match[0],
    startPos,
    endPos: cursorOffset,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Fuzzy Matching
// ──────────────────────────────────────────────────────────────────────────────

function isSubsequence(text: string, query: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

function defaultFilterSuggestions(
  suggestions: TypeaheadSuggestion[],
  query: string,
): TypeaheadSuggestion[] {
  if (!query) return suggestions;

  const lowerQuery = query.toLowerCase();
  const exact: TypeaheadSuggestion[] = [];
  const startsWith: TypeaheadSuggestion[] = [];
  const includes: TypeaheadSuggestion[] = [];
  const fuzzy: TypeaheadSuggestion[] = [];

  for (const item of suggestions) {
    const lowerText = item.displayText.toLowerCase();

    if (lowerText === lowerQuery) {
      exact.push(item);
    } else if (lowerText.startsWith(lowerQuery)) {
      startsWith.push(item);
    } else if (lowerText.includes(lowerQuery)) {
      includes.push(item);
    } else if (isSubsequence(lowerText, lowerQuery)) {
      fuzzy.push(item);
    }
  }

  return [...exact, ...startsWith, ...includes, ...fuzzy];
}

// ──────────────────────────────────────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────────────────────────────────────

export function useTypeahead(options: UseTypeaheadOptions): UseTypeaheadReturn {
  const {
    value,
    cursorOffset = value.length,
    fetchSuggestions,
    debounceMs = 100,
    minChars = 1,
    maxSuggestions = 20,
    enableGhostText = true,
    onAccept,
    onInputChange,
    suppressSuggestions = false,
    extractToken = defaultExtractToken,
    filterSuggestions = defaultFilterSuggestions,
  } = options;

  const [suggestions, setSuggestions] = useState<TypeaheadSuggestion[]>([]);
  const [selectedIndex, setSelectedIndexState] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [ghostText, setGhostText] = useState<string | undefined>(undefined);
  const [ghostTextFull, setGhostTextFull] = useState<string | undefined>(undefined);

  const latestTokenRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dismissedForValueRef = useRef<string | null>(null);

  const setSelectedIndex = useCallback((index: number | ((prev: number) => number)) => {
    setSelectedIndexState((prev) => {
      const next = typeof index === 'function' ? index(prev) : index;
      const suggestionsLen = suggestions.length;
      if (suggestionsLen === 0) return -1;
      return Math.max(0, Math.min(next, suggestionsLen - 1));
    });
  }, [suggestions.length]);

  const dismissSuggestions = useCallback(() => {
    setSuggestions([]);
    setSelectedIndexState(-1);
    setGhostText(undefined);
    setGhostTextFull(undefined);
    dismissedForValueRef.current = value;
  }, [value]);

  const fetchAndSetSuggestions = useCallback(async (
    token: string,
    signal: AbortSignal,
  ) => {
    if (suppressSuggestions) return;
    if (token.length < minChars) {
      dismissSuggestions();
      return;
    }

    if (dismissedForValueRef.current === value) {
      dismissedForValueRef.current = null;
    }

    latestTokenRef.current = token;
    setIsLoading(true);

    try {
      const results = await fetchSuggestions(token, cursorOffset);

      if (signal.aborted || latestTokenRef.current !== token) return;

      const filtered = filterSuggestions(results, token);
      const limited = filtered.slice(0, maxSuggestions);

      setSuggestions(limited);
      setSelectedIndexState(limited.length > 0 ? 0 : -1);

      if (enableGhostText && limited.length === 1) {
        const single = limited[0]!;
        setGhostText(single.displayText.slice(token.length));
        setGhostTextFull(single.displayText);
      } else {
        setGhostText(undefined);
        setGhostTextFull(undefined);
      }
    } finally {
      setIsLoading(false);
    }
  }, [suppressSuggestions, minChars, cursorOffset, fetchSuggestions, filterSuggestions, maxSuggestions, enableGhostText, dismissSuggestions, value]);

  useEffect(() => {
    if (suppressSuggestions) {
      dismissSuggestions();
      return;
    }

    const tokenInfo = extractToken(value, cursorOffset);
    const token = tokenInfo?.token ?? '';

    if (!token && suggestions.length === 0) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    debounceTimerRef.current = setTimeout(() => {
      void fetchAndSetSuggestions(token, controller.signal);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      controller.abort();
    };
  }, [value, cursorOffset, suppressSuggestions, extractToken, fetchAndSetSuggestions, debounceMs, dismissSuggestions, suggestions.length]);

  const acceptSuggestion = useCallback((): boolean => {
    if (suggestions.length === 0 || selectedIndex < 0) return false;

    const suggestion = suggestions[selectedIndex];
    if (!suggestion) return false;

    const tokenInfo = extractToken(value, cursorOffset);
    if (!tokenInfo) return false;

    const before = value.substring(0, tokenInfo.startPos);
    const after = value.substring(tokenInfo.endPos);
    const newValue = before + suggestion.displayText + after;
    const newCursorOffset = before.length + suggestion.displayText.length;

    onInputChange?.(newValue);
    onAccept?.(suggestion);

    setSuggestions([]);
    setSelectedIndexState(-1);
    setGhostText(undefined);
    setGhostTextFull(undefined);

    return true;
  }, [suggestions, selectedIndex, value, cursorOffset, extractToken, onInputChange, onAccept]);

  const applyGhostText = useCallback((): boolean => {
    if (!ghostText || !ghostTextFull) return false;

    const tokenInfo = extractToken(value, cursorOffset);
    if (!tokenInfo) return false;

    const before = value.substring(0, tokenInfo.startPos);
    const after = value.substring(tokenInfo.endPos);
    const newValue = before + ghostTextFull + after;
    const newCursorOffset = before.length + ghostTextFull.length;

    onInputChange?.(newValue);

    setGhostText(undefined);
    setGhostTextFull(undefined);

    return true;
  }, [ghostText, ghostTextFull, value, cursorOffset, extractToken, onInputChange]);

  const hasSuggestions = suggestions.length > 0;

  const state: TypeaheadState = {
    suggestions,
    selectedIndex,
    isLoading,
    hasSuggestions,
    ghostText,
    ghostTextFull,
  };

  return {
    state,
    setSelectedIndex,
    acceptSuggestion,
    dismissSuggestions,
    applyGhostText,
  };
}

/**
 * Hook for simple text typeahead (no token extraction)
 */
export function useSimpleTypeahead(
  value: string,
  fetchSuggestions: (query: string) => Promise<TypeaheadSuggestion[]>,
  options?: {
    debounceMs?: number;
    minChars?: number;
    maxSuggestions?: number;
  },
): UseTypeaheadReturn {
  const {
    debounceMs = 100,
    minChars = 1,
    maxSuggestions = 20,
  } = options ?? {};

  return useTypeahead({
    value,
    cursorOffset: value.length,
    fetchSuggestions: (query) => fetchSuggestions(query),
    debounceMs,
    minChars,
    maxSuggestions,
    extractToken: (v) => {
      if (!v) return null;
      return { token: v, startPos: 0, endPos: v.length };
    },
  });
}
