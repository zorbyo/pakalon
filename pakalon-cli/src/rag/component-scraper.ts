import { FirecrawlMCP } from "@/integrations/mcp.js";
import { scrapeUrl } from "@/scrape/scraper.js";
import logger from "@/utils/logger.js";
import type { ComponentEntry } from "./component-registry.js";

export interface ScrapeCandidate {
  url: string;
  name?: string;
  category?: ComponentEntry["category"];
  framework?: ComponentEntry["framework"];
  tags?: string[];
}

export interface ScrapedComponentDraft {
  url: string;
  title: string;
  markdown: string;
  code: string;
  description: string;
  tags: string[];
  category: ComponentEntry["category"];
  framework: ComponentEntry["framework"];
  complexity: ComponentEntry["complexity"];
  dependencies: string[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractTitle(markdown: string, fallbackUrl: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const title = markdown.match(/^##\s+(.+)$/m)?.[1]?.trim();
  return title || new URL(fallbackUrl).hostname;
}

function extractCodeBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const fence = /```(?:tsx?|jsx?|html|css|javascript|js)?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(markdown)) !== null) {
    const code = match[1]?.trim();
    if (code) blocks.push(code);
  }
  return blocks;
}

function inferFramework(markdown: string, url: string): ComponentEntry["framework"] {
  const text = `${markdown} ${url}`.toLowerCase();
  if (text.includes("vue")) return "vue";
  if (text.includes("html") || text.includes("css") || text.includes("tailwind")) return "html";
  return "react";
}

function inferCategory(markdown: string, title: string): ComponentEntry["category"] {
  const text = `${title} ${markdown}`.toLowerCase();
  if (/nav|menu|breadcrumb|tabs|sidebar/.test(text)) return "navigation";
  if (/form|input|select|validation|login|signup/.test(text)) return "form";
  if (/table|chart|metric|dashboard|card|grid|list/.test(text)) return "data-display";
  if (/toast|alert|modal|dialog|banner|notification|feedback/.test(text)) return "feedback";
  if (/layout|shell|header|footer|hero|section/.test(text)) return "layout";
  return "ui";
}

function inferComplexity(code: string): ComponentEntry["complexity"] {
  const lines = code.split(/\r?\n/).length;
  if (lines > 80 || /use(State|Effect|Memo)|context|animation/i.test(code)) return "complex";
  if (lines > 30) return "medium";
  return "simple";
}

function inferDependencies(code: string): string[] {
  const deps = new Set<string>();
  if (/react/i.test(code)) deps.add("react");
  if (/framer-motion/i.test(code)) deps.add("framer-motion");
  if (/lucide-react/i.test(code)) deps.add("lucide-react");
  if (/date-fns/i.test(code)) deps.add("date-fns");
  return Array.from(deps);
}

function inferTags(markdown: string, title: string, code: string, existing: string[] = []): string[] {
  const base = new Set(existing.map((tag) => tag.toLowerCase()));
  const text = `${title} ${markdown} ${code}`.toLowerCase();
  const candidates = ["button", "card", "dashboard", "modal", "drawer", "navigation", "sidebar", "table", "form", "input", "toast", "alert", "hero", "layout", "pricing", "chart", "tabs", "accordion"];

  for (const tag of candidates) if (text.includes(tag)) base.add(tag);
  if (code.includes("className")) base.add("tailwind");
  if (code.includes("<svg")) base.add("svg");
  if (/rounded|shadow|border/.test(code)) base.add("ui");
  return Array.from(base);
}

async function describeComponent(input: { title: string; markdown: string; code: string; url: string; framework: ComponentEntry["framework"]; category: ComponentEntry["category"]; }): Promise<string> {
  const prompt = [
    `Component title: ${input.title}`,
    `Source URL: ${input.url}`,
    `Framework: ${input.framework}`,
    `Category: ${input.category}`,
    "",
    "Source markdown:",
    input.markdown.slice(0, 4000),
    "",
    "Extracted code:",
    input.code.slice(0, 4000),
  ].join("\n");

  try {
    const { text } = await (await import("@/ai/openrouter.js")).generateCompletion({
      model: process.env.PAKALON_COMPONENT_MODEL ?? "openrouter/auto",
      messages: [
        { role: "system", content: "Summarize UI components into concise retrieval-friendly descriptions. Return one sentence." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      maxTokens: 120,
      privacyLevel: "full",
    });

    const normalized = normalizeWhitespace(text);
    if (normalized) return normalized;
  } catch (error) {
    logger.debug(`[rag] Description generation fallback: ${String(error)}`);
  }

  return normalizeWhitespace(`${input.title} is a ${input.category} component built for ${input.framework} apps.`);
}

export async function scrapeComponentCandidate(candidate: ScrapeCandidate): Promise<ScrapedComponentDraft | null> {
  try {
    const firecrawl = new FirecrawlMCP();
    const firecrawlResult = await firecrawl.scrapeUrl(candidate.url);
    const scraped = firecrawlResult.markdown?.trim() || firecrawlResult.html?.trim() || (await scrapeUrl({ url: candidate.url })).markdown?.trim() || "";
    if (!scraped) return null;

    const title = candidate.name?.trim() || extractTitle(scraped, candidate.url);
    const codeBlocks = extractCodeBlocks(scraped);
    const code = codeBlocks[0] ?? scraped.slice(0, 4000);
    const framework = candidate.framework ?? inferFramework(scraped, candidate.url);
    const category = candidate.category ?? inferCategory(scraped, title);
    const complexity = inferComplexity(code);
    const description = await describeComponent({ title, markdown: scraped, code, url: candidate.url, framework, category });
    const tags = inferTags(scraped, title, code, candidate.tags ?? []);

    return {
      url: candidate.url,
      title,
      markdown: scraped,
      code,
      description,
      tags,
      category,
      framework,
      complexity,
      dependencies: inferDependencies(code),
    };
  } catch (error) {
    logger.warn(`[rag] Failed to scrape component candidate ${candidate.url}: ${String(error)}`);
    return null;
  }
}

export async function scrapeComponents(candidates: ScrapeCandidate[]): Promise<ScrapedComponentDraft[]> {
  const results = await Promise.all(candidates.map((candidate) => scrapeComponentCandidate(candidate)));
  return results.filter((value): value is ScrapedComponentDraft => Boolean(value));
}
