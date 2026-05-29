/**
 * Transcript Search Utility
 *
 * Provides fuzzy and exact search over session transcript files (JSONL).
 * Transcripts are line-delimited JSON entries stored at
 * .pakalon/sessions/<sessionId>.jsonl or in project-specific directories.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

import type { SessionEntryType } from '../session/types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface TranscriptEntry {
  type: SessionEntryType | string;
  timestamp?: string;
  sessionId?: string;
  content?: string;
  display?: string;
  [key: string]: unknown;
}

export interface TranscriptSearchResult {
  entry: TranscriptEntry;
  matchPosition: number;
  matchType: 'exact' | 'fuzzy' | 'subsequence';
  lineNumber: number;
  sessionId: string;
  transcriptPath: string;
}

export interface TranscriptSearchOptions {
  /** Maximum number of results to return (default: 50) */
  limit?: number;
  /** Case-sensitive search (default: false) */
  caseSensitive?: boolean;
  /** Only search entries of these types */
  entryTypes?: SessionEntryType[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Maximum file size to read in bytes (default: 50MB) */
  maxFileSize?: number;
}

export interface TranscriptSearchStats {
  filesScanned: number;
  totalEntries: number;
  matchedEntries: number;
  searchDurationMs: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const TRANSCRIPT_TYPES_WITH_CONTENT: Set<string> = new Set([
  'user',
  'assistant',
  'system',
  'attachment',
  'summary',
  'last-prompt',
]);

// ──────────────────────────────────────────────────────────────────────────────
// Path Resolution
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get the default session directory
 */
export function getSessionDir(): string {
  return path.join(process.cwd(), '.pakalon', 'sessions');
}

/**
 * Get the projects directory for cross-project sessions
 */
export function getProjectsDir(): string {
  const configHome = process.env.PAKALON_CONFIG_DIR ?? path.join(os.homedir(), '.pakalon');
  return path.join(configHome, 'projects');
}

/**
 * Resolve all transcript file paths to search
 */
export async function resolveTranscriptPaths(options?: {
  sessionIds?: string[];
  projectDir?: string;
}): Promise<string[]> {
  const paths: string[] = [];

  if (options?.sessionIds?.length) {
    for (const sessionId of options.sessionIds) {
      const cwdPath = path.join(getSessionDir(), `${sessionId}.jsonl`);
      if (fsSync.existsSync(cwdPath)) {
        paths.push(cwdPath);
      }

      if (options.projectDir) {
        const sanitized = options.projectDir.replace(/[^a-zA-Z0-9._-]/g, '_');
        const projectPath = path.join(getProjectsDir(), sanitized, `${sessionId}.jsonl`);
        if (fsSync.existsSync(projectPath)) {
          paths.push(projectPath);
        }
      }
    }
    return paths;
  }

  const sessionDir = getSessionDir();
  if (fsSync.existsSync(sessionDir)) {
    const files = await fs.readdir(sessionDir);
    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        paths.push(path.join(sessionDir, file));
      }
    }
  }

  const projectsDir = getProjectsDir();
  if (fsSync.existsSync(projectsDir)) {
    const projectDirs = await fs.readdir(projectsDir);
    for (const projDir of projectDirs) {
      const fullProjPath = path.join(projectsDir, projDir);
      if (fsSync.statSync(fullProjPath).isDirectory()) {
        const projFiles = await fs.readdir(fullProjPath);
        for (const file of projFiles) {
          if (file.endsWith('.jsonl')) {
            paths.push(path.join(fullProjPath, file));
          }
        }
      }
    }
  }

  return paths;
}

// ──────────────────────────────────────────────────────────────────────────────
// Entry Extraction
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extract searchable text from a transcript entry
 */
export function extractSearchableText(entry: TranscriptEntry): string {
  if (entry.display) return entry.display;

  if (typeof entry.content === 'string') return entry.content;

  if (Array.isArray(entry.content)) {
    return (entry.content as Array<unknown>)
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as Record<string, unknown>).text ?? '');
        }
        return '';
      })
      .join('\n');
  }

  if (entry.type === 'custom-title' && 'customTitle' in entry) {
    return String(entry.customTitle ?? '');
  }

  if (entry.type === 'ai-title' && 'aiTitle' in entry) {
    return String(entry.aiTitle ?? '');
  }

  if (entry.type === 'last-prompt' && 'lastPrompt' in entry) {
    return String(entry.lastPrompt ?? '');
  }

  if (entry.type === 'tag' && 'tag' in entry) {
    return String(entry.tag ?? '');
  }

  return '';
}

