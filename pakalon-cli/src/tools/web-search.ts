/**
 * Web Search Tool for Pakalon CLI
 * 
 * Multi-provider web search capability.
 * Features:
 * - Multiple search providers (Google, Bing, DuckDuckGo)
 * - Rate limiting and caching
 * - Result summarization
 * - Safe search options
 */

import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  position: number;
}

export interface SearchResponse {
  success: boolean;
  provider: string;
  query: string;
  results: SearchResult[];
  totalResults?: number;
  searchTime?: number;
  cached?: boolean;
  error?: string;
}

export type SearchProvider = "google" | "bing" | "duckduckgo" | "brave" | "serp";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RESULTS_COUNT = 10;
const MAX_RESULTS_COUNT = 50;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 30;

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimits: Map<string, RateLimitEntry> = new Map();

function checkRateLimit(provider: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(provider);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(provider, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }

  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

interface CacheEntry {
  response: SearchResponse;
  timestamp: number;
}

const searchCache: Map<string, CacheEntry> = new Map();

function getCacheKey(query: string, provider: string, count: number): string {
  return `${provider}:${count}:${query.toLowerCase().trim()}`;
}

function getCachedResults(key: string): SearchResponse | null {
  const entry = searchCache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }

  return { ...entry.response, cached: true };
}

function setCachedResults(key: string, response: SearchResponse): void {
  searchCache.set(key, {
    response,
    timestamp: Date.now(),
  });

  // Clean up old cache entries periodically
  if (searchCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of searchCache.entries()) {
      if (now - v.timestamp > CACHE_TTL_MS) {
        searchCache.delete(k);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Provider Implementations
// ---------------------------------------------------------------------------

/**
 * DuckDuckGo Search (no API key required)
 * Uses the lite HTML version for scraping
 */
async function searchDuckDuckGo(
  query: string,
  count: number
): Promise<SearchResponse> {
  const startTime = Date.now();

  try {
    // DuckDuckGo lite HTML API
    const searchUrl = new URL("https://lite.duckduckgo.com/lite/");
    searchUrl.searchParams.set("q", query);

    const response = await fetch(searchUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Pakalon-CLI/1.0)",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        provider: "duckduckgo",
        query,
        results: [],
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const html = await response.text();
    const results = parseDuckDuckGoResults(html, count);

    return {
      success: true,
      provider: "duckduckgo",
      query,
      results,
      searchTime: Date.now() - startTime,
    };
  } catch (error) {
    logger.error(`[web-search] DuckDuckGo error: ${error}`);
    return {
      success: false,
      provider: "duckduckgo",
      query,
      results: [],
      error: String(error),
    };
  }
}

function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Simple regex-based parsing of DuckDuckGo lite results
  // Format: <a rel="nofollow" class="result-link" href="...">title</a>
  // <span class="result-snippet">snippet</span>
  
  const linkRegex = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  const snippetRegex = /<span[^>]*class="result-snippet"[^>]*>([^<]*)<\/span>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push({
      url: match[1]!,
      title: match[2]!.trim(),
    });
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(match[1]!.trim());
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i]!.title,
      url: links[i]!.url,
      snippet: snippets[i] ?? "",
      source: "duckduckgo",
      position: i + 1,
    });
  }

  return results;
}

/**
 * Google Search (requires API key)
 */
async function searchGoogle(
  query: string,
  count: number,
  apiKey?: string,
  searchEngineId?: string
): Promise<SearchResponse> {
  if (!apiKey || !searchEngineId) {
    return {
      success: false,
      provider: "google",
      query,
      results: [],
      error: "Google API key and Search Engine ID required. Set GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables.",
    };
  }

  const startTime = Date.now();

  try {
    const searchUrl = new URL("https://www.googleapis.com/customsearch/v1");
    searchUrl.searchParams.set("key", apiKey);
    searchUrl.searchParams.set("cx", searchEngineId);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("num", String(Math.min(count, 10)));

    const response = await fetch(searchUrl.toString());

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        provider: "google",
        query,
        results: [],
        error: `Google API error: ${error}`,
      };
    }

    const data = await response.json() as {
      items?: Array<{
        title: string;
        link: string;
        snippet?: string;
      }>;
      searchInformation?: {
        totalResults?: string;
      };
    };

    const results: SearchResult[] = (data.items ?? []).map((item, i) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet ?? "",
      source: "google",
      position: i + 1,
    }));

    return {
      success: true,
      provider: "google",
      query,
      results,
      totalResults: data.searchInformation?.totalResults 
        ? parseInt(data.searchInformation.totalResults, 10)
        : undefined,
      searchTime: Date.now() - startTime,
    };
  } catch (error) {
    logger.error(`[web-search] Google error: ${error}`);
    return {
      success: false,
      provider: "google",
      query,
      results: [],
      error: String(error),
    };
  }
}

/**
 * Bing Search (requires API key)
 */
