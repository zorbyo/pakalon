/**
 * History Search Hook
 *
 * React hook for searching through session history with real-time
 * filtering, keyboard navigation, and typeahead support.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { HistoryEntry } from '../utils/config.js';
import { KeyboardEvent } from '../ink/events/keyboard-event.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- backward-compat bridge
import { useInput } from '../ink.js';
import { useKeybinding, useKeybindings } from '../keybindings/useKeybinding.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface HistorySearchState {
  isSearching: boolean;
  query: string;
  results: HistoryEntry[];
  selectedIndex: number;
  isLoading: boolean;
  hasMore: boolean;
  totalMatches: number;
}

export interface UseHistorySearchReturn {
  state: HistorySearchState;
  setQuery: (query: string) => void;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  startSearch: () => void;
  cancelSearch: () => void;
  acceptMatch: () => HistoryEntry | undefined;
  navigateNext: () => void;
  navigatePrev: () => void;
  handleKeyDown: (e: KeyboardEvent) => void;
}

export interface HistorySearchOptions {
  /** Maximum results to load initially */
  initialLimit?: number;
  /** Debounce delay for query changes (ms) */
  debounceMs?: number;
  /** Enable fuzzy matching */
  fuzzyMatch?: boolean;
  /** Case-sensitive search */
  caseSensitive?: boolean;
  /** Callback when a match is accepted */
  onAccept?: (entry: HistoryEntry) => void;
  /** Callback when search is cancelled */
  onCancel?: () => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Matching
// ──────────────────────────────────────────────────────────────────────────────

