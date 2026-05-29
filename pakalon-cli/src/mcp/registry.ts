/**
 * MCP Registry — known MCP servers from modelcontextprotocol/servers
 * and other popular community servers.
 */

export interface RegistryEntry {
  name: string;
  displayName: string;
  url: string;
  description: string;
  transport: "sse" | "stdio";
  tags: string[];
  official: boolean;
}

// ---------------------------------------------------------------------------
// Known server registry
// ---------------------------------------------------------------------------

export const MCP_REGISTRY: RegistryEntry[] = [
  {
    name: "filesystem",
    displayName: "Filesystem",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    description: "Read/write local filesystem with sandboxed directory access",
    transport: "stdio",
    tags: ["file", "filesystem", "io"],
    official: true,
  },
  {
    name: "github",
    displayName: "GitHub",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    description: "Interact with GitHub repositories, issues, and PRs",
    transport: "stdio",
    tags: ["git", "github", "vcs", "code"],
    official: true,
  },
  {
    name: "gitlab",
    displayName: "GitLab",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab",
    description: "Interact with GitLab repositories and CI/CD pipelines",
    transport: "stdio",
    tags: ["git", "gitlab", "vcs", "ci"],
    official: true,
  },
  {
    name: "google-drive",
    displayName: "Google Drive",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive",
    description: "Access and manage Google Drive files and folders",
    transport: "stdio",
    tags: ["drive", "google", "files", "cloud"],
    official: true,
  },
  {
    name: "google-maps",
    displayName: "Google Maps",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps",
    description: "Location, routing, and places via Google Maps API",
    transport: "stdio",
    tags: ["maps", "location", "geo", "google"],
    official: true,
  },
  {
    name: "postgres",
    displayName: "PostgreSQL",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    description: "Read-only and read-write access to PostgreSQL databases",
    transport: "stdio",
    tags: ["database", "sql", "postgres", "db"],
    official: true,
  },
  {
    name: "sqlite",
    displayName: "SQLite",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    description: "SQLite database interaction with schema introspection",
    transport: "stdio",
    tags: ["database", "sql", "sqlite", "db"],
    official: true,
  },
  {
    name: "slack",
    displayName: "Slack",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    description: "Post messages and read channels from Slack workspace",
    transport: "stdio",
    tags: ["slack", "messaging", "team", "social"],
    official: true,
  },
  {
    name: "puppeteer",
    displayName: "Puppeteer",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    description: "Browser automation via Puppeteer — screenshots, scraping, testing",
    transport: "stdio",
    tags: ["browser", "puppeteer", "automation", "scrape", "test"],
    official: true,
  },
  {
    name: "brave-search",
    displayName: "Brave Search",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    description: "Web search using the Brave Search API",
    transport: "stdio",
    tags: ["search", "web", "brave", "internet"],
    official: true,
  },
  {
    name: "everart",
    displayName: "EverArt",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/everart",
    description: "AI image generation using EverArt API",
    transport: "stdio",
    tags: ["image", "ai", "art", "generate", "visual"],
    official: true,
  },
  {
    name: "fetch",
    displayName: "Fetch",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    description: "HTTP fetch for URLs with markdown conversion",
    transport: "stdio",
    tags: ["http", "fetch", "web", "url"],
    official: true,
  },
  {
    name: "aws-kb-retrieval",
    displayName: "AWS Knowledge Base",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/aws-kb-retrieval-server",
    description: "AWS Bedrock Knowledge Base retrieval for RAG",
    transport: "stdio",
    tags: ["aws", "bedrock", "rag", "knowledge", "retrieval"],
    official: true,
  },
  {
    name: "sentry",
    displayName: "Sentry",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/sentry",
    description: "Query Sentry issues and error reports",
    transport: "stdio",
    tags: ["monitoring", "sentry", "errors", "observability"],
    official: true,
  },
  {
    name: "linear",
    displayName: "Linear",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/linear",
    description: "Create and manage Linear issues and projects",
    transport: "stdio",
    tags: ["project", "issues", "linear", "planning"],
    official: true,
  },
  {
    name: "memory",
    displayName: "Memory",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    description: "Persistent memory store using knowledge graphs",
    transport: "stdio",
    tags: ["memory", "knowledge", "persistent", "graph"],
    official: true,
  },
  {
    name: "sequentialthinking",
    displayName: "Sequential Thinking",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    description: "Chain-of-thought reasoning via sequential thinking protocol",
    transport: "stdio",
    tags: ["reasoning", "thinking", "cot", "chain"],
    official: true,
  },
  {
    name: "firecrawl",
    displayName: "Firecrawl",
    url: "https://github.com/mendableai/firecrawl-mcp-server",
    description: "Advanced web scraping and crawling with Firecrawl",
    transport: "sse",
    tags: ["scrape", "crawl", "web", "firecrawl"],
    official: false,
  },
  {
    name: "browserbase",
    displayName: "BrowserBase",
    url: "https://github.com/browserbase/mcp-server-browserbase",
    description: "Cloud browser sessions for AI — screenshots, automation",
    transport: "sse",
    tags: ["browser", "cloud", "automation", "screenshot"],
    official: false,
  },
  {
    name: "neon",
    displayName: "Neon Database",
    url: "https://github.com/neondatabase/mcp-server-neon",
    description: "Neon serverless Postgres management and querying",
    transport: "sse",
    tags: ["database", "neon", "postgres", "serverless"],
    official: false,
  },
  {
    name: "cloudflare",
    displayName: "Cloudflare",
    url: "https://github.com/cloudflare/mcp-server-cloudflare",
    description: "Manage Cloudflare workers, KV, R2, and Durable Objects",
    transport: "sse",
    tags: ["cloudflare", "workers", "edge", "cdn"],
    official: false,
  },
  {
    name: "context7",
    displayName: "Context7",
    url: "https://github.com/upstash/context7",
    description: "Up-to-date library documentation and code examples for any npm/PyPI package — prevents hallucinated APIs",
    transport: "stdio",
    tags: ["docs", "documentation", "context", "npm", "libraries", "context7", "upstash"],
    official: false,
  },
  {
    name: "notion",
    displayName: "Notion",
    url: "https://github.com/makenotion/notion-mcp-server",
    description: "Read, write, and search Notion pages and databases via the Notion API",
    transport: "sse",
    tags: ["notion", "notes", "docs", "wiki", "enterprise"],
    official: false,
  },
  {
    name: "jira",
    displayName: "Jira",
    url: "https://github.com/atlassian/jira-mcp-server",
    description: "Create, update, and search Jira issues for Cloud and Server/DC",
    transport: "sse",
    tags: ["jira", "issues", "project", "atlassian", "enterprise"],
    official: false,
  },
];

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Fuzzy search registry by name, description, or tags.
 */