async function searchBing(
  query: string,
  count: number,
  apiKey?: string
): Promise<SearchResponse> {
  if (!apiKey) {
    return {
      success: false,
      provider: "bing",
      query,
      results: [],
      error: "Bing API key required. Set BING_API_KEY environment variable.",
    };
  }

  const startTime = Date.now();

  try {
    const searchUrl = new URL("https://api.bing.microsoft.com/v7.0/search");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("count", String(Math.min(count, 50)));

    const response = await fetch(searchUrl.toString(), {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        provider: "bing",
        query,
        results: [],
        error: `Bing API error: ${error}`,
      };
    }

    const data = await response.json() as {
      webPages?: {
        value?: Array<{
          name: string;
          url: string;
          snippet?: string;
        }>;
        totalEstimatedMatches?: number;
      };
    };

    const results: SearchResult[] = (data.webPages?.value ?? []).map((item, i) => ({
      title: item.name,
      url: item.url,
      snippet: item.snippet ?? "",
      source: "bing",
      position: i + 1,
    }));

    return {
      success: true,
      provider: "bing",
      query,
      results,
      totalResults: data.webPages?.totalEstimatedMatches,
      searchTime: Date.now() - startTime,
    };
  } catch (error) {
    logger.error(`[web-search] Bing error: ${error}`);
    return {
      success: false,
      provider: "bing",
      query,
      results: [],
      error: String(error),
    };
  }
}

/**
 * Brave Search (requires API key)
 */
async function searchBrave(
  query: string,
  count: number,
  apiKey?: string
): Promise<SearchResponse> {
  if (!apiKey) {
    return {
      success: false,
      provider: "brave",
      query,
      results: [],
      error: "Brave API key required. Set BRAVE_API_KEY environment variable.",
    };
  }

  const startTime = Date.now();

  try {
    const searchUrl = new URL("https://api.search.brave.com/res/v1/web/search");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("count", String(Math.min(count, 20)));

    const response = await fetch(searchUrl.toString(), {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        provider: "brave",
        query,
        results: [],
        error: `Brave API error: ${error}`,
      };
    }

    const data = await response.json() as {
      web?: {
        results?: Array<{
          title: string;
          url: string;
          description?: string;
        }>;
      };
    };

    const results: SearchResult[] = (data.web?.results ?? []).map((item, i) => ({
      title: item.title,
      url: item.url,
      snippet: item.description ?? "",
      source: "brave",
      position: i + 1,
    }));

    return {
      success: true,
      provider: "brave",
      query,
      results,
      searchTime: Date.now() - startTime,
    };
  } catch (error) {
    logger.error(`[web-search] Brave error: ${error}`);
    return {
      success: false,
      provider: "brave",
      query,
      results: [],
      error: String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Main Search Function
// ---------------------------------------------------------------------------

export async function webSearch(
  query: string,
  options: {
    provider?: SearchProvider;
    count?: number;
    apiKey?: string;
    searchEngineId?: string;
  } = {}
): Promise<SearchResponse> {
  const {
    provider = "duckduckgo",
    count = DEFAULT_RESULTS_COUNT,
    apiKey,
    searchEngineId,
  } = options;

  const effectiveCount = Math.min(count, MAX_RESULTS_COUNT);

  // Check cache first
  const cacheKey = getCacheKey(query, provider, effectiveCount);
  const cached = getCachedResults(cacheKey);
  if (cached) {
    logger.debug(`[web-search] Cache hit for: ${query}`);
    return cached;
  }

  // Check rate limit
  if (!checkRateLimit(provider)) {
    return {
      success: false,
      provider,
      query,
      results: [],
      error: "Rate limit exceeded. Please wait a moment.",
    };
  }

  logger.debug(`[web-search] Searching ${provider} for: ${query}`);

  let response: SearchResponse;

  switch (provider) {
    case "google":
      response = await searchGoogle(
        query,
        effectiveCount,
        apiKey ?? process.env.GOOGLE_API_KEY,
        searchEngineId ?? process.env.GOOGLE_SEARCH_ENGINE_ID
      );
      break;

    case "bing":
      response = await searchBing(
        query,
        effectiveCount,
        apiKey ?? process.env.BING_API_KEY
      );
      break;

    case "brave":
      response = await searchBrave(
        query,
        effectiveCount,
        apiKey ?? process.env.BRAVE_API_KEY
      );
      break;

    case "duckduckgo":
    default:
      response = await searchDuckDuckGo(query, effectiveCount);
      break;
  }

  // Cache successful results
  if (response.success && response.results.length > 0) {
    setCachedResults(cacheKey, response);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const webSearchSchema = z.object({
  query: z.string().describe("Search query"),
  provider: z.enum(["google", "bing", "duckduckgo", "brave"]).optional()
    .default("duckduckgo")
    .describe("Search provider to use"),
  count: z.number().min(1).max(50).optional()
    .default(10)
    .describe("Number of results to return"),
});

export type WebSearchInput = z.infer<typeof webSearchSchema>;

export const webSearchToolDefinition = {
  name: "web_search",
  description: "Search the web using multiple providers (Google, Bing, DuckDuckGo, Brave)",
  inputSchema: webSearchSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input: WebSearchInput): Promise<SearchResponse> {
    const { query, provider, count } = input;
    return webSearch(query, { provider, count });
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  webSearch,
  webSearchSchema,
  webSearchToolDefinition,
};
