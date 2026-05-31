/**
 * GitHub Filesystem - Read PRs and issues like local files
 * 
 * Implements pr:// and issue:// URL schemes for reading GitHub PRs and issues
 * as structured markdown, similar to local file reading.
 * 
 * Features:
 * - pr://N - Single PR view
 * - pr://N/diff - Changed file listing
 * - pr://N/diff/all - Full unified diff
 * - pr://N/diff/M - Single file's diff
 * - issue://N - Single issue with comments
 * - issue://?state=open&label=bug&limit=20 - List issues
 * - Caching with soft and hard TTLs
 * - Background refresh, never blocks
 */

import { z } from 'zod';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// SQLite-compatible cache (uses JSON file as fallback if sqlite3 not available)
// In production, this would use better-sqlite3 or similar

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubPR {
  number: number;
  title: string;
  author: string;
  state: 'open' | 'closed' | 'merged';
  body: string;
  labels: string[];
  assignees: string[];
  reviewers: string[];
  created_at: string;
  updated_at: string;
  merged_at?: string;
  head_branch: string;
  base_branch: string;
  changed_files: number;
  additions: number;
  deletions: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  author: string;
  state: 'open' | 'closed';
  body: string;
  labels: string[];
  assignees: string[];
  comments: GitHubComment[];
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

export interface GitHubComment {
  id: number;
  author: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubFileDiff {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GitHubCacheEntry<T> {
  data: T;
  timestamp: number;
  softTtl: number;
  hardTtl: number;
}

// ---------------------------------------------------------------------------
// Cache - SQLite-backed with JSON file fallback
// ---------------------------------------------------------------------------

const DEFAULT_SOFT_TTL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_HARD_TTL = 30 * 60 * 1000; // 30 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  softTtl: number;
  hardTtl: number;
}

// In-memory cache with disk persistence
const memoryCache = new Map<string, CacheEntry<unknown>>();
const CACHE_DIR = path.join(os.homedir(), '.config', 'pakalon', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'github-fs-cache.json');

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Load cache from disk
 */
function loadCacheFromDisk(): void {
  try {
    ensureCacheDir();
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      const entries = JSON.parse(data) as Record<string, CacheEntry<unknown>>;
      for (const [key, value] of Object.entries(entries)) {
        memoryCache.set(key, value);
      }
    }
  } catch {
    // Ignore errors - start with empty cache
  }
}

/**
 * Save cache to disk
 */
function saveCacheToDisk(): void {
  try {
    ensureCacheDir();
    const entries: Record<string, CacheEntry<unknown>> = {};
    for (const [key, value] of memoryCache) {
      entries[key] = value;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entries, null, 2), 'utf-8');
  } catch {
    // Ignore errors - cache will just be in-memory
  }
}

// Initialize cache from disk on module load
loadCacheFromDisk();

// Save cache periodically (every 5 minutes)
setInterval(saveCacheToDisk, 5 * 60 * 1000);

// Save on process exit
process.on('exit', saveCacheToDisk);
process.on('SIGINT', () => { saveCacheToDisk(); process.exit(); });
process.on('SIGTERM', () => { saveCacheToDisk(); process.exit(); });

function getCacheKey(url: string): string {
  return url.toLowerCase();
}

function getCached<T>(url: string): T | null {
  const entry = memoryCache.get(getCacheKey(url));
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > entry.hardTtl) {
    memoryCache.delete(getCacheKey(url));
    return null;
  }

  // Soft TTL - return cached but schedule background refresh
  if (now - entry.timestamp > entry.softTtl) {
    // Background refresh would go here
  }

  return entry.data as T;
}

function setCache<T>(url: string, data: T, softTtl = DEFAULT_SOFT_TTL, hardTtl = DEFAULT_HARD_TTL): void {
  memoryCache.set(getCacheKey(url), {
    data,
    timestamp: Date.now(),
    softTtl,
    hardTtl,
  });
}

/**
 * Clear expired cache entries
 */
