/**
 * Phase 1 Research Module
 * Web research capability for tech stack and market research.
 * Uses Firecrawl MCP when available, falls back to scraper.
 */
import * as fs from "fs/promises";
import * as path from "path";
import logger from "@/utils/logger.js";
import { FirecrawlMCP } from "@/integrations/mcp.js";
import { getRegistryEntry } from "@/mcp/registry.js";

export interface ResearchConfig {
  topics: string[];
  maxUrlsPerTopic: number;
}

export interface ResearchResult {
  topic: string;
  findings: string;
  sources: string[];
}

export interface ResearchSourceDiscovery {
  topic: string;
  query: string;
  urls: string[];
}

export interface FirecrawlResearchResult {
  topic: string;
  findings: string[];
  sources: string[];
}

const RESEARCH_URLS: Record<string, string[]> = {
  "frontend-frameworks": [
    "https://react.dev",
    "https://vuejs.org",
    "https://svelte.dev",
    "https://angular.io",
    "https://nextjs.org",
    "https://nuxt.com",
    "https://remix.run",
    "https://qwik.dev",
  ],
  "backend-frameworks": [
    "https://nodejs.org",
    "https://fastify.dev",
    "https://expressjs.com",
    "https://nestjs.com",
    "https://rubyonrails.org",
    "https://go.dev",
  ],
  "databases": [
    "https://postgresql.org",
    "https://www.mongodb.com",
    "https://redis.io",
    "https://www.mysql.com",
    "https://www.sqlite.org",
    "https://cassandra.apache.org",
    "https://neo4j.com",
    "https://www.elastic.co",
  ],
  "ui-components": [
    "https://ui.shadcn.com",
    "https://daisyui.com",
    "https://chakra-ui.com",
    "https://mui.com",
    "https://ant.design",
    "https://radix-ui.com",
    "https://nextui.org",
    "https://headlessui.com",
    "https://ark-ui.com",
    "https://tanstack.com/table",
    "https://tanstack.com/form",
  ],
  "design-systems": [
    "https://radix-ui.com",
    "https://nextui.org",
    "https://materialui.com",
    "https://design-system.bootflat.com",
    "https://shoelace.style",
    "https://spectrum.adobe.com",
    "https:// Polaris.design",
  ],
  "css-frameworks": [
    "https://tailwindcss.com",
    "https://getbootstrap.com",
    "https://bulma.io",
    "https://purecss.io",
    "https://milligram.io",
    "https://unsemantic.com",
    "https://tachyons.io",
  ],
  "api-design": [
    "https://swagger.io",
    "https://www.asyncapi.com",
    "https://jsonapi.org",
    "https://graphql.org",
    "https://trpc.io",
    "https://grpc.io",
    "https://www.openapis.org",
  ],
  "testing": [
    "https://vitest.dev",
    "https://jestjs.io",
    "https://playwright.dev",
    "https://www.cypress.io",
    "https://testing-library.com",
    "https://mochajs.org",
    "https://www.chaijs.com",
    "https://webdriver.io",
  ],
  "devops": [
    "https://docker.com",
    "https://kubernetes.io",
    "https://www.terraform.io",
    "https://www.ansible.com",
    "https://github.com/features/actions",
    "https://about.gitlab.com/features/ci-cd",
    "https://www.jenkins.io",
    "https://circleci.com",
  ],
  "cloud-providers": [
    "https://aws.amazon.com",
    "https://cloud.google.com",
    "https://azure.microsoft.com",
    "https://www.digitalocean.com",
    "https://vercel.com",
    "https://www.heroku.com",
    "https://www.linode.com",
    "https://www.rackspace.com",
  ],
  "realtime": [
    "https://socket.io",
    "https://www.ably.io",
    "https://pusher.com",
    "https://firebase.google.com",
    "https://supabase.com",
    "https://www.particular.net",
  ],
  "auth": [
    "https://auth0.com",
    "https://supabase.com/auth",
    "https://clerk.com",
    "https://www.passportjs.org",
    "https://jwt.io",
    "https://oauth.net",
    "https://logrocket.com/blog/authentication-react",
  ],
  "cms": [
    "https://strapi.io",
    "https://ghost.org",
    "https://wordpress.org",
    "https://sanity.io",
    "https://contentful.com",
    "https://prismic.io",
    "https://keystonejs.com",
  ],
  "ecommerce": [
    "https://www.shopify.com",
    "https://medusa-commerce.com",
    "https://saleor.io",
    "https://prestashop.com",
    "https://magento.com",
    "https://woocommerce.com",
  ],
};

