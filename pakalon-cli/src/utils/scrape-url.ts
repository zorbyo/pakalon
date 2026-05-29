/**
 * Web scraping utility — replaces Python's scrape_url() function.
 *
 * Uses Node.js native `fetch` for HTTP and `cheerio` for HTML parsing.
 * No external dependencies beyond already-bundled packages.
 */

import * as cheerio from 'cheerio';

export interface ScrapeResult {
  url: string;
  title: string;
  text: string;
  links: string[];
}

/**
 * Scrape a URL and extract clean text content.
 *
 * @param url - The URL to scrape
 * @param timeoutMs - Request timeout in milliseconds (default: 20s)
 * @returns Promise resolving to scraped text content
 * @throws Error if the request fails or times out
 */
export async function scrapeUrl(
  url: string,
  timeoutMs = 20_000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Pakalon/1.0 (https://pakalon.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) {
      // Return raw text for non-HTML responses
      return await response.text();
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove noise elements
    $('script, style, noscript, iframe, nav, header, footer, aside, .ads, .sidebar, .navigation, .nav, .menu, .header, .footer').remove();

    // Remove hidden elements
    $('[style*="display: none"], [style*="display:none"], [hidden]').remove();

    // Get title
    const title = $('title').text().trim();

    // Extract main content from common content containers
    let text = '';
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.article-content',
      '.entry-content',
      '#content',
      '.markdown-body',
      '.readme',
    ];

    for (const selector of contentSelectors) {
      const el = $(selector);
      if (el.length) {
        text = el.text().replace(/\s+/g, ' ').trim();
        break;
      }
    }

    // Fallback: body text
    if (!text) {
      text = $('body').text().replace(/\s+/g, ' ').trim();
    }

    clearTimeout(timer);
    return text;

  } catch (err) {
    clearTimeout(timer);

    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Scraping timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  }
}

/**
 * Scrape a URL and return structured result with metadata.
 *
 * @param url - The URL to scrape
 * @param timeoutMs - Request timeout in milliseconds (default: 20s)
 * @returns Promise resolving to structured scrape result
 */
export async function scrapeUrlFull(
  url: string,
  timeoutMs = 20_000,
): Promise<ScrapeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Pakalon/1.0 (https://pakalon.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) {
      const text = await response.text();
      return { url, title: '', text, links: [] };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $('script, style, noscript, iframe, nav, header, footer').remove();

    const title = $('title').text().trim();

    const links: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) {
        links.push(href);
      }
    });

    let text = '';
    const contentSelectors = ['article', 'main', '[role="main"]', '.content', '.post-content', '#content'];
    for (const selector of contentSelectors) {
      const el = $(selector);
      if (el.length) {
        text = el.text().replace(/\s+/g, ' ').trim();
        break;
      }
    }
    if (!text) {
      text = $('body').text().replace(/\s+/g, ' ').trim();
    }

    clearTimeout(timer);
    return { url, title, text, links };

  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Scraping timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  }
}

export default { scrapeUrl, scrapeUrlFull };