/**
 * Parse a single JSONL line into a TranscriptEntry
 */
export function parseTranscriptLine(line: string): TranscriptEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as TranscriptEntry;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Matching Algorithms
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Check if query is a subsequence of text (characters appear in order, not necessarily contiguous)
 */
export function isSubsequence(text: string, query: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/**
 * Find the first position where query appears in text
 */
export function findMatchPosition(text: string, query: string, caseSensitive: boolean): number {
  const searchText = caseSensitive ? text : text.toLowerCase();
  const searchQuery = caseSensitive ? query : query.toLowerCase();
  return searchText.indexOf(searchQuery);
}

/**
 * Score a match for ranking purposes
 */
export function scoreMatch(
  text: string,
  query: string,
  matchType: 'exact' | 'fuzzy' | 'subsequence',
  matchPosition: number,
): number {
  const score: Record<string, number> = { exact: 100, fuzzy: 50, subsequence: 10 };
  let base = score[matchType] ?? 0;

  if (matchPosition === 0) base += 20;
  if (text.toLowerCase().startsWith(query.toLowerCase())) base += 10;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  let occurrences = 0;
  let idx = textLower.indexOf(queryLower);
  while (idx !== -1) {
    occurrences++;
    idx = textLower.indexOf(queryLower, idx + 1);
  }
  base += Math.min(occurrences * 5, 20);

  return base;
}

// ──────────────────────────────────────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Search a single transcript file for matching entries
 */
export async function searchTranscriptFile(
  transcriptPath: string,
  query: string,
  options: TranscriptSearchOptions = {},
): Promise<{ results: TranscriptSearchResult[]; stats: { entriesScanned: number } }> {
  const {
    limit = DEFAULT_LIMIT,
    caseSensitive = false,
    entryTypes,
    signal,
    maxFileSize = MAX_FILE_SIZE,
  } = options;

  const results: TranscriptSearchResult[] = [];
  let entriesScanned = 0;

  if (!fsSync.existsSync(transcriptPath)) {
    return { results, stats: { entriesScanned } };
  }

  const stat = fsSync.statSync(transcriptPath);
  if (stat.size > maxFileSize) {
    return { results, stats: { entriesScanned } };
  }

  const content = await fs.readFile(transcriptPath, 'utf-8');
  const lines = content.split('\n');

  const sessionId = path.basename(transcriptPath, '.jsonl');
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    if (signal?.aborted) break;
    if (results.length >= limit) break;

    const entry = parseTranscriptLine(lines[lineNumber]!);
    if (!entry) continue;

    if (entryTypes && entryTypes.length > 0 && !entryTypes.includes(entry.type as SessionEntryType)) {
      continue;
    }

    const text = extractSearchableText(entry);
    if (!text) continue;

    entriesScanned++;

    const compareText = caseSensitive ? text : text.toLowerCase();
    const matchPos = compareText.indexOf(searchQuery);

    let matchType: 'exact' | 'fuzzy' | 'subsequence' | null = null;

    if (matchPos !== -1) {
      matchType = 'exact';
    } else if (text.toLowerCase().includes(searchQuery)) {
      matchType = 'fuzzy';
    } else if (isSubsequence(compareText, searchQuery)) {
      matchType = 'subsequence';
    }

    if (matchType) {
      const effectivePos = matchPos !== -1 ? matchPos : findMatchPosition(text, query, caseSensitive);
      results.push({
        entry,
        matchPosition: effectivePos !== -1 ? effectivePos : 0,
        matchType,
        lineNumber,
        sessionId,
        transcriptPath,
      });
    }
  }

  return { results, stats: { entriesScanned } };
}

/**
 * Search across all transcript files
 */