export function searchRegistry(query: string): RegistryEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return MCP_REGISTRY;

  const scored: Array<{ entry: RegistryEntry; score: number }> = [];

  for (const entry of MCP_REGISTRY) {
    let score = 0;

    // Exact name match — highest priority
    if (entry.name === q) score += 100;
    // Name starts with query
    else if (entry.name.startsWith(q)) score += 50;
    // Name contains query
    else if (entry.name.includes(q)) score += 30;

    // Display name match
    if (entry.displayName.toLowerCase().includes(q)) score += 20;

    // Description match
    if (entry.description.toLowerCase().includes(q)) score += 10;

    // Tag matches
    for (const tag of entry.tags) {
      if (tag === q) score += 40;
      else if (tag.includes(q)) score += 15;
    }

    // Official bonus
    if (entry.official && score > 0) score += 5;

    if (score > 0) scored.push({ entry, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry);
}

/**
 * Get full details for a registry entry by name.
 */
export function getRegistryEntry(name: string): RegistryEntry | null {
  return MCP_REGISTRY.find((e) => e.name === name) ?? null;
}

/**
 * List all entries grouped by official vs community.
 */
export function listByOfficial(): { official: RegistryEntry[]; community: RegistryEntry[] } {
  return {
    official: MCP_REGISTRY.filter((e) => e.official),
    community: MCP_REGISTRY.filter((e) => !e.official),
  };
}

// ============================================================================
// MCP Server Discovery — local config + npm search + well-known list
// ============================================================================

export interface McpNpmSearchResult {
  name: string;
  version: string;
  description: string;
  publisher: string;
  date: string;
}

export interface DiscoveredMcpServer {
  name: string;
  packageName: string;
  description: string;
  source: "well-known" | "npm" | "local";
  version?: string;
  installed?: boolean;
  transport?: "sse" | "stdio";
  url?: string;
}

/**
 * Return the 10 well-known @modelcontextprotocol/* MCP servers.
 */
export function listWellKnownMcpServers(): DiscoveredMcpServer[] {
  const servers: Array<{ name: string; packageName: string; description: string }> = [
    { name: "filesystem", packageName: "@modelcontextprotocol/server-filesystem", description: "Read/write local filesystem with sandboxed directory access" },
    { name: "github", packageName: "@modelcontextprotocol/server-github", description: "Interact with GitHub repositories, issues, and PRs" },
    { name: "gitlab", packageName: "@modelcontextprotocol/server-gitlab", description: "Interact with GitLab repositories and CI/CD pipelines" },
    { name: "postgres", packageName: "@modelcontextprotocol/server-postgres", description: "Read-only and read-write access to PostgreSQL databases" },
    { name: "sqlite", packageName: "@modelcontextprotocol/server-sqlite", description: "SQLite database interaction with schema introspection" },
    { name: "puppeteer", packageName: "@modelcontextprotocol/server-puppeteer", description: "Browser automation via Puppeteer" },
    { name: "sentry", packageName: "@modelcontextprotocol/server-sentry", description: "Query Sentry issues and error reports" },
    { name: "slack", packageName: "@modelcontextprotocol/server-slack", description: "Post messages and read channels from Slack workspace" },
    { name: "sequential-thinking", packageName: "@modelcontextprotocol/server-sequential-thinking", description: "Chain-of-thought reasoning via sequential thinking protocol" },
    { name: "memory", packageName: "@modelcontextprotocol/server-memory", description: "Persistent memory store using knowledge graphs" },
  ];
  return servers.map((s) => ({
    ...s,
    source: "well-known" as const,
    transport: "stdio" as const,
  }));
}

/**
 * Query the npm registry API for MCP server packages.
 */
export async function searchNpmRegistry(query: string, limit = 20): Promise<McpNpmSearchResult[]> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://registry.npmjs.org/-/v1/search?text=${encoded}&size=${Math.min(limit, 250)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      objects?: Array<{
        package: { name: string; version: string; description: string; publisher?: { username: string }; date: string };
      }>;
    };
    return (data.objects ?? []).map((o) => ({
      name: o.package.name,
      version: o.package.version,
      description: o.package.description ?? "",
      publisher: o.package.publisher?.username ?? "",
      date: o.package.date,
    }));
  } catch {
    return [];
  }
}

