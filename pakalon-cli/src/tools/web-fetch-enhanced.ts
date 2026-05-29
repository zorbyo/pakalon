/**
 * Enhanced Web Fetch Tool
 *
 * Adds trusted host detection, redirect handling, richer HTML -> markdown/text
 * conversion, timeout support, and typed errors.
 */

import { z } from 'zod';
import logger from '@/utils/logger';

export const PREAPPROVED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  'github.com',
  '*.github.com',
  'githubusercontent.com',
  '*.githubusercontent.com',
  'docs.*',
  '*.docs.*',
  'developer.mozilla.org',
  '*.developer.mozilla.org',
  'readthedocs.io',
  '*.readthedocs.io',
  'npmjs.com',
  '*.npmjs.com',
  'nodejs.org',
  '*.nodejs.org',
  'bun.sh',
  '*.bun.sh',
  'typescriptlang.org',
  '*.typescriptlang.org',
  'vercel.com',
  '*.vercel.com',
  'supabase.com',
  '*.supabase.com',
  'cloudflare.com',
  '*.cloudflare.com',
  'microsoft.com',
  '*.microsoft.com',
  'google.com',
  '*.google.com',
  'stackoverflow.com',
  '*.stackoverflow.com',
  'wikipedia.org',
  '*.wikipedia.org',
] as const;

const REDIRECT_STATUSES = new Set([301, 307, 308]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;

export type WebFetchErrorCode =
  | 'INVALID_URL'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'REDIRECT_ERROR'
  | 'CONTENT_ERROR';

export class WebFetchError extends Error {
  constructor(
    public readonly code: WebFetchErrorCode,
    message: string,
    public readonly url?: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WebFetchError';
  }
}

export class WebFetchTimeoutError extends WebFetchError {
  constructor(url: string, timeoutMs: number) {
    super('TIMEOUT', `Request timed out after ${timeoutMs}ms`, url);
    this.name = 'WebFetchTimeoutError';
  }
}

export class WebFetchHttpError extends WebFetchError {
  constructor(url: string, status: number, statusText: string) {
    super('HTTP_ERROR', `HTTP ${status}: ${statusText}`, url, status);
    this.name = 'WebFetchHttpError';
  }
}

export class WebFetchRedirectError extends WebFetchError {
  constructor(url: string, message: string) {
    super('REDIRECT_ERROR', message, url);
    this.name = 'WebFetchRedirectError';
  }
}

export class WebFetchContentError extends WebFetchError {
  constructor(url: string, message: string) {
    super('CONTENT_ERROR', message, url);
    this.name = 'WebFetchContentError';
  }
}

export function isPreapprovedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;

  return PREAPPROVED_HOSTS.some((pattern) => {
    const regex = new RegExp(
      `^${pattern
        .toLowerCase()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*')}$`,
    );
    return regex.test(normalized);
  });
}

export interface FetchWebEnhancedArgs {
  url: string;
  max_length?: number;
  raw?: boolean;
  start_index?: number;
  timeout_ms?: number;
  max_redirects?: number;
}

function createAbortError(url: string, timeoutMs: number): WebFetchTimeoutError {
  return new WebFetchTimeoutError(url, timeoutMs);
}

function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

function safeDecodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
  };

  return value
    .replace(/&#(x?[0-9a-fA-F]+);/g, (_, entity: string) => {
      const isHex = entity.startsWith('x') || entity.startsWith('X');
      const num = Number.parseInt(isHex ? entity.slice(1) : entity, isHex ? 16 : 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : _;
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (_, entity: string) => named[entity] ?? _);
}

function stripScriptStyleAndComments(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripTags(input: string): string {
  return safeDecodeHtmlEntities(input.replace(/<[^>]+>/g, ''));
}

function convertInlineHtml(input: string): string {
  let text = input;

  text = text.replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*>/gi, (_, alt: string) =>
    safeDecodeHtmlEntities(alt || '').trim(),
  );
  text = text.replace(/<img\b[^>]*>/gi, '');

  text = text.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, label: string) => {
      const cleanedLabel = stripTags(label).trim();
      return cleanedLabel ? `[${cleanedLabel}](${href})` : href;
    },
  );

  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, code: string) => {
    const value = stripTags(code).replace(/\r\n/g, '\n').trim();
    return value ? `\`${value.replace(/`/g, '\\`')}\`` : '';
  });

  text = text.replace(/<(strong|b)>/gi, '**').replace(/<\/(strong|b)>/gi, '**');
  text = text.replace(/<(em|i)>/gi, '_').replace(/<\/(em|i)>/gi, '_');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  return safeDecodeHtmlEntities(text.replace(/<[^>]+>/g, ''));
}

