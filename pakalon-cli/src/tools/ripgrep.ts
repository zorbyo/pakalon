/**
 * Ripgrep wrapper — fast code search via bundled rg binary.
 * Matches Copilot CLI's bundled ripgrep approach.
 *
 * Falls back to a Node.js recursive walk if ripgrep is not installed.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { executeBash } from "./bash.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RipgrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface RipgrepOptions {
  pattern: string;
  cwd?: string;
  glob?: string;
  caseSensitive?: boolean;
  maxResults?: number;
  includeHidden?: boolean;
  followSymlinks?: boolean;
  contextLines?: number;
}

export interface RipgrepResult {
  matches: RipgrepMatch[];
  count: number;
  truncated: boolean;
  elapsed: number;
}

export interface GlobOptions {
  pattern: string;
  cwd?: string;
  maxResults?: number;
  excludePatterns?: string[];
}

export interface GlobResult {
  files: string[];
  count: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Ripgrep binary resolution
// ---------------------------------------------------------------------------

function findRipgrepBinary(): string | null {
  // Check common locations
  const candidates = [
    "rg", // PATH
    "/usr/bin/rg",
    "/usr/local/bin/rg",
    path.join(os.homedir(), ".cargo/bin/rg"),
  ];

  if (process.platform === "win32") {
    candidates.push(
      "rg.exe",
      path.join(os.homedir(), "scoop/apps/ripgrep/current/rg.exe"),
      path.join(os.homedir(), ".cargo/bin/rg.exe"),
    );
  }

  for (const candidate of candidates) {
    try {
      // Quick check: try `rg --version`
      const { execSync } = require("child_process") as typeof import("child_process");
      execSync(`${candidate} --version`, { stdio: "ignore", timeout: 2000 });
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

let _rgBinary: string | null | undefined;

function getRipgrepBinary(): string | null {
  if (_rgBinary === undefined) {
    _rgBinary = findRipgrepBinary();
    if (_rgBinary) {
      logger.info(`[ripgrep] Found binary: ${_rgBinary}`);
    } else {
      logger.warn("[ripgrep] Not found — falling back to Node.js file walk");
    }
  }
  return _rgBinary;
}

// ---------------------------------------------------------------------------
// Ripgrep search
// ---------------------------------------------------------------------------

/**
 * Search files using ripgrep (rg) for maximum performance.
 */
export async function ripgrepSearch(options: RipgrepOptions): Promise<RipgrepResult> {
  const {
    pattern,
    cwd = process.cwd(),
    glob,
    caseSensitive = false,
    maxResults = 100,
    includeHidden = false,
    followSymlinks = false,
    contextLines = 0,
  } = options;

  const startTime = Date.now();
  const rg = getRipgrepBinary();

  if (rg) {
    return ripgrepSearchNative(rg, options, startTime);
  }

  // Fallback: Node.js recursive walk
  return ripgrepSearchFallback(options, startTime);
}

async function ripgrepSearchNative(
  rg: string,
  options: RipgrepOptions,
  startTime: number,
): Promise<RipgrepResult> {
  const {
    pattern,
    cwd = process.cwd(),
    glob,
    caseSensitive = false,
    maxResults = 100,
    includeHidden = false,
    followSymlinks = false,
    contextLines = 0,
  } = options;

  const args: string[] = ["--json", "--max-count", String(maxResults)];

  if (!caseSensitive) args.push("-i");
  if (includeHidden) args.push("--hidden");
  if (followSymlinks) args.push("--follow");
  if (contextLines > 0) args.push("-C", String(contextLines));
  if (glob) args.push("--glob", glob);

  // Exclude common directories
  args.push("--glob", "!node_modules/**");
  args.push("--glob", "!.git/**");
  args.push("--glob", "!dist/**");
  args.push("--glob", "!.next/**");

  args.push(pattern, ".");

  const result = await executeBash({
    command: `${rg} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`,
    cwd,
    timeout: 30000,
  });

  const matches: RipgrepMatch[] = [];
  const lines = result.stdout.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "match") {
        matches.push({
          file: parsed.data?.path?.text ?? "",
          line: (parsed.data?.line_number ?? 0),
          text: (parsed.data?.lines?.text ?? "").trim().slice(0, 200),
        });
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return {
    matches: matches.slice(0, maxResults),
    count: matches.length,
    truncated: matches.length >= maxResults,
    elapsed: Date.now() - startTime,
  };
}

