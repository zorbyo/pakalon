/**
 * Diff Command for Pakalon CLI
 * 
 * Shows differences between file versions or conversation states.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";
import type { CommandContext, CommandResult } from "./types.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffOptions {
  /** Context lines around changes */
  context?: number;
  /** Output format */
  format?: "unified" | "side-by-side" | "inline" | "stat";
  /** Show word-level diff */
  wordDiff?: boolean;
  /** Color output */
  color?: boolean;
  /** Ignore whitespace changes */
  ignoreWhitespace?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface DiffResult {
  success: boolean;
  hunks?: DiffHunk[];
  additions: number;
  deletions: number;
  files?: string[];
  output?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Git Diff
// ---------------------------------------------------------------------------

/**
 * Get git diff for a file or directory
 */
export async function getGitDiff(
  target?: string,
  options: DiffOptions = {}
): Promise<DiffResult> {
  const {
    context = 3,
    format = "unified",
    wordDiff = false,
    color = true,
    ignoreWhitespace = false,
  } = options;

  try {
    const args = ["--no-pager", "diff"];
    
    args.push(`-U${context}`);
    
    if (wordDiff) {
      args.push("--word-diff");
    }
    
    if (color) {
      args.push("--color=always");
    } else {
      args.push("--color=never");
    }
    
    if (ignoreWhitespace) {
      args.push("-w");
    }
    
    if (format === "stat") {
      args.push("--stat");
    }
    
    if (target) {
      args.push("--", target);
    }
    
    const output = execSync(`git ${args.join(" ")}`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    
    // Parse diff output
    const { hunks, additions, deletions, files } = parseDiff(output);
    
    return {
      success: true,
      hunks,
      additions,
      deletions,
      files,
      output,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[diff] Git diff failed: ${msg}`);
    
    return {
      success: false,
      additions: 0,
      deletions: 0,
      error: msg,
    };
  }
}

/**
 * Get staged diff (changes to be committed)
 */
export async function getStagedDiff(options: DiffOptions = {}): Promise<DiffResult> {
  const {
    context = 3,
    color = true,
    wordDiff = false,
  } = options;

  try {
    const args = ["--no-pager", "diff", "--staged", `-U${context}`];
    
    if (wordDiff) {
      args.push("--word-diff");
    }
    
    if (color) {
      args.push("--color=always");
    }
    
    const output = execSync(`git ${args.join(" ")}`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    
    const { hunks, additions, deletions, files } = parseDiff(output);
    
    return {
      success: true,
      hunks,
      additions,
      deletions,
      files,
      output,
    };
  } catch (error) {
    return {
      success: false,
      additions: 0,
      deletions: 0,
      error: String(error),
    };
  }
}

/**
 * Get diff between two commits/branches
 */
export async function getCommitDiff(
  ref1: string,
  ref2: string = "HEAD",
  options: DiffOptions = {}
): Promise<DiffResult> {
  const { context = 3, color = true } = options;

  try {
    const args = [
      "--no-pager",
      "diff",
      `-U${context}`,
      color ? "--color=always" : "--color=never",
      ref1,
      ref2,
    ];
    
    const output = execSync(`git ${args.join(" ")}`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    
    const { hunks, additions, deletions, files } = parseDiff(output);
    
    return {
      success: true,
      hunks,
      additions,
      deletions,
      files,
      output,
    };
  } catch (error) {
    return {
      success: false,
      additions: 0,
      deletions: 0,
      error: String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// File Diff
// ---------------------------------------------------------------------------

/**
 * Diff two strings or files
 */
export function computeDiff(
  oldContent: string,
  newContent: string,
  options: DiffOptions = {}
): DiffResult {
  const { context = 3 } = options;
  
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  
  // Simple diff algorithm (Myers-like)
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  
  // Use longest common subsequence approach
  const lcs = computeLCS(oldLines, newLines);
  const diffLines = buildDiffLines(oldLines, newLines, lcs, context);
  
  // Group into hunks
  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;
  
  for (const line of diffLines) {
    if (line.type === "add") additions++;
    if (line.type === "remove") deletions++;
    
    if (!currentHunk) {
      currentHunk = {
        oldStart: line.oldLineNo ?? oldLineNo + 1,
        oldCount: 0,
        newStart: line.newLineNo ?? newLineNo + 1,
        newCount: 0,
        lines: [],
      };
    }
    
    currentHunk.lines.push(line);
    
    if (line.type !== "add") {
      currentHunk.oldCount++;
      oldLineNo = line.oldLineNo ?? oldLineNo + 1;
    }
    if (line.type !== "remove") {
      currentHunk.newCount++;
      newLineNo = line.newLineNo ?? newLineNo + 1;
    }
  }
  
  if (currentHunk && currentHunk.lines.length > 0) {
    hunks.push(currentHunk);
  }
  
  return {
    success: true,
    hunks,
    additions,
    deletions,
  };
}

/**
 * Compute longest common subsequence
 */
function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  
  return dp;
}

/**
 * Build diff lines from LCS
 */
function buildDiffLines(
  oldLines: string[],
  newLines: string[],
  lcs: number[][],
  context: number
): DiffLine[] {
  const result: DiffLine[] = [];
  
  let i = oldLines.length;
  let j = newLines.length;
  const changes: DiffLine[] = [];
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      changes.unshift({
        type: "context",
        content: oldLines[i - 1]!,
        oldLineNo: i,
        newLineNo: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i]![j - 1]! >= lcs[i - 1]![j]!)) {
      changes.unshift({
        type: "add",
        content: newLines[j - 1]!,
        newLineNo: j,
      });
      j--;
    } else if (i > 0) {
      changes.unshift({
        type: "remove",
        content: oldLines[i - 1]!,
        oldLineNo: i,
      });
      i--;
    }
  }
  
  // Filter to only include changes and their context
  let lastChangeIdx = -context - 1;
  for (let idx = 0; idx < changes.length; idx++) {
    const line = changes[idx]!;
    if (line.type !== "context") {
      // Include context before change
      for (let c = Math.max(lastChangeIdx + context + 1, idx - context); c < idx; c++) {
        if (c >= 0 && changes[c]?.type === "context") {
          result.push(changes[c]!);
        }
      }
      result.push(line);
      lastChangeIdx = idx;
    } else if (idx <= lastChangeIdx + context) {
      // Include context after change
      result.push(line);
    }
  }
  
  return result;
}

// ---------------------------------------------------------------------------
// Diff Parsing
// ---------------------------------------------------------------------------

/**
 * Parse unified diff output
 */
function parseDiff(output: string): {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  files: string[];
} {
  const hunks: DiffHunk[] = [];
  const files: string[] = [];
  let additions = 0;
  let deletions = 0;
  
  const lines = output.split("\n");
  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;
  
  for (const line of lines) {
    // File header
    if (line.startsWith("diff --git")) {
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      if (match) {
        files.push(match[2]!);
      }
      continue;
    }
    
    // Hunk header
    const hunkMatch = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      
      oldLineNo = parseInt(hunkMatch[1]!, 10);
      newLineNo = parseInt(hunkMatch[3]!, 10);
      
      currentHunk = {
        oldStart: oldLineNo,
        oldCount: parseInt(hunkMatch[2] ?? "1", 10),
        newStart: newLineNo,
        newCount: parseInt(hunkMatch[4] ?? "1", 10),
        lines: [],
      };
      continue;
    }
    
    if (!currentHunk) continue;
    
    // Diff lines (strip ANSI codes for parsing)
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, "");
    
    if (cleanLine.startsWith("+") && !cleanLine.startsWith("+++")) {
      currentHunk.lines.push({
        type: "add",
        content: cleanLine.slice(1),
        newLineNo: newLineNo++,
      });
      additions++;
    } else if (cleanLine.startsWith("-") && !cleanLine.startsWith("---")) {
      currentHunk.lines.push({
        type: "remove",
        content: cleanLine.slice(1),
        oldLineNo: oldLineNo++,
      });
      deletions++;
    } else if (cleanLine.startsWith(" ") || cleanLine === "") {
      currentHunk.lines.push({
        type: "context",
        content: cleanLine.slice(1),
        oldLineNo: oldLineNo++,
        newLineNo: newLineNo++,
      });
    }
  }
  
  if (currentHunk) {
    hunks.push(currentHunk);
  }
  
  return { hunks, additions, deletions, files };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format diff for display
 */
export function formatDiff(
  result: DiffResult,
  options: { color?: boolean; lineNumbers?: boolean } = {}
): string {
  const { color = true, lineNumbers = true } = options;
  
  if (!result.success || !result.hunks) {
    return result.error ?? "No changes";
  }
  
  const lines: string[] = [];
  
  // Summary
  const addColor = color ? "\x1b[32m" : "";
  const removeColor = color ? "\x1b[31m" : "";
  const reset = color ? "\x1b[0m" : "";
  
  lines.push(`${addColor}+${result.additions}${reset} ${removeColor}-${result.deletions}${reset}`);
  lines.push("");
  
  for (const hunk of result.hunks) {
    const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
    lines.push(color ? `\x1b[36m${header}\x1b[0m` : header);
    
    for (const line of hunk.lines) {
      let prefix: string;
      let lineColor: string;
      let lineNum: string;
      
      switch (line.type) {
        case "add":
          prefix = "+";
          lineColor = addColor;
          lineNum = lineNumbers && line.newLineNo ? `${line.newLineNo}: ` : "";
          break;
        case "remove":
          prefix = "-";
          lineColor = removeColor;
          lineNum = lineNumbers && line.oldLineNo ? `${line.oldLineNo}: ` : "";
          break;
        default:
          prefix = " ";
          lineColor = "";
          lineNum = lineNumbers && line.oldLineNo ? `${line.oldLineNo}: ` : "";
          break;
      }
      
      lines.push(`${lineColor}${prefix}${lineNum}${line.content}${reset}`);
    }
    
    lines.push("");
  }
  
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Command Implementation
// ---------------------------------------------------------------------------

export const diffCommand = {
  name: "diff",
  aliases: ["d", "changes"],
  description: "Show differences in files or git changes",
  usage: "/diff [file|--staged|--commit <ref>] [options]",
  
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const options: DiffOptions = {
      context: 3,
      color: true,
      format: "unified",
    };
    
    let target: string | undefined;
    let mode: "working" | "staged" | "commit" = "working";
    let ref1: string | undefined;
    let ref2: string = "HEAD";
    
    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      
      switch (arg) {
        case "--staged":
        case "-s":
          mode = "staged";
          break;
        case "--commit":
        case "-c":
          mode = "commit";
          ref1 = args[++i];
          break;
        case "--context":
        case "-U":
          options.context = parseInt(args[++i] ?? "3", 10);
          break;
        case "--word-diff":
        case "-w":
          options.wordDiff = true;
          break;
        case "--stat":
          options.format = "stat";
          break;
        case "--no-color":
          options.color = false;
          break;
        case "--ignore-whitespace":
        case "-W":
          options.ignoreWhitespace = true;
          break;
        default:
          if (!arg.startsWith("-")) {
            if (mode === "commit" && ref1) {
              ref2 = arg;
            } else {
              target = arg;
            }
          }
          break;
      }
    }
    
    // Execute diff
    let result: DiffResult;
    
    switch (mode) {
      case "staged":
        result = await getStagedDiff(options);
        break;
      case "commit":
        if (!ref1) {
          return {
            success: false,
            message: "Commit ref required for --commit mode",
          };
        }
        result = await getCommitDiff(ref1, ref2, options);
        break;
      default:
        result = await getGitDiff(target, options);
        break;
    }
    
    if (!result.success) {
      return {
        success: false,
        message: result.error ?? "Diff failed",
      };
    }
    
    const output = result.output ?? formatDiff(result, { color: options.color });
    
    return {
      success: true,
      message: output || "No changes",
      data: {
        additions: result.additions,
        deletions: result.deletions,
        files: result.files,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  diffCommand,
  getGitDiff,
  getStagedDiff,
  getCommitDiff,
  computeDiff,
  formatDiff,
  parseDiff,
};
