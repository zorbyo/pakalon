/**
 * Copy Command for Pakalon CLI
 * 
 * Copies assistant messages to clipboard with code block extraction support.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { marked, Token, Tokens } from "marked";
import type { CommandContext, CommandResult } from "./types.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopyOptions {
  /** Copy full response instead of showing picker */
  fullResponse?: boolean;
  /** Save to file instead of clipboard */
  outputFile?: string;
  /** Message index (1 = latest, 2 = second-latest, etc.) */
  messageIndex?: number;
}

export interface CodeBlock {
  language: string;
  code: string;
  lineCount: number;
  index: number;
}

export interface CopyTarget {
  type: "full" | "codeblock";
  content: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Clipboard Support
// ---------------------------------------------------------------------------

/**
 * OSC 52 escape sequence for setting clipboard
 */
function osc52Clipboard(content: string): string {
  const encoded = Buffer.from(content).toString("base64");
  return `\x1b]52;c;${encoded}\x07`;
}

/**
 * Copy content to clipboard using OSC 52 or fallback to file
 */
export async function setClipboard(content: string): Promise<boolean> {
  // Try OSC 52 first
  if (process.stdout.isTTY) {
    process.stdout.write(osc52Clipboard(content));
    return true;
  }

  // Fallback: write to temp file and use system clipboard command
  const tempDir = path.join(os.homedir(), ".tmp", "pakalon");
  await fs.mkdir(tempDir, { recursive: true });
  
  const tempFile = path.join(tempDir, `clipboard-${Date.now()}.txt`);
  await fs.writeFile(tempFile, content, "utf-8");

  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    
    // Platform-specific clipboard commands
    const platform = process.platform;
    if (platform === "win32") {
      execSync(`clip < "${tempFile}"`, { shell: true });
    } else if (platform === "darwin") {
      execSync(`pbcopy < "${tempFile}"`, { shell: true });
    } else {
      // Linux with xclip or xsel
      try {
        execSync(`xclip -selection clipboard < "${tempFile}"`, { shell: true });
      } catch {
        execSync(`xsel --clipboard < "${tempFile}"`, { shell: true });
      }
    }
    
    return true;
  } catch (error) {
    logger.error(`[copy] Clipboard error: ${error}`);
    return false;
  } finally {
    // Clean up temp file
    await fs.unlink(tempFile).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Code Block Extraction
// ---------------------------------------------------------------------------

/**
 * Extract code blocks from markdown content
 */
export function extractCodeBlocks(content: string): CodeBlock[] {
  const tokens = marked.lexer(content);
  const blocks: CodeBlock[] = [];
  
  let blockIndex = 0;
  
  function processTokens(tokenList: Token[]): void {
    for (const token of tokenList) {
      if (token.type === "code") {
        const codeToken = token as Tokens.Code;
        const code = codeToken.text;
        const lines = code.split("\n").length;
        
        blocks.push({
          language: codeToken.lang ?? "text",
          code,
          lineCount: lines,
          index: blockIndex++,
        });
      }
      
      // Recurse into nested tokens
      if ("tokens" in token && Array.isArray(token.tokens)) {
        processTokens(token.tokens);
      }
    }
  }
  
  processTokens(tokens);
  return blocks;
}

/**
 * Get a preview of code content (first few lines)
 */
export function getCodePreview(code: string, maxLines: number = 3): string {
  const lines = code.split("\n");
  const preview = lines.slice(0, maxLines).join("\n");
  
  if (lines.length > maxLines) {
    return preview + "\n...";
  }
  return preview;
}

// ---------------------------------------------------------------------------
// Message Extraction
// ---------------------------------------------------------------------------

/**
 * Get recent assistant messages from conversation
 */
export function getAssistantMessages(
  context: CommandContext,
  maxCount: number = 20
): Array<{ content: string; index: number }> {
  const messages: Array<{ content: string; index: number }> = [];
  
  if (!context.messages) return messages;
  
  // Iterate backwards to get most recent first
  for (let i = context.messages.length - 1; i >= 0 && messages.length < maxCount; i--) {
    const msg = context.messages[i];
    if (!msg) continue;
    
    // Check for assistant role
    const role = (msg as Record<string, unknown>).role;
    if (role !== "assistant") continue;
    
    // Extract content
    const content = (msg as Record<string, unknown>).content;
    if (typeof content === "string") {
      messages.push({ content, index: i });
    } else if (Array.isArray(content)) {
      // Handle content parts
      const text = content
        .filter((part) => part && typeof part === "object" && (part as Record<string, unknown>).type === "text")
        .map((part) => (part as Record<string, unknown>).text as string)
        .join("\n");
      
      if (text) {
        messages.push({ content: text, index: i });
      }
    }
  }
  
  return messages;
}

// ---------------------------------------------------------------------------
// Copy Targets
// ---------------------------------------------------------------------------

/**
 * Build copy targets from message content
 */
export function buildCopyTargets(content: string): CopyTarget[] {
  const targets: CopyTarget[] = [];
  
  // Full response option
  targets.push({
    type: "full",
    content,
    description: `Full response (${content.length} chars)`,
  });
  
  // Code blocks
  const codeBlocks = extractCodeBlocks(content);
  for (const block of codeBlocks) {
    const langLabel = block.language !== "text" ? block.language : "";
    targets.push({
      type: "codeblock",
      content: block.code,
      description: `Code block ${block.index + 1}: ${langLabel} (${block.lineCount} lines)`,
    });
  }
  
  return targets;
}

// ---------------------------------------------------------------------------
// Command Implementation
// ---------------------------------------------------------------------------

export const copyCommand = {
  name: "copy",
  aliases: ["cp", "yank"],
  description: "Copy assistant response or code blocks to clipboard",
  usage: "/copy [message_index] [--full] [--file <path>]",
  
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    // Parse options
    const options: CopyOptions = {
      fullResponse: false,
      messageIndex: 1,
    };
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      
      if (arg === "--full" || arg === "-f") {
        options.fullResponse = true;
      } else if (arg === "--file" || arg === "-o") {
        options.outputFile = args[++i];
      } else if (/^\d+$/.test(arg)) {
        options.messageIndex = parseInt(arg, 10);
      }
    }
    
    // Get assistant messages
    const assistantMessages = getAssistantMessages(context);
    
    if (assistantMessages.length === 0) {
      return {
        success: false,
        message: "No assistant messages to copy",
      };
    }
    
    // Get target message
    const targetIndex = (options.messageIndex ?? 1) - 1;
    if (targetIndex >= assistantMessages.length) {
      return {
        success: false,
        message: `Message index out of range. Only ${assistantMessages.length} assistant message(s) available.`,
      };
    }
    
    const targetMessage = assistantMessages[targetIndex]!;
    const content = targetMessage.content;
    
    // Build copy targets
    const targets = buildCopyTargets(content);
    
    // Determine what to copy
    let contentToCopy: string;
    let description: string;
    
    if (options.fullResponse || targets.length <= 1) {
      // Copy full response
      contentToCopy = content;
      description = "Full response";
    } else {
      // In CLI mode, default to full response (no interactive picker)
      // Interactive picker would be implemented in UI layer
      contentToCopy = content;
      description = "Full response";
      
      // Log available code blocks for reference
      const codeBlocks = extractCodeBlocks(content);
      if (codeBlocks.length > 0) {
        logger.info(`[copy] ${codeBlocks.length} code block(s) available`);
        codeBlocks.forEach((block, i) => {
          logger.info(`  [${i + 1}] ${block.language}: ${block.lineCount} lines`);
        });
      }
    }
    
    // Output to file or clipboard
    if (options.outputFile) {
      try {
        await fs.writeFile(options.outputFile, contentToCopy, "utf-8");
        return {
          success: true,
          message: `Written to ${options.outputFile}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to write file: ${error}`,
        };
      }
    }
    
    // Copy to clipboard
    const success = await setClipboard(contentToCopy);
    
    if (success) {
      return {
        success: true,
        message: `Copied: ${description} (${contentToCopy.length} chars)`,
      };
    } else {
      return {
        success: false,
        message: "Failed to copy to clipboard",
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  copyCommand,
  extractCodeBlocks,
  getCodePreview,
  setClipboard,
  getAssistantMessages,
  buildCopyTargets,
};
