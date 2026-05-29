/**
 * Tool Display Formatter — Claude Code / Copilot CLI style output.
 *
 * Formats tool calls and results for clean terminal display instead of
 * raw JSON dumps. Produces output like:
 *
 *   ┌ tool: writeFile
 *   │ path: demo.py
 *   │ content: (42 lines)
 *   └ [OK] success
 *
 * Instead of:
 *   writeFile {"filePath":"demo.py","content":"# ...long JSON..."}
 *   writeFile result
 *   {"success":true,"path":"..."}
 */

// ---------------------------------------------------------------------------
// Tool call formatting
// ---------------------------------------------------------------------------

/**
 * Format a tool call input for display.
 * Returns a compact, human-readable string instead of raw JSON.
 */
export function formatToolCall(toolName: string, input: Record<string, unknown>, note?: string): string {
  const lines: string[] = [];

  // Tool name header with note if provided
  if (note) {
    lines.push(`${note}`);
  }

  switch (toolName) {
    case "writeFile":
    case "editFile":
    case "multiEditFiles": {
      const filePath = String(input.filePath ?? input.path ?? "");
      const content = String(input.content ?? input.newString ?? "");
      const contentLines = content.split("\n").length;
      lines.push(`write ${filePath}${content ? ` (${contentLines} lines)` : ""}`);
      break;
    }

    case "readFile":
    case "view": {
      const filePath = String(input.filePath ?? input.file ?? "");
      const maxBytes = input.maxBytes ? `, max ${input.maxBytes} bytes` : "";
      const startLine = input.startLine ? `, lines ${input.startLine}-${input.endLine ?? "end"}` : "";
      lines.push(`read ${filePath}${maxBytes}${startLine}`);
      break;
    }

    case "bash": {
      const cmd = String(input.command ?? "");
      // Truncate long commands
      const displayCmd = cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd;
      lines.push(`$ ${displayCmd}`);
      break;
    }

    case "globFind":
    case "glob": {
      const pattern = String(input.pattern ?? "");
      const cwd = input.cwd ? ` in ${input.cwd}` : "";
      lines.push(`find ${pattern}${cwd}`);
      break;
    }

    case "grepSearch":
    case "rg": {
      const pattern = String(input.pattern ?? "");
      const searchPath = String(input.path ?? input.cwd ?? ".");
      const ext = input.extensions ? ` [${input.extensions}]` : "";
      lines.push(`search "${pattern}" in ${searchPath}${ext}`);
      break;
    }

    case "listDir": {
      const dirPath = String(input.dirPath ?? input.path ?? ".");
      const recursive = input.recursive ? " (recursive)" : "";
      lines.push(`ls ${dirPath}${recursive}`);
      break;
    }

    case "set-location":
    case "cd": {
      lines.push(`cd ${String(input.path ?? "")}`);
      break;
    }

    case "webFetch": {
      lines.push(`fetch ${String(input.url ?? "")}`);
      break;
    }

    case "webSearch": {
      lines.push(`search web: "${String(input.query ?? "")}"`);
      break;
    }

    case "askUser": {
      lines.push(`ask: "${String(input.question ?? "")}"`);
      break;
    }

    default: {
      // Generic compact display — show key parameters
      const params = Object.entries(input)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => {
          const val = typeof v === "string"
            ? (v.length > 60 ? v.slice(0, 60) + "..." : v)
            : typeof v === "object"
              ? "(object)"
              : String(v);
          return `${k}: ${val}`;
        })
        .join(", ");
      lines.push(params || "(no input)");
      break;
    }
  }

  return lines.join("\n");
}

/**
 * Format a tool result for display.
 * Returns a compact, human-readable string instead of raw JSON.
 */
export function formatToolResult(toolName: string, result: unknown): string {
  if (result === null || result === undefined) return "";

  const obj = (typeof result === "object" && result !== null) ? result as Record<string, unknown> : null;

  // Check for errors first
  if (obj?.error) {
    return `[X] ${String(obj.error).slice(0, 200)}`;
  }

  if (obj?.blocked) {
    return `⊘ blocked${obj.error ? `: ${String(obj.error).slice(0, 200)}` : ""}`;
  }

  switch (toolName) {
    case "writeFile":
    case "editFile": {
      if (obj?.success) {
        const path = String(obj.path ?? "");
        const diagnostics = obj.lspDiagnostics as unknown[] | undefined;
        let out = `[OK] ${path}`;
        if (diagnostics && diagnostics.length > 0) {
          out += `\n  ${diagnostics.length} diagnostic(s)`;
        }
        return out;
      }
      if (obj?.noChange) return "[OK] file already up to date";
      break;
    }

    case "readFile":
    case "view": {
      if (typeof result === "string") {
        const lineCount = result.split("\n").length;
        return `[OK] ${lineCount} lines`;
      }
      if (obj?.content) {
        const lineCount = String(obj.content).split("\n").length;
        const total = obj.totalLines ? ` of ${obj.totalLines}` : "";
        return `[OK] ${lineCount} lines${total}`;
      }
      if (obj?.isDirectory) return `directory listing`;
      break;
    }

    case "bash": {
      const stdout = String(obj?.stdout ?? "").trim();
      const exitCode = obj?.exitCode ?? 0;
      const stderr = String(obj?.stderr ?? "").trim();
      const lines: string[] = [];
      if (stdout) {
        const stdoutLines = stdout.split("\n");
        if (stdoutLines.length <= 5) {
          lines.push(stdout);
        } else {
          lines.push(stdoutLines.slice(0, 3).join("\n") + `\n... (${stdoutLines.length} lines)`);
        }
      }
      if (stderr) lines.push(`stderr: ${stderr.slice(0, 200)}`);
      if (exitCode !== 0) lines.push(`exit ${exitCode}`);
      return lines.join("\n") || "(no output)";
    }

    case "globFind":
    case "glob": {
      const files = obj?.files as string[] | undefined;
      if (files) return `[OK] ${files.length} file(s) found`;
      break;
    }

    case "grepSearch":
    case "rg": {
      const matches = obj?.matches as unknown[] | undefined;
      const count = obj?.count as number | undefined;
      if (count !== undefined) return `[OK] ${count} match(es)`;
      if (matches) return `[OK] ${matches.length} match(es)`;
      break;
    }

    case "listDir": {
      const entries = obj?.entries as string[] | undefined;
      if (entries) return `[OK] ${entries.length} entries`;
      break;
    }

    case "set-location":
    case "cd": {
      if (obj?.success || obj?.cwd) return `[OK] ${String(obj.cwd ?? "")}`;
      break;
    }

    default: {
      // Generic: show success status and key fields
      if (obj?.success) return "[OK] success";
      break;
    }
  }

  // Fallback: compact JSON for small results, truncation for large ones
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (text.length <= 200) return text;
  return text.slice(0, 200) + "...";
}
