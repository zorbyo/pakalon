import { logger } from "@oh-my-pi/pi-utils";
import type { ScrapeOptions, ScrapeResult } from "./types";

export class WebScraper {
	async scrape(options: ScrapeOptions): Promise<ScrapeResult> {
		const url = options.url;
		logger.info("Scraping URL", { url });

		const startTime = Date.now();
		const result: ScrapeResult = {
			url,
			title: "",
			content: "",
			markdown: "",
			metadata: { fetchedAt: new Date().toISOString() },
			fetchedAt: new Date().toISOString(),
		};

		try {
			const controller = new AbortController();
			const timeout = options.timeout ?? 30000;
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			const response = await fetch(url, {
				signal: controller.signal,
				headers: {
					"User-Agent": "Pakalon-Scraper/1.0",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			});
			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const contentType = response.headers.get("content-type") ?? "";
			const html = await response.text();

			result.title = this.extractTitle(html);
			result.content = this.extractText(html);
			result.metadata = {
				contentType,
				contentLength: html.length,
				responseTime: Date.now() - startTime,
				statusCode: response.status,
				fetchedAt: result.fetchedAt,
			};

			if (options.format === "markdown" || options.format === undefined) {
				result.markdown = this.htmlToMarkdown(html);
			} else if (options.format === "text") {
				result.markdown = result.content;
			} else {
				result.markdown = html;
			}

			if (options.maxLength && result.content.length > options.maxLength) {
				result.content = result.content.slice(0, options.maxLength);
				result.markdown = result.markdown.slice(0, options.maxLength);
			}

			logger.info("Scrape completed", {
				url,
				title: result.title,
				contentLength: result.content.length,
				responseTime: result.metadata.responseTime,
			});
		} catch (error) {
			logger.warn("Scrape failed", { url, error: String(error) });
			result.content = `Error scraping ${url}: ${error}`;
			result.metadata = { ...result.metadata, error: String(error) };
		}

		return result;
	}

	async scrapeMultiple(urls: string[], options?: Partial<ScrapeOptions>): Promise<ScrapeResult[]> {
		const results = await Promise.all(urls.map(url => this.scrape({ url, ...options })));
		return results;
	}

	async extractText(url: string): Promise<string> {
		const result = await this.scrape({ url, format: "text" });
		return result.content;
	}

	async extractMarkdown(url: string): Promise<string> {
		const result = await this.scrape({ url, format: "markdown" });
		return result.markdown;
	}

	private extractTitle(html: string): string {
		const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
		return match ? match[1].trim() : "";
	}

	private extractText(html: string): string {
		const withoutTags = html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
		return withoutTags.replace(/\s+/g, " ").trim();
	}

	private htmlToMarkdown(html: string): string {
		let md = html;

		md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n");
		md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n");
		md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n");
		md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n");

		md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");

		md = md.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

		md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
		md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
		md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
		md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");

		md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m: string, content: string) => {
			return `${content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")}\n`;
		});
		md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m: string, content: string) => {
			let idx = 1;
			return `${content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_lm: string, lc: string) => `${idx++}. ${lc}\n`)}\n`;
		});

		md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
		md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```\n\n");

		md = md.replace(/<br\s*\/?>/gi, "\n");
		md = md.replace(/<hr\s*\/?>/gi, "---\n\n");

		md = md.replace(/<img\s+(?:[^>]*?\s+)?src="([^"]*)"[^>]*>/gi, "![image]($1)");

		md = md.replace(/<[^>]+>/g, "");
		md = md.replace(/&nbsp;/g, " ");
		md = md.replace(/&amp;/g, "&");
		md = md.replace(/&lt;/g, "<");
		md = md.replace(/&gt;/g, ">");
		md = md.replace(/&quot;/g, '"');
		md = md.replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCharCode(Number(n)));

		return md.replace(/\n{3,}/g, "\n\n").trim();
	}
}
