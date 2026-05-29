/**
 * /share command — export session to markdown or GitHub gist.
 * Matches Copilot CLI's /share feature.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { useStore } from "@/store/index.js";

/**
 * Export the current session messages to a markdown string.
 */
export function exportSessionToMarkdown(): string {
  const { messages } = useStore.getState();
  const lines: string[] = [];

  lines.push("# Pakalon Session Export");
  lines.push("");
  lines.push(`**Exported**: ${new Date().toISOString()}`);
  lines.push("");

  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Tool";
    lines.push(`## ${role}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Export session to a file.
 */
export function exportSessionToFile(filePath?: string): string {
  const markdown = exportSessionToMarkdown();
  const outputPath = filePath ?? path.join(
    os.tmpdir(),
    `pakalon-session-${Date.now()}.md`,
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown, "utf-8");
  return outputPath;
}

/**
 * Get session summary for display.
 */
export function getSessionSummary(): { messageCount: number; roles: Record<string, number> } {
  const { messages } = useStore.getState();
  const roles: Record<string, number> = {};

  for (const msg of messages) {
    roles[msg.role] = (roles[msg.role] ?? 0) + 1;
  }

  return { messageCount: messages.length, roles };
}
