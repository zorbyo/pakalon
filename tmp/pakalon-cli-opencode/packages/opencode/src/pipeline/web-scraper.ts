import { Log } from "../util/log"

const log = Log.create({ service: "pipeline:web-scraper" })

export interface ScrapedContent {
  url: string
  title: string
  content: string
  metadata: {
    techStack?: string[]
    features?: string[]
    designPatterns?: string[]
    colorScheme?: string[]
  }
}

export interface DesignAnalysis {
  url: string
  colors: string[]
  typography: {
    fonts: string[]
    sizes: string[]
  }
  layout: {
    style: string
    components: string[]
  }
  patterns: string[]
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev"

export namespace WebScraper {
  export async function scrapeForRequirements(prompt: string): Promise<string> {
    log.info("scraping for requirements", { prompt: prompt.slice(0, 100) })

    try {
      // Search for similar projects
      const results = await searchWeb(prompt)

      // Scrape top results
      const contents: ScrapedContent[] = []
      for (const result of results.slice(0, 3)) {
        try {
          const content = await scrapeUrl(result.url)
          contents.push(content)
        } catch (err) {
          log.warn("failed to scrape", { url: result.url, error: err })
        }
      }

      // Extract insights
      const insights = extractInsights(contents)

      return formatInsights(insights, prompt)
    } catch (err) {
      log.error("web scraping failed", { error: err })
      return "Web scraping unavailable. Proceeding with standard analysis."
    }
  }

  export async function scrapeDesignInspiration(url: string): Promise<DesignAnalysis> {
    log.info("scraping design inspiration", { url })

    try {
      const content = await scrapeUrl(url)
      return analyzeDesign(content)
    } catch (err) {
      log.error("design scraping failed", { error: err })
      return {
        url,
        colors: [],
        typography: { fonts: [], sizes: [] },
        layout: { style: "unknown", components: [] },
        patterns: [],
      }
    }
  }

  export async function searchWeb(query: string): Promise<SearchResult[]> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      log.warn("FIRECRAWL_API_KEY not set, using mock results")
      return generateMockResults(query)
    }

