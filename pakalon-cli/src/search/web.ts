/**
 * Web search — fetch to Brave/DuckDuckGo APIs.
 * No Python bridge dependency.
 */
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchOptions {
  query: string;
  maxResults?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  count: number;
  source: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// DuckDuckGo Search (HTML scrape, no API key needed)
// ---------------------------------------------------------------------------

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodedQuery}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PakalonCLI/0.1.0)",
        },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) return [];

    const html = await response.text();
    const results: SearchResult[] = [];

    // Parse DuckDuckGo HTML results
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);

    $(".result").each((_i, el) => {
      if (results.length >= maxResults) return;

      const titleEl = $(el).find(".result__title a");
      const snippetEl = $(el).find(".result__snippet");
      const url = titleEl.attr("href") ?? "";
      const title = titleEl.text().trim();
      const snippet = snippetEl.text().trim();

      if (title && url) {
        // DuckDuckGo wraps URLs in a redirect — extract the actual URL
        let actualUrl = url;
        try {
          const urlObj = new URL(url, "https://duckduckgo.com");
          const ddgUrl = urlObj.searchParams.get("uddg");
          if (ddgUrl) actualUrl = ddgUrl;
        } catch { /* keep original */ }

        results.push({ title, url: actualUrl, snippet });
      }
    });

    return results;
  } catch (err) {
    logger.warn("[search] DuckDuckGo search failed", { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Brave Search (requires BRAVE_API_KEY)
// ---------------------------------------------------------------------------

async function searchBrave(query: string, maxResults: number): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];

  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${maxResults}`,
      {
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      logger.warn("[search] Brave API returned", { status: response.status });
      return [];
    }

    const data = await response.json() as any;
    const results: SearchResult[] = [];

    for (const item of data.web?.results ?? []) {
      if (results.length >= maxResults) break;
      results.push({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.description ?? "",
      });
    }

    return results;
  } catch (err) {
    logger.warn("[search] Brave search failed", { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main Search Function
// ---------------------------------------------------------------------------

/**
 * Search the web using Brave API (preferred) or DuckDuckGo (fallback).
 */
export async function webSearch(options: SearchOptions): Promise<SearchResponse> {
  const { query, maxResults = 8 } = options;

  if (!query?.trim()) {
    return {
      success: false,
      query,
      results: [],
      count: 0,
      source: "none",
      error: "Search query is required",
    };
  }

  // Try Brave first (better quality results)
  let results = await searchBrave(query, maxResults);
  let source = "brave";

  // Fall back to DuckDuckGo
  if (results.length === 0) {
    results = await searchDuckDuckGo(query, maxResults);
    source = "duckduckgo";
  }

  return {
    success: results.length > 0,
    query,
    results,
    count: results.length,
    source,
    error: results.length === 0 ? "No results found" : undefined,
  };
}
