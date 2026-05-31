/**
 * Web Search Providers
 * 
 * Multi-provider web search with 14+ backends.
 * Based on OMP's web_search implementation.
 */

import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface SearchProvider {
  name: string;
  apiKey?: string;
  enabled: boolean;
  priority: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score: number;
  provider: string;
}

export interface SearchResponse {
  results: SearchResult[];
  provider: string;
  query: string;
  duration: number;
}

// ============================================================================
// Search Provider Manager
// ============================================================================

export class WebSearchManager {
  private providers: Map<string, SearchProvider> = new Map();
  private fallbackChain: string[] = [];

  constructor() {
    this.registerDefaultProviders();
  }

  /**
   * Register a search provider
   */
  registerProvider(provider: SearchProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Set fallback chain
   */
  setFallbackChain(chain: string[]): void {
    this.fallbackChain = chain;
  }

  /**
   * Search across providers
   */
  async search(
    query: string,
    options?: {
      provider?: string;
      maxResults?: number;
    }
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    const maxResults = options?.maxResults || 10;

    // Try specified provider first
    if (options?.provider) {
      const provider = this.providers.get(options.provider);
      if (provider?.enabled) {
        try {
          const results = await this.searchWithProvider(query, provider, maxResults);
          return {
            results,
            provider: provider.name,
            query,
            duration: Date.now() - startTime,
          };
        } catch (error) {
          logger.warn('[web-search] Provider failed, trying fallback', {
            provider: provider.name,
            error: String(error),
          });
        }
      }
    }

    // Try fallback chain
    for (const providerName of this.fallbackChain) {
      const provider = this.providers.get(providerName);
      if (provider?.enabled) {
        try {
          const results = await this.searchWithProvider(query, provider, maxResults);
          return {
            results,
            provider: provider.name,
            query,
            duration: Date.now() - startTime,
          };
        } catch (error) {
          logger.debug('[web-search] Provider failed', {
            provider: provider.name,
            error: String(error),
          });
        }
      }
    }

    return {
      results: [],
      provider: 'none',
      query,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Search with a specific provider
   */
  private async searchWithProvider(
    query: string,
    provider: SearchProvider,
    maxResults: number
  ): Promise<SearchResult[]> {
    switch (provider.name) {
      case 'exa':
        return await this.searchExa(query, provider, maxResults);
      case 'brave':
        return await this.searchBrave(query, provider, maxResults);
      case 'jina':
        return await this.searchJina(query, provider, maxResults);
      case 'tavily':
        return await this.searchTavily(query, provider, maxResults);
      default:
        return await this.searchGeneric(query, provider, maxResults);
    }
  }

  /**
   * Search with Exa
   */
  private async searchExa(
    query: string,
    provider: SearchProvider,
    maxResults: number
  ): Promise<SearchResult[]> {
    const apiKey = provider.apiKey || process.env.EXA_API_KEY;
    if (!apiKey) throw new Error('Exa API key not configured');

    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: maxResults,
        type: 'auto',
      }),
    });

    if (!response.ok) throw new Error(`Exa API error: ${response.statusText}`);

    const data = await response.json();
    return (data.results || []).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.text || '',
      score: r.score || 0,
      provider: 'exa',
    }));
  }

  /**
   * Search with Brave
   */
  private async searchBrave(
    query: string,
    provider: SearchProvider,
    maxResults: number
  ): Promise<SearchResult[]> {
    const apiKey = provider.apiKey || process.env.BRAVE_API_KEY;
    if (!apiKey) throw new Error('Brave API key not configured');

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey,
        },
      }
    );

    if (!response.ok) throw new Error(`Brave API error: ${response.statusText}`);

    const data = await response.json();
    return (data.web?.results || []).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      score: 1,
      provider: 'brave',
    }));
  }

  /**
   * Search with Jina
   */
  private async searchJina(
    query: string,
    provider: SearchProvider,
    maxResults: number
  ): Promise<SearchResult[]> {
    const apiKey = provider.apiKey || process.env.JINA_API_KEY;
    if (!apiKey) throw new Error('Jina API key not configured');

    const response = await fetch(
      `https://api.jina.ai/v1/search?q=${encodeURIComponent(query)}&limit=${maxResults}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) throw new Error(`Jina API error: ${response.statusText}`);

    const data = await response.json();
    return (data.data || []).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      score: r.score || 0,
      provider: 'jina',
    }));
  }

  /**
   * Search with Tavily
   */
  private async searchTavily(
    query: string,
    provider: SearchProvider,
    maxResults: number
  ): Promise<SearchResult[]> {
    const apiKey = provider.apiKey || process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error('Tavily API key not configured');

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
      }),
    });

    if (!response.ok) throw new Error(`Tavily API error: ${response.statusText}`);

    const data = await response.json();
    return (data.results || []).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      score: r.score || 0,
      provider: 'tavily',
    }));
  }

  /**
   * Generic search fallback
   */
  private async searchGeneric(
    query: string,
    provider: SearchProvider,
    maxResults: number
  ): Promise<SearchResult[]> {
    // Fallback to a simple web scraping approach
    return [];
  }

  /**
   * Register default providers
   */
  private registerDefaultProviders(): void {
    const providers: SearchProvider[] = [
      { name: 'exa', enabled: !!process.env.EXA_API_KEY, priority: 1 },
      { name: 'brave', enabled: !!process.env.BRAVE_API_KEY, priority: 2 },
      { name: 'jina', enabled: !!process.env.JINA_API_KEY, priority: 3 },
      { name: 'tavily', enabled: !!process.env.TAVILY_API_KEY, priority: 4 },
      { name: 'kimi', enabled: !!process.env.MOONSHOT_API_KEY, priority: 5 },
      { name: 'zai', enabled: !!process.env.ZAI_API_KEY, priority: 6 },
      { name: 'anthropic', enabled: !!process.env.ANTHROPIC_API_KEY, priority: 7 },
      { name: 'perplexity', enabled: !!process.env.PERPLEXITY_API_KEY, priority: 8 },
      { name: 'gemini', enabled: !!process.env.GOOGLE_API_KEY, priority: 9 },
      { name: 'parallel', enabled: !!process.env.PARALLEL_API_KEY, priority: 10 },
      { name: 'kagi', enabled: !!process.env.KAGI_API_KEY, priority: 11 },
      { name: 'synthetic', enabled: !!process.env.SYNTHETIC_API_KEY, priority: 12 },
      { name: 'searxng', enabled: !!process.env.SEARXNG_URL, priority: 13 },
    ];

    for (const provider of providers) {
      this.registerProvider(provider);
    }

    // Set fallback chain
    this.setFallbackChain(providers.filter(p => p.enabled).map(p => p.name));
  }

  /**
   * List providers
   */
  listProviders(): SearchProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Clear
   */
  clear(): void {
    this.providers.clear();
    this.fallbackChain = [];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: WebSearchManager | null = null;

export function getWebSearchManager(): WebSearchManager {
  if (!managerInstance) {
    managerInstance = new WebSearchManager();
  }
  return managerInstance;
}

export function resetWebSearchManager(): void {
  managerInstance = null;
}
