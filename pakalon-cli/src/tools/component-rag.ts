import * as cheerio from "cheerio";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import logger from "@/utils/logger.js";
import { scrapeUrl } from "@/scrape/scraper.js";

export interface ComponentSource {
  name: string;
  description: string;
  url: string;
  sourceCode?: string;
  category: string;
  framework: "react" | "vue" | "vanilla" | "other";
  tags: string[];
  previewUrl?: string;
}

export interface ComponentResult {
  source: ComponentSource;
  relevanceScore: number;
  matchedTerms: string[];
}

interface RegistryFile {
  version: string;
  updatedAt: string;
  sources: string[];
  components: ComponentSource[];
  semanticIndex: Record<string, string[]>;
}

interface PageCandidate {
  url: string;
  sourceUrl: string;
}

const REGISTRY_VERSION = "1.0.0";
const REGISTRY_PATH = path.join(process.cwd(), ".pakalon", "component-registry.json");

const COMPONENT_WEBSITES = [
  "https://lightswind.com/components",
  "https://reactbits.dev/",
  "https://daisyui.com/",
  "https://preline.co/",
  "https://tailwindflex.com/",
  "https://magicui.design/",
  "https://shadcnstudio.com/",
  "https://tweakcn.com/",
  "https://www.aura.build/components",
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "could", "do", "does", "for", "from", "had", "has", "have", "how", "i",
  "if", "in", "is", "it", "its", "just", "like", "may", "more", "my", "need",
  "not", "of", "on", "or", "our", "please", "should", "so", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "to", "too", "use", "using", "want", "was", "we", "what", "when", "where",
  "which", "who", "why", "will", "with", "would", "you", "your",
]);

const STYLE_BOOSTS = [
  "minimal", "clean", "modern", "glass", "glassmorphism", "dark", "light", "animated",
  "motion", "gradient", "neumorphic", "dashboard", "landing", "hero", "pricing",
  "sidebar", "navbar", "form", "modal", "table", "card", "tabs", "accordion",
  "toast", "chart", "authentication", "signup", "login", "onboarding", "portfolio",
  "ecommerce", "marketing", "admin", "docs", "search", "filter", "profile", "settings",
];

let registryState: RegistryFile | null = null;
let registryLoadPromise: Promise<RegistryFile> | null = null;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "component";
}

function shortHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function extractTerms(input: string): string[] {
  const tokens = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));

  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a && b) bigrams.push(`${a} ${b}`);
  }

  return unique([...tokens, ...bigrams]);
}

function inferFramework(text: string): ComponentSource["framework"] {
  const value = text.toLowerCase();
  if (value.includes("<template") || value.includes("vue") || value.includes("v-model") || value.includes("v-if")) return "vue";
  if (value.includes("classname") || value.includes("jsx") || value.includes("tsx") || value.includes("react") || /export\s+(function|const|class)\s+[A-Z]/.test(value)) return "react";
  if (value.includes("<html") || value.includes("<div") || value.includes("tailwind") || value.includes("class=") || value.includes("classlist")) return "vanilla";
  return "other";
}

function inferCategory(text: string, name: string): string {
  const haystack = `${name} ${text}`.toLowerCase();
  if (/nav|menu|sidebar|breadcrumb|tabs|navbar|header|footer/.test(haystack)) return "navigation";
  if (/form|input|select|checkbox|radio|validation|login|signup|auth/.test(haystack)) return "form";
  if (/card|table|chart|metric|dashboard|stats?|grid|list|pricing/.test(haystack)) return "data-display";
  if (/toast|alert|modal|dialog|notification|feedback|banner/.test(haystack)) return "feedback";
  if (/layout|hero|section|shell|page|container/.test(haystack)) return "layout";
  return "ui";
}

function inferTags(text: string, name: string, code: string): string[] {
  const haystack = `${name} ${text} ${code}`.toLowerCase();
  const candidates = [
    "button", "card", "dashboard", "modal", "drawer", "navigation", "sidebar", "table",
    "form", "input", "toast", "alert", "hero", "layout", "pricing", "chart", "tabs",
    "accordion", "tooltip", "popover", "avatar", "badge", "search", "filter", "menu",
    "dropdown", "login", "signup", "profile", "settings", "analytics", "auth", "chat",
  ];
  return unique(candidates.filter((candidate) => haystack.includes(candidate)));
}