async function ripgrepSearchFallback(
  options: RipgrepOptions,
  startTime: number,
): Promise<RipgrepResult> {
  const {
    pattern,
    cwd = process.cwd(),
    caseSensitive = false,
    maxResults = 100,
  } = options;

  const flags = caseSensitive ? "g" : "gi";
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    // Escape special regex chars for literal search
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  }

  const matches: RipgrepMatch[] = [];

  const walk = (dir: string, base: string) => {
    if (matches.length >= maxResults) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      if (matches.length >= maxResults) break;
      const rel = base ? `${base}/${e.name}` : e.name;

      if (rel.includes("node_modules") || rel.startsWith(".git") || rel.startsWith("dist/")) {
        continue;
      }

      if (e.isDirectory()) {
        walk(path.join(dir, e.name), rel);
      } else {
        if (/\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|mp4|webm|zip|tar|gz|bin|exe|dll)$/i.test(e.name)) {
          continue;
        }
        try {
          const content = fs.readFileSync(path.join(dir, e.name), "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i] ?? "")) {
              matches.push({
                file: rel,
                line: i + 1,
                text: (lines[i] ?? "").trim().slice(0, 200),
              });
            }
          }
        } catch {
          /* skip unreadable files */
        }
      }
    }
  };

  walk(cwd, "");

  return {
    matches,
    count: matches.length,
    truncated: matches.length >= maxResults,
    elapsed: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Glob (file finding)
// ---------------------------------------------------------------------------

/**
 * Find files matching a glob pattern using ripgrep or Node.js fallback.
 */
export async function ripgrepGlob(options: GlobOptions): Promise<GlobResult> {
  const {
    pattern,
    cwd = process.cwd(),
    maxResults = 200,
    excludePatterns = ["node_modules/**", ".git/**", "dist/**", ".next/**"],
  } = options;

  const rg = getRipgrepBinary();

  if (rg) {
    return ripgrepGlobNative(rg, options);
  }

  return globFallback(pattern, cwd, maxResults, excludePatterns);
}

async function ripgrepGlobNative(
  rg: string,
  options: GlobOptions,
): Promise<GlobResult> {
  const {
    pattern,
    cwd = process.cwd(),
    maxResults = 200,
    excludePatterns = ["node_modules/**", ".git/**", "dist/**"],
  } = options;

  const args: string[] = ["--files", "--max-count", String(maxResults)];

  for (const exclude of excludePatterns) {
    args.push("--glob", `!${exclude}`);
  }
  args.push("--glob", pattern);

  const result = await executeBash({
    command: `${rg} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`,
    cwd,
    timeout: 15000,
  });

  const files = result.stdout.split("\n").filter((f) => f.trim()).slice(0, maxResults);

  return {
    files,
    count: files.length,
    truncated: files.length >= maxResults,
  };
}

async function globFallback(
  pattern: string,
  cwd: string,
  maxResults: number,
  excludePatterns: string[],
): Promise<GlobResult> {
  const results: string[] = [];

  try {
    const { minimatch } = await import("minimatch");

    const walk = (dir: string, base: string) => {
      if (results.length >= maxResults) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const e of entries) {
        if (results.length >= maxResults) break;
        const rel = base ? `${base}/${e.name}` : e.name;

        const excluded = excludePatterns.some((ep) =>
          minimatch(rel, ep, { dot: true })
        );
        if (excluded) continue;

        if (e.isDirectory()) {
          walk(path.join(dir, e.name), rel);
        } else {
          if (minimatch(rel, pattern, { dot: true })) {
            results.push(rel);
          }
        }
      }
    };

    walk(cwd, "");
  } catch {
    // minimatch not available, use simple extension matching
    const ext = pattern.replace("**/*", "").replace("*", "");
    const walkSimple = (dir: string, base: string) => {
      if (results.length >= maxResults) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (results.length >= maxResults) break;
          const rel = base ? `${base}/${e.name}` : e.name;
          if (rel.includes("node_modules") || rel.startsWith(".git")) continue;
          if (e.isDirectory()) {
            walkSimple(path.join(dir, e.name), rel);
          } else if (rel.endsWith(ext)) {
            results.push(rel);
          }
        }
      } catch { /* skip */ }
    };
    walkSimple(cwd, "");
  }

  return {
    files: results,
    count: results.length,
    truncated: results.length >= maxResults,
  };
}
