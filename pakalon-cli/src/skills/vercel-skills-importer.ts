import * as fs from "fs/promises";
import * as path from "path";
import logger from "@/utils/logger.js";
import { scrapeUrl } from "@/scrape/scraper.js";
import { parseFrontmatter } from "@/utils/frontmatterParser.js";
import { extractDescriptionFromMarkdown } from "@/utils/markdownConfigLoader.js";

export interface VercelSkill {
  name: string;
  description: string;
  url: string;
  category: string;
  source: "github" | "skills.sh";
  keywords: string[];
}

export interface RelevantSkill extends VercelSkill {
  relevanceScore: number;
  matchedTerms: string[];
}

export interface SkillSearchOptions {
  limit?: number;
  minScore?: number;
  cacheTtlMs?: number;
  sources?: Array<VercelSkill["source"]>;
}

interface SkillCacheFile {
  fetchedAt: string;
  skills: VercelSkill[];
}

interface SkillParseResult {
  name: string;
  description: string;
  category: string;
  keywords: string[];
}

const GITHUB_REPO = "vercel-labs/agent-skills";
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";
const SKILLS_SH_INDEX = "https://skills.sh/vercel-labs/agent-skills";
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = path.join(process.cwd(), ".pakalon", "skills-cache.json");

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[\s/-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getCacheTtlMs(options?: SkillSearchOptions): number {
  return options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
}

async function readCache(): Promise<SkillCacheFile | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as SkillCacheFile;
    if (!parsed || !Array.isArray(parsed.skills)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function filterSkills(skills: VercelSkill[], options: SkillSearchOptions): VercelSkill[] {
  let filtered = skills;

  if (options.sources?.length) {
    filtered = filtered.filter((skill) => options.sources?.includes(skill.source));
  }

  return filtered;
}

async function writeCache(skills: VercelSkill[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const cache: SkillCacheFile = {
      fetchedAt: new Date().toISOString(),
      skills,
    };
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (error) {
    logger.warn(`[skills] Failed to write cache: ${error}`);
  }
}

async function readText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "PakalonCLI/1.0",
      Accept: "text/plain, text/markdown, text/html, application/json;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }

  return response.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "PakalonCLI/1.0",
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }

  return (await response.json()) as T;
}

function deriveCategory(url: string, filePath?: string, frontmatterCategory?: string): string {
  const explicit = safeString(frontmatterCategory);
  if (explicit) return explicit;

  if (filePath) {
    const parts = filePath.split(/[\\/]+/).filter(Boolean);
    const meaningful = parts.find((part) => part !== "README.md" && !part.endsWith(".md"));
    if (meaningful) return meaningful;
    if (parts.length > 1) return parts[0] ?? "general";
  }

  try {
    const parsed = new URL(url);
    const pieces = parsed.pathname.split("/").filter(Boolean);
    const last = pieces.at(-1) ?? "general";
    return last.replace(/\.md$/i, "") || parsed.hostname;
  } catch {
    return "general";
  }
}

function parseSkillMarkdown(markdown: string, fallbackName: string, url: string, filePath?: string): SkillParseResult {
  const { frontmatter, content } = parseFrontmatter(markdown);
  const fm = frontmatter as Record<string, unknown>;

  const name = safeString(fm.name) || fallbackName;
  const frontmatterDescription = safeString(fm.description);
  const description = frontmatterDescription || extractDescriptionFromMarkdown(content, name);
  const category = deriveCategory(url, filePath, safeString(fm.category));

  const keywords = uniq([
    ...tokenize(name),
    ...tokenize(description),
    ...tokenize(category),
    ...(Array.isArray(fm.keywords) ? fm.keywords.flatMap((item) => tokenize(String(item))) : []),
    ...(Array.isArray(fm.tags) ? fm.tags.flatMap((item) => tokenize(String(item))) : []),
  ]);

  return { name, description, category, keywords };
}

function normalizeSkill(skill: VercelSkill): VercelSkill {
  return {
    ...skill,
    name: skill.name.trim(),
    description: skill.description.trim(),
    url: skill.url.trim(),
    category: skill.category.trim() || "general",
    keywords: uniq(skill.keywords.map((keyword) => normalizeText(keyword)).filter(Boolean)),
  };
}

function buildSkill(source: VercelSkill["source"], url: string, markdown: string, filePath?: string): VercelSkill {
  const fallbackName = (() => {
    try {
      const pathname = new URL(url).pathname.split("/").filter(Boolean);
      const last = pathname.at(-1) ?? "skill";
      return last.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
    } catch {
      return filePath ? path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ") : "skill";
    }
  })();

  const parsed = parseSkillMarkdown(markdown, fallbackName, url, filePath);

  return normalizeSkill({
    name: parsed.name,
    description: parsed.description,
    url,
    category: parsed.category,
    source,
    keywords: parsed.keywords,
  });
}

async function fetchGithubSkills(): Promise<VercelSkill[]> {
  const repoInfo = await fetchJson<{ default_branch?: string }>(`${GITHUB_API_BASE}/repos/${GITHUB_REPO}`);
  const branch = repoInfo.default_branch ?? "main";
  const commit = await fetchJson<{ commit?: { tree?: { sha?: string } } }>(
    `${GITHUB_API_BASE}/repos/${GITHUB_REPO}/branches/${branch}`,
  );
  const treeSha = commit.commit?.tree?.sha;
  if (!treeSha) {
    throw new Error(`Unable to resolve tree SHA for ${GITHUB_REPO}@${branch}`);
  }

  const tree = await fetchJson<{ tree?: Array<{ path?: string; type?: string }> }>(
    `${GITHUB_API_BASE}/repos/${GITHUB_REPO}/git/trees/${treeSha}?recursive=1`,
  );

  const markdownFiles = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path as string)
    .filter((filePath) => !/^readme\.md$/i.test(path.basename(filePath)));

  const skills: VercelSkill[] = [];
  for (const filePath of markdownFiles) {
    try {
      const rawUrl = `${GITHUB_RAW_BASE}/${GITHUB_REPO}/${branch}/${filePath}`;
      const markdown = await readText(rawUrl);
      skills.push(buildSkill("github", rawUrl, markdown, filePath));
    } catch (error) {
      logger.warn(`[skills] GitHub skill fetch failed for ${filePath}: ${error}`);
    }
  }

  return skills;
}

