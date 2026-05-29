/**
 * GitHub API Integration — checks PRs, issues, and reviews.
 */
import { Octokit } from "@octokit/rest";
import type { GitHubConfig } from "./types.js";
import { debugLog } from "@/utils/logger.js";

export interface PRIssue {
  prNumber: number;
  title: string;
  url: string;
  state: string;
  issue: string;
  author: string;
  createdAt: string;
  labels: string[];
}

export interface PRCheckResult {
  repo: string;
  issues: PRIssue[];
  checkedAt: string;
}

function getOctokit(config: GitHubConfig): Octokit {
  return new Octokit({
    auth: config.token ?? process.env.GITHUB_TOKEN,
  });
}

export async function checkPullRequests(config: GitHubConfig): Promise<PRCheckResult> {
  const octokit = getOctokit(config);
  const issues: PRIssue[] = [];

  try {
    const { data: pulls } = await octokit.pulls.list({
      owner: config.owner,
      repo: config.repo,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: 30,
    });

    for (const pull of pulls) {
      const prIssues = await checkPRForIssues(octokit, config, pull);
      issues.push(...prIssues);
    }

    debugLog(`[github] Checked ${pulls.length} PRs in ${config.owner}/${config.repo}, found ${issues.length} issues`);
  } catch (error) {
    debugLog(`[github] Error checking PRs: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    repo: `${config.owner}/${config.repo}`,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

async function checkPRForIssues(
  octokit: Octokit,
  config: GitHubConfig,
  pull: { number: number; title: string; html_url: string; state: string; user: { login: string } | null; created_at: string; labels: { name: string }[] }
): Promise<PRIssue[]> {
  const issues: PRIssue[] = [];
  const repo = `${config.owner}/${config.repo}`;

  try {
    const { data: reviews } = await octokit.pulls.listReviews({
      owner: config.owner,
      repo: config.repo,
      pull_number: pull.number,
    });

    const hasChangesRequested = reviews.some((r) => r.state === "CHANGES_REQUESTED");
    if (hasChangesRequested) {
      const changeRequests = reviews.filter((r) => r.state === "CHANGES_REQUESTED");
      const latestComment = changeRequests[changeRequests.length - 1]?.body ?? "Changes requested";
      issues.push({
        prNumber: pull.number,
        title: pull.title,
        url: pull.html_url,
        state: pull.state,
        issue: `Changes requested: ${latestComment.slice(0, 200)}`,
        author: pull.user?.login ?? "unknown",
        createdAt: pull.created_at,
        labels: pull.labels?.map((l) => l.name) ?? [],
      });
    }

    const { data: comments } = await octokit.issues.listComments({
      owner: config.owner,
      repo: config.repo,
      issue_number: pull.number,
      per_page: 10,
    });

    for (const comment of comments) {
      const lower = comment.body?.toLowerCase() ?? "";
      if (lower.includes("conflict") || lower.includes("needs fix") || lower.includes("blocking")) {
        issues.push({
          prNumber: pull.number,
          title: pull.title,
          url: pull.html_url,
          state: pull.state,
          issue: `Comment flagged: ${comment.body?.slice(0, 200)}`,
          author: comment.user?.login ?? "unknown",
          createdAt: pull.created_at,
          labels: pull.labels?.map((l) => l.name) ?? [],
        });
        break;
      }
    }

    const { data: checks } = await octokit.checks.listForRef({
      owner: config.owner,
      repo: config.repo,
      ref: pull.head.sha,
    });

    const failedChecks = checks.check_runs.filter((c) => c.conclusion === "failure");
    if (failedChecks.length > 0) {
      const checkNames = failedChecks.map((c) => c.name).join(", ");
      issues.push({
        prNumber: pull.number,
        title: pull.title,
        url: pull.html_url,
        state: pull.state,
        issue: `CI checks failed: ${checkNames}`,
        author: pull.user?.login ?? "unknown",
        createdAt: pull.created_at,
        labels: pull.labels?.map((l) => l.name) ?? [],
      });
    }
  } catch (error) {
    debugLog(`[github] Error checking PR #${pull.number}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return issues;
}

export async function getRepositoryInfo(config: GitHubConfig): Promise<{ name: string; fullName: string; defaultBranch: string; openPRs: number } | null> {
  try {
    const octokit = getOctokit(config);
    const { data: repo } = await octokit.repos.get({
      owner: config.owner,
      repo: config.repo,
    });

    return {
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      openPRs: repo.open_issues_count,
    };
  } catch (error) {
    debugLog(`[github] Error fetching repo info: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function validateGitHubConfig(config: Partial<GitHubConfig>): string[] {
  const errors: string[] = [];
  if (!config.owner) errors.push("GitHub owner is required");
  if (!config.repo) errors.push("GitHub repo is required");
  return errors;
}
