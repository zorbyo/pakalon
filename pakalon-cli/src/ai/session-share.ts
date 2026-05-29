/**
 * Session Sharing — export sessions to markdown or GitHub gist.
 *
 * Matches Copilot CLI's /share file|gist functionality.
 */
import * as fs from "fs";
import * as path from "path";
import type { ChatMessage } from "@/store/slices/session.slice.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionExport {
  sessionId: string;
  exportedAt: string;
  messages: ChatMessage[];
  metadata: {
    model?: string;
    workingDirectory?: string;
    messageCount: number;
  };
}

// ---------------------------------------------------------------------------
// Export to Markdown
// ---------------------------------------------------------------------------

/**
 * Export session to markdown format.
 */
export function exportToMarkdown(
  sessionId: string,
  messages: ChatMessage[],
  metadata: { model?: string; workingDirectory?: string } = {}
): string {
  const lines: string[] = [
    `# Session: ${sessionId}`,
    "",
    `**Exported:** ${new Date().toISOString()}`,
  ];

  if (metadata.model) {
    lines.push(`**Model:** ${metadata.model}`);
  }
  if (metadata.workingDirectory) {
    lines.push(`**Working Directory:** ${metadata.workingDirectory}`);
  }

  lines.push(`**Messages:** ${messages.length}`, "", "---", "");

  for (const msg of messages) {
    const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    const timestamp = msg.createdAt instanceof Date
      ? msg.createdAt.toISOString()
      : new Date(msg.createdAt).toISOString();

    lines.push(`### ${role} (${timestamp})`, "");
    lines.push(msg.content, "");

    if (msg.toolCalls) {
      lines.push("**Tool Calls:**", "```json");
      lines.push(JSON.stringify(msg.toolCalls, null, 2));
      lines.push("```", "");
    }

    lines.push("---", "");
  }

  return lines.join("\n");
}

/**
 * Save session as markdown file.
 */
export async function saveSessionAsMarkdown(
  sessionId: string,
  messages: ChatMessage[],
  outputPath: string,
  metadata: { model?: string; workingDirectory?: string } = {}
): Promise<string> {
  const markdown = exportToMarkdown(sessionId, messages, metadata);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, markdown, "utf-8");
  logger.info("[session-share] Exported to markdown", { outputPath });

  return outputPath;
}

// ---------------------------------------------------------------------------
// Export to JSON
// ---------------------------------------------------------------------------

/**
 * Export session to JSON format.
 */
export function exportToJson(
  sessionId: string,
  messages: ChatMessage[],
  metadata: { model?: string; workingDirectory?: string } = {}
): SessionExport {
  return {
    sessionId,
    exportedAt: new Date().toISOString(),
    messages,
    metadata: {
      ...metadata,
      messageCount: messages.length,
    },
  };
}

/**
 * Save session as JSON file.
 */
export async function saveSessionAsJson(
  sessionId: string,
  messages: ChatMessage[],
  outputPath: string,
  metadata: { model?: string; workingDirectory?: string } = {}
): Promise<string> {
  const data = exportToJson(sessionId, messages, metadata);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
  logger.info("[session-share] Exported to JSON", { outputPath });

  return outputPath;
}

// ---------------------------------------------------------------------------
// Create GitHub Gist (optional, requires gh CLI)
// ---------------------------------------------------------------------------

/**
 * Create a GitHub Gist from session markdown.
 * Requires `gh` CLI to be installed and authenticated.
 */
export async function createGist(
  sessionId: string,
  messages: ChatMessage[],
  options: { description?: string; public?: boolean } = {}
): Promise<{ url: string; id: string } | null> {
  const { execSync } = await import("child_process");

  try {
    // Check if gh is available
    execSync("gh --version", { stdio: "ignore" });
  } catch {
    logger.warn("[session-share] gh CLI not installed, cannot create gist");
    return null;
  }

  const markdown = exportToMarkdown(sessionId, messages);
  const filename = `pakalon-session-${sessionId.slice(0, 8)}.md`;

  // Create temp file
  const tmpPath = path.join(require("os").tmpdir(), filename);
  fs.writeFileSync(tmpPath, markdown, "utf-8");

  try {
    const visibility = options.public ? "--public" : "--secret";
    const desc = options.description ?? `Pakalon session ${sessionId.slice(0, 8)}`;

    const result = execSync(
      `gh gist create ${visibility} --desc "${desc}" "${tmpPath}"`,
      { encoding: "utf-8" }
    );

    const url = result.trim();
    const id = url.split("/").pop() ?? "";

    logger.info("[session-share] Created gist", { url, id });

    return { url, id };
  } catch (err) {
    logger.error("[session-share] Failed to create gist", { error: String(err) });
    return null;
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}
