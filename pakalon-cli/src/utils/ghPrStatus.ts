/**
 * GH PR Status — fetches PR review status via GitHub CLI.
 *
 * Used by usePrStatus hook to poll for PR CI/checks status.
 * Non-blocking — returns null if gh CLI is not available or no PR exists.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import logger from "@/utils/logger.js";

const execFileAsync = promisify(execFile);

export type PrReviewState = "pending" | "success" | "failure" | "cancelled" | "no_pr";

export interface PrStatusResult {
  number: number | null;
  url: string | null;
  reviewState: PrReviewState | null;
  checks?: Array<{ name: string; status: string; conclusion: string | null }>;
}

export async function fetchPrStatus(cwd?: string): Promise<PrStatusResult | null> {
  const workDir = cwd ?? process.cwd();

  try {
    const { stdout: branchOut } = await execFileAsync(
      "git",
      ["branch", "--show-current"],
      { cwd: workDir, timeout: 3000 },
    );
    const branch = branchOut.trim();
    if (!branch) return null;

    const { stdout: prOut } = await execFileAsync(
      "gh",
      ["pr", "view", "--json", "number,url,state,statusCheckRollup,headRefName"],
      { cwd: workDir, timeout: 4000 },
    );

    const prData = JSON.parse(prOut) as {
      number: number;
      url: string;
      state: string;
      statusCheckRollup: Array<{
        name: string;
        status: string;
        conclusion: string | null;
      }> | null;
      headRefName: string;
    };

    if (prData.headRefName !== branch) {
      return null;
    }

    let reviewState: PrReviewState = "pending";
    const checks = prData.statusCheckRollup ?? [];

    if (checks.length === 0) {
      reviewState = "pending";
    } else {
      const allCompleted = checks.every((c) => c.status === "completed");
      if (!allCompleted) {
        reviewState = "pending";
      } else {
        const allSuccess = checks.every((c) => c.conclusion === "success" || c.conclusion === "skipped");
        const anyFailure = checks.some((c) => c.conclusion === "failure");
        const anyCancelled = checks.some((c) => c.conclusion === "cancelled");

        if (anyFailure) reviewState = "failure";
        else if (anyCancelled) reviewState = "cancelled";
        else if (allSuccess) reviewState = "success";
        else reviewState = "pending";
      }
    }

    return {
      number: prData.number,
      url: prData.url,
      reviewState,
      checks,
    };
  } catch (err) {
    logger.debug("[ghPrStatus] Failed to fetch PR status", { error: err });
    return null;
  }
}

export async function getPrNumber(cwd?: string): Promise<number | null> {
  const workDir = cwd ?? process.cwd();

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", "--json", "number"],
      { cwd: workDir, timeout: 3000 },
    );
    const data = JSON.parse(stdout) as { number: number };
    return data.number ?? null;
  } catch {
    return null;
  }
}

export async function getPrUrl(cwd?: string): Promise<string | null> {
  const workDir = cwd ?? process.cwd();

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", "--json", "url"],
      { cwd: workDir, timeout: 3000 },
    );
    const data = JSON.parse(stdout) as { url: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}

export async function getPrChecks(cwd?: string): Promise<Array<{ name: string; status: string; conclusion: string | null }>> {
  const workDir = cwd ?? process.cwd();

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", "--json", "statusCheckRollup"],
      { cwd: workDir, timeout: 4000 },
    );
    const data = JSON.parse(stdout) as { statusCheckRollup: Array<{ name: string; status: string; conclusion: string | null }> | null };
    return data.statusCheckRollup ?? [];
  } catch {
    return [];
  }
}

export function isPrReviewStateFinal(state: PrReviewState | null): boolean {
  return state === "success" || state === "failure" || state === "cancelled";
}

export function formatPrReviewState(state: PrReviewState | null): string {
  switch (state) {
    case "success":
      return "[OK] Checks passed";
    case "failure":
      return "[X] Checks failed";
    case "cancelled":
      return "⊘ Checks cancelled";
    case "pending":
      return "⟳ Checks pending";
    case "no_pr":
      return "— No PR";
    default:
      return "";
  }
}
