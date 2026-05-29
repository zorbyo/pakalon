import * as fs from "fs/promises";
import * as path from "path";
import logger from "@/utils/logger.js";
import { FirecrawlMCP } from "@/integrations/mcp.js";

interface CompetitorProfile {
  name: string;
  url: string;
  features: string[];
  pricing: string;
  differentiation: string;
}

interface CompetitorSeed {
  name: string;
  url: string;
  focus: string;
}

const COMPETITOR_MAP: Record<string, CompetitorSeed[]> = {
  saas: [
    { name: "Linear", url: "https://linear.app", focus: "productivity and issue tracking" },
    { name: "Notion", url: "https://www.notion.so", focus: "workspace and collaboration" },
    { name: "Airtable", url: "https://airtable.com", focus: "database-driven workflows" },
    { name: "ClickUp", url: "https://clickup.com", focus: "project management" },
    { name: "Monday.com", url: "https://monday.com", focus: "work management" },
  ],
  ecommerce: [
    { name: "Shopify", url: "https://www.shopify.com", focus: "online stores" },
    { name: "BigCommerce", url: "https://www.bigcommerce.com", focus: "enterprise commerce" },
    { name: "WooCommerce", url: "https://woocommerce.com", focus: "WordPress commerce" },
    { name: "Saleor", url: "https://saleor.io", focus: "headless commerce" },
    { name: "Medusa", url: "https://medusajs.com", focus: "headless commerce" },
  ],
  crm: [
    { name: "HubSpot", url: "https://www.hubspot.com", focus: "sales and marketing CRM" },
    { name: "Salesforce", url: "https://www.salesforce.com", focus: "enterprise CRM" },
    { name: "Pipedrive", url: "https://www.pipedrive.com", focus: "sales pipeline CRM" },
    { name: "Zoho CRM", url: "https://www.zoho.com/crm/", focus: "business CRM" },
    { name: "Freshsales", url: "https://www.freshworks.com/crm/", focus: "SMB CRM" },
  ],
  cms: [
    { name: "Contentful", url: "https://www.contentful.com", focus: "headless CMS" },
    { name: "Sanity", url: "https://www.sanity.io", focus: "structured content" },
    { name: "Strapi", url: "https://strapi.io", focus: "self-hosted CMS" },
    { name: "Prismic", url: "https://prismic.io", focus: "content editing" },
    { name: "Ghost", url: "https://ghost.org", focus: "publishing" },
  ],
  analytics: [
    { name: "Amplitude", url: "https://amplitude.com", focus: "product analytics" },
    { name: "Mixpanel", url: "https://mixpanel.com", focus: "event analytics" },
    { name: "PostHog", url: "https://posthog.com", focus: "product analytics" },
    { name: "Hotjar", url: "https://www.hotjar.com", focus: "behavior analytics" },
    { name: "Looker", url: "https://looker.com", focus: "BI and reporting" },
  ],
  "developer-tools": [
    { name: "Replit", url: "https://replit.com", focus: "developer workspace" },
    { name: "Cursor", url: "https://cursor.com", focus: "AI coding editor" },
    { name: "Supabase", url: "https://supabase.com", focus: "developer platform" },
    { name: "Vercel", url: "https://vercel.com", focus: "deployment platform" },
    { name: "Railway", url: "https://railway.app", focus: "developer infrastructure" },
  ],
};

function getCompetitorSeeds(productCategory: string): CompetitorSeed[] {
  return COMPETITOR_MAP[productCategory] ?? COMPETITOR_MAP.saas ?? [];
}

function extractTextFromMarkdown(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
}

function pickFeatureStatements(markdown: string): string[] {
  const text = extractTextFromMarkdown(markdown);
  const sentences = text.split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  return sentences.filter((sentence) => /feature|capabilit|workflow|automation|collaborat|analytics|pricing|integrat/i.test(sentence)).slice(0, 5);
}

function inferPricing(markdown: string): string {
  const pricingSentence = markdown
    .split(/[\n\.\!\?]+/)
    .map((item) => item.trim())
    .find((sentence) => /pricing|plan|per month|free|enterprise|starter|business/i.test(sentence));

  return pricingSentence || "Pricing not clearly stated on the discovered source.";
}

function inferDifferentiation(markdown: string, seed: CompetitorSeed): string {
  const focus = seed.focus;
  const snippets = pickFeatureStatements(markdown);
  if (snippets.length > 0) {
    return `${seed.name} appears positioned around ${focus}; notable strengths include ${snippets[0]}`;
  }
  return `${seed.name} is positioned around ${focus}.`;
}

async function scrapeCompetitor(seed: CompetitorSeed): Promise<CompetitorProfile> {
  const firecrawl = new FirecrawlMCP();
  let markdown = "";

  try {
    const result = await firecrawl.scrapeUrl(seed.url);
    markdown = result.markdown?.trim() || result.html?.trim() || "";
  } catch (error) {
    logger.warn(`[competitive-analysis] Firecrawl scrape failed for ${seed.url}: ${error}`);
  }

  if (!markdown) {
    try {
      const response = await fetch(seed.url, { signal: AbortSignal.timeout(15000) });
      markdown = await response.text();
    } catch (error) {
      logger.warn(`[competitive-analysis] Fallback fetch failed for ${seed.url}: ${error}`);
    }
  }

  const features = pickFeatureStatements(markdown);
  return {
    name: seed.name,
    url: seed.url,
    features: features.length > 0 ? features : ["Feature details not clearly available from source."],
    pricing: inferPricing(markdown),
    differentiation: inferDifferentiation(markdown, seed),
  };
}

function formatReport(productCategory: string, competitors: CompetitorProfile[]): string {
  const lines = [
    `# Competitive Analysis: ${productCategory}`,
    "",
    `*Generated: ${new Date().toISOString()}*`,
    "",
    "## Top Competitors",
    "",
    "| Competitor | Features | Pricing | Differentiation |",
    "| --- | --- | --- | --- |",
  ];

  for (const competitor of competitors) {
    lines.push(
      `| ${competitor.name} | ${competitor.features.join("; ").replace(/\|/g, " ")} | ${competitor.pricing.replace(/\|/g, " ")} | ${competitor.differentiation.replace(/\|/g, " ")} |`,
    );
  }

  lines.push("", "## Strategic Opportunities", "");
  lines.push("- Focus on workflow speed and low-friction onboarding.");
  lines.push("- Differentiate with stronger automation and AI assistance.");
  lines.push("- Win on clarity of pricing and product positioning.");

  return lines.join("\n");
}

export async function runCompetitiveAnalysis(productCategory: string, projectDir: string): Promise<string> {
  const seeds = getCompetitorSeeds(productCategory).slice(0, 5);
  const competitors = await Promise.all(seeds.map((seed) => scrapeCompetitor(seed)));
  const report = formatReport(productCategory, competitors);

  const outputPath = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-1", "competitive-analysis.md");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, report, "utf-8");
  logger.info(`[competitive-analysis] Saved report to ${outputPath}`);

  return report;
}
