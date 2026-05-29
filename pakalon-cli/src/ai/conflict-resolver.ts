/**
 * Git merge conflict resolver — pure TypeScript via LLM.
 * Replaces Python bridge /agent/resolve-conflict endpoint.
 */
import * as fs from "fs";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConflictResolution {
  filePath: string;
  resolvedContent: string;
  strategy: "accept-current" | "accept-incoming" | "both" | "custom";
}

export interface ResolveOptions {
  filePath: string;
  conflictContent?: string;
  strategy?: "accept-current" | "accept-incoming" | "both" | "auto";
  apiKey?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Conflict Detection
// ---------------------------------------------------------------------------

/**
 * Detect if a file has merge conflicts.
 */
export function hasConflicts(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.includes("<<<<<<<") && content.includes(">>>>>>>") && content.includes("=======");
  } catch {
    return false;
  }
}

/**
 * Extract conflict blocks from a file.
 */
export function extractConflicts(content: string): Array<{
  current: string;
  incoming: string;
  startLine: number;
  endLine: number;
}> {
  const conflicts: Array<{ current: string; incoming: string; startLine: number; endLine: number }> = [];
  const lines = content.split("\n");

  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.startsWith("<<<<<<<")) {
      const startLine = i;
      const currentLines: string[] = [];
      const incomingLines: string[] = [];

      i++; // Skip <<<<<<< line

      // Collect current section
      while (i < lines.length && !lines[i]?.startsWith("=======")) {
        currentLines.push(lines[i]!);
        i++;
      }

      i++; // Skip ======= line

      // Collect incoming section
      while (i < lines.length && !lines[i]?.startsWith(">>>>>>>")) {
        incomingLines.push(lines[i]!);
        i++;
      }

      const endLine = i;
      i++; // Skip >>>>>>> line

      conflicts.push({
        current: currentLines.join("\n"),
        incoming: incomingLines.join("\n"),
        startLine,
        endLine,
      });
    } else {
      i++;
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Resolution Strategies
// ---------------------------------------------------------------------------

/**
 * Resolve conflicts using a simple strategy.
 */
export function resolveWithStrategy(
  content: string,
  strategy: "accept-current" | "accept-incoming" | "both",
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inConflict = false;
  let inCurrent = false;
  let inIncoming = false;

  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) {
      inConflict = true;
      inCurrent = true;
      inIncoming = false;
      continue;
    }

    if (line.startsWith("=======") && inConflict) {
      inCurrent = false;
      inIncoming = true;
      continue;
    }

    if (line.startsWith(">>>>>>>") && inConflict) {
      inConflict = false;
      inCurrent = false;
      inIncoming = false;
      continue;
    }

    if (!inConflict) {
      result.push(line);
    } else if (strategy === "accept-current" && inCurrent) {
      result.push(line);
    } else if (strategy === "accept-incoming" && inIncoming) {
      result.push(line);
    } else if (strategy === "both") {
      if (inCurrent) result.push(line);
      if (inIncoming) result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Resolve conflicts using LLM (intelligent merge).
 */
export async function resolveWithLLM(
  filePath: string,
  content: string,
  apiKey: string,
  model?: string,
): Promise<string> {
  const conflicts = extractConflicts(content);

  if (conflicts.length === 0) return content;

  const conflictDescription = conflicts
    .map((c, i) => `Conflict ${i + 1}:\n--- Current ---\n${c.current}\n--- Incoming ---\n${c.incoming}`)
    .join("\n\n");

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model ?? "anthropic/claude-3.5-sonnet",
        messages: [
          {
            role: "system",
            content: "You are a merge conflict resolver. For each conflict, decide which version to keep, or merge both. Respond with the resolved code for each conflict, numbered. Only output the resolved code, nothing else.",
          },
          {
            role: "user",
            content: `File: ${filePath}\n\nConflicts:\n${conflictDescription}`,
          },
        ],
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API returned ${response.status}`);
    }

    const data = await response.json() as any;
    const llmResponse = data.choices?.[0]?.message?.content ?? "";

    // Apply LLM resolutions
    let resolved = content;
    const resolutions = llmResponse.split(/\n---\n|\n\n/);

    for (let i = conflicts.length - 1; i >= 0; i--) {
      const conflict = conflicts[i]!;
      const resolution = resolutions[i] ?? conflict.current;

      // Replace conflict block with resolution
      const lines = resolved.split("\n");
      lines.splice(conflict.startLine, conflict.endLine - conflict.startLine + 1, resolution.trim());
      resolved = lines.join("\n");
    }

    return resolved;
  } catch (err) {
    logger.error("[conflict-resolver] LLM resolution failed", { error: String(err) });
    // Fall back to accepting incoming
    return resolveWithStrategy(content, "accept-incoming");
  }
}

/**
 * Main resolution entry point.
 */
export async function resolveConflicts(options: ResolveOptions): Promise<ConflictResolution> {
  const { filePath, strategy = "auto", apiKey, model } = options;

  const content = options.conflictContent ?? fs.readFileSync(filePath, "utf-8");

  if (!content.includes("<<<<<<<")) {
    return { filePath, resolvedContent: content, strategy: "custom" };
  }

  if (strategy === "accept-current" || strategy === "accept-incoming" || strategy === "both") {
    return {
      filePath,
      resolvedContent: resolveWithStrategy(content, strategy),
      strategy,
    };
  }

  // Auto mode — use LLM if available
  if (apiKey) {
    try {
      const resolved = await resolveWithLLM(filePath, content, apiKey, model);
      return { filePath, resolvedContent: resolved, strategy: "custom" };
    } catch {
      // Fall through
    }
  }

  // Default: accept incoming
  return {
    filePath,
    resolvedContent: resolveWithStrategy(content, "accept-incoming"),
    strategy: "accept-incoming",
  };
}
