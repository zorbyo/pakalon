/**
 * RAG scraper tool.
 *
 * Handles web scraping for the 13 component websites and
 * knowledge base construction using Firecrawl and Playwright MCP.
 */
import { logger } from "@oh-my-pi/pi-utils";

// ============================================================================
// Types
// ============================================================================

export interface ScrapeResult {
	url: string;
	success: boolean;
	content: string;
	metadata: ScrapeMetadata;
	error?: string;
}

export interface ScrapeMetadata {
	title: string;
	description: string;
	characterCount: number;
	wordCount: number;
	screenshotPath?: string;
	crawledAt: string;
}

export interface KnowledgeBaseEntry {
	id: string;
	url: string;
	title: string;
	content: string;
	chunks: string[];
	metadata: ScrapeMetadata;
}

// ============================================================================
// Component Websites
// ============================================================================

export const COMPONENT_WEBSITES = {
	"next.js": "https://nextjs.org/docs",
	react: "https://react.dev/learn",
	typescript: "https://www.typescriptlang.org/docs/",
	tailwind: "https://tailwindcss.com/docs",
	prisma: "https://www.prisma.io/docs",
	postgresql: "https://www.postgresql.org/docs/",
	redis: "https://redis.io/docs/",
	s3: "https://docs.aws.amazon.com/s3/",
	cloudflare: "https://developers.cloudflare.com/",
	docker: "https://docs.docker.com/",
	"github-actions": "https://docs.github.com/en/actions",
	vercel: "https://vercel.com/docs",
	supabase: "https://supabase.com/docs",
} as const;

// ============================================================================
// Scraper
// ============================================================================

export class RAGScraper {
	private projectPath: string;
	private maxChunkSize: number;

	constructor(projectPath: string, maxChunkSize = 4000) {
		this.projectPath = projectPath;
		this.maxChunkSize = maxChunkSize;
	}

	// ------------------------------------------------------------------
	// Single URL scraping
	// ------------------------------------------------------------------

	async scrapeUrl(url: string): Promise<ScrapeResult> {
		const _startTime = Date.now();

		try {
			// Try Firecrawl first
			const content = await this.scrapeWithFirecrawl(url);

			return {
				url,
				success: true,
				content,
				metadata: this.buildMetadata(url, content),
			};
		} catch {
			try {
				// Fallback to basic fetch
				const content = await this.scrapeWithFetch(url);

				return {
					url,
					success: true,
					content,
					metadata: this.buildMetadata(url, content),
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					url,
					success: false,
					content: "",
					metadata: this.buildMetadata(url, ""),
					error: msg,
				};
			}
		}
	}

	// ------------------------------------------------------------------
	// Batch scraping
	// ------------------------------------------------------------------

	async scrapeMultiple(urls: string[]): Promise<ScrapeResult[]> {
		const results: ScrapeResult[] = [];

		for (const url of urls) {
			const result = await this.scrapeUrl(url);
			results.push(result);

			// Rate limiting
			await new Promise(r => setTimeout(r, 1000));
		}

		return results;
	}

	async scrapeComponentWebsites(components: string[]): Promise<ScrapeResult[]> {
		const urls: string[] = [];

		for (const component of components) {
			const key = Object.keys(COMPONENT_WEBSITES).find(k => k.toLowerCase() === component.toLowerCase());
			if (key) {
				urls.push(COMPONENT_WEBSITES[key as keyof typeof COMPONENT_WEBSITES]);
			}
		}

		if (urls.length === 0) {
			// Scrape all component websites
			urls.push(...Object.values(COMPONENT_WEBSITES));
		}

		return this.scrapeMultiple(urls);
	}

	// ------------------------------------------------------------------
	// Knowledge base construction
	// ------------------------------------------------------------------

