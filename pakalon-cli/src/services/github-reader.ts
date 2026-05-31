/**
 * PR/Issue Reading
 * 
 * Reads PRs and Issues via pr:// and issue:// schemes.
 * Based on OMP's GitHub integration.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '@/utils/logger.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  createdAt: string;
  updatedAt: string;
  headRef: string;
  baseRef: string;
  mergeable: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  assignees: string[];
  url: string;
}

export interface PRDiff {
  file: string;
  additions: number;
  deletions: number;
  patch: string;
}

// ============================================================================
// GitHub Reader
// ============================================================================

export class GitHubReader {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * Read a PR by number
   */
  async readPR(prNumber: number): Promise<GitHubPR | null> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'view', String(prNumber), '--json', 'number,title,body,state,author,createdAt,updatedAt,headRefName,baseRefName,mergeable,additions,deletions,changedFiles,url'],
        { cwd: this.repoPath }
      );

      const pr = JSON.parse(stdout);
      
      return {
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        state: pr.state?.toLowerCase() || 'open',
        author: pr.author?.login || 'unknown',
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        headRef: pr.headRefName,
        baseRef: pr.baseRefName,
        mergeable: pr.mergeable ?? true,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        changedFiles: pr.changedFiles || 0,
        url: pr.url,
      };
    } catch (error) {
      logger.error('[github-reader] Failed to read PR', { prNumber, error: String(error) });
      return null;
    }
  }

  /**
   * Read PR diff
   */
  async readPRDiff(prNumber: number): Promise<PRDiff[]> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'diff', String(prNumber), '--stat'],
        { cwd: this.repoPath }
      );

      const diffs: PRDiff[] = [];
      const lines = stdout.split('\n').filter(line => line.includes('|'));

      for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 2) {
          const file = parts[0];
          const stats = parts[1];
          const match = stats.match(/\+(\d+)\s+-(\d+)/);
          
          if (match) {
            diffs.push({
              file,
              additions: parseInt(match[1], 10),
              deletions: parseInt(match[2], 10),
              patch: '', // Would need separate call for full patch
            });
          }
        }
      }

      return diffs;
    } catch (error) {
      logger.error('[github-reader] Failed to read PR diff', { prNumber, error: String(error) });
      return [];
    }
  }

  /**
   * Read an issue by number
   */
  async readIssue(issueNumber: number): Promise<GitHubIssue | null> {
    try {
      const { stdout } = await execFileAsync(
        'gh',        ['issue', 'view', String(issueNumber), '--json', 'number,title,body,state,author,createdAt,updatedAt,labels,assignees,url'],
        { cwd: this.repoPath }
      );

      const issue = JSON.parse(stdout);
      
      return {
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        state: issue.state?.toLowerCase() || 'open',
        author: issue.author?.login || 'unknown',
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        labels: (issue.labels || []).map((l: any) => l.name || l),
        assignees: (issue.assignees || []).map((a: any) => a.login || a),
        url: issue.url,
      };
    } catch (error) {
      logger.error('[github-reader] Failed to read issue', { issueNumber, error: String(error) });
      return null;
    }
  }

  /**
   * Format PR as markdown
   */
  formatPRAsMarkdown(pr: GitHubPR): string {
    return `# PR #${pr.number}: ${pr.title}

**State:** ${pr.state}
**Author:** ${pr.author}
**Created:** ${pr.createdAt}
**Updated:** ${pr.updatedAt}
**Mergeable:** ${pr.mergeable ? 'Yes' : 'No'}

## Branches
- **Head:** ${pr.headRef}
- **Base:** ${pr.baseRef}

## Changes
- Additions: +${pr.additions}
- Deletions: -${pr.deletions}
- Changed Files: ${pr.changedFiles}

## Description
${pr.body || 'No description provided.'}

## URL
${pr.url}`;
  }

  /**
   * Format issue as markdown
   */
  formatIssueAsMarkdown(issue: GitHubIssue): string {
    return `# Issue #${issue.number}: ${issue.title}

**State:** ${issue.state}
**Author:** ${issue.author}
**Created:** ${issue.createdAt}
**Updated:** ${issue.updatedAt}

## Labels
${issue.labels.length > 0 ? issue.labels.map(l => `- ${l}`).join('\n') : 'No labels'}

## Assignees
${issue.assignees.length > 0 ? issue.assignees.map(a => `- ${a}`).join('\n') : 'No assignees'}

## Description
${issue.body || 'No description provided.'}

## URL
${issue.url}`;
  }
}

// ============================================================================
// URL Scheme Handler
// ============================================================================

export function parseGitHubURL(url: string): {
  type: 'pr' | 'issue';
  owner: string;
  repo: string;
  number: number;
} | null {
  // Handle pr:// and issue:// schemes
  const schemeMatch = url.match(/^(?:pr|issue):\/\/([^/]+)\/([^/]+)\/(\d+)$/);
  if (schemeMatch) {
    return {
      type: url.startsWith('pr://') ? 'pr' : 'issue',
      owner: schemeMatch[1],
      repo: schemeMatch[2],
      number: parseInt(schemeMatch[3], 10),
    };
  }

  // Handle standard GitHub URLs
  const githubMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/);
  if (githubMatch) {
    const type = url.includes('/pull/') ? 'pr' : 'issue';
    return {
      type,
      owner: githubMatch[1],
      repo: githubMatch[2],
      number: parseInt(githubMatch[3], 10),
    };
  }

  return null;
}

// ============================================================================
// Singleton
// ============================================================================

let readerInstance: GitHubReader | null = null;

export function getGitHubReader(repoPath?: string): GitHubReader {
  if (!readerInstance || repoPath) {
    readerInstance = new GitHubReader(repoPath || process.cwd());
  }
  return readerInstance;
}

export function resetGitHubReader(): void {
  readerInstance = null;
}
