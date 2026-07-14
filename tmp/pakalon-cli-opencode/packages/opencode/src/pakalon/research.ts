/**
 * Pakalon Research Integration
 * 
 * Provides research capabilities for planning phases:
 * - Firecrawl web scraping
 * - MCP server research
 * - Browser-based research
 * - Local codebase analysis
 */

import { Log } from "../util/log"
import { Instance } from "../project/instance"
import fs from "fs/promises"
import path from "path"

const log = Log.create({ service: "pakalon:research" })

export interface ResearchResult {
  source: "firecrawl" | "mcp" | "browser" | "local"
  query: string
  content: string
  url?: string
  timestamp: number
}

export interface ResearchOptions {
  maxResults?: number
  timeout?: number
  sources?: Array<"firecrawl" | "mcp" | "browser" | "local">
}

export namespace ResearchEngine {
  const cache = new Map<string, ResearchResult[]>()

  /**
   * Research a topic using available sources
   */
  export async function research(
    query: string,
    options: ResearchOptions = {}
  ): Promise<ResearchResult[]> {
    const { maxResults = 5, timeout = 30000, sources = ["local", "mcp"] } = options
    
    const results: ResearchResult[] = []
    const cacheKey = `${query}-${sources.join(",")}`
    
    // Check cache
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!
    }

    // Research from each source
    for (const source of sources) {
      try {
        const sourceResults = await researchFromSource(source, query, { maxResults, timeout })
        results.push(...sourceResults)
      } catch (error) {
        log.warn(`Research from ${source} failed`, { error })
      }
    }

    // Cache results
    cache.set(cacheKey, results)
    return results.slice(0, maxResults)
  }

  /**
   * Research from a specific source
   */
  async function researchFromSource(
    source: ResearchResult["source"],
    query: string,
    options: { maxResults: number; timeout: number }
  ): Promise<ResearchResult[]> {
    switch (source) {
      case "firecrawl":
        return researchWithFirecrawl(query, options)
      case "mcp":
        return researchWithMCP(query, options)
      case "browser":
        return researchWithBrowser(query, options)
      case "local":
        return researchLocal(query, options)
      default:
        return []
    }
  }

  /**
   * Research using Firecrawl (web scraping)
   */
  async function researchWithFirecrawl(
    query: string,
    options: { maxResults: number; timeout: number }
  ): Promise<ResearchResult[]> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      log.debug("Firecrawl API key not configured")
      return []
    }

    try {
      // Firecrawl API call
      const response = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          limit: options.maxResults,
        }),
        signal: AbortSignal.timeout(options.timeout),
      })

      if (!response.ok) {
        throw new Error(`Firecrawl API error: ${response.status}`)
      }

      const data = await response.json()
      const results: ResearchResult[] = []

      for (const item of data.data || []) {
        results.push({
          source: "firecrawl",
          query,
          content: item.markdown || item.content || "",
          url: item.url,
          timestamp: Date.now(),
        })
      }

      return results
    } catch (error) {
      log.error("Firecrawl research failed", { error })
      return []
    }
  }

  /**
   * Research using MCP servers
   */
  async function researchWithMCP(
    query: string,
    options: { maxResults: number; timeout: number }
  ): Promise<ResearchResult[]> {
    // MCP research would use the MCP tool system
    // For now, return empty - this would be wired to actual MCP servers
    log.debug("MCP research requested", { query })
    return []
  }

  /**
   * Research using browser
   */
  async function researchWithBrowser(
    query: string,
    options: { maxResults: number; timeout: number }
  ): Promise<ResearchResult[]> {
    // Browser research would use the browser automation tool
    // For now, return empty - this would be wired to browser tools
    log.debug("Browser research requested", { query })
    return []
  }

  /**
   * Research local codebase
   */
  async function researchLocal(
    query: string,
    options: { maxResults: number; timeout: number }
  ): Promise<ResearchResult[]> {
    const workdir = Instance.worktree
    const results: ResearchResult[] = []

    try {
      // Search for relevant files
      const keywords = query.toLowerCase().split(/\s+/)
      
      // Common patterns to search
      const patterns = [
        "*.md",
        "*.txt",
        "*.json",
        "*.yaml",
        "*.yml",
        "*.ts",
        "*.js",
      ]

      for (const pattern of patterns) {
        try {
          const files = await findFiles(workdir, pattern, 10)
          
          for (const file of files) {
            try {
              const content = await fs.readFile(file, "utf-8")
              const contentLower = content.toLowerCase()
              
              // Check if file contains relevant keywords
              const matchCount = keywords.filter(k => contentLower.includes(k)).length
              if (matchCount > 0) {
                results.push({
                  source: "local",
                  query,
                  content: content.slice(0, 1000), // Limit content size
                  url: file,
                  timestamp: Date.now(),
                })
              }
            } catch {}
          }
        } catch {}
      }

      return results.slice(0, options.maxResults)
    } catch (error) {
      log.error("Local research failed", { error })
      return []
    }
  }

  /**
   * Find files matching a pattern
   */
  async function findFiles(dir: string, pattern: string, limit: number): Promise<string[]> {
    const results: string[] = []
    
    async function walk(currentDir: string) {
      if (results.length >= limit) return
      
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true })
        
        for (const entry of entries) {
          if (results.length >= limit) break
          
          const fullPath = path.join(currentDir, entry.name)
          
          // Skip node_modules, .git, etc.
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue
          
          if (entry.isDirectory()) {
            await walk(fullPath)
          } else if (entry.isFile() && matchPattern(entry.name, pattern)) {
            results.push(fullPath)
          }
        }
      } catch {}
    }

    await walk(dir)
    return results
  }

  /**
   * Simple pattern matching
   */
  function matchPattern(filename: string, pattern: string): boolean {
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1)
      return filename.endsWith(ext)
    }
    return filename === pattern
  }

  /**
   * Get research summary for planning
   */
  export async function getResearchSummary(
    topic: string,
    options: ResearchOptions = {}
  ): Promise<string> {
    const results = await research(topic, options)
    
    if (results.length === 0) {
      return `No research results found for: ${topic}`
    }

    let summary = `# Research Summary: ${topic}\n\n`
    
    for (const result of results) {
      summary += `## Source: ${result.source}\n`
      if (result.url) {
        summary += `URL: ${result.url}\n`
      }
      summary += `\n${result.content.slice(0, 500)}...\n\n`
    }

    return summary
  }

  /**
   * Research best practices for a technology
   */
  export async function researchBestPractices(technology: string): Promise<string> {
    return getResearchSummary(`${technology} best practices 2024`, {
      maxResults: 3,
      sources: ["firecrawl", "local"],
    })
  }

  /**
   * Research similar projects
   */
  export async function researchSimilarProjects(description: string): Promise<string> {
    return getResearchSummary(`similar projects ${description}`, {
      maxResults: 3,
      sources: ["firecrawl"],
    })
  }

  /**
   * Clear research cache
   */
  export function clearCache(): void {
    cache.clear()
  }
}

export default ResearchEngine