function nameFromPackage(pkg: string): string {
  return pkg
    .replace(/^@[^/]+\//, "")
    .replace(/^(mcp-)?server-/, "")
    .replace(/-mcp-server$/, "");
}

/**
 * Discover available MCP servers from three sources:
 * 1. Well-known @modelcontextprotocol/* list
 * 2. npm registry search
 * 3. Local Pakalon config (already-installed servers)
 *
 * Results are deduplicated by package name; well-known entries take priority.
 */
export async function discoverMcpServers(options?: {
  query?: string;
  includeNpm?: boolean;
  includeWellKnown?: boolean;
  includeLocal?: boolean;
}): Promise<DiscoveredMcpServer[]> {
  const {
    query = "",
    includeNpm = true,
    includeWellKnown = true,
    includeLocal = true,
  } = options ?? {};

  const results: DiscoveredMcpServer[] = [];
  const seen = new Set<string>();
  const q = query.toLowerCase().trim();

  const matches = (name: string, desc: string): boolean =>
    !q || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);

  if (includeWellKnown) {
    for (const server of listWellKnownMcpServers()) {
      if (matches(server.name, server.description)) {
        seen.add(server.packageName);
        results.push(server);
      }
    }
  }

  if (includeNpm) {
    const searchText = q ? `keywords:mcp-server ${q}` : "keywords:mcp-server";
    const npmResults = await searchNpmRegistry(searchText, 25);
    for (const pkg of npmResults) {
      if (!seen.has(pkg.name)) {
        seen.add(pkg.name);
        results.push({
          name: nameFromPackage(pkg.name) || pkg.name,
          packageName: pkg.name,
          description: pkg.description,
          source: "npm",
          version: pkg.version,
        });
      }
    }
  }

  if (includeLocal) {
    try {
      const { listMcpServers } = await import("./manager.js");
      const localServers = listMcpServers();
      for (const s of localServers) {
        const pk = s.url || s.name;
        if (!seen.has(pk) && matches(s.name, s.description ?? "")) {
          seen.add(pk);
          results.push({
            name: s.name,
            packageName: s.name,
            description: s.description ?? "",
            source: "local",
            installed: true,
            transport: s.transport,
            url: s.url,
          });
        }
      }
    } catch {
      // local config unavailable — skip
    }
  }

  return results;
}