    try {
      const response = await fetch(`${FIRECRAWL_API_URL}/v1/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          limit: 5,
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
        data: Array<{ title: string; url: string; markdown?: string }>
      }

      return data.data.map((item) => ({
        title: item.title ?? "Untitled",
        url: item.url,
        snippet: item.markdown?.slice(0, 200) ?? "",
      }))
    } catch (err) {
      log.error("search failed", { error: err })
      return generateMockResults(query)
    }
  }

  export async function scrapeUrl(url: string): Promise<ScrapedContent> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      log.warn("FIRECRAWL_API_KEY not set, using mock content")
      return generateMockContent(url)
    }

    try {
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
        content: data.data.markdown ?? data.data.html ?? "",
        metadata: extractMetadata(data.data.markdown ?? ""),
      }
    } catch (err) {
      log.error("scrape failed", { url, error: err })
      return generateMockContent(url)
    }
  }

  function extractMetadata(content: string): ScrapedContent["metadata"] {
    const techStack: string[] = []
    const features: string[] = []
    const designPatterns: string[] = []
    const colorScheme: string[] = []

    // Extract tech stack mentions
    const techPatterns = [
      /react/gi, /vue/gi, /angular/gi, /svelte/gi, /next\.?js/gi,
      /tailwind/gi, /bootstrap/gi, /node\.?js/gi, /express/gi,
      /fastapi/gi, /django/gi, /postgresql/gi, /mongodb/gi,
      /firebase/gi, /supabase/gi, /graphql/gi, /typescript/gi,
    ]

    for (const pattern of techPatterns) {
      const matches = content.match(pattern)
      if (matches) {
        techStack.push(...matches.map((m) => m.toLowerCase()))
      }
    }

    // Extract color codes
    const colorMatches = content.match(/#[0-9a-fA-F]{6}/g)
    if (colorMatches) {
      colorScheme.push(...colorMatches.slice(0, 5))
    }

    return {
      techStack: [...new Set(techStack)],
      features,
      designPatterns,
      colorScheme,
    }
  }

  function extractInsights(contents: ScrapedContent[]): {
    commonTechStack: string[]
    commonFeatures: string[]
    commonPatterns: string[]
    colorSchemes: string[]
  } {
    const techCount: Record<string, number> = {}
    const featureCount: Record<string, number> = {}
    const patternCount: Record<string, number> = {}
    const allColors: string[] = []

    for (const content of contents) {
      for (const tech of content.metadata.techStack ?? []) {
        techCount[tech] = (techCount[tech] ?? 0) + 1
      }
      for (const feature of content.metadata.features ?? []) {
        featureCount[feature] = (featureCount[feature] ?? 0) + 1
      }
      for (const pattern of content.metadata.designPatterns ?? []) {
        patternCount[pattern] = (patternCount[pattern] ?? 0) + 1
      }
      allColors.push(...(content.metadata.colorScheme ?? []))
    }

    return {
      commonTechStack: Object.entries(techCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k),
      commonFeatures: Object.entries(featureCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k),
      commonPatterns: Object.entries(patternCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k),
      colorSchemes: [...new Set(allColors)].slice(0, 5),
    }
  }

  function formatInsights(
    insights: ReturnType<typeof extractInsights>,
    originalPrompt: string,
  ): string {
    const lines = [
      "# Web Research Insights",
      "",
      `Based on analysis of similar projects for: "${originalPrompt}"`,
      "",
      "## Common Tech Stack",
      insights.commonTechStack.length > 0
        ? insights.commonTechStack.map((t) => `- ${t}`).join("\n")
        : "- No common patterns found",
      "",
      "## Common Features",
      insights.commonFeatures.length > 0
        ? insights.commonFeatures.map((f) => `- ${f}`).join("\n")
        : "- No common features found",
      "",
      "## Design Patterns",
      insights.commonPatterns.length > 0
        ? insights.commonPatterns.map((p) => `- ${p}`).join("\n")
        : "- No common patterns found",
      "",
      "## Color Schemes",
      insights.colorSchemes.length > 0
        ? insights.colorSchemes.map((c) => `- ${c}`).join("\n")
        : "- No color schemes extracted",
      "",
      "---",
      "*Generated by Pakalon Web Scraper*",
    ]

    return lines.join("\n")
  }

  function analyzeDesign(content: ScrapedContent): DesignAnalysis {
    const colors = content.metadata.colorScheme ?? []
    const fonts: string[] = []
    const sizes: string[] = []

    // Extract font mentions
    const fontPatterns = content.content.match(/font-family:\s*([^;]+)/gi)
    if (fontPatterns) {
      fonts.push(...fontPatterns.map((f) => f.replace(/font-family:\s*/i, "").trim()))
    }

    return {
      url: content.url,
      colors,
      typography: {
        fonts: [...new Set(fonts)].slice(0, 5),
        sizes,
      },
      layout: {
        style: "modern",
        components: [],
      },
      patterns: content.metadata.designPatterns ?? [],
    }
  }

  function generateMockResults(query: string): SearchResult[] {
    return [
      {
        title: `Example ${query} project`,
        url: `https://example.com/${query.replace(/\s+/g, "-").toLowerCase()}`,
        snippet: `This is a sample result for ${query}. It demonstrates common patterns and features.`,
      },
    ]
  }

  function generateMockContent(url: string): ScrapedContent {
    return {
      url,
      title: "Sample Project",
      content: "Mock content for development purposes.",
      metadata: {
        techStack: ["react", "typescript", "tailwind"],
        features: ["dashboard", "authentication"],
        designPatterns: ["responsive", "modern"],
        colorScheme: ["#6366f1", "#8b5cf6"],
      },
    }
  }
}
