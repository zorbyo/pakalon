/**
 * Firecrawl-compatible web scraping client for Pakalon.
 * Implements the `scrape`, `crawl`, and `map` operations. If the user
 * supplies a `FIRECRAWL_API_KEY`, the request is proxied to the
 * Firecrawl API; otherwise the local `tools/web-scrape.ts` extractor
 * is used as a fallback so the feature works offline.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { scrapeUrl } from "../../tools/web-scrape";

const FIRECRAWL_API = "https://api.firecrawl.dev/v1";

export interface ScrapeResult {
	url: string;
	title: string;
	markdown: string;
	metadata?: Record<string, unknown>;
}

export interface CrawlResult {
	urls: string[];
	pages: ScrapeResult[];
}

function apiKey(): string | null {
	return process.env.FIRECRAWL_API_KEY ?? null;
}

/** Single-page scrape. */
export async function scrape(url: string): Promise<ScrapeResult> {
	const key = apiKey();
	if (key) {
		try {
			const resp = await fetch(`${FIRECRAWL_API}/scrape`, {
				method: "POST",
				headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
				body: JSON.stringify({ url, formats: ["markdown"] }),
			});
			if (resp.ok) {
				const data = (await resp.json()) as { data?: { markdown?: string; metadata?: Record<string, unknown> } };
				return {
					url,
					title: (data.data?.metadata?.title as string) ?? url,
					markdown: data.data?.markdown ?? "",
					metadata: data.data?.metadata,
				};
			}
			logger.warn("firecrawl: scrape non-2xx, falling back to local", { status: resp.status });
		} catch (err) {
			logger.warn("firecrawl: scrape failed, falling back to local", { err });
		}
	}
	const local = await scrapeUrl(url);
	return {
		url,
		title: local.title ?? url,
		markdown: local.text ?? "",
		metadata: { source: "local-fallback" },
	};
}

/** BFS crawl: scrape `url`, follow internal links up to `maxPages`. */
export async function crawl(root: string, maxPages: number = 5): Promise<CrawlResult> {
	const visited = new Set<string>();
	const queue: string[] = [root];
	const pages: ScrapeResult[] = [];
	const baseUrl = new URL(root).origin;

	while (queue.length > 0 && pages.length < maxPages) {
		const next = queue.shift()!;
		if (visited.has(next)) continue;
		visited.add(next);
		try {
			const page = await scrape(next);
			pages.push(page);
			// Naive link extraction from the markdown body
			const links = Array.from(page.markdown.matchAll(/\((https?:\/\/[^)]+)\)/g))
				.map(m => m[1]!)
				.filter(l => l.startsWith(baseUrl))
				.slice(0, 10);
			for (const l of links) {
				if (!visited.has(l)) queue.push(l);
			}
		} catch (err) {
			logger.debug("crawl: page failed", { url: next, err });
		}
	}
	return { urls: Array.from(visited), pages };
}

/** Map: return the discovered URL set without scraping each page. */
export async function map(root: string, maxPages: number = 20): Promise<string[]> {
	const result = await crawl(root, maxPages);
	return result.urls;
}