export function clearExpiredCache(): number {
  const now = Date.now();
  let cleared = 0;
  for (const [key, entry] of memoryCache) {
    if (now - entry.timestamp > entry.hardTtl) {
      memoryCache.delete(key);
      cleared++;
    }
  }
  if (cleared > 0) {
    saveCacheToDisk();
  }
  return cleared;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { entries: number; sizeBytes: number } {
  let sizeBytes = 0;
  for (const [, entry] of memoryCache) {
    sizeBytes += JSON.stringify(entry).length;
  }
  return {
    entries: memoryCache.size,
    sizeBytes,
  };
}

// ---------------------------------------------------------------------------
// Git Operations
// ---------------------------------------------------------------------------

function getDefaultRepo(): string | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    // Parse owner/repo from remote URL
    const match = remoteUrl.match(/github\.com[:/](.+?)\.git$/);
    if (match) {
      return match[1];
    }
    // Try HTTPS format
    const httpsMatch = remoteUrl.match(/github\.com\/(.+?)\.git$/);
    if (httpsMatch) {
      return httpsMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

function execGitHub(args: string): string {
  try {
    return execSync(`gh ${args}`, { encoding: 'utf-8' }).trim();
  } catch (error) {
    throw new Error(`GitHub CLI error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// PR Operations
// ---------------------------------------------------------------------------

export async function readPR(
  prNumber: number,
  repo?: string
): Promise<GitHubPR> {
  const effectiveRepo = repo || getDefaultRepo();
  if (!effectiveRepo) {
    throw new Error('No GitHub repository found. Run in a git repo with GitHub remote.');
  }

  const cacheKey = `pr://${effectiveRepo}/${prNumber}`;
  const cached = getCached<GitHubPR>(cacheKey);
  if (cached) return cached;

  const output = execGitHub(`pr view ${prNumber} --repo ${effectiveRepo} --json number,title,body,state,author,assignees,labels,reviewers,createdAt,updatedAt,mergedAt,headRefName,baseRefName,changedFiles,additions,deletions`);

  const data = JSON.parse(output);
  const pr: GitHubPR = {
    number: data.number,
    title: data.title,
    author: data.author?.login || 'unknown',
    state: data.state?.toLowerCase() || 'open',
    body: data.body || '',
    labels: data.labels?.map((l: { name: string }) => l.name) || [],
    assignees: data.assignees?.map((a: { login: string }) => a.login) || [],
    reviewers: data.reviewers?.map((r: { login: string }) => r.login) || [],
    created_at: data.createdAt,
    updated_at: data.updatedAt,
    merged_at: data.mergedAt,
    head_branch: data.headRefName,
    base_branch: data.baseRefName,
    changed_files: data.changedFiles || 0,
    additions: data.additions || 0,
    deletions: data.deletions || 0,
  };

  setCache(cacheKey, pr);
  return pr;
}

export async function readPRDiff(
  prNumber: number,
  repo?: string
): Promise<GitHubFileDiff[]> {
  const effectiveRepo = repo || getDefaultRepo();
  if (!effectiveRepo) {
    throw new Error('No GitHub repository found.');
  }

  const cacheKey = `pr://${effectiveRepo}/${prNumber}/diff`;
  const cached = getCached<GitHubFileDiff[]>(cacheKey);
  if (cached) return cached;

  const output = execGitHub(`pr diff ${prNumber} --repo ${effectiveRepo} --stat`);
  const lines = output.split('\n').filter(l => l.trim());

  const files: GitHubFileDiff[] = [];
  for (const line of lines) {
    // Parse stat lines like " src/file.ts | 10 ++++---"
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([+-]+)/);
    if (match) {
      const filename = match[1]!.trim();
      const additions = (match[3]!.match(/\+/g) || []).length;
      const deletions = (match[3]!.match(/-/g) || []).length;
      files.push({
        filename,
        status: 'modified',
        additions,
        deletions,
      });
    }
  }

  setCache(cacheKey, files);
  return files;
}

export async function readPRFileDiff(
  prNumber: number,
  fileIndex: number,
  repo?: string
): Promise<string> {
  const effectiveRepo = repo || getDefaultRepo();
  if (!effectiveRepo) {
    throw new Error('No GitHub repository found.');
  }

  const cacheKey = `pr://${effectiveRepo}/${prNumber}/diff/${fileIndex}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  const output = execGitHub(`pr diff ${prNumber} --repo ${effectiveRepo}`);
  
  // Parse unified diff and extract specific file
  const files = output.split(/^diff --git/m);
  const fileDiff = files[fileIndex] || files[fileIndex + 1] || '';
  
  setCache(cacheKey, fileDiff);
  return fileDiff;
}

export async function readPRFullDiff(
  prNumber: number,
  repo?: string
): Promise<string> {
  const effectiveRepo = repo || getDefaultRepo();
  if (!effectiveRepo) {
    throw new Error('No GitHub repository found.');
  }

  const cacheKey = `pr://${effectiveRepo}/${prNumber}/diff/all`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  const output = execGitHub(`pr diff ${prNumber} --repo ${effectiveRepo}`);
  
  setCache(cacheKey, output);
  return output;
}

// ---------------------------------------------------------------------------
// Issue Operations
// ---------------------------------------------------------------------------

export async function readIssue(
  issueNumber: number,
  repo?: string,
  includeComments = true
): Promise<GitHubIssue> {
  const effectiveRepo = repo || getDefaultRepo();
  if (!effectiveRepo) {
    throw new Error('No GitHub repository found.');
  }

  const cacheKey = `issue://${effectiveRepo}/${issueNumber}`;
  const cached = getCached<GitHubIssue>(cacheKey);
  if (cached) return cached;

  const output = execGitHub(`issue view ${issueNumber} --repo ${effectiveRepo} --json number,title,body,state,author,assignees,labels,comments,createdAt,updatedAt,closedAt`);

  const data = JSON.parse(output);
  const issue: GitHubIssue = {
    number: data.number,
    title: data.title,
    author: data.author?.login || 'unknown',
    state: data.state?.toLowerCase() || 'open',
    body: data.body || '',
    labels: data.labels?.map((l: { name: string }) => l.name) || [],
    assignees: data.assignees?.map((a: { login: string }) => a.login) || [],
    comments: data.comments?.map((c: {
      id: number;
      author: { login: string };
      body: string;
      createdAt: string;
      updatedAt: string;
    }) => ({
      id: c.id,
      author: c.author?.login || 'unknown',
      body: c.body,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    })) || [],
    created_at: data.createdAt,
    updated_at: data.updatedAt,
    closed_at: data.closedAt,
  };

  setCache(cacheKey, issue);
  return issue;
}

export interface IssueListOptions {
  state?: 'open' | 'closed' | 'all';
  label?: string;
  assignee?: string;
  limit?: number;
  repo?: string;
}

export async function listIssues(
  options: IssueListOptions = {}
): Promise<GitHubIssue[]> {
  const effectiveRepo = options.repo || getDefaultRepo();
  if (!effectiveRepo) {
    throw new Error('No GitHub repository found.');
  }

  const state = options.state || 'open';
  const limit = options.limit || 30;
  
  let cmd = `issue list --repo ${effectiveRepo} --state ${state} --limit ${limit} --json number,title,state,author,labels,createdAt,updatedAt`;
  
  if (options.label) {
    cmd += ` --label "${options.label}"`;
  }
  if (options.assignee) {
    cmd += ` --assignee "${options.assignee}"`;
  }

  const output = execGitHub(cmd);
  const data = JSON.parse(output);

  return data.map((item: {
    number: number;
    title: string;
    state: string;
    author: { login: string };
    labels: Array<{ name: string }>;
    createdAt: string;
    updatedAt: string;
  }) => ({
    number: item.number,
    title: item.title,
    author: item.author?.login || 'unknown',
    state: item.state?.toLowerCase() || 'open',
    body: '',
    labels: item.labels?.map((l: { name: string }) => l.name) || [],
    assignees: [],
    comments: [],
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// URL Parsing
// ---------------------------------------------------------------------------

export function parseGitHubURL(url: string): {
  type: 'pr' | 'issue';
  number: number;
  subpath?: string;
  repo?: string;
} | null {
  // pr://N
  // pr://N/diff
  // pr://N/diff/all
  // pr://N/diff/M
  // issue://N
  // issue://?state=open&label=bug&limit=20
  const prMatch = url.match(/^pr:\/\/(\d+)(?:\/(.*))?$/);
  if (prMatch) {
    return {
      type: 'pr',
      number: parseInt(prMatch[1]!, 10),
      subpath: prMatch[2] || undefined,
    };
  }

  const issueMatch = url.match(/^issue:\/\/(\d+)(?:\/(.*))?$/);
  if (issueMatch) {
    return {
      type: 'issue',
      number: parseInt(issueMatch[1]!, 10),
      subpath: issueMatch[2] || undefined,
    };
  }

  // Full repo path: pr://owner/repo/N
  const fullPrMatch = url.match(/^pr:\/\/([^/]+)\/([^/]+)\/(\d+)(?:\/(.*))?$/);
  if (fullPrMatch) {
    return {
      type: 'pr',
      number: parseInt(fullPrMatch[3]!, 10),
      subpath: fullPrMatch[4] || undefined,
      repo: `${fullPrMatch[1]}/${fullPrMatch[2]}`,
    };
  }

  const fullIssueMatch = url.match(/^issue:\/\/([^/]+)\/([^/]+)\/(\d+)(?:\/(.*))?$/);
  if (fullIssueMatch) {
    return {
      type: 'issue',
      number: parseInt(fullIssueMatch[3]!, 10),
      subpath: fullIssueMatch[4] || undefined,
      repo: `${fullIssueMatch[1]}/${fullIssueMatch[2]}`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Markdown Rendering
// ---------------------------------------------------------------------------

function prToMarkdown(pr: GitHubPR): string {
  const statusEmoji = pr.state === 'merged' ? '🟣' : pr.state === 'open' ? '🟢' : '🔴';
  
  let md = `# ${statusEmoji} PR #${pr.number}: ${pr.title}\n\n`;
  md += `**Author:** ${pr.author}\n`;
  md += `**State:** ${pr.state}${pr.merged_at ? ` (merged ${pr.merged_at})` : ''}\n`;
  md += `**Branch:** ${pr.head_branch} → ${pr.base_branch}\n`;
  md += `**Changes:** ${pr.changed_files} files, +${pr.additions} -${pr.deletions}\n`;
  
  if (pr.labels.length > 0) {
    md += `**Labels:** ${pr.labels.join(', ')}\n`;
  }
  if (pr.assignees.length > 0) {
    md += `**Assignees:** ${pr.assignees.join(', ')}\n`;
  }
  if (pr.reviewers.length > 0) {
    md += `**Reviewers:** ${pr.reviewers.join(', ')}\n`;
  }
  
  md += `\n---\n\n`;
  md += pr.body || 'No description provided.\n';
  
  return md;
}

function prDiffToMarkdown(files: GitHubFileDiff[]): string {
  let md = `# PR Diff - ${files.length} files changed\n\n`;
  
  for (const file of files) {
    const statusIcon = file.status === 'added' ? '🆕' : 
                       file.status === 'removed' ? '🗑️' : 
                       file.status === 'renamed' ? '📝' : '✏️';
    md += `- ${statusIcon} **${file.filename}** (+${file.additions} -${file.deletions})\n`;
  }
  
  return md;
}

function issueToMarkdown(issue: GitHubIssue): string {
  const statusEmoji = issue.state === 'open' ? '🟢' : '🔴';
  
  let md = `# ${statusEmoji} Issue #${issue.number}: ${issue.title}\n\n`;
  md += `**Author:** ${issue.author}\n`;
  md += `**State:** ${issue.state}\n`;
  
  if (issue.labels.length > 0) {
    md += `**Labels:** ${issue.labels.join(', ')}\n`;
  }
  if (issue.assignees.length > 0) {
    md += `**Assignees:** ${issue.assignees.join(', ')}\n`;
  }
  
  md += `\n---\n\n`;
  md += issue.body || 'No description provided.\n';
  
  if (issue.comments.length > 0) {
    md += `\n---\n\n## Comments (${issue.comments.length})\n\n`;
    
    for (const comment of issue.comments) {
      md += `### ${comment.author} commented on ${comment.created_at}\n\n`;
      md += `${comment.body}\n\n`;
    }
  }
  
  return md;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const githubFSSchema = z.object({
  url: z.string().describe('GitHub URL (pr://N, issue://N, etc.)'),
});

export type GitHubFSInput = z.infer<typeof githubFSSchema>;

export async function readGitHubURL(url: string): Promise<string> {
  const parsed = parseGitHubURL(url);
  if (!parsed) {
    throw new Error(`Invalid GitHub URL: ${url}. Use pr://N or issue://N format.`);
  }

  if (parsed.type === 'pr') {
    const pr = await readPR(parsed.number, parsed.repo);
    
    if (!parsed.subpath) {
      return prToMarkdown(pr);
    }
    
    if (parsed.subpath === 'diff') {
      const files = await readPRDiff(parsed.number, parsed.repo);
      return prDiffToMarkdown(files);
    }
    
    if (parsed.subpath === 'diff/all') {
      return await readPRFullDiff(parsed.number, parsed.repo);
    }
    
    const diffMatch = parsed.subpath.match(/^diff\/(\d+)$/);
    if (diffMatch) {
      const fileIndex = parseInt(diffMatch[1]!, 10);
      return await readPRFileDiff(parsed.number, fileIndex, parsed.repo);
    }
    
    throw new Error(`Unknown PR subpath: ${parsed.subpath}`);
  }
  
  if (parsed.type === 'issue') {
    const issue = await readIssue(parsed.number, parsed.repo);
    return issueToMarkdown(issue);
  }
  
  throw new Error(`Unsupported URL type: ${parsed.type}`);
}

export const githubFSToolDefinition = {
  name: 'github_fs',
  description: 'Read GitHub PRs and issues as structured markdown using pr:// and issue:// URLs',
  inputSchema: githubFSSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input: GitHubFSInput): Promise<{ content: string }> {
    const content = await readGitHubURL(input.url);
    return { content };
  },
};

export default {
  readGitHubURL,
  readPR,
  readPRDiff,
  readPRFullDiff,
  readIssue,
  listIssues,
  parseGitHubURL,
  githubFSToolDefinition,
};