function inferNameFromCode(code: string): string | undefined {
  const match = code.match(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/)
    ?? code.match(/function\s+([A-Z][A-Za-z0-9_]*)/)
    ?? code.match(/const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*/);
  return match?.[1];
}

function isCodeLike(value: string): boolean {
  const text = normalizeText(value);
  if (text.length < 30) return false;
  return /className=|export\s+|function\s+|const\s+|return\s*\(|<[^>]+>|use(State|Effect|Memo)|tailwind|v-if|v-for/i.test(text);
}

function extractCodeBlocks(markdown: string, html: string): string[] {
  const blocks = new Set<string>();

  const markdownFence = /```(?:tsx?|jsx?|html?|css|javascript|js|ts|vue)?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = markdownFence.exec(markdown)) !== null) {
    const code = normalizeText(match[1] ?? "");
    if (isCodeLike(code)) blocks.add(code);
  }

  const $ = cheerio.load(html);
  $("pre code, code").each((_, element) => {
    const code = normalizeText($(element).text());
    if (isCodeLike(code)) blocks.add(code);
  });

  return Array.from(blocks);
}

function extractTitle(markdown: string, html: string, fallbackUrl: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;

  const $ = cheerio.load(html);
  const title = normalizeText($("h1").first().text() || $("title").text());
  if (title) return title;

  return new URL(fallbackUrl).hostname.replace(/^www\./, "");
}

function extractDescription(markdown: string, html: string): string {
  const paragraph = markdown
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .find((line) => line.length > 40 && !line.startsWith("```") && !line.startsWith("#"));
  if (paragraph) return paragraph.slice(0, 240);

  const $ = cheerio.load(html);
  const text = normalizeText($("main p, article p, section p, body p").first().text());
  return text.slice(0, 240);
}

function extractPreviewUrl(html: string, pageUrl: string): string | undefined {
  const $ = cheerio.load(html);
  const src = $("main img, article img, section img, img").first().attr("src");
  if (!src) return undefined;
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function buildComponentSource(input: {
  name: string;
  description: string;
  url: string;
  sourceCode?: string;
  category: string;
  framework: ComponentSource["framework"];
  tags: string[];
  previewUrl?: string;
}): ComponentSource {
  return {
    name: normalizeText(input.name),
    description: normalizeText(input.description),
    url: input.url,
    sourceCode: input.sourceCode ? input.sourceCode.trim() : undefined,
    category: input.category,
    framework: input.framework,
    tags: unique(input.tags.map((tag) => tag.toLowerCase())),
    previewUrl: input.previewUrl,
  };
}

function parsePageToComponents(pageUrl: string, html: string, markdown: string): ComponentSource[] {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, aside, noscript, iframe").remove();

  const pageTitle = extractTitle(markdown, html, pageUrl);
  const description = extractDescription(markdown, html);
  const previewUrl = extractPreviewUrl(html, pageUrl);
  const codeBlocks = extractCodeBlocks(markdown, html);
  const results: ComponentSource[] = [];

  for (const code of codeBlocks) {
    const container = $("pre, article, section, li, div").filter((_, element) => $(element).find("code, pre").length > 0).first();
    const blockText = normalizeText(container.text());
    const heading = normalizeText(container.find("h1, h2, h3, h4, h5, h6").first().text()) || pageTitle;
    const inferredName = inferNameFromCode(code) || heading || pageTitle;
    const componentName = normalizeText(inferredName || pageTitle);
    const framework = inferFramework(`${code} ${blockText} ${pageUrl}`);
    const category = inferCategory(`${blockText} ${markdown}`, componentName);
    const tags = inferTags(blockText || markdown, componentName, code);

    results.push(buildComponentSource({
      name: componentName,
      description: description || `${componentName} component from ${new URL(pageUrl).hostname.replace(/^www\./, "")}`,
      url: pageUrl,
      sourceCode: code,
      category,
      framework,
      tags,
      previewUrl,
    }));
  }

  if (results.length === 0) {
    results.push(buildComponentSource({
      name: pageTitle,
      description,
      url: pageUrl,
      sourceCode: undefined,
      category: inferCategory(markdown, pageTitle),
      framework: inferFramework(`${markdown} ${html}`),
      tags: inferTags(markdown, pageTitle, ""),
      previewUrl,
    }));
  }

  return results;
}

function isSameOrigin(candidate: string, rootUrl: URL): boolean {
  try {
    const parsed = new URL(candidate, rootUrl);
    return parsed.hostname === rootUrl.hostname;
  } catch {
    return false;
  }
}

function shouldFollowLink(href: string, text: string, rootUrl: URL): boolean {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return false;
  const resolved = new URL(href, rootUrl);
  if (resolved.hostname !== rootUrl.hostname) return false;

  const haystack = `${resolved.pathname} ${text}`.toLowerCase();
  return /component|components|ui|block|blocks|pattern|patterns|example|examples|gallery|library|docs|design|button|card|modal|form|layout|navbar|sidebar|accordion|tabs|toast|alert|table|pricing|hero/.test(haystack);
}

async function discoverCandidates(seedUrl: string, maxPages = 12): Promise<PageCandidate[]> {
  const rootUrl = new URL(seedUrl);
  const queue: PageCandidate[] = [{ url: seedUrl, sourceUrl: seedUrl }];
  const visited = new Set<string>();
  const discovered: PageCandidate[] = [];

  while (queue.length > 0 && discovered.length < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current.url)) continue;
    visited.add(current.url);
    discovered.push(current);

    try {
      const result = await scrapeUrl({ url: current.url, formats: ["html", "markdown"], maxChars: 120000, timeout: 20000 });
      if (!result.success || !result.html) continue;

      const $ = cheerio.load(result.html);
      $("a[href]").each((_, element) => {
        const href = normalizeText($(element).attr("href") ?? "");
        const text = normalizeText($(element).text());
        if (!shouldFollowLink(href, text, rootUrl)) return;

        const resolved = new URL(href, seedUrl).toString();
        if (!visited.has(resolved) && queue.length + discovered.length < maxPages) {
          queue.push({ url: resolved, sourceUrl: seedUrl });
        }
      });
    } catch (error) {
      logger.warn(`[component-rag] Link discovery failed for ${current.url}: ${String(error)}`);
    }
  }

  return discovered;
}

