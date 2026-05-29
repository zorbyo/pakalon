/**
 * Web Fetch Tool - Copilot CLI Style
 * 
 * Fetches web page content for agent use.
 * Supports both raw HTML and markdown-like text extraction.
 * 
 * Tool definition for agent runtime.
 */

import { z } from 'zod';
import logger from '@/utils/logger';

/**
 * Fetch web page content
 */
export async function fetchWeb(args: {
  url: string;
  max_length?: number;
  raw?: boolean;
  start_index?: number;
}): Promise<string> {
  const {
    url,
    max_length = 5000,
    raw = false,
    start_index = 0,
  } = args;

  logger.info(`Fetching web content: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Pakalon-CLI/1.0 (AI Agent)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // Handle JSON responses
    if (contentType.includes('application/json')) {
      const json = await response.json();
      const jsonStr = JSON.stringify(json, null, 2);
      return jsonStr.slice(start_index, start_index + max_length);
    }

    // Get HTML/text
    const html = await response.text();

    // Return raw HTML if requested
    if (raw) {
      return html.slice(start_index, start_index + max_length);
    }

    // Convert HTML to readable text
    const text = htmlToText(html);
    const content = text.slice(start_index, start_index + max_length);

    // Add truncation note
    if (content.length >= max_length) {
      return (
        content +
        `\n\n<note>Content truncated. Call with start_index=${
          start_index + max_length
        } to get more content.</note>`
      );
    }

    return content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Web fetch failed: ${message}`);
    throw new Error(`Failed to fetch ${url}: ${message}`);
  }
}

/**
 * Convert HTML to plain text
 * Simple implementation - no heavy dependencies
 */
function htmlToText(html: string): string {
  let text = html;

  // Remove script and style tags
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert common tags to text equivalents
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<\/li>/gi, '\n');

  // Convert links to markdown-style
  text = text.replace(
    /<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi,
    '[$2]($1)'
  );

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n'); // Max 2 newlines
  text = text.replace(/[ \t]+/g, ' '); // Normalize spaces
  text = text.trim();

  return text;
}

/**
 * Tool definition for agent runtime
 */
export const webFetchTool = {
  description: 'Fetch content from a web URL. Returns text content or JSON.',
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
  }),
};

/**
 * Export for tool registry
 */
export default {
  name: 'web_fetch',
  definition: webFetchTool,
  handler: fetchWeb,
  category: 'web',
};
