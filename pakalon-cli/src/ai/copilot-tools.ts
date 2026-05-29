/**
 * Copilot CLI-style direct command tools.
 * Provides tools that mirror GitHub Copilot CLI's built-in tools:
 * - rg: Fast ripgrep code search (Copilot CLI's rg tool)
 * - view: File viewing with line ranges (Copilot CLI's view tool)
 * - setLocation: Change working directory (Copilot CLI's cd/set-location)
 *
 * These tools execute immediately as single-line commands, matching
 * the Copilot CLI's direct execution model.
 */
import { tool } from "ai";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { useStore } from "@/store/index.js";
import { ripgrepSearch } from "@/tools/ripgrep.js";
import { setBashSessionCwd } from "@/tools/bash.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// rg tool — Copilot CLI-style ripgrep search
// ---------------------------------------------------------------------------

export const rgTool = tool({
  description:
    "Search for regex patterns in files using ripgrep. " +
    "Fast, gitignore-aware code search - mirrors GitHub Copilot CLI's rg tool. " +
    "Example: rg({ pattern: 'useState', path: './src' })",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().optional().describe("File or directory to search in"),
    caseSensitive: z.boolean().optional().describe("Case-sensitive search"),
    extensions: z.string().optional().describe("Comma-separated file extensions to include"),
    context: z.number().optional().describe("Number of context lines around matches"),
    maxMatches: z.number().optional().describe("Maximum number of matches to return"),
    lineNumbers: z.boolean().optional().describe("Show line numbers in output"),
    glob: z.string().optional().describe("Glob pattern to filter files"),
  }),
  execute: async ({ pattern, path: searchPath, caseSensitive, context, maxMatches, lineNumbers, glob: globPattern }) => {
    const { permissionMode } = useStore.getState();
    if (permissionMode === "orchestration") {
      return { error: "Search blocked: orchestration mode is Q&A only.", blocked: true };
    }

    try {
      const searchDir = path.resolve(searchPath ?? ".");
      const result = await ripgrepSearch({
        pattern,
        cwd: searchDir,
        glob: globPattern,
        caseSensitive: caseSensitive ?? false,
        maxResults: maxMatches ?? 100,
        contextLines: context ?? 0,
      });

      const showLineNumbers = lineNumbers !== false;
      const lines = result.matches.map((m) =>
        showLineNumbers ? `${m.file}:${m.line}:${m.text}` : `${m.file}:${m.text}`
      );

      return {
        type: "text",
        content: lines.join("\n"),
        matches: result.matches,
        count: result.count,
        truncated: result.truncated,
        elapsed: result.elapsed,
      };
    } catch (err) {
      logger.error("[rg tool] Search failed", { pattern, path: searchPath, error: String(err) });
      return { error: String(err), matches: [], count: 0 };
    }
  },
});

// ---------------------------------------------------------------------------
// view tool — Copilot CLI-style file viewing
// ---------------------------------------------------------------------------

export const viewTool = tool({
  description:
    "View file contents with optional line range. " +
    "Mirrors GitHub Copilot CLI's view tool. " +
    "Returns file content with line numbers. " +
    "Example: view({ file: 'src/App.tsx', startLine: 1, endLine: 50 })",
  inputSchema: z.object({
    file: z.string().describe("File path to view"),
    startLine: z.number().optional().describe("Start line number (1-based, inclusive)"),
    endLine: z.number().optional().describe("End line number (inclusive)"),
    maxLines: z.number().optional().describe("Maximum number of lines to display"),
  }),
  execute: async ({ file, startLine, endLine, maxLines }) => {
    const { permissionMode } = useStore.getState();
    if (permissionMode === "orchestration") {
      return { error: "View blocked: orchestration mode is Q&A only.", blocked: true };
    }

    try {
      const absPath = path.resolve(file);
      if (!fs.existsSync(absPath)) {
        return { error: `File not found: ${absPath}` };
      }

      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(absPath, { withFileTypes: true })
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return {
          type: "text",
          content: entries.join("\n"),
          isDirectory: true,
          path: absPath,
        };
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const allLines = content.split("\n");
      const totalLines = allLines.length;

      let displayLines = allLines;
      let displayedRange = { start: 1, end: totalLines };

      if (startLine !== undefined) {
        const start = Math.max(0, startLine - 1);
        let end = endLine !== undefined ? Math.min(endLine, totalLines) : totalLines;
        if (maxLines) end = Math.min(end, start + maxLines);
        displayLines = allLines.slice(start, end);
        displayedRange = { start: startLine, end };
      } else if (maxLines) {
        displayLines = allLines.slice(0, maxLines);
        displayedRange = { start: 1, end: maxLines };
      }

      const numbered = displayLines.map((line, idx) => {
        const lineNum = displayedRange.start + idx;
        return `${String(lineNum).padStart(4)}>${line}`;
      });

      return {
        type: "text",
        content: numbered.join("\n"),
        totalLines,
        displayedRange,
        path: absPath,
        truncated: displayedRange.end < totalLines,
      };
    } catch (err) {
      logger.error("[view tool] Failed to read file", { file, error: String(err) });
      return { error: String(err) };
    }
  },
});

// ---------------------------------------------------------------------------
// setLocation tool — Copilot CLI-style directory change
// ---------------------------------------------------------------------------

let sessionCwd: string | null = null;

export function getSessionCwd(): string {
  return sessionCwd ?? process.cwd();
}

export function setSessionCwd(dir: string): void {
  sessionCwd = dir;
}

export const setLocationTool = tool({
  description:
    "Change the current working directory for this session. " +
    "All subsequent file operations and bash commands will use this directory. " +
    "Mirrors GitHub Copilot CLI's /cwd command and cd tool. " +
    "Example: setLocation({ path: 'src/components' })",
  inputSchema: z.object({
    path: z.string().describe("New working directory path (absolute or relative to current)"),
  }),
  execute: async ({ path: newPath }) => {
    try {
      const target = newPath.trim();
      const homeDir = process.env.HOME ?? process.env.USERPROFILE;

      let resolved: string;
      if (target === "~" && homeDir) {
        resolved = path.resolve(homeDir);
      } else if ((target.startsWith("~/") || target.startsWith("~\\")) && homeDir) {
        resolved = path.resolve(homeDir, target.slice(2));
      } else {
        resolved = path.resolve(sessionCwd ?? process.cwd(), target);
      }

      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return { error: `Directory not found: ${resolved}` };
      }

      sessionCwd = resolved;
      setBashSessionCwd(resolved);

      return {
        type: "text",
        content: `Working directory changed to: ${resolved}`,
        cwd: resolved,
        success: true,
      };
    } catch (err) {
      return { error: String(err) };
    }
  },
});

// ---------------------------------------------------------------------------
// Export Copilot-style tools collection
// ---------------------------------------------------------------------------

export const copilotTools = {
  rg: rgTool,
  view: viewTool,
  setLocation: setLocationTool,
  cd: setLocationTool,
};