function buildSemanticIndex(components: ComponentSource[]): Record<string, string[]> {
  const index = new Map<string, Set<string>>();

  for (const component of components) {
    const semanticText = [
      component.name,
      component.description,
      component.category,
      component.framework,
      component.tags.join(" "),
      component.sourceCode ?? "",
    ].join(" ");

    for (const term of extractTerms(semanticText)) {
      if (!index.has(term)) index.set(term, new Set<string>());
      index.get(term)?.add(component.url + "|" + component.name);
    }
  }

  return Object.fromEntries(Array.from(index.entries()).map(([term, ids]) => [term, Array.from(ids)]));
}

async function loadRegistryFromDisk(): Promise<RegistryFile> {
  if (registryState) return registryState;
  if (!registryLoadPromise) {
    registryLoadPromise = (async () => {
      try {
        const raw = await fs.readFile(REGISTRY_PATH, "utf-8");
        const parsed = JSON.parse(raw) as Partial<RegistryFile>;
        const components = Array.isArray(parsed.components) ? parsed.components : [];
        const registry: RegistryFile = {
          version: parsed.version ?? REGISTRY_VERSION,
          updatedAt: parsed.updatedAt ?? new Date().toISOString(),
          sources: Array.isArray(parsed.sources) ? parsed.sources : [],
          components,
          semanticIndex: parsed.semanticIndex ?? buildSemanticIndex(components),
        };
        registryState = registry;
        return registry;
      } catch {
        const empty: RegistryFile = {
          version: REGISTRY_VERSION,
          updatedAt: new Date().toISOString(),
          sources: [],
          components: [],
          semanticIndex: {},
        };
        registryState = empty;
        return empty;
      }
    })();
  }

  return registryLoadPromise;
}

async function saveRegistry(registry: RegistryFile): Promise<void> {
  await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  registryState = registry;
}