function discoverSkillsShUrls(markdown: string): string[] {
  const urls = new Set<string>();
  const linkRegex = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
  const bareRegex = /https?:\/\/skills\.sh\/[A-Za-z0-9._~!$&'()*+,;=:@/\-?%#]+/g;

  for (const match of markdown.matchAll(linkRegex)) {
    const url = match[1];
    if (url.includes("skills.sh")) urls.add(url);
  }

  for (const match of markdown.matchAll(bareRegex)) {
    urls.add(match[0]);
  }

  return Array.from(urls);
}

async function fetchSkillsShSkills(): Promise<VercelSkill[]> {
  try {
    const index = await scrapeUrl({ url: SKILLS_SH_INDEX, formats: ["markdown"], maxChars: 50000, timeout: 20000 });
    if (!index.success || !index.markdown) return [];

    const urls = discoverSkillsShUrls(index.markdown)
      .filter((url) => !url.endsWith("/"))
      .filter((url) => !/\/vercel-labs\/agent-skills\/?$/i.test(url));

    const skills: VercelSkill[] = [];
    for (const url of urls) {
      try {
        const page = await scrapeUrl({ url, formats: ["markdown"], maxChars: 50000, timeout: 20000 });
        if (!page.success || !page.markdown) continue;
        skills.push(buildSkill("skills.sh", url, page.markdown));
      } catch (error) {
        logger.warn(`[skills] skills.sh fetch failed for ${url}: ${error}`);
      }
    }

    return skills;
  } catch (error) {
    logger.warn(`[skills] skills.sh index unavailable: ${error}`);
    return [];
  }
}

function dedupeSkills(skills: VercelSkill[]): VercelSkill[] {
  const byKey = new Map<string, VercelSkill>();

  for (const skill of skills) {
    const normalized = normalizeSkill(skill);
    const key = normalizeText(normalized.name) || normalized.url;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, normalized);
      continue;
    }

    const existingScore = existing.description.length + existing.keywords.length * 2;
    const nextScore = normalized.description.length + normalized.keywords.length * 2;
    if (nextScore > existingScore) {
      byKey.set(key, normalized);
    }
  }

  return Array.from(byKey.values());
}