async function scrapeUrl(url: string): Promise<string> {
  try {
    // Use node-fetch for web scraping
    const response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Pakalon/1.0 Research Bot",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Simple text extraction (remove scripts, styles, and tags)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Limit to 5000 chars per URL
    return text.substring(0, 5000);
  } catch (error) {
    logger.warn(`[research] Failed to scrape ${url}: ${error}`);
    return "";
  }
}

function hasFirecrawlApiKey(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

function getFirecrawlClient(): FirecrawlMCP | null {
  if (!hasFirecrawlApiKey()) return null;

  const firecrawlRegistryEntry = getRegistryEntry("firecrawl");
  if (!firecrawlRegistryEntry) {
    logger.warn("[phase1-research] Firecrawl registry entry missing; using fallback scraping");
    return null;
  }

  return new FirecrawlMCP();
}

function buildDiscoveryQueries(topic: string, contextHint?: string): string[] {
  const topicMap: Record<string, string[]> = {
    "frontend-frameworks": [
      "frontend framework documentation blog best practices",
      "react vue svelte nextjs docs blog",
    ],
    "backend-frameworks": [
      "backend framework documentation blog best practices",
      "node express fastify nest go docs blog",
    ],
    "databases": [
      "database documentation blog performance best practices",
      "postgres mysql sqlite redis docs blog",
    ],
    "ui-components": [
      "ui component library documentation blog patterns",
      "design system components accessibility docs blog",
    ],
    "design-systems": [
      "design system documentation blog accessibility",
      "design tokens components docs blog",
    ],
    "css-frameworks": [
      "css framework documentation blog utility classes",
      "tailwind bootstrap bulma docs blog",
    ],
    "api-design": [
      "api design documentation blog best practices",
      "openapi graphql grpc docs blog",
    ],
    "testing": [
      "testing framework documentation blog best practices",
      "vitest jest playwright cypress docs blog",
    ],
    "devops": [
      "devops tooling documentation blog best practices",
      "docker kubernetes ci cd docs blog",
    ],
    "cloud-providers": [
      "cloud provider documentation blog best practices",
      "aws azure gcp vercel docs blog",
    ],
    "realtime": [
      "realtime app documentation blog best practices",
      "websocket socket firebase supabase docs blog",
    ],
    "auth": [
      "authentication authorization documentation blog best practices",
      "auth0 clerk oauth jwt docs blog",
    ],
    "cms": [
      "cms headless content platform documentation blog",
      "strapi sanity contentful prismic docs blog",
    ],
    "ecommerce": [
      "ecommerce platform documentation blog best practices",
      "shopify medusa saleor docs blog",
    ],
  };

  const base = topicMap[topic] ?? [
    `${topic} documentation blog best practices`,
    `${topic} platform comparison pricing features`,
  ];

  const contextual = contextHint?.trim()
    ? [`${topic} ${contextHint.trim()} documentation pricing features`, `${contextHint.trim()} best practices`]
    : [];

  return [...contextual, ...base];
}

function filterResearchUrls(urls: string[]): string[] {
  const filtered: string[] = [];
  const seen = new Set<string>();

  for (const rawUrl of urls) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;

      const normalized = `${url.origin}${url.pathname}`.replace(/\/$/, "");
      if (seen.has(normalized)) continue;

      const lower = `${url.hostname}${url.pathname}`.toLowerCase();
      const looksRelevant =
        /docs?|blog|guide|learn|pricing|features|compare|platform|product|solutions/.test(lower) ||
        /github\.io|\.dev$|\.org$|\.com$/.test(url.hostname);

      if (!looksRelevant) continue;

      seen.add(normalized);
      filtered.push(url.toString());
    } catch {
      continue;
    }
  }

  return filtered;
}

