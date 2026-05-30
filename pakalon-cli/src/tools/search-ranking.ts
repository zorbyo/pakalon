/**
 * Search Result Ranking
 * Ranks web search results by relevance and quality
 */

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  score?: number;
  rank?: number;
}

export interface RankingOptions {
  query: string;
  boostFreshness?: boolean;
  boostDomain?: string[];
  penalizeDomain?: string[];
  maxResults?: number;
}

/**
 * Calculate relevance score for a search result
 */
function calculateRelevanceScore(result: SearchResult, options: RankingOptions): number {
  let score = 0;
  const queryLower = options.query.toLowerCase();
  const titleLower = result.title.toLowerCase();
  const snippetLower = result.snippet.toLowerCase();

  // Title relevance (0-30 points)
  const queryWords = queryLower.split(/\s+/);
  const titleMatches = queryWords.filter((word) => titleLower.includes(word)).length;
  score += (titleMatches / queryWords.length) * 30;

  // Snippet relevance (0-20 points)
  const snippetMatches = queryWords.filter((word) => snippetLower.includes(word)).length;
  score += (snippetMatches / queryWords.length) * 20;

  // Exact phrase match bonus (0-15 points)
  if (titleLower.includes(queryLower)) {
    score += 15;
  } else if (snippetLower.includes(queryLower)) {
    score += 10;
  }

  // URL relevance (0-10 points)
  const urlLower = result.url.toLowerCase();
  const urlMatches = queryWords.filter((word) => urlLower.includes(word)).length;
  score += (urlMatches / queryWords.length) * 10;

  // Domain boost (0-15 points)
  if (options.boostDomain) {
    for (const domain of options.boostDomain) {
      if (urlLower.includes(domain.toLowerCase())) {
        score += 15;
        break;
      }
    }
  }

  // Domain penalty (-10 points)
  if (options.penalizeDomain) {
    for (const domain of options.penalizeDomain) {
      if (urlLower.includes(domain.toLowerCase())) {
        score -= 10;
        break;
      }
    }
  }

  // Freshness boost (0-10 points)
  if (options.boostFreshness) {
    // Simple heuristic: URLs with dates in them are assumed to be newer
    if (/\d{4}[-/]\d{2}[-/]\d{2}/.test(urlLower)) {
      score += 10;
    }
  }

  // Snippet length bonus (0-5 points)
  if (result.snippet.length > 100) {
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Rank search results by relevance
 */
export function rankSearchResults(
  results: SearchResult[],
  options: RankingOptions,
): SearchResult[] {
  const maxResults = options.maxResults || results.length;

  const ranked = results
    .map((result) => ({
      ...result,
      score: calculateRelevanceScore(result, options),
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, maxResults)
    .map((result, index) => ({
      ...result,
      rank: index + 1,
    }));

  return ranked;
}

/**
 * Deduplicate search results by URL
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const normalizedUrl = result.url.toLowerCase().replace(/\/$/, '');
    if (seen.has(normalizedUrl)) {
      return false;
    }
    seen.add(normalizedUrl);
    return true;
  });
}

/**
 * Filter results by quality signals
 */
export function filterByQuality(
  results: SearchResult[],
  options: { minScore?: number; excludePatterns?: RegExp[] } = {},
): SearchResult[] {
  const { minScore = 0, excludePatterns = [] } = options;

  return results.filter((result) => {
    // Check minimum score
    if ((result.score || 0) < minScore) {
      return false;
    }

    // Check exclude patterns
    for (const pattern of excludePatterns) {
      if (pattern.test(result.url) || pattern.test(result.title)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Merge results from multiple sources with ranking
 */
export function mergeSearchResults(
  resultSets: SearchResult[][],
  options: RankingOptions,
): SearchResult[] {
  const merged = resultSets.flat();
  const deduplicated = deduplicateResults(merged);
  return rankSearchResults(deduplicated, options);
}