function cacheIsFresh(cache: SkillCacheFile, ttlMs: number): boolean {
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < ttlMs;
}

function buildSearchText(userPrompt: string, skills: VercelSkill[]): string {
  const tokens = tokenize(userPrompt);
  const matched = new Set<string>();

  for (const skill of skills) {
    const haystack = normalizeText(`${skill.name} ${skill.description} ${skill.category} ${skill.keywords.join(" ")}`);
    for (const token of tokens) {
      if (haystack.includes(token)) matched.add(token);
    }
  }

  return Array.from(matched).join(" ");
}

function scoreSkill(skill: VercelSkill, query: string): RelevantSkill {
  const queryText = normalizeText(query);
  const queryTokens = uniq(tokenize(query));
  const haystack = normalizeText(`${skill.name} ${skill.description} ${skill.category} ${skill.keywords.join(" ")}`);

  let score = 0;
  const matchedTerms = new Set<string>();

  const nameTokens = tokenize(skill.name);
  for (const token of queryTokens) {
    if (skill.keywords.includes(token)) {
      score += 8;
      matchedTerms.add(token);
    }
    if (skill.category.includes(token)) {
      score += 5;
      matchedTerms.add(token);
    }
    if (nameTokens.includes(token)) {
      score += 10;
      matchedTerms.add(token);
    }
    if (skill.description.toLowerCase().includes(token)) {
      score += 4;
      matchedTerms.add(token);
    }
    if (haystack.includes(token)) {
      score += 2;
      matchedTerms.add(token);
    }
  }

  if (queryText && haystack.includes(queryText)) {
    score += 25;
    matchedTerms.add(queryText);
  }

  const overlap = queryTokens.filter((token) => haystack.includes(token)).length;
  if (queryTokens.length > 0) {
    score += Math.round((overlap / queryTokens.length) * 20);
  }

  if (normalizeText(skill.name).split(" ").every((part) => queryText.includes(part))) {
    score += 15;
  }

  return {
    ...skill,
    relevanceScore: Math.min(100, score),
    matchedTerms: Array.from(matchedTerms),
  };
}

export async function fetchVercelAgentSkills(options: SkillSearchOptions = {}): Promise<VercelSkill[]> {
  const ttlMs = getCacheTtlMs(options);
  const cached = await readCache();
  if (cached && cacheIsFresh(cached, ttlMs)) {
    return filterSkills(cached.skills, options);
  }

  try {
    const [githubSkills, skillsShSkills] = await Promise.all([fetchGithubSkills(), fetchSkillsShSkills()]);
    const merged = dedupeSkills([...githubSkills, ...skillsShSkills]);
    await writeCache(merged);
    return filterSkills(merged, options);
  } catch (error) {
    logger.warn(`[skills] Falling back to cache after fetch failure: ${error}`);
    return filterSkills(cached?.skills ?? [], options);
  }
}

export async function getRelevantSkills(userPrompt: string): Promise<RelevantSkill[]> {
  const skills = await fetchVercelAgentSkills();
  if (!skills.length) return [];

  const searchQuery = buildSearchText(userPrompt, skills) || userPrompt;
  const scored = skills
    .map((skill) => scoreSkill(skill, searchQuery))
    .filter((skill) => skill.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a.name.localeCompare(b.name));

  return scored.slice(0, 8);
}