export async function discoverResearchSources(topic: string, contextHint?: string): Promise<ResearchSourceDiscovery> {
  const query = buildDiscoveryQueries(topic, contextHint)[0] ?? topic;
  const firecrawl = getFirecrawlClient();

  if (!firecrawl) {
    return {
      topic,
      query,
      urls: filterResearchUrls(RESEARCH_URLS[topic] ?? []),
    };
  }

  const queries = buildDiscoveryQueries(topic, contextHint);
  const discovered = new Set<string>();

  for (const searchQuery of queries) {
    try {
      const response = await firecrawl.search(searchQuery, 8);
      if (!response.success || !response.results) continue;

      for (const result of response.results) {
        if (result.url) discovered.add(result.url);
      }
    } catch (error) {
      logger.warn(`[phase1-research] Discovery search failed for "${searchQuery}": ${error}`);
    }
  }

  const urls = filterResearchUrls(Array.from(discovered));
  if (urls.length > 0) {
    return { topic, query, urls };
  }

  return {
    topic,
    query,
    urls: filterResearchUrls(RESEARCH_URLS[topic] ?? []),
  };
}

export async function firecrawlResearch(
  topic: string,
  urls: string[],
  options: { maxUrls?: number } = {},
): Promise<FirecrawlResearchResult> {
  const firecrawl = getFirecrawlClient();
  if (!firecrawl) {
    return { topic, findings: [], sources: [] };
  }

  const findings: string[] = [];
  const sources: string[] = [];
  const urlsToRead = urls.slice(0, options.maxUrls ?? urls.length);

  for (const url of urlsToRead) {
    try {
      const result = await firecrawl.scrapeUrl(url);
      const content = result.markdown?.trim() || result.html?.trim() || "";

      if (!content) continue;

      findings.push(summarizeContent(content, topic));
      sources.push(url);
    } catch (error) {
      logger.warn(`[phase1-research] Firecrawl scrape failed for ${url}: ${error}`);
    }
  }

  return { topic, findings, sources };
}

export async function runPhase1Research(
  config: ResearchConfig,
  projectDir?: string,
): Promise<ResearchResult[]> {
  const results: ResearchResult[] = [];

  for (const topic of config.topics) {
    const discovered = await discoverResearchSources(topic);
    const fallbackUrls = filterResearchUrls(RESEARCH_URLS[topic] || []);
    const urlsToScrape = (discovered.urls.length > 0 ? discovered.urls : fallbackUrls).slice(0, config.maxUrlsPerTopic);

    let findings: string[] = [];
    let sources: string[] = [];

    const firecrawl = await firecrawlResearch(topic, urlsToScrape, { maxUrls: config.maxUrlsPerTopic });
    findings = firecrawl.findings;
    sources = firecrawl.sources;

    if (findings.length === 0 || sources.length === 0) {
      for (const url of urlsToScrape) {
        const content = await scrapeUrl(url);
        if (content) {
          const summary = summarizeContent(content, topic);
          findings.push(summary);
          sources.push(url);
        }
      }
    }

    results.push({
      topic,
      findings: findings.join("\n\n"),
      sources,
    });

    logger.info(`[phase1-research] Completed research for topic: ${topic}`);
  }

  // Save research results
  if (projectDir) {
    const researchPath = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-1", "research.md");
    const researchContent = formatResearchMarkdown(results);
    await fs.mkdir(path.dirname(researchPath), { recursive: true });
    await fs.writeFile(researchPath, researchContent, "utf-8");
    logger.info(`[phase1-research] Saved research to ${researchPath}`);
  }

  return results;
}

function summarizeContent(content: string, topic: string): string {
  // Simple summarization - extract sentences that mention key terms
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const keyTerms = getKeyTermsForTopic(topic);

  const relevant = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return keyTerms.some((term) => lower.includes(term));
  });

  // Return top 3 relevant sentences
  const summary = relevant.slice(0, 3).map((s) => s.trim()).join(". ");
  return summary ? summary + "." : "Information not available for this topic.";
}

function getKeyTermsForTopic(topic: string): string[] {
  const termMap: Record<string, string[]> = {
    "frontend-frameworks": ["component", "state", "render", "virtual dom", "ssr", "hydra"],
    "backend-frameworks": ["server", "api", "route", "middleware", "async", "rest"],
    "databases": ["query", "schema", "index", "transaction", "replication", "sql", "nosql"],
    "ui-components": ["component", "design", "theme", "accessibility", "dark mode", "responsive"],
    "design-systems": ["design token", "component library", "style", "props", "variant"],
  };
  return termMap[topic] || ["overview", "features", "benefits", "getting started"];
}