	async buildKnowledgeBase(results: ScrapeResult[]): Promise<KnowledgeBaseEntry[]> {
		const entries: KnowledgeBaseEntry[] = [];

		for (const result of results) {
			if (!result.success || !result.content) continue;

			const chunks = this.chunkContent(result.content);

			entries.push({
				id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				url: result.url,
				title: result.metadata.title,
				content: result.content,
				chunks,
				metadata: result.metadata,
			});
		}

		// Save knowledge base
		await this.saveKnowledgeBase(entries);

		return entries;
	}

	// ------------------------------------------------------------------
	// Content chunking
	// ------------------------------------------------------------------

	private chunkContent(content: string): string[] {
		const chunks: string[] = [];
		const paragraphs = content.split(/\n\n+/);
		let currentChunk = "";

		for (const para of paragraphs) {
			if (currentChunk.length + para.length > this.maxChunkSize) {
				if (currentChunk) {
					chunks.push(currentChunk.trim());
				}
				currentChunk = para;
			} else {
				currentChunk += (currentChunk ? "\n\n" : "") + para;
			}
		}

		if (currentChunk.trim()) {
			chunks.push(currentChunk.trim());
		}

		return chunks;
	}

	// ------------------------------------------------------------------
	// Persistence
	// ------------------------------------------------------------------

	private async saveKnowledgeBase(entries: KnowledgeBaseEntry[]): Promise<void> {
		const { writeFile, mkdir } = await import("node:fs/promises");
		const { join } = await import("node:path");

		const dir = join(this.projectPath, ".pakalon-agents", "knowledge-base");
		await mkdir(dir, { recursive: true });

		const filePath = join(dir, "rag-index.json");
		await writeFile(filePath, JSON.stringify(entries, null, 2));

		logger.info(`Knowledge base saved: ${entries.length} entries`);
	}

	// ------------------------------------------------------------------
	// Scrape implementations
	// ------------------------------------------------------------------

	private async scrapeWithFirecrawl(url: string): Promise<string> {
		// Firecrawl API call
		const apiKey = process.env.FIRECRAWL_API_KEY;
		if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

		const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				url,
				formats: ["markdown"],
				onlyMainContent: true,
			}),
		});

		if (!res.ok) throw new Error(`Firecrawl failed: ${res.status}`);

		const data = (await res.json()) as { data?: { markdown?: string } };
		return data.data?.markdown ?? "";
	}

	private async scrapeWithFetch(url: string): Promise<string> {
		const res = await fetch(url, {
			headers: {
				"User-Agent": "PakalonBot/1.0 (Research Scraper)",
			},
		});

		if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

		const html = await res.text();
		// Simple HTML to text
		return html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------

	private buildMetadata(url: string, content: string): ScrapeMetadata {
		const titleMatch = content.match(/^#\s+(.+)/m);
		return {
			title: titleMatch?.[1] ?? new URL(url).hostname,
			description: content.slice(0, 200).replace(/\n/g, " "),
			characterCount: content.length,
			wordCount: content.split(/\s+/).length,
			crawledAt: new Date().toISOString(),
		};
	}
}

// ============================================================================
// Prompt Builder
// ============================================================================

export function buildRAGScraperPrompt(components: string[]): string {
	return `You are the Pakalon RAG Scraper Agent. Your task is to scrape component documentation and build a knowledge base.

## Components to Scrape
${components.map(c => `- ${c}`).join("\n")}

## Available Websites
${Object.entries(COMPONENT_WEBSITES)
	.map(([k, v]) => `- ${k}: ${v}`)
	.join("\n")}

## Tasks
1. Scrape all relevant documentation pages for the project's tech stack
2. Extract key information: API references, patterns, examples
3. Chunk content for RAG retrieval (max 4000 chars per chunk)
4. Build a local knowledge base in \`.pakalon-agents/knowledge-base/\`
5. Generate a summary of what was scraped

## Output
Save to \`.pakalon-agents/knowledge-base/rag-index.json\`:
\`\`\`json
[
  {
    "id": "kb-...",
    "url": "...",
    "title": "...",
    "content": "...",
    "chunks": ["chunk1", "chunk2"],
    "metadata": { ... }
  }
]
\`\`\`

Also save a human-readable summary to \`rag-summary.md\`.`;
}