export async function searchTranscripts(
  query: string,
  options: TranscriptSearchOptions = {},
): Promise<{
  results: TranscriptSearchResult[];
  stats: TranscriptSearchStats;
}> {
  const startTime = Date.now();

  if (!query.trim()) {
    return { results: [], stats: { filesScanned: 0, totalEntries: 0, matchedEntries: 0, searchDurationMs: 0 } };
  }

  const paths = await resolveTranscriptPaths({
    sessionIds: options.signal ? undefined : undefined,
  });

  const allResults: TranscriptSearchResult[] = [];
  let totalEntries = 0;
  let filesScanned = 0;

  for (const transcriptPath of paths) {
    if (options.signal?.aborted) break;

    const { results, stats } = await searchTranscriptFile(transcriptPath, query, options);
    filesScanned++;
    totalEntries += stats.entriesScanned;
    allResults.push(...results);
  }

  allResults.sort((a, b) => {
    const scoreA = scoreMatch(
      extractSearchableText(a.entry),
      query,
      a.matchType,
      a.matchPosition,
    );
    const scoreB = scoreMatch(
      extractSearchableText(b.entry),
      query,
      b.matchType,
      b.matchPosition,
    );
    return scoreB - scoreA;
  });

  const limitedResults = allResults.slice(0, options.limit ?? DEFAULT_LIMIT);

  return {
    results: limitedResults,
    stats: {
      filesScanned,
      totalEntries,
      matchedEntries: limitedResults.length,
      searchDurationMs: Date.now() - startTime,
    },
  };
}

/**
 * Search within a specific session's transcript
 */
export async function searchSessionTranscript(
  sessionId: string,
  query: string,
  options: TranscriptSearchOptions = {},
): Promise<{
  results: TranscriptSearchResult[];
  stats: TranscriptSearchStats;
}> {
  const startTime = Date.now();

  if (!query.trim()) {
    return { results: [], stats: { filesScanned: 0, totalEntries: 0, matchedEntries: 0, searchDurationMs: 0 } };
  }

  const paths = await resolveTranscriptPaths({ sessionIds: [sessionId] });

  if (paths.length === 0) {
    return {
      results: [],
      stats: { filesScanned: 0, totalEntries: 0, matchedEntries: 0, searchDurationMs: 0 },
    };
  }

  const allResults: TranscriptSearchResult[] = [];
  let totalEntries = 0;

  for (const transcriptPath of paths) {
    if (options.signal?.aborted) break;

    const { results, stats } = await searchTranscriptFile(transcriptPath, query, options);
    totalEntries += stats.entriesScanned;
    allResults.push(...results);
  }

  allResults.sort((a, b) => {
    const scoreA = scoreMatch(
      extractSearchableText(a.entry),
      query,
      a.matchType,
      a.matchPosition,
    );
    const scoreB = scoreMatch(
      extractSearchableText(b.entry),
      query,
      b.matchType,
      b.matchPosition,
    );
    return scoreB - scoreA;
  });

  return {
    results: allResults.slice(0, options.limit ?? DEFAULT_LIMIT),
    stats: {
      filesScanned: paths.length,
      totalEntries,
      matchedEntries: Math.min(allResults.length, options.limit ?? DEFAULT_LIMIT),
      searchDurationMs: Date.now() - startTime,
    },
  };
}

/**
 * Read transcript entries as an async generator (reverse order, newest first)
 */
export async function* readTranscriptReverse(
  transcriptPath: string,
  options?: { signal?: AbortSignal; maxBytes?: number },
): AsyncGenerator<TranscriptEntry> {
  if (!fsSync.existsSync(transcriptPath)) return;

  const maxBytes = options?.maxBytes ?? MAX_FILE_SIZE;
  const stat = fsSync.statSync(transcriptPath);
  if (stat.size > maxBytes) return;

  const content = await fs.readFile(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());

  for (let i = lines.length - 1; i >= 0; i--) {
    if (options?.signal?.aborted) return;

    const entry = parseTranscriptLine(lines[i]!);
    if (entry) {
      yield entry;
    }
  }
}

/**
 * Get transcript content for a session (all entries)
 */
export async function getTranscriptEntries(
  sessionId: string,
  options?: { projectDir?: string; signal?: AbortSignal },
): Promise<TranscriptEntry[]> {
  const paths = await resolveTranscriptPaths({
    sessionIds: [sessionId],
    projectDir: options?.projectDir,
  });

  if (paths.length === 0) return [];

  const entries: TranscriptEntry[] = [];
  for (const transcriptPath of paths) {
    if (options?.signal?.aborted) break;

    const content = await fs.readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const entry = parseTranscriptLine(line);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

/**
 * Highlight matched text with ANSI escape codes
 */
export function highlightMatch(text: string, query: string, colorCode = '\x1b[32m'): string {
  if (!query) return text;

  const resetCode = '\x1b[0m';
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const parts: string[] = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQuery);

  while (idx !== -1) {
    parts.push(text.slice(lastIndex, idx));
    parts.push(`${colorCode}${text.slice(idx, idx + query.length)}${resetCode}`);
    lastIndex = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }

  parts.push(text.slice(lastIndex));
  return parts.join('');
}
