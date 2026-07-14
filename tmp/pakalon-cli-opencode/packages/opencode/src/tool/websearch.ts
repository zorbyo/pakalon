import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { abortAfterAny } from "../util/abort"
import { FirecrawlIntegration } from "../integrations/firecrawl"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  DEFAULT_NUM_RESULTS: 8,
} as const

interface McpSearchRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      numResults?: number
      livecrawl?: "fallback" | "preferred"
      type?: "auto" | "fast" | "deep"
      contextMaxCharacters?: number
    }
  }
}

interface McpSearchResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

function trimOutput(value: string, maxCharacters: number) {
  if (value.length <= maxCharacters) return value
  return `${value.slice(0, maxCharacters)}\n\n[Output trimmed]`
}

async function firecrawlSearchOutput(query: string, numResults: number, maxCharacters: number) {
  if (!process.env.FIRECRAWL_API_KEY) return undefined

  const response = await FirecrawlIntegration.search(query, numResults)
  if (response.results.length === 0) return undefined

  const output = [
    "Firecrawl results:",
    ...response.results.slice(0, numResults).map((result, index) => {
      const body = result.content.trim() || "No extracted content returned."
      return `${index + 1}. ${result.url}\n${trimOutput(body, 1200)}`
    }),
  ].join("\n\n")

  return trimOutput(output, maxCharacters)
}

export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: z.object({
      query: z.string().describe("Websearch query"),
      numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
      livecrawl: z
        .enum(["fallback", "preferred"])
        .optional()
        .describe(
          "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
        ),
      type: z
        .enum(["auto", "fast", "deep"])
        .optional()
        .describe(
          "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
        ),
      contextMaxCharacters: z
        .number()
        .optional()
        .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
    }),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
          livecrawl: params.livecrawl,
          type: params.type,
          contextMaxCharacters: params.contextMaxCharacters,
        },
      })

      const searchRequest: McpSearchRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: {
            query: params.query,
            type: params.type || "auto",
            numResults: params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
            livecrawl: params.livecrawl || "fallback",
            contextMaxCharacters: params.contextMaxCharacters,
          },
        },
      }

      const { signal, clearTimeout } = abortAfterAny(25000, ctx.abort)
      const outputs: string[] = []
      let exaError: unknown

      try {
        const headers: Record<string, string> = {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
          method: "POST",
          headers,
          body: JSON.stringify(searchRequest),
          signal,
        })

        clearTimeout()

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Search error (${response.status}): ${errorText}`)
        }

        const responseText = await response.text()

        // Parse SSE response
        const lines = responseText.split("\n")
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data: McpSearchResponse = JSON.parse(line.substring(6))
            if (data.result && data.result.content && data.result.content.length > 0) {
              outputs.push(`OpenRouter/Exa results:\n${data.result.content[0].text}`)
              break
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Search request timed out")
        }

        exaError = error
      } finally {
        clearTimeout()
      }

      try {
        const firecrawlOutput = await firecrawlSearchOutput(
          params.query,
          params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
          params.contextMaxCharacters || 10000,
        )
        if (firecrawlOutput) outputs.push(firecrawlOutput)
      } catch (error) {
        if (outputs.length === 0) exaError = exaError ?? error
      }

      if (outputs.length > 0) {
        return {
          output: outputs.join("\n\n---\n\n"),
          title: `Web search: ${params.query}`,
          metadata: {},
        }
      }

      if (exaError) throw exaError

      return {
        output: "No search results found. Please try a different query.",
        title: `Web search: ${params.query}`,
        metadata: {},
      }
    },
  }
})