function extractTopLevelListItems(html: string): string[] {
  const items: string[] = [];
  const openTag = /<li\b[^>]*>/gi;
  const tagScanner = /<\/?li\b[^>]*>|<\/?(?:ul|ol)\b[^>]*>/gi;

  let searchIndex = 0;
  while (true) {
    openTag.lastIndex = searchIndex;
    const startMatch = openTag.exec(html);
    if (!startMatch) break;

    const contentStart = startMatch.index + startMatch[0].length;
    tagScanner.lastIndex = contentStart;
    let liDepth = 1;
    let endIndex = -1;

    while (true) {
      const tagMatch = tagScanner.exec(html);
      if (!tagMatch) {
        endIndex = html.length;
        break;
      }

      const tag = tagMatch[0].toLowerCase();
      if (tag.startsWith('<li')) {
        liDepth += 1;
      } else if (tag.startsWith('</li')) {
        liDepth -= 1;
        if (liDepth === 0) {
          endIndex = tagMatch.index;
          searchIndex = tagMatch.index + tagMatch[0].length;
          break;
        }
      }
    }

    const rawItem = html.slice(contentStart, endIndex);
    items.push(rawItem);
    if (endIndex >= html.length) break;
  }

  return items;
}

function convertListHtml(html: string, ordered: boolean, depth = 0): string {
  const items = extractTopLevelListItems(html);
  const indent = '  '.repeat(depth);

  return items
    .map((item, index) => {
      const content = htmlToTextInternal(item, depth + 1);
      const lines = normalizeWhitespace(content)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        return `${indent}${ordered ? `${index + 1}.` : '-'} `;
      }

      const [firstLine, ...rest] = lines;
      const prefix = `${indent}${ordered ? `${index + 1}.` : '-'} `;
      const continuation = rest.map((line) => `${indent}  ${line}`).join('\n');

      return continuation ? `${prefix}${firstLine}\n${continuation}` : `${prefix}${firstLine}`;
    })
    .join('\n');
}

function convertTableHtml(html: string): string {
  const rows: string[][] = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    const cells = [...rowHtml.matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
      (match) => convertInlineHtml(match[2]).replace(/\s*\n\s*/g, ' ').trim(),
    );
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) {
    return '';
  }

  const header = rows[0];
  const body = rows.slice(1);
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(
      ...rows.map((row) => (row[column] ?? '').length),
      3,
    ),
  );

  const formatRow = (row: string[]): string =>
    row
      .map((cell, index) => (cell ?? '').replace(/\|/g, '\\|').padEnd(widths[index], ' '))
      .join(' | ');

  const separator = widths.map((width) => '-'.repeat(Math.max(3, width))).join(' | ');

  return [
    formatRow(header),
    separator,
    ...body.map(formatRow),
  ].join('\n');
}

function htmlToTextInternal(html: string, listDepth = 0): string {
  let text = stripScriptStyleAndComments(html);
  const placeholders: string[] = [];

  const stash = (value: string): string => {
    const token = `\u0000P${placeholders.length}\u0000`;
    placeholders.push(value);
    return token;
  };

  text = text.replace(
    /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, code: string) =>
      stash(`\n\`\`\`\n${safeDecodeHtmlEntities(stripTags(code)).replace(/\r\n/g, '\n').trimEnd()}\n\`\`\`\n`),
  );

  text = text.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const converted = convertTableHtml(table);
    return stash(converted ? `\n${converted}\n` : '');
  });

  text = text.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag: string, content: string) =>
    stash(`\n${convertListHtml(content, tag.toLowerCase() === 'ol', listDepth)}\n`),
  );

  text = text.replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*>/gi, (_, alt: string) =>
    safeDecodeHtmlEntities(alt || '').trim(),
  );
  text = text.replace(/<img\b[^>]*>/gi, '');

  text = text.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, label: string) => {
      const cleanedLabel = convertInlineHtml(label).trim();
      return cleanedLabel ? `[${cleanedLabel}](${href})` : href;
    },
  );

  text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, content: string) => {
    const heading = convertInlineHtml(content).trim();
    return `\n${'#'.repeat(Number(level))} ${heading}\n\n`;
  });

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<p\b[^>]*>/gi, '');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<div\b[^>]*>/gi, '');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<(section|article|header|footer|nav|main)\b[^>]*>/gi, '');
  text = text.replace(/<\/(section|article|header|footer|nav|main)>/gi, '\n');
  text = text.replace(/<blockquote\b[^>]*>/gi, '\n> ');
  text = text.replace(/<\/blockquote>/gi, '\n');

  text = convertInlineHtml(text);

  text = text.replace(/\u0000P(\d+)\u0000/g, (_, index: string) => placeholders[Number(index)] ?? '');

  return normalizeWhitespace(text);
}

