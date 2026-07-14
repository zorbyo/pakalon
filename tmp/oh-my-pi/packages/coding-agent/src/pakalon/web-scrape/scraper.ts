/**
 * Real web scraper for the 13 design sites + any URL.
 *
 * Strategy:
 *   1. If `FIRECRAWL_API_KEY` is set, use the Firecrawl client.
 *   2. Otherwise, fetch the page with `Bun.fetch` and extract a
 *      readable Markdown-ish body via a Mozilla/Readability-style
 *      heuristic. We then split into semantic blocks (headings,
 *      code, previews) for the registry-RAG and phase-3 frontend
 *      workflows to consume.
 *
 * Per-site overrides tune the extraction for known registry
 * sites (e.g. shadcn's `/r/styles/default/button.json` is JSON
 * and we want to return the JSON verbatim).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { scrape as firecrawlScrape } from "../firecrawl/client";
import { DESIGN_SITES, isDesignSite } from "./sites";

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 5_000_000;

export type DesignSite = (typeof DESIGN_SITES)[number];

export interface ScrapedPage {
	url: string;
	title: string;
	description: string;
	markdown: string;
	/** Optional JSON body for known JSON endpoints (e.g. shadcn registry). */
	json?: unknown;
	source: "firecrawl" | "fetch" | "registry";
	site?: DesignSite;
}

/**
 * Public entrypoint. Tries Firecrawl first; falls back to
 * `Bun.fetch` + a Readability-style extraction.
 */
export async function scrapeUrl(url: string): Promise<ScrapedPage> {
	const site = lookupSite(url);
	if (site && site.type === "registry" && url.endsWith(".json")) {
		return scrapeRegistryJson(url, site);
	}

	// Firecrawl is preferred when configured.
	const fcKey = process.env.FIRECRAWL_API_KEY;
	if (fcKey) {
		try {
			const fc = await firecrawlScrape(url);
			return {
				url,
				title: fc.title,
				description: typeof fc.metadata?.description === "string" ? fc.metadata.description : "",
				markdown: fc.markdown,
				source: "firecrawl",
				site: site ?? undefined,
			};
		} catch (err) {
			logger.warn("scraper: firecrawl failed, falling back to fetch", { err });
		}
	}

	// Fallback: direct fetch + heuristic extractor.
	return await scrapeViaFetch(url, site ?? undefined);
}

function lookupSite(url: string): DesignSite | null {
	return isDesignSite(url)
		? (DESIGN_SITES.find(s => new URL(url).hostname.endsWith(new URL(s.url).hostname)) ?? null)
		: null;
}

async function scrapeRegistryJson(url: string, site: DesignSite): Promise<ScrapedPage> {
	const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!resp.ok) throw new Error(`registry-json scrape failed: ${resp.status}`);
	const json = (await resp.json()) as { name?: string; description?: string; $schema?: string };
	return {
		url,
		title: json.name ?? "Registry",
		description: json.description ?? "",
		markdown: "",
		json,
		source: "registry",
		site,
	};
}

async function scrapeViaFetch(url: string, site: DesignSite | undefined): Promise<ScrapedPage> {
	const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
	const buf = new Uint8Array(await resp.arrayBuffer());
	if (buf.byteLength > MAX_BYTES) {
		throw new Error(`response too large: ${buf.byteLength} bytes`);
	}
	const html = new TextDecoder().decode(buf);
	const extracted = extractReadable(html, url);
	return {
		url,
		title: extracted.title,
		description: extracted.description,
		markdown: extracted.markdown,
		source: "fetch",
		site,
	};
}

interface ExtractedPage {
	title: string;
	description: string;
	markdown: string;
}

/**
 * Minimal Readability-style extractor. We don't pull in a full
 * library to keep the CLI bundle small. The heuristic:
 *   - strip <script>, <style>, <noscript>, <svg>
 *   - take <title> + <meta name="description">
 *   - walk the DOM body depth-first, converting block-level tags
 *     to Markdown and inline tags to plain text
 *   - keep the first 50KB of text only
 */