function formatResearchMarkdown(results: ResearchResult[]): string {
  const lines = [
    "# Phase 1 Research Findings",
    "",
    `*Generated: ${new Date().toISOString()}*`,
    "",
  ];

  for (const result of results) {
    lines.push(`## ${formatTopicName(result.topic)}`);
    lines.push("");
    lines.push(result.findings);
    lines.push("");
    lines.push("**Sources:**");
    for (const source of result.sources) {
      lines.push(`- ${source}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function formatTopicName(topic: string): string {
  return topic
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Firecrawl MCP integration
export interface FirecrawlClient {
  scrape: (url: string, options?: { formats?: string[] }) => Promise<{ content?: string }>;
}

/**
 * Enhanced research with parallel scraping for speed
 */
export async function runPhase1ResearchEnhanced(
  config: ResearchConfig,
  userPrompt: string,
  projectDir?: string,
): Promise<ResearchResult[]> {
  // Detect relevant topics based on user prompt
  const relevantTopics = detectRelevantTopics(userPrompt, config.topics);
  logger.info(`[phase1-research] Relevant topics: ${relevantTopics.join(', ')}`);

  const results: ResearchResult[] = [];

  // Scrape topics in parallel for speed
  const topicPromises = relevantTopics.map(async (topic) => {
    const discovered = await discoverResearchSources(topic, userPrompt);
    const firecrawl = getFirecrawlClient();

    let findings: string[] = [];
    let sources: string[] = [];

    if (firecrawl) {
      const research = await firecrawlResearch(topic, discovered.urls, { maxUrls: config.maxUrlsPerTopic });
      findings = research.findings;
      sources = research.sources;
    }

    if (findings.length === 0 || sources.length === 0) {
      const fallbackUrls = filterResearchUrls(RESEARCH_URLS[topic] || []);
      const urlsToScrape = (discovered.urls.length > 0 ? discovered.urls : fallbackUrls).slice(0, config.maxUrlsPerTopic);

      const urlPromises = urlsToScrape.map(async (url) => {
        try {
          const content = await scrapeUrl(url);
          return { url, content: content.substring(0, 2000), success: !!content };
        } catch (error) {
          logger.warn(`[phase1-research] Failed to scrape ${url}: ${error}`);
          return { url, content: "", success: false };
        }
      });

      const urlResults = await Promise.all(urlPromises);
      const successfulResults = urlResults.filter((r) => r.success);
      findings = successfulResults.map((r) => r.content);
      sources = successfulResults.map((r) => r.url);
    }

    return {
      topic,
      findings: findings.join("\n\n"),
      sources,
    };
  });

  const topicResults = await Promise.all(topicPromises);
  results.push(...topicResults);

  // Generate AI-powered summary of research findings
  const summary = await generateResearchSummary(userPrompt, results);
  
  // Save research results
  if (projectDir) {
    const researchPath = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-1", "research.md");
    const researchContent = formatResearchMarkdown(results) + "\n\n" + summary;
    await fs.mkdir(path.dirname(researchPath), { recursive: true });
    await fs.writeFile(researchPath, researchContent, "utf-8");
    
    // Also save as JSON for programmatic access
    const jsonPath = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-1", "research.json");
    await fs.writeFile(jsonPath, JSON.stringify({ results, summary, generatedAt: new Date().toISOString() }, null, 2));
    
    logger.info(`[phase1-research] Saved research to ${researchPath}`);
  }

  return results;
}

/**
 * Detect relevant research topics based on user prompt
 */
function detectRelevantTopics(userPrompt: string, availableTopics: string[]): string[] {
  const promptLower = userPrompt.toLowerCase();
  const topicKeywords: Record<string, string[]> = {
    'frontend-frameworks': ['react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt', 'frontend', 'ui', 'component', 'web app'],
    'backend-frameworks': ['node', 'express', 'fastify', 'nest', 'go', 'api', 'server', 'backend'],
    'databases': ['database', 'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite', 'supabase', 'prisma', 'orm'],
    'ui-components': ['ui', 'component', 'shadcn', 'tailwind', 'bootstrap', 'material', 'design system', 'styled'],
    'design-systems': ['design', 'theme', 'brand', 'colors', 'typography', 'design system'],
    'css-frameworks': ['css', 'tailwind', 'bootstrap', 'bulma', 'styled', 'css-in-js'],
    'api-design': ['api', 'rest', 'graphql', 'grpc', 'openapi', 'swagger', 'endpoint'],
    'testing': ['test', 'testing', 'jest', 'vitest', 'playwright', 'cypress', 'qa', 'e2e'],
    'devops': ['docker', 'kubernetes', 'k8s', 'ci cd', 'github actions', 'gitlab', 'jenkins', 'deploy'],
    'cloud-providers': ['aws', 'azure', 'gcp', 'google cloud', 'vercel', 'netlify', 'heroku', 'cloud'],
    'realtime': ['websocket', 'socket', 'real-time', 'pusher', 'ably', 'firebase', 'sse'],
    'auth': ['auth', 'authentication', 'login', 'jwt', 'oauth', 'clerk', 'auth0', 'supabase auth'],
    'cms': ['cms', 'content', 'strapi', 'sanity', 'contentful', 'headless'],
    'ecommerce': ['ecommerce', 'shop', 'cart', 'payment', 'stripe', 'shopify'],
  };

  const relevant: string[] = [];
  
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    const matches = keywords.filter(kw => promptLower.includes(kw));
    if (matches.length > 0) {
      relevant.push(topic);
    }
  }

  // If no topics detected, return default important ones
  if (relevant.length === 0) {
    return ['frontend-frameworks', 'backend-frameworks', 'databases', 'api-design'];
  }

  return relevant;
}

/**
 * Generate AI-powered summary of research findings
 */
async function generateResearchSummary(userPrompt: string, results: ResearchResult[]): Promise<string> {
  try {
    const { generateText } = await import('ai');
    const { openrouter } = await import('@openrouter/ai-sdk-provider');
    
    const findingsText = results.map(r => 
      `## ${r.topic}\n${r.findings.substring(0, 500)}`
    ).join('\n\n');

    const prompt = `Based on the user's project requirements: "${userPrompt}"

Research findings:
${findingsText}

Provide a concise summary (2-3 paragraphs) highlighting:
1. Recommended technology stack based on the requirements
2. Key considerations for this type of project
3. Potential challenges and how to address them

Format as markdown.`;

    const response = await generateText({
      model: openrouter('anthropic/claude-3-5-haiku'),
      prompt,
      maxOutputTokens: 1000,
    });

    return `\n## Research Summary\n\n${response.text}`;
  } catch (error) {
    logger.warn(`[phase1-research] AI summary generation failed: ${error}`);
    return '';
  }
}

export async function runPhase1ResearchWithMCP(
  config: ResearchConfig,
  firecrawl: FirecrawlClient,
  projectDir?: string,
): Promise<ResearchResult[]> {
  const results: ResearchResult[] = [];

  for (const topic of config.topics) {
    const urls = RESEARCH_URLS[topic] || [];
    const urlsToScrape = urls.slice(0, config.maxUrlsPerTopic);

    const findings: string[] = [];
    const sources: string[] = [];

    for (const url of urlsToScrape) {
      try {
        const result = await firecrawl.scrape(url, { formats: ["markdown"] });
        if (result.content) {
          findings.push(result.content.substring(0, 2000));
          sources.push(url);
        }
      } catch (error) {
        logger.warn(`[phase1-research] Firecrawl failed for ${url}: ${error}`);
        // Fallback to basic scraping
        const content = await scrapeUrl(url);
        if (content) {
          findings.push(content.substring(0, 2000));
          sources.push(url);
        }
      }
    }

    results.push({
      topic,
      findings: findings.join("\n\n"),
      sources,
    });
  }

  if (projectDir) {
    const researchPath = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-1", "research.md");
    const researchContent = formatResearchMarkdown(results);
    await fs.mkdir(path.dirname(researchPath), { recursive: true });
    await fs.writeFile(researchPath, researchContent, "utf-8");
  }

  return results;
}
