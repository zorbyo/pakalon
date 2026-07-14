import { Log } from "../util/log"

const log = Log.create({ service: "integrations:firecrawl" })
const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v1"

type ScrapeResponse = {
  success?: boolean
  data?: {
    content?: string
    markdown?: string
  }
}

type SearchResponse = {
  success?: boolean
  data?: Array<{
    url?: string
    markdown?: string
    content?: string
  }>
}

export namespace FirecrawlIntegration {
  function getApiKey(): string {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      throw new Error("FIRECRAWL_API_KEY is required for Firecrawl integration")
    }
    return apiKey
  }

  export async function scrape(url: string): Promise<{ content: string; markdown: string }> {
    const apiKey = getApiKey()

    try {
      log.info("firecrawl scrape started", { url })
      const response = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
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
        throw new Error(`Firecrawl scrape failed with status ${response.status}`)
      }

      const data = (await response.json()) as ScrapeResponse
      const content = data.data?.content ?? ""
      const markdown = data.data?.markdown ?? ""
      log.info("firecrawl scrape completed", { url })
      return { content, markdown }
    } catch (error) {
      log.error("firecrawl scrape failed", { url, error })
      throw error
    }
  }

  export async function search(query: string, limit = 5): Promise<{ results: Array<{ url: string; content: string }> }> {
    const apiKey = getApiKey()

    try {
      log.info("firecrawl search started", { query })
      const response = await fetch(`${FIRECRAWL_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          limit,
        }),
      })

      if (!response.ok) {
        throw new Error(`Firecrawl search failed with status ${response.status}`)
      }

      const data = (await response.json()) as SearchResponse
      const results = (data.data ?? [])
        .map((item) => ({
          url: item.url ?? "",
          content: item.content ?? item.markdown ?? "",
        }))
        .filter((item) => item.url.length > 0)

      log.info("firecrawl search completed", { query, count: results.length })
      return { results }
    } catch (error) {
      log.error("firecrawl search failed", { query, error })
      throw error
    }
  }
}
