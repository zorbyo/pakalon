/**
 * Web scraping — in-process fetch + cheerio for HTML→markdown.
 * Matches Copilot CLI's web_fetch tool approach.
 *
 * Features:
 * - Native fetch (no HTTP bridge)
 * - HTML→markdown conversion via cheerio
 * - Rejects file:// URLs (Copilot pattern)
 * - Configurable timeout and max content length
 * - Fallback to @mendable/firecrawl-js if available
 */
import * as cheerio from "cheerio";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScrapeOptions {
  url: string;
  formats?: Array<"markdown" | "html">;
  maxChars?: number;
  timeout?: number;
}

export interface ScrapeResult {
  success: boolean;
  url: string;
  markdown?: string;
  html?: string;
  title?: string;
  source: string;
  error?: string;
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// URL Validation
// ---------------------------------------------------------------------------

function validateUrl(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "URL is required" };
  }

  // Reject file:// URLs (Copilot pattern — prevents local file access)
  if (/^file:\/\//i.test(url)) {
    return { valid: false, error: "file:// URLs are not allowed" };
  }

  // Must be http or https
  if (!/^https?:\/\//i.test(url)) {
    return { valid: false, error: "URL must begin with http:// or https://" };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// HTML → Markdown Conversion
// ---------------------------------------------------------------------------

function htmlToMarkdown(html: string, _baseUrl?: string): { markdown: string; title: string } {
  const $ = cheerio.load(html);

  // Remove script, style, nav, footer, header elements for cleaner content
  $("script, style, nav, footer, header, aside, iframe, noscript").remove();

  const title = $("title").text().trim() || $("h1").first().text().trim() || "";

  // Try to find main content
  const mainSelectors = ["main", "article", '[role="main"]', ".content", "#content", ".post", ".entry"];
  let root: any = $("body");
  for (const selector of mainSelectors) {
    const el = $(selector);
    if (el.length > 0) {
      root = el.first();
      break;
    }
  }

  const lines: string[] = [];

  root.find("*").each((_: any, el: any) => {
    const $el = $(el);
    const tagName = el.type === "tag" ? (el as any).tagName?.toLowerCase?.() ?? "" : "";

    switch (tagName) {
      case "h1":
        lines.push(`# ${$el.text().trim()}\n`);
        break;
      case "h2":
        lines.push(`## ${$el.text().trim()}\n`);
        break;
      case "h3":
        lines.push(`### ${$el.text().trim()}\n`);
        break;
      case "h4":
        lines.push(`#### ${$el.text().trim()}\n`);
        break;
      case "h5":
        lines.push(`##### ${$el.text().trim()}\n`);
        break;
      case "h6":
        lines.push(`###### ${$el.text().trim()}\n`);
        break;
      case "p":
        lines.push(`${$el.text().trim()}\n`);
        break;
      case "br":
        lines.push("\n");
        break;
      case "hr":
        lines.push("---\n");
        break;
      case "strong":
      case "b":
        lines.push(`**${$el.text().trim()}**`);
        break;
      case "em":
      case "i":
        lines.push(`*${$el.text().trim()}*`);
        break;
      case "code":
        lines.push(`\`${$el.text().trim()}\``);
        break;
      case "pre": {
        const codeText = $el.find("code").text() || $el.text();
        lines.push(`\`\`\`\n${codeText.trim()}\n\`\`\`\n`);
        break;
      }
      case "a": {
        const href = $el.attr("href") || "";
        const linkText = $el.text().trim();
        if (href && linkText) {
          lines.push(`[${linkText}](${href})`);
        } else if (linkText) {
          lines.push(linkText);
        }
        break;
      }
      case "img": {
        const src = $el.attr("src") || "";
        const alt = $el.attr("alt") || "";
        if (src) {
          lines.push(`![${alt}](${src})`);
        }
        break;
      }
      case "ul":
      case "ol": {
        $el.children("li").each((i, li) => {
          const prefix = tagName === "ol" ? `${i + 1}. ` : "- ";
          lines.push(`${prefix}${$(li).text().trim()}`);
        });
        lines.push("");
        break;
      }
      case "table": {
        const rows: string[][] = [];
        $el.find("tr").each((_, tr) => {
          const cells: string[] = [];
          $(tr).find("th, td").each((__, cell) => {
            cells.push($(cell).text().trim());
          });
          if (cells.length) rows.push(cells);
        });
        if (rows.length > 0) {
          const header = rows[0];
          if (header) {
            lines.push(`| ${header.join(" | ")} |`);
            lines.push(`| ${header.map(() => "---").join(" | ")} |`);
            for (const row of rows.slice(1)) {
              lines.push(`| ${row.join(" | ")} |`);
            }
            lines.push("");
          }
        }
        break;
      }
      case "blockquote":
        lines.push(`> ${$el.text().trim()}\n`);
        break;
      default:
        break;
    }
  });

  return {
    markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    title,
  };
}

// ---------------------------------------------------------------------------
// Main Scrape Function
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and return its content as markdown.
 */
export async function scrapeUrl(options: ScrapeOptions): Promise<ScrapeResult> {
  const {
    url,
    formats = ["markdown"],
    maxChars = 20000,
    timeout = 15000,
  } = options;

  // Validate URL
  const validation = validateUrl(url);
  if (!validation.valid) {
    return {
      success: false,
      url,
      error: validation.error,
      source: "validation",
    };
  }

  try {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PakalonCLI/0.1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain,application/json,*/*",
      },
      redirect: "follow",
    });

    clearTimeout(timeoutHandle);

    if (!response.ok) {
      return {
        success: false,
        url,
        error: `HTTP ${response.status}: ${response.statusText}`,
        source: "fetch",
      };
    }

    const contentType = response.headers.get("content-type") ?? "";

    // Handle non-HTML content
    if (contentType.includes("application/json")) {
      const json = await response.text();
      return {
        success: true,
        url,
        markdown: formats.includes("markdown")
          ? json.slice(0, maxChars)
          : undefined,
        html: formats.includes("html") ? json.slice(0, maxChars) : undefined,
        title: url,
        source: "fetch-json",
        truncated: json.length > maxChars,
      };
    }

    const html = await response.text();

    // Convert HTML to markdown
    const { markdown, title } = htmlToMarkdown(html, url);
    const truncatedMarkdown = markdown.length > maxChars
      ? markdown.slice(0, maxChars)
      : markdown;

    return {
      success: true,
      url,
      markdown: formats.includes("markdown") ? truncatedMarkdown : undefined,
      html: formats.includes("html") ? html.slice(0, maxChars) : undefined,
      title,
      source: "cheerio",
      truncated: markdown.length > maxChars,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      url,
      error: message,
      source: "fetch",
    };
  }
}