function isSubsequence(text: string, query: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

function scoreHistoryEntry(
  entry: HistoryEntry,
  query: string,
  caseSensitive: boolean,
  fuzzyMatch: boolean,
): { score: number; matches: boolean } {
  const display = entry.display ?? '';
  const searchText = caseSensitive ? display : display.toLowerCase();
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  const exactPos = searchText.indexOf(searchQuery);
  if (exactPos !== -1) {
    let score = 100;
    if (exactPos === 0) score += 20;
    return { score, matches: true };
  }

  if (fuzzyMatch && isSubsequence(searchText, searchQuery)) {
    return { score: 10, matches: true };
  }

  return { score: 0, matches: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────────────────────────────────────

export function useHistorySearch(
  historyReader: AsyncGenerator<HistoryEntry> | (() => AsyncGenerator<HistoryEntry>),
  options: HistorySearchOptions = {},
): UseHistorySearchReturn {
  const {
    initialLimit = 100,
    debounceMs = 50,
    fuzzyMatch = true,
    caseSensitive = false,
    onAccept,
    onCancel,
  } = options;

  const [isSearching, setIsSearching] = useState(false);
  const [query, setQueryState] = useState('');
  const [results, setResults] = useState<HistoryEntry[]>([]);
  const [selectedIndex, setSelectedIndexState] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalMatches, setTotalMatches] = useState(0);

  const allEntriesRef = useRef<HistoryEntry[]>([]);
  const seenPromptsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreRef = useRef<AsyncGenerator<HistoryEntry> | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    setSelectedIndexState(0);
  }, []);

  const setSelectedIndex = useCallback((index: number | ((prev: number) => number)) => {
    setSelectedIndexState((prev) => {
      const next = typeof index === 'function' ? index(prev) : index;
      return Math.max(0, Math.min(next, results.length - 1));
    });
  }, [results.length]);

  const loadHistoryEntries = useCallback(async (
    reader: AsyncGenerator<HistoryEntry>,
    q: string,
    limit: number,
  ): Promise<{ entries: HistoryEntry[]; hasMore: boolean; total: number }> => {
    const entries: HistoryEntry[] = [];
    let total = 0;
    let hasMoreResults = false;

    for await (const entry of reader) {
      if (q.length === 0) {
        entries.push(entry);
        total++;
        if (entries.length >= limit) {
          hasMoreResults = true;
          break;
        }
        continue;
      }

      const { score, matches } = scoreHistoryEntry(entry, q, caseSensitive, fuzzyMatch);
      if (matches) {
        entries.push({ ...entry, _score: score });
        total++;
      }

      if (entries.length >= limit) {
        hasMoreResults = true;
        break;
      }
    }

    entries.sort((a, b) => ((b as Record<string, unknown>)._score as number ?? 0) - ((a as Record<string, unknown>)._score as number ?? 0));

    return { entries, hasMore: hasMoreResults, total };
  }, [caseSensitive, fuzzyMatch]);

  const performSearch = useCallback(async (q: string) => {
    setIsLoading(true);

    try {
      const reader = typeof historyReader === 'function' ? historyReader() : historyReader;
      loadMoreRef.current = reader;

      const { entries, hasMore: more, total } = await loadHistoryEntries(reader, q, initialLimit);

      if (queryRef.current === q) {
        allEntriesRef.current = entries;
        setResults(entries);
        setHasMore(more);
        setTotalMatches(total);
        setSelectedIndexState(0);
      }
    } finally {
      setIsLoading(false);
    }
  }, [historyReader, initialLimit, loadHistoryEntries]);

  const loadMoreResults = useCallback(async () => {
    if (!hasMore || !loadMoreRef.current || isLoading) return;

    setIsLoading(true);

    try {
      const q = queryRef.current;
      const additional: HistoryEntry[] = [];
      let count = 0;
      const batchSize = 50;

      for await (const entry of loadMoreRef.current) {
        if (q.length === 0) {
          additional.push(entry);
          count++;
          if (count >= batchSize) break;
          continue;
        }

        const { matches } = scoreHistoryEntry(entry, q, caseSensitive, fuzzyMatch);
        if (matches) {
          additional.push(entry);
          count++;
        }

        if (count >= batchSize) break;
      }

      if (additional.length < batchSize) {
        setHasMore(false);
      }

      allEntriesRef.current = [...allEntriesRef.current, ...additional];
      setResults((prev) => [...prev, ...additional]);
    } finally {
      setIsLoading(false);
    }
  }, [hasMore, isLoading, caseSensitive, fuzzyMatch]);

  useEffect(() => {
    if (!isSearching) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void performSearch(query);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, isSearching, debounceMs, performSearch]);

  const startSearch = useCallback(() => {
    setIsSearching(true);
    setQueryState('');
    setResults([]);
    setSelectedIndexState(0);
    seenPromptsRef.current.clear();
  }, []);

  const cancelSearch = useCallback(() => {
    setIsSearching(false);
    setQueryState('');
    setResults([]);
    setSelectedIndexState(0);
    setHasMore(false);
    setTotalMatches(0);
    allEntriesRef.current = [];

    if (loadMoreRef.current) {
      void loadMoreRef.current.return(undefined);
      loadMoreRef.current = null;
    }

    onCancel?.();
  }, [onCancel]);

  const acceptMatch = useCallback((): HistoryEntry | undefined => {
    if (results.length === 0) return undefined;
    const entry = results[selectedIndex];
    if (entry) {
      onAccept?.(entry);
    }
    cancelSearch();
    return entry;
  }, [results, selectedIndex, onAccept, cancelSearch]);

  const navigateNext = useCallback(() => {
    setSelectedIndexState((prev) => {
      if (prev < results.length - 1) return prev + 1;
      if (hasMore && !isLoading) {
        void loadMoreResults();
      }
      return prev;
    });
  }, [results.length, hasMore, isLoading, loadMoreResults]);

  const navigatePrev = useCallback(() => {
    setSelectedIndexState((prev) => Math.max(0, prev - 1));
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isSearching) return;

    switch (e.key) {
      case 'escape':
        e.preventDefault();
        cancelSearch();
        break;
      case 'return':
        e.preventDefault();
        acceptMatch();
        break;
      case 'down':
        e.preventDefault();
        navigateNext();
        break;
      case 'up':
        e.preventDefault();
        navigatePrev();
        break;
      case 'tab':
        e.preventDefault();
        if (e.shift) {
          navigatePrev();
        } else {
          navigateNext();
        }
        break;
    }
  }, [isSearching, cancelSearch, acceptMatch, navigateNext, navigatePrev]);

  useKeybinding('history:search', startSearch, {
    context: 'Global',
    isActive: !isSearching,
  });

  const historySearchHandlers = useMemo(() => ({
    'historySearch:next': navigateNext,
    'historySearch:prev': navigatePrev,
    'historySearch:accept': acceptMatch,
    'historySearch:cancel': cancelSearch,
  }), [navigateNext, navigatePrev, acceptMatch, cancelSearch]);

  useKeybindings(historySearchHandlers, {
    context: 'HistorySearch',
    isActive: isSearching,
  });

  useInput(
    (_input, _key, event) => {
      handleKeyDown(new KeyboardEvent(event.keypress));
    },
    { isActive: isSearching },
  );

  const state: HistorySearchState = {
    isSearching,
    query,
    results,
    selectedIndex,
    isLoading,
    hasMore,
    totalMatches,
  };

  return {
    state,
    setQuery,
    setSelectedIndex,
    startSearch,
    cancelSearch,
    acceptMatch,
    navigateNext,
    navigatePrev,
    handleKeyDown,
  };
}
