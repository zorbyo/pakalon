/**
 * WebSearch Streaming
 *
 * Provides real-time search progress updates.
 * Supports:
 * - Streaming search results
 * - Progress callbacks
 * - Result buffering
 * - Error handling
 */

import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebSearchStreamOptions {
  /** Search query */
  query: string;
  /** Allowed domains */
  allowedDomains?: string[];
  /** Blocked domains */
  blockedDomains?: string[];
  /** Maximum results */
  maxResults?: number;
  /** Timeout in ms */
  timeout?: number;
}

export interface WebSearchResult {
  /** Result title */
  title: string;
  /** Result URL */
  url: string;
  /** Result snippet */
  snippet: string;
  /** Result score */
  score?: number;
}

export interface WebSearchProgress {
  /** Progress type */
  type: 'started' | 'querying' | 'results_received' | 'completed' | 'error';
  /** Progress message */
  message: string;
  /** Number of results found so far */
  resultCount?: number;
  /** Current query being processed */
  currentQuery?: string;
  /** Error message (if type is 'error') */
  error?: string;
}

export type WebSearchProgressCallback = (progress: WebSearchProgress) => void;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isSearching = false;
let abortController: AbortController | null = null;

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Perform a web search with streaming progress
 */
export async function webSearchStream(
  options: WebSearchStreamOptions,
  onProgress?: WebSearchProgressCallback,
): Promise<WebSearchResult[]> {
  if (isSearching) {
    throw new Error('A search is already in progress');
  }

  isSearching = true;
  abortController = new AbortController();

  const results: WebSearchResult[] = [];

  try {
    // Notify start
    onProgress?.({
      type: 'started',
      message: `Starting search: ${options.query}`,
    });

    // Build search URL
    const searchUrl = buildSearchUrl(options);

    // Notify querying
    onProgress?.({
      type: 'querying',
      message: `Querying: ${options.query}`,
      currentQuery: options.query,
    });

    // Perform search
    const response = await fetch(searchUrl, {
      signal: abortController.signal,
      headers: {
        'User-Agent': 'Pakalon-CLI/1.0 (AI Agent)',
      },
    });

    if (!response.ok) {
      throw new Error(`Search failed: HTTP ${response.status}`);
    }

    const data = await response.json() as { results?: Array<{ title: string; url: string; snippet: string }> };

    // Process results
    if (data.results) {
      for (const result of data.results) {
        // Check if result matches domain filters
        if (isDomainAllowed(result.url, options.allowedDomains, options.blockedDomains)) {
          results.push({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
          });

          // Notify results received
          onProgress?.({
            type: 'results_received',
            message: `Found result: ${result.title}`,
            resultCount: results.length,
          });
        }
      }
    }

    // Notify completion
    onProgress?.({
      type: 'completed',
      message: `Search completed: ${results.length} results`,
      resultCount: results.length,
    });

    return results;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      onProgress?.({
        type: 'error',
        message: 'Search was cancelled',
        error: 'Cancelled',
      });
      return [];
    }

    const message = error instanceof Error ? error.message : String(error);
    onProgress?.({
      type: 'error',
      message: `Search failed: ${message}`,
      error: message,
    });
    throw error;
  } finally {
    isSearching = false;
    abortController = null;
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Build search URL
 */
function buildSearchUrl(options: WebSearchStreamOptions): string {
  const params = new URLSearchParams();
  params.set('q', options.query);

  if (options.allowedDomains && options.allowedDomains.length > 0) {
    params.set('sites', options.allowedDomains.join(','));
  }

  if (options.maxResults) {
    params.set('num', String(options.maxResults));
  }

  // Use a free search API (e.g., DuckDuckGo, SearXNG)
  return `https://api.duckduckgo.com/?${params.toString()}&format=json`;
}

/**
 * Check if a URL is allowed by domain filters
 */
function isDomainAllowed(
  url: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
): boolean {
  try {
    const hostname = new URL(url).hostname;

    // Check blocked domains
    if (blockedDomains && blockedDomains.length > 0) {
      for (const blocked of blockedDomains) {
        if (hostname.includes(blocked)) {
          return false;
        }
      }
    }

    // Check allowed domains
    if (allowedDomains && allowedDomains.length > 0) {
      for (const allowed of allowedDomains) {
        if (hostname.includes(allowed)) {
          return true;
        }
      }
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Cancel the current search
 */
export function cancelSearch(): void {
  if (abortController) {
    abortController.abort();
    logger.info('[websearch] Search cancelled');
  }
}

/**
 * Check if a search is in progress
 */
export function isSearchInProgress(): boolean {
  return isSearching;
}
