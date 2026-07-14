import { Log } from "../util/log"

const log = Log.create({ service: "integration:firecrawl" })

export interface ScrapeResult {
  url: string
  title: string
  content: string
  markdown: string
  metadata: {
    title?: string
    description?: string
    language?: string
    keywords?: string[]
  }
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  markdown?: string
}

export interface CrawlResult {
  url: string
  pages: ScrapeResult[]
  totalPages: number
  errors: string[]
}

const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev"

export namespace Firecrawl {
  export async function scrape(url: string): Promise<ScrapeResult> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      log.warn("FIRECRAWL_API_KEY not set, using mock data")
      return generateMockScrape(url)
    }

    try {
      log.info("scraping URL", { url })

      const response = await fetch(`${FIRECRAWL_API_URL}/v1/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["markdown", "html"],
        }),
      })

      if (!response.ok) {
        throw new Error(`Firecrawl scrape failed: ${response.statusText}`)
      }

      const data = (await response.json()) as {
        success: boolean
        data: {
          title?: string
          markdown?: string
          html?: string
          metadata?: Record<string, unknown>
        }
      }

      return {
        url,
        title: data.data.title ?? "Untitled",
        content: data.data.html ?? "",
        markdown: data.data.markdown ?? "",
        metadata: {
          title: data.data.title,
          description: data.data.metadata?.description as string,
          language: data.data.metadata?.language as string,
          keywords: data.data.metadata?.keywords as string[],
        },
      }
    } catch (err) {
      log.error("scrape failed", { url, error: err })
      return generateMockScrape(url)
    }
  }

  export async function search(query: string, limit: number = 5): Promise<SearchResult[]> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      log.warn("FIRECRAWL_API_KEY not set, using mock results")
      return generateMockSearch(query)
    }

    try {
      log.info("searching", { query, limit })

      const response = await fetch(`${FIRECRAWL_API_URL}/v1/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          limit,
          scrapeOptions: {
            formats: ["markdown"],
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`Firecrawl search failed: ${response.statusText}`)
      }

      const data = (await response.json()) as {
        success: boolean
        data: Array<{
          title?: string
          url: string
          markdown?: string
          metadata?: Record<string, unknown>
        }>
      }

      return data.data.map((item) => ({
        title: item.title ?? "Untitled",
        url: item.url,
        snippet: item.markdown?.slice(0, 200) ?? "",
        markdown: item.markdown,
      }))
    } catch (err) {
      log.error("search failed", { query, error: err })
      return generateMockSearch(query)
    }
  }

  export async function crawl(
    url: string,
    maxPages: number = 10,
  ): Promise<CrawlResult> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      log.warn("FIRECRAWL_API_KEY not set, using mock data")
      return generateMockCrawl(url)
    }

    try {
      log.info("crawling URL", { url, maxPages })

      const response = await fetch(`${FIRECRAWL_API_URL}/v1/crawl`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url,
          maxPages,
          formats: ["markdown"],
        }),
      })

      if (!response.ok) {
        throw new Error(`Firecrawl crawl failed: ${response.statusText}`)
      }

      const data = (await response.json()) as {
        success: boolean
        data: Array<{
          title?: string
          url: string
          markdown?: string
          metadata?: Record<string, unknown>
        }>
      }

      const pages = data.data.map((item) => ({
        url: item.url,
        title: item.title ?? "Untitled",
        content: "",
        markdown: item.markdown ?? "",
        metadata: {
          title: item.title,
        },
      }))

      return {
        url,
        pages,
        totalPages: pages.length,
        errors: [],
      }
    } catch (err) {
      log.error("crawl failed", { url, error: err })
      return generateMockCrawl(url)
    }
  }

  export async function extractStructuredData(
    url: string,
    schema: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      log.warn("FIRECRAWL_API_KEY not set, using mock data")
      return {}
    }

    try {
      log.info("extracting structured data", { url })

      const response = await fetch(`${FIRECRAWL_API_URL}/v1/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          urls: [url],
          schema,
        }),
      })

      if (!response.ok) {
        throw new Error(`Firecrawl extract failed: ${response.statusText}`)
      }

      const data = (await response.json()) as {
        success: boolean
        data: Record<string, unknown>
      }

      return data.data
    } catch (err) {
      log.error("extract failed", { url, error: err })
      return {}
    }
  }

  function generateMockScrape(url: string): ScrapeResult {
    return {
      url,
      title: "Mock Page Title",
      content: "<html><body>Mock content</body></html>",
      markdown: "# Mock Page\n\nThis is mock content for development purposes.",
      metadata: {
        title: "Mock Page Title",
        description: "Mock description",
        language: "en",
      },
    }
  }

  function generateMockSearch(query: string): SearchResult[] {
    return [
      {
        title: `Search result for: ${query}`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        snippet: `This is a mock search result for the query: ${query}`,
      },
    ]
  }

  function generateMockCrawl(url: string): CrawlResult {
    return {
      url,
      pages: [generateMockScrape(url)],
      totalPages: 1,
      errors: [],
    }
  }
}
