import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

type ScrapeMode = "inspiration" | "registry";

export const CURATED_URLS = [
  "https://lightswind.com",
  "https://reactbits.dev",
  "https://daisyui.com",
  "https://preline.co",
  "https://tailwindflex.com",
  "https://dribbble.com",
  "https://magicui.design",
  "https://spline.design",
  "https://aura.build",
  "https://shadcnstudio.com",
  "https://tweakcn.com",
  "https://componentsui.com",
  "https://ui.shadcn.com",
  "https://flowbite.com",
  "https://mantine.dev",
  "https://chakra-ui.com",
  "https://ui.aceternity.com",
  "https://kokonutui.com",
] as const;

export interface ScrapedSnippet {
  selector: string;
  text: string;
}

export interface DesignInspirationResult {
  url: string;
  title: string;
  screenshotPath?: string;
  summary: string;
  snippets: ScrapedSnippet[];
  scrapedAt: string;
}

export interface RegistryComponentResult {
  name: string;
  description: string;
  codeSnippets: string[];
  source: string;
}

export interface ComponentRegistryResult {
  url: string;
  title: string;
  components: RegistryComponentResult[];
  scrapedAt: string;
}

export interface CuratedPipelineResult {
  phase: number;
  urls: string[];
  results: Array<DesignInspirationResult | ComponentRegistryResult>;
  cached: boolean;
}

const CACHE_ROOT = path.join(process.cwd(), ".pakalon-agents", "scrape-cache");

function hashKey(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function cachePath(mode: ScrapeMode, url: string): string {
  return path.join(CACHE_ROOT, `${mode}-${hashKey(url)}.json`);
}

function screenshotPath(url: string): string {
  return path.join(CACHE_ROOT, `${hashKey(`${url}:screenshot`)}.png`);
}

async function ensureCacheRoot(): Promise<void> {
  await fs.mkdir(CACHE_ROOT, { recursive: true });
}

async function loadCached<T>(mode: ScrapeMode, url: string): Promise<T | null> {
  try {
    const data = await fs.readFile(cachePath(mode, url), "utf8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function saveCached<T>(mode: ScrapeMode, url: string, data: T): Promise<void> {
  await ensureCacheRoot();
  await fs.writeFile(cachePath(mode, url), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function withBrowser<T>(fn: (page: import("playwright").Page) => Promise<T>): Promise<T> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
    const page = await context.newPage();
    try {
      return await fn(page);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

function compact(text: string, maxLength = 280): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

async function extractSnippets(page: import("playwright").Page): Promise<ScrapedSnippet[]> {
  const snippets = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("pre code, code, [data-component], [data-testid], article, section"));
    return nodes
      .map((node) => {
        const text = node.textContent?.trim() ?? "";
        const selector = node.tagName.toLowerCase();
        return { selector, text };
      })
      .filter((item) => item.text.length > 24)
      .slice(0, 12);
  });

  return snippets.map((snippet) => ({ selector: snippet.selector, text: compact(snippet.text, 500) }));
}

function pickRegistryComponentBlocks(title: string, snippets: ScrapedSnippet[]): RegistryComponentResult[] {
  const seen = new Set<string>();
  const components: RegistryComponentResult[] = [];

  for (const snippet of snippets) {
    const lines = snippet.text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const firstLine = lines[0] ?? title;
    const name = firstLine.replace(/[^\w\-\s]/g, "").trim().slice(0, 64) || title;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    components.push({
      name,
      description: compact(lines.slice(1).join(" ") || snippet.text, 220),
      codeSnippets: [snippet.text.slice(0, 1200)],
      source: snippet.selector,
    });
  }

  return components.slice(0, 12);
}

export async function scrapeDesignInspiration(url: string): Promise<DesignInspirationResult> {
  const cached = await loadCached<DesignInspirationResult>("inspiration", url);
  if (cached) return cached;

  await ensureCacheRoot();
  const result = await withBrowser(async (page) => {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.screenshot({ path: screenshotPath(url), fullPage: true });

    const title = await page.title();
    const snippets = await extractSnippets(page);
    const summary = compact(await page.locator("body").innerText().catch(() => ""), 360);

    return {
      url,
      title,
      screenshotPath: screenshotPath(url),
      summary,
      snippets,
      scrapedAt: new Date().toISOString(),
    } satisfies DesignInspirationResult;
  });

  await saveCached("inspiration", url, result);
  return result;
}

export async function scrapeComponentRegistry(url: string): Promise<ComponentRegistryResult> {
  const cached = await loadCached<ComponentRegistryResult>("registry", url);
  if (cached) return cached;

  const result = await withBrowser(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500).catch(() => undefined);

    const title = await page.title();
    const snippets = await extractSnippets(page);
    const headings = await page.evaluate(() =>
      Array.from(document.querySelectorAll("h1, h2, h3, h4"))
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean)
        .slice(0, 20),
    );

    const components = pickRegistryComponentBlocks(title, snippets);
    for (const heading of headings) {
      const normalized = heading.replace(/\s+/g, " ").trim();
      if (!components.some((component) => component.name.toLowerCase() === normalized.toLowerCase())) {
        components.unshift({
          name: normalized,
          description: `Referenced from ${new URL(url).hostname}`,
          codeSnippets: [],
          source: "heading",
        });
      }
    }

    return {
      url,
      title,
      components: components.slice(0, 20),
      scrapedAt: new Date().toISOString(),
    } satisfies ComponentRegistryResult;
  });

  await saveCached("registry", url, result);
  return result;
}

function phaseUrls(targetPhase: number): string[] {
  const inspiration = [
    "https://lightswind.com",
    "https://reactbits.dev",
    "https://dribbble.com",
    "https://magicui.design",
    "https://spline.design",
    "https://aura.build",
  ];
  const registry = [
    "https://daisyui.com",
    "https://preline.co",
    "https://tailwindflex.com",
    "https://shadcnstudio.com",
    "https://tweakcn.com",
    "https://componentsui.com",
    "https://ui.shadcn.com",
    "https://flowbite.com",
    "https://mantine.dev",
    "https://chakra-ui.com",
    "https://ui.aceternity.com",
    "https://kokonutui.com",
  ];

  if (targetPhase <= 1) return inspiration;
  if (targetPhase >= 3) return registry;
  return [...inspiration, ...registry];
}

export async function runCuratedScrapePipeline(targetPhase: number): Promise<CuratedPipelineResult> {
  const urls = phaseUrls(targetPhase);
  const mode: ScrapeMode = targetPhase >= 3 ? "registry" : "inspiration";
  const cachedResults: Array<DesignInspirationResult | ComponentRegistryResult> = [];
  let cached = true;

  for (const url of urls) {
    const cachedItem = await loadCached<DesignInspirationResult | ComponentRegistryResult>(mode, url);
    if (cachedItem) {
      cachedResults.push(cachedItem);
      continue;
    }

    cached = false;
    if (mode === "inspiration") {
      cachedResults.push(await scrapeDesignInspiration(url));
    } else {
      cachedResults.push(await scrapeComponentRegistry(url));
    }
  }

  return {
    phase: targetPhase,
    urls,
    results: cachedResults,
    cached,
  };
}