export function extractReadable(html: string, url: string): ExtractedPage {
	// Strip non-content tags. Multi-line, non-greedy.
	const cleaned = html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
		.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "");

	const title = (cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() || url;
	const description = (cleaned.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)/i)?.[1] ?? "").trim();

	// Strip remaining tags, collapse whitespace, normalise line breaks.
	const body = cleaned
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
		.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
		.replace(/<\/?(h1|h2|h3|h4|h5|h6)[^>]*>/gi, m => `\n\n${m.toUpperCase()}\n`)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/?(p|div|li|tr|td|th|article|section|main|header|footer|nav)[^>]*>/gi, "\n")
		.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
		.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n")
		.replace(/<a\s+[^>]*href=["']([^"']*)[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	const markdown = body.slice(0, 50_000);
	return { title, description, markdown };
}

/**
 * Batch-scrape a list of URLs (one per design site, for example)
 * and return the results. Failures are logged + skipped, so a
 * flaky site doesn't kill the whole batch.
 */
export async function scrapeBatch(urls: string[]): Promise<ScrapedPage[]> {
	const out: ScrapedPage[] = [];
	for (const url of urls) {
		try {
			out.push(await scrapeUrl(url));
		} catch (err) {
			logger.warn("scraper: skipped url", { url, err });
		}
	}
	return out;
}

/** Persist a scraped page to disk for offline consumption. */
export function writeScrapedPage(page: ScrapedPage, outDir: string): string {
	fs.mkdirSync(outDir, { recursive: true });
	const hash = page.url.replace(/[^a-z0-9]+/gi, "_").slice(0, 80);
	const file = path.join(outDir, `${hash}.json`);
	fs.writeFileSync(file, JSON.stringify(page, null, 2));
	return file;
}

export interface ContextHit {
	url: string;
	title: string;
	snippet: string;
}

/**
 * Search the web for a free-form prompt and return a compact list of
 * context hits (title + first paragraph snippet) suitable for
 * injection into a Phase 1 question-generator prompt. Best-effort:
 * returns `null` when neither Firecrawl nor a direct search provider
 * is configured. The caller must handle `null` and never throw.
 *
 * Strategy:
 *   1. If Firecrawl is configured, hit its `/search` endpoint.
 *   2. Otherwise, build a query URL against a known public search
 *      provider (DuckDuckGo HTML) and fetch+extract the top hits.
 *   3. Return up to `maxResults` hits.
 */
export async function scrapeForContext(
	prompt: string,
	opts: { maxResults?: number; preferFirecrawl?: boolean } = {},
): Promise<ContextHit[] | null> {
	const max = opts.maxResults ?? 5;
	if (opts.preferFirecrawl !== false && process.env.FIRECRAWL_API_KEY) {
		try {
			const { search } = await import("../firecrawl/client");
			const hits = (await search(prompt, { limit: max })) as Array<{
				url: string;
				title?: string;
				snippet?: string;
			}>;
			if (hits && hits.length > 0) {
				return hits.map(h => ({ url: h.url, title: h.title ?? h.url, snippet: h.snippet ?? "" }));
			}
		} catch (err) {
			logger.debug("scrapeForContext: firecrawl search failed, falling back", { err });
		}
	}
	// Fallback: hit DuckDuckGo's HTML endpoint and extract the top links.
	try {
		const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(prompt)}`;
		const resp = await fetch(url, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { "User-Agent": "pakalon-cli/1.0" },
		});
		if (!resp.ok) return null;
		const html = await resp.text();
		const hits: ContextHit[] = [];
		// Extract result blocks: <a class="result__a" href="...">title</a>
		// and <a class="result__snippet">snippet</a>.
		const linkRe = /<a[^>]+class=["']result__a["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
		const snippetRe = /<a[^>]+class=["']result__snippet["'][^>]*>([\s\S]*?)<\/a>/gi;
		const seen = new Set<string>();
		for (;;) {
			const linkMatch = linkRe.exec(html);
			if (linkMatch === null || hits.length >= max) break;
			const u = linkMatch[1] ?? "";
			const t = (linkMatch[2] ?? "").replace(/<[^>]+>/g, "").trim();
			if (!u || seen.has(u) || !u.startsWith("http")) continue;
			seen.add(u);
			hits.push({ url: u, title: t || u, snippet: "" });
		}
		for (;;) {
			const snipMatch = snippetRe.exec(html);
			if (snipMatch === null) break;
			const s = (snipMatch[1] ?? "").replace(/<[^>]+>/g, "").trim();
			if (hits.length > 0) {
				const last = hits[hits.length - 1];
				if (last) last.snippet = s;
			}
		}
		return hits.length > 0 ? hits : null;
	} catch (err) {
		logger.debug("scrapeForContext: duckduckgo fallback failed", { err });
		return null;
	}
}
