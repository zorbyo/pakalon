/**
 * PowerShell argv Overflow Handler
 * 
 * Handles Windows PowerShell command length limitations by:
 * - Detecting when commands exceed the 32,767 character limit
 * - Splitting large commands into smaller batches
 * - Using response files for very large payloads
 * - Encoding special characters properly
 */

import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import logger from "@/utils/logger.js";

export interface CommandChunk {
  index: number;
  total: number;
  command: string;
  useFile: boolean;
  filePath?: string;
}

const MAX_POWERSHELL_ARGS = 32767;
const RESPONSE_FILE_THRESHOLD = 8192;
const CHUNK_SIZE = 4000;

export class PowerShellArgvOverflowHandler {
  private tempDir: string;

  constructor(tempDir?: string) {
    this.tempDir = tempDir || join(process.cwd(), ".pakalon", "temp");
  }

  detectOverflow(command: string): boolean {
    return command.length > MAX_POWERSHELL_ARGS;
  }

  chunkCommand(command: string): CommandChunk[] {
    if (!this.detectOverflow(command)) {
      return [{ index: 0, total: 1, command, useFile: false }];
    }

    if (command.length > RESPONSE_FILE_THRESHOLD * 5) {
      return this.createResponseFileChunks(command);
    }

    return this.splitIntoChunks(command);
  }

  private splitIntoChunks(command: string): CommandChunk[] {
    const chunks: CommandChunk[] = [];
    let index = 0;

    for (let i = 0; i < command.length; i += CHUNK_SIZE) {
      const chunk = command.slice(i, i + CHUNK_SIZE);
      chunks.push({
        index: index++,
        total: Math.ceil(command.length / CHUNK_SIZE),
        command: chunk,
        useFile: false,
      });
    }

    return chunks;
  }

  private createResponseFileChunks(command: string): CommandChunk[] {
    const chunks: CommandChunk[] = [];
    const chunkSize = RESPONSE_FILE_THRESHOLD;
    let index = 0;

    for (let i = 0; i < command.length; i += chunkSize) {
      const chunk = command.slice(i, i + chunkSize);
      const filePath = this.writeResponseFile(chunk, index);

      chunks.push({
        index: index++,
        total: Math.ceil(command.length / chunkSize),
        command: chunk,
        useFile: true,
        filePath,
      });
    }

    return chunks;
  }

  private writeResponseFile(content: string, index: number): string {
    const fileName = `pakalon-ps-${Date.now()}-${index}.txt`;
    const filePath = join(this.tempDir, fileName);

    // Write with UTF-8 BOM for PowerShell compatibility
    const bom = "\ufeff";
    writeFileSync(filePath, bom + content, "utf-8");

    return filePath;
  }

  cleanupResponseFiles(chunks: CommandChunk[]): void {
    for (const chunk of chunks) {
      if (chunk.useFile && chunk.filePath && existsSync(chunk.filePath)) {
        try {
          unlinkSync(chunk.filePath);
        } catch (err) {
          logger.warn(`[PowerShellOverflow] Failed to cleanup ${chunk.filePath}:`, err);
        }
      }
    }
  }

  formatCommandForExecution(chunk: CommandChunk): string {
    if (chunk.useFile && chunk.filePath) {
      return `Get-Content -Path '${chunk.filePath}' -Raw | Invoke-Expression`;
    }
    return chunk.command;
  }

  buildExecutionScript(chunks: CommandChunk[]): string {
    if (chunks.length === 1) {
      return this.formatCommandForExecution(chunks[0]);
    }

    const statements = chunks.map((chunk, idx) => {
      const formatted = this.formatCommandForExecution(chunk);
      return idx === 0
        ? `$result = ${formatted}`
        : `$result = $result; ${formatted}`;
    });

    return statements.join("\n") + "\n$result";
  }

  detectSpecialChars(command: string): { hasSpecialChars: boolean; needsEncoding: boolean } {
    const needsEncoding = /[<>|&^%]/.test(command);
    return {
      hasSpecialChars: needsEncoding,
      needsEncoding,
    };
  }

  escapeForPowerShell(command: string): string {
    return command
      .replace(/`/g, "``")
      .replace(/\$/g, "`$")
      .replace(/"/g, '`"')
      .replace(/\\n/g, "`n")
      .replace(/\\r/g, "`r")
      .replace(/\\t/g, "`t");
  }

  createBashWrapper(command: string, useEncoding = false): string {
    if (useEncoding) {
      const encoded = Buffer.from(command, "utf-16le").toString("base64");
      return `powershell -EncodedCommand ${encoded}`;
    }

    return `powershell -Command "${this.escapeForPowerShell(command)}"`;
  }
}

let handler: PowerShellArgvOverflowHandler | null = null;

export function getPowerShellOverflowHandler(): PowerShellArgvOverflowHandler {
  if (!handler) {
    handler = new PowerShellArgvOverflowHandler();
  }
  return handler;
}

export function wrapPowerShellCommand(command: string): { wrapped: string; needsChunking: boolean; cleanup?: () => void } {
  const handler = getPowerShellOverflowHandler();

  if (!handler.detectOverflow(command)) {
    return { wrapped: command, needsChunking: false };
  }

  const chunks = handler.chunkCommand(command);
  if (chunks.length === 1) {
    return { wrapped: handler.formatCommandForExecution(chunks[0]), needsChunking: true };
  }

  const script = handler.buildExecutionScript(chunks);
  return {
    wrapped: handler.createBashWrapper(script, true),
    needsChunking: true,
    cleanup: () => handler.cleanupResponseFiles(chunks),
  };
}

export default PowerShellArgvOverflowHandler;