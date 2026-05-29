/**
 * /web command — analyze a website's design and inject it as context.
 * Calls Firecrawl via the Python bridge to scrape real page content.
 * Also supports web search via Firecrawl search API.
 */
import { debugLog } from "@/utils/logger.js";
import { useStore } from "@/store/index.js";
import { scrapeUrl } from "@/scrape/scraper.js";
import { webSearch } from "@/search/web.js";
import type { CommandDefinition } from "./types.js";

const BRIDGE_URL = process.env.PAKALON_BRIDGE_URL ?? "http://127.0.0.1:7432";

/**
 * Build a web analysis prompt using the URL.
 */
export function getWebAnalysisPrompt(url: string, scrapedContent?: string): string {
  const contentBlock = scrapedContent
    ? `\n\n<scraped_content>\n${scrapedContent.slice(0, 8000)}\n</scraped_content>\n`
    : "";

  return `Analyze the design and UX of the website at: ${url}${contentBlock}

Based on the scraped content above (or if unavailable, by examining the URL), extract:
1. **Color Palette** — primary, secondary, background, text colors (exact hex/oklch values)
2. **Typography** — font families, sizes, weights for headings, body, code
3. **Layout** — grid system, spacing scale, max widths, responsive breakpoints
4. **Components** — identified UI components (nav, hero, cards, buttons, forms, footer)
5. **Design System** — any identifiable patterns or frameworks (Tailwind, Material, etc.)
6. **User Flow** — key interactions and page transitions
7. **Unique Features** — standout design choices worth replicating

Format your response as a structured design spec directly usable for building a similar interface.`;
}

/**
 * Build a web search prompt using the query and search results.
 */
export function getWebSearchPrompt(query: string, searchResults?: string): string {
  const resultsBlock = searchResults
    ? `\n\n<search_results>\n${searchResults.slice(0, 12000)}\n</search_results>\n`
    : "";

  return `Search the web for: ${query}${resultsBlock}

Based on the search results above, provide a comprehensive answer to the user's query. Include:
1. **Direct Answer** — the main information requested
2. **Key Facts** — important details and data points
3. **Sources** — cite the sources from the search results
4. **Additional Context** — relevant background information
5. **Related Topics** — suggest related queries if helpful

Format your response clearly with headings and bullet points for readability.`;
}

/**
 * Check if a string is a URL
 */
function isUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://") || str.startsWith("www.");
}

export async function cmdWebAnalyze(url: string): Promise<string> {
  debugLog(`[web] Analyzing: ${url}`);

  // 1. Try Firecrawl via bridge
  try {
    const { token } = useStore.getState();
    const res = await fetch(`${BRIDGE_URL}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url, formats: ["markdown", "html"] }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) {
      const data = await res.json() as { success: boolean; markdown?: string; html?: string; error?: string };
      if (data.success && (data.markdown || data.html)) {
        const content = data.markdown ?? data.html ?? "";
        debugLog(`[web] Firecrawl scraped ${content.length} chars`);
        return getWebAnalysisPrompt(url, content);
      }
      debugLog(`[web] Bridge scrape returned no content: ${data.error ?? "unknown"}`);
    } else {
      debugLog(`[web] Bridge scrape HTTP ${res.status}`);
    }
  } catch (err) {
    debugLog(`[web] Bridge unavailable or scrape failed: ${err}`);
  }

  // 2. Fallback: in-process scraper (Firecrawl SDK when configured, then HTTP/HTML extraction)
  try {
    const result = await scrapeUrl({
      url,
      formats: ["markdown", "html"],
      maxChars: 20_000,
    });
    if (result.success && (result.markdown || result.html)) {
      return getWebAnalysisPrompt(url, result.markdown ?? result.html);
    }
  } catch (err) {
    debugLog(`[web] In-process scrape failed: ${err}`);
  }

  // 3. Fallback: return static analysis prompt
  return getWebAnalysisPrompt(url);
}

export async function cmdWebSearch(query: string): Promise<string> {
  debugLog(`[web] Searching: ${query}`);

  // 1. Try dedicated web-search endpoint (Firecrawl/SearchWeb/httpx fallback chain in bridge)
  try {
    const { token } = useStore.getState();
    const res = await fetch(`${BRIDGE_URL}/web/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, max_results: 8 }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) {
      const data = await res.json() as {
        success: boolean;
        source?: string;
        results?: Array<{ title: string; url: string; snippet: string }>;
        error?: string;
      };
      if (data.success && data.results && data.results.length > 0) {
        const formattedResults = data.results
          .map((r, i) => `${i + 1}. **${r.title || r.url}**\n   URL: ${r.url}\n   ${r.snippet || ""}`)
          .join("\n\n");
        debugLog(`[web] web/search returned ${data.results.length} results via ${data.source ?? "unknown"}`);
        return getWebSearchPrompt(query, `Provider: ${data.source ?? "unknown"}\n\n${formattedResults}`);
      }
      debugLog(`[web] Bridge web/search returned no results: ${data.error ?? "unknown"}`);
    } else {
      debugLog(`[web] Bridge web/search HTTP ${res.status}`);
    }
  } catch (err) {
    debugLog(`[web] Bridge web/search unavailable or search failed: ${err}`);
  }

  // 2. Fallback: in-process web search (Brave when configured, then public HTML search)
  try {
    const result = await webSearch({ query, maxResults: 8 });
    if (result.success && result.results.length > 0) {
      const formattedResults = result.results
        .map((r, i) => `${i + 1}. **${r.title || r.url}**\n   URL: ${r.url}\n   ${r.snippet || ""}`)
        .join("\n\n");
      return getWebSearchPrompt(query, `Provider: ${result.source ?? "in-process"}\n\n${formattedResults}`);
    }
  } catch (err) {
    debugLog(`[web] In-process web search failed: ${err}`);
  }

  // 3. Fallback: return static search prompt
  return getWebSearchPrompt(query);
}

/**
 * Main /web command handler - supports both URL analysis and web search
 */
export async function cmdWeb(input: string): Promise<{ type: "analyze" | "search"; prompt: string }> {
  if (isUrl(input)) {
    return { type: "analyze", prompt: await cmdWebAnalyze(input) };
  } else {
    return { type: "search", prompt: await cmdWebSearch(input) };
  }
}

export const webCommand: CommandDefinition = {
  name: "web",
  description: "Search the web or analyze a URL and return an AI-ready research prompt",
  usage: "/web <query-or-url>",
  category: "workflow",
  permissions: ["network"],
  async execute(_context, args) {
    const input = args.join(" ").trim();
    if (!input) {
      return {
        success: false,
        message: "Usage: /web <query-or-url>",
      };
    }

    const result = await cmdWeb(input);
    return {
      success: true,
      message: result.prompt,
      data: result,
    };
  },
};
