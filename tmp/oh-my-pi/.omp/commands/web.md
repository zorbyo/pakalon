# `/web` — Web search / scrape

Run a web search (the same `web_search` tool the agent uses), or
scrape a specific URL.

## Arguments

- `$ARGUMENTS` — required. Either a search query, or a URL prefixed
  with `!` (e.g. `!https://example.com/docs`) to scrape.

## Steps

1. If `$ARGUMENTS` starts with `!`, scrape the URL via `web_scrape`
   (Firecrawl + Puppeteer fallback).
2. Otherwise, run `web_search` with the 14-provider chain; the
   `auto` strategy tries them in order.
3. Inline the top results into the conversation as markdown with
   link targets preserved.
