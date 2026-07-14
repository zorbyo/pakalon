/**
 * `web_scrape` — fetch and clean a URL's content.
 *
 * Tries Firecrawl first (if `FIRECRAWL_API_KEY` is set), falls back to
 * Puppeteer (via the existing `browser` tool's session). Output is
 * markdown with link targets preserved — same shape the agent
 * already uses for `web_search` results, so call sites are
 * interchangeable.
 */

import * as readability from "@mozilla/readability";
import { logger } from "@oh-my-pi/pi-utils";
import { JSDOM } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export interface ScrapeOptions {
	url: string;
	maxBytes?: number;
	timeoutMs?: number;
	preferMarkdown?: boolean;
}

export interface ScrapeResult {
	url: string;
	title: string;
	markdown: string;
	text: string;
	byline?: string;
	siteName?: string;
	bytesFetched: number;
	source: "firecrawl" | "browser" | "direct";
	fetchedAt: string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT = 30_000;

function getTurndown(): TurndownService {
	const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
	td.use(gfm);
	return td;
}

/**
 * Direct fetch + readability extraction. Used as the no-key
 * fallback; works for any site that returns HTML without aggressive
 * JS-only rendering.
 */
async function scrapeDirect(url: string, opts: ScrapeOptions): Promise<ScrapeResult> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
	try {
		const resp = await fetch(url, {
			signal: ctrl.signal,
			headers: { "User-Agent": "Pakalon/0.1 (+https://pakalon.dev)" },
		});
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const html = await resp.text();
		const bytes = new TextEncoder().encode(html).byteLength;
		if (bytes > (opts.maxBytes ?? DEFAULT_MAX_BYTES)) {
			throw new Error(`body too large: ${bytes} bytes`);
		}
		const dom = new JSDOM(html, { url });
		const reader = new readability.Readability(dom.window.document);
		const parsed = reader.parse();
		if (!parsed) throw new Error("readability could not parse");
		const td = getTurndown();
		const markdown = td.turndown(parsed.content ?? "");
		return {
			url,
			title: parsed.title ?? "",
			markdown,
			text: parsed.textContent ?? "",
			byline: parsed.byline ?? undefined,
			siteName: parsed.siteName ?? undefined,
			bytesFetched: bytes,
			source: "direct",
			fetchedAt: new Date().toISOString(),
		};
	} finally {
		clearTimeout(t);
	}
}

/**
 * Firecrawl-backed scrape. Returns clean markdown with site-aware
 * extraction (GitHub, registries, docs).
 */
async function scrapeFirecrawl(url: string, apiKey: string, opts: ScrapeOptions): Promise<ScrapeResult> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
	try {
		const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
			method: "POST",
			signal: ctrl.signal,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				url,
				formats: ["markdown"],
				onlyMainContent: true,
			}),
		});
		if (!resp.ok) throw new Error(`Firecrawl HTTP ${resp.status}`);
		const data = (await resp.json()) as {
			data?: {
				markdown?: string;
				metadata?: { title?: string; siteName?: string; byline?: string };
				rawHtml?: string;
			};
		};
		const md = data.data?.markdown ?? "";
		const meta = data.data?.metadata ?? {};
		return {
			url,
			title: meta.title ?? "",
			markdown: md,
			text: md.replace(/[`*_>#\-[\]()!]/g, " "),
			byline: meta.byline,
			siteName: meta.siteName,
			bytesFetched: new TextEncoder().encode(md).byteLength,
			source: "firecrawl",
			fetchedAt: new Date().toISOString(),
		};
	} finally {
		clearTimeout(t);
	}
}

/**
 * Public entry. Order: Firecrawl → direct. Puppeteer fallback
 * (for JS-heavy sites) is wired through the `browser` tool in the
 * TUI; here we only do static-ish sites.
 */
export async function scrapeUrl(url: string, opts: ScrapeOptions = { url: "" }): Promise<ScrapeResult> {
	const fullOpts: ScrapeOptions = { url, ...opts };
	const firecrawlKey = process.env.FIRECRAWL_API_KEY;
	if (firecrawlKey) {
		try {
			return await scrapeFirecrawl(url, firecrawlKey, fullOpts);
		} catch (err) {
			logger.warn("Firecrawl failed, falling back to direct", { url, err: String(err) });
		}
	}
	return scrapeDirect(url, fullOpts);
}