export function htmlToText(html: string): string {
  return htmlToTextInternal(html);
}

async function fetchWithRedirects(
  inputUrl: string,
  timeoutMs: number,
  maxRedirects: number,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = new URL(inputUrl);
  let redirectCount = 0;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(currentUrl.href)) {
      throw new WebFetchRedirectError(currentUrl.href, 'Redirect loop detected');
    }
    visited.add(currentUrl.href);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Pakalon-CLI/1.0 (AI Agent)',
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        },
      });

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new WebFetchRedirectError(currentUrl.href, `Redirect response ${response.status} without Location header`);
        }

        redirectCount += 1;
        if (redirectCount > maxRedirects) {
          throw new WebFetchRedirectError(currentUrl.href, `Too many redirects (>${maxRedirects})`);
        }

        const nextUrl = new URL(location, currentUrl);
        logger.info(`Following redirect: ${currentUrl.href} -> ${nextUrl.href}`);

        currentUrl = nextUrl;
        continue;
      }

      return { response, finalUrl: currentUrl.href };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw createAbortError(currentUrl.href, timeoutMs);
      }
      if (error instanceof WebFetchError) {
        throw error;
      }
      throw new WebFetchError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : String(error),
        currentUrl.href,
        undefined,
        error,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export async function fetchWebEnhanced(args: FetchWebEnhancedArgs): Promise<string> {
  const {
    url,
    max_length = 5000,
    raw = false,
    start_index = 0,
    timeout_ms = DEFAULT_TIMEOUT_MS,
    max_redirects = DEFAULT_MAX_REDIRECTS,
  } = args;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new WebFetchError('INVALID_URL', `Invalid URL: ${url}`, url, undefined, error);
  }

  logger.info(
    `Fetching web content: ${parsedUrl.href} (trusted=${isPreapprovedHost(parsedUrl.hostname)})`,
  );

  try {
    const { response, finalUrl } = await fetchWithRedirects(parsedUrl.href, timeout_ms, max_redirects);

    if (!response.ok) {
      throw new WebFetchHttpError(finalUrl, response.status, response.statusText);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = await response.json();
      const jsonStr = JSON.stringify(json, null, 2);
      const content = jsonStr.slice(start_index, start_index + max_length);
      return content.length >= max_length
        ? `${content}\n\n<note>Content truncated. Call with start_index=${start_index + max_length} to get more content.</note>`
        : content;
    }

    const body = await response.text();
    if (raw) {
      const rawContent = body.slice(start_index, start_index + max_length);
      return rawContent.length >= max_length
        ? `${rawContent}\n\n<note>Content truncated. Call with start_index=${start_index + max_length} to get more content.</note>`
        : rawContent;
    }

    const text = htmlToText(body);
    if (!text) {
      throw new WebFetchContentError(finalUrl, 'Empty response body after conversion');
    }

    const content = text.slice(start_index, start_index + max_length);
    return content.length >= max_length
      ? `${content}\n\n<note>Content truncated. Call with start_index=${start_index + max_length} to get more content.</note>`
      : content;
  } catch (error) {
    if (error instanceof WebFetchError) {
      logger.error(`Web fetch failed: ${error.message}`);
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Web fetch failed: ${message}`);
    throw new WebFetchError('NETWORK_ERROR', `Failed to fetch ${url}: ${message}`, url, undefined, error);
  }
}

export const webFetchEnhancedTool = {
  description: 'Fetch content from a web URL with trusted-host handling, redirects, and improved markdown conversion.',
  parameters: z.object({
    url: z.string().url().describe('The URL to fetch'),
    max_length: z
      .number()
      .optional()
      .describe('Maximum characters to return (default: 5000, max: 20000)'),
    raw: z
      .boolean()
      .optional()
      .describe('Return raw HTML instead of converted text (default: false)'),
    start_index: z
      .number()
      .optional()
      .describe('Start index for pagination (default: 0)'),
    timeout_ms: z
      .number()
      .optional()
      .describe('Timeout in milliseconds (default: 30000)'),
    max_redirects: z
      .number()
      .optional()
      .describe('Maximum redirect hops to follow (default: 5)'),
  }),
};

export default {
  name: 'web_fetch_enhanced',
  definition: webFetchEnhancedTool,
  handler: fetchWebEnhanced,
  category: 'web',
};