function mergeComponents(existing: ComponentSource[], incoming: ComponentSource[]): ComponentSource[] {
  const byKey = new Map<string, ComponentSource>();
  for (const item of existing) {
    const key = `${item.url}|${slugify(item.name)}|${shortHash(item.sourceCode ?? item.description)}`;
    byKey.set(key, item);
  }
  for (const item of incoming) {
    const key = `${item.url}|${slugify(item.name)}|${shortHash(item.sourceCode ?? item.description)}`;
    byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function scoreComponent(component: ComponentSource, terms: string[], query: string): { score: number; matchedTerms: string[] } {
  const haystack = [
    component.name,
    component.description,
    component.category,
    component.framework,
    component.tags.join(" "),
    component.sourceCode ?? "",
    component.previewUrl ?? "",
  ].join(" ").toLowerCase();

  const matchedTerms: string[] = [];
  let score = 0;

  for (const term of terms) {
    if (component.name.toLowerCase().includes(term)) {
      score += term.includes(" ") ? 1.25 : 1;
      matchedTerms.push(term);
      continue;
    }
    if (component.description.toLowerCase().includes(term)) {
      score += term.includes(" ") ? 0.9 : 0.75;
      matchedTerms.push(term);
      continue;
    }
    if (component.tags.some((tag) => tag.includes(term))) {
      score += 0.7;
      matchedTerms.push(term);
      continue;
    }
    if (component.category.toLowerCase().includes(term) || component.framework.includes(term as ComponentSource["framework"])) {
      score += 0.5;
      matchedTerms.push(term);
      continue;
    }
    if ((component.sourceCode ?? "").toLowerCase().includes(term)) {
      score += 0.3;
      matchedTerms.push(term);
    }
  }

  const queryLower = query.toLowerCase();
  if (component.name && queryLower.includes(component.name.toLowerCase())) score += 2;

  return { score, matchedTerms: unique(matchedTerms) };
}

export async function indexComponentWebsites(): Promise<void> {
  const registry = await loadRegistryFromDisk();

  const cachedByUrl = new Set(registry.components.map((item) => item.url));
  const discoveredComponents: ComponentSource[] = [];

  for (const website of COMPONENT_WEBSITES) {
    try {
      const candidates = await discoverCandidates(website);
      for (const candidate of candidates) {
        if (cachedByUrl.has(candidate.url)) continue;

        const result = await scrapeUrl({ url: candidate.url, formats: ["html", "markdown"], maxChars: 120000, timeout: 25000 });
        if (!result.success || (!result.html && !result.markdown)) continue;

        const html = result.html ?? "";
        const markdown = result.markdown ?? "";
        const pageComponents = parsePageToComponents(candidate.url, html, markdown);
        for (const component of pageComponents) {
          discoveredComponents.push(component);
          cachedByUrl.add(component.url);
        }
      }
    } catch (error) {
      logger.warn(`[component-rag] Failed to index ${website}: ${String(error)}`);
    }
  }

  const merged = mergeComponents(registry.components, discoveredComponents);
  const nextRegistry: RegistryFile = {
    version: REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    sources: unique([...(registry.sources ?? []), ...COMPONENT_WEBSITES]),
    components: merged,
    semanticIndex: buildSemanticIndex(merged),
  };

  await saveRegistry(nextRegistry);
}

export async function searchComponents(query: string, limit = 8): Promise<ComponentResult[]> {
  const registry = await loadRegistryFromDisk();
  if (!registry.components.length) {
    try {
      await indexComponentWebsites();
    } catch (error) {
      logger.warn(`[component-rag] Initial indexing failed: ${String(error)}`);
    }
  }

  const activeRegistry = registryState ?? registry;
  const terms = extractTerms(query);
  if (!terms.length || !activeRegistry.components.length) return [];

  const termIndex = activeRegistry.semanticIndex ?? {};
  const candidateKeys = new Set<string>();

  for (const term of terms) {
    for (const key of termIndex[term] ?? []) {
      candidateKeys.add(key);
    }
  }

  const candidates = candidateKeys.size > 0
    ? activeRegistry.components.filter((component) => candidateKeys.has(`${component.url}|${component.name}`))
    : activeRegistry.components;

  const scored = candidates
    .map((component) => {
      const { score, matchedTerms } = scoreComponent(component, terms, query);
      const styleBoost = STYLE_BOOSTS.reduce((sum, term) => sum + ((component.name + " " + component.description + " " + component.tags.join(" ")).toLowerCase().includes(term) ? 0.18 : 0), 0);
      const normalizedScore = Math.min(score + styleBoost, 10);
      return {
        source: component,
        relevanceScore: normalizedScore,
        matchedTerms,
      } satisfies ComponentResult;
    })
    .filter((item) => item.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);

  return scored;
}

export async function getRegistrySnapshot(): Promise<RegistryFile> {
  return loadRegistryFromDisk();
}

export const componentRegistryPath = REGISTRY_PATH;
export const componentWebsites = COMPONENT_WEBSITES;

export default {
  searchComponents,
  indexComponentWebsites,
  getRegistrySnapshot,
  componentRegistryPath,
  componentWebsites,
};
