/**
 * File/Folder Mention System
 *
 * Allows users to reference files and folders in prompts using @mentions.
 * This enables the agent to automatically include file contents and context
 * when processing prompts.
 *
 * Strategy:
 * 1. Parse @mentions from user input
 * 2. Resolve file/folder paths
 * 3. Read file contents and metadata
 * 4. Inject into prompt context
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FileMentionOptions {
  /** Maximum file size to read in bytes (default: 1MB) */
  maxFileSize?: number;
  /** Maximum number of files to include (default: 10) */
  maxFiles?: number;
  /** Whether to include file metadata (default: true) */
  includeMetadata?: boolean;
  /** Whether to include line numbers (default: false) */
  includeLineNumbers?: boolean;
  /** File patterns to exclude */
  excludePatterns?: string[];
  /** Callback for file read errors */
  onError?: (filePath: string, error: Error) => void;
}

export interface FileMention {
  /** Original mention text */
  mention: string;
  /** Resolved file path */
  filePath: string;
  /** Whether path exists */
  exists: boolean;
  /** Whether path is a directory */
  isDirectory: boolean;
  /** File content (if file) */
  content?: string;
  /** File metadata */
  metadata?: FileMetadata;
  /** Error message if read failed */
  error?: string;
}

export interface FileMetadata {
  /** File size in bytes */
  size: number;
  /** Last modified date */
  modified: Date;
  /** File extension */
  extension: string;
  /** MIME type */
  mimeType: string;
  /** Line count (for text files) */
  lineCount?: number;
}

export interface FileMentionResult {
  /** Parsed mentions */
  mentions: FileMention[];
  /** Total files included */
  totalFiles: number;
  /** Total size in bytes */
  totalSize: number;
  /** Errors encountered */
  errors: string[];
  /** Formatted context string */
  contextString: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME Type Detection
// ─────────────────────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.less': 'text/x-less',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'text/xml',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.zsh': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.graphql': 'text/x-graphql',
  '.proto': 'text/x-protobuf',
  '.dockerfile': 'text/x-dockerfile',
  '.env': 'text/plain',
  '.gitignore': 'text/plain',
  '.dockerignore': 'text/plain',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'text/plain';
}

// ─────────────────────────────────────────────────────────────────────────────
// Mention Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse @mentions from user input.
 * Supports: @file.txt, @folder/, @path/to/file, @./relative/path
 */
export function parseMentions(input: string): string[] {
  // Match @ followed by file path
  const mentionRegex = /@([^\s@]+(?:\/[^\s@]*)*)/g;
  const mentions: string[] = [];
  let match;

  while ((match = mentionRegex.exec(input)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}

/**
 * Resolve mention to absolute path.
 */
function resolveMention(mention: string, cwd: string): string {
  // Handle relative paths
  if (mention.startsWith('./') || mention.startsWith('../')) {
    return path.resolve(cwd, mention);
  }

  // Handle absolute paths
  if (path.isAbsolute(mention)) {
    return mention;
  }

  // Handle relative to cwd
  return path.resolve(cwd, mention);
}

// ─────────────────────────────────────────────────────────────────────────────
// File Reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read file content and metadata.
 */
async function readFile(
  filePath: string,
  options: FileMentionOptions
): Promise<{ content?: string; metadata?: FileMetadata; error?: string }> {
  const {
    maxFileSize = 1024 * 1024, // 1MB
    includeMetadata = true,
    includeLineNumbers = false,
  } = options;

  try {
    // Check if file exists
    const stats = await fs.promises.stat(filePath);

    // Check if it's a directory
    if (stats.isDirectory()) {
      return {
        metadata: {
          size: 0,
          modified: stats.mtime,
          extension: '',
          mimeType: 'inode/directory',
        },
      };
    }

    // Check file size
    if (stats.size > maxFileSize) {
      return {
        error: `File too large (${stats.size} bytes, max: ${maxFileSize})`,
      };
    }

    // Read content
    const content = await fs.promises.readFile(filePath, 'utf-8');

    // Add line numbers if requested
    let formattedContent = content;
    if (includeLineNumbers) {
      const lines = content.split('\n');
      formattedContent = lines
        .map((line, i) => `${i + 1}: ${line}`)
        .join('\n');
    }

    // Build metadata
    const metadata: FileMetadata = {
      size: stats.size,
      modified: stats.mtime,
      extension: path.extname(filePath),
      mimeType: getMimeType(filePath),
      lineCount: content.split('\n').length,
    };

    return {
      content: formattedContent,
      metadata,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read directory contents.
 */
async function readDirectory(
  dirPath: string,
  options: FileMentionOptions
): Promise<{ content?: string; metadata?: FileMetadata; error?: string }> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const stats = await fs.promises.stat(dirPath);

    const content = entries
      .map(entry => {
        const prefix = entry.isDirectory() ? '📁' : '📄';
        return `${prefix} ${entry.name}`;
      })
      .join('\n');

    const metadata: FileMetadata = {
      size: 0,
      modified: stats.mtime,
      extension: '',
      mimeType: 'inode/directory',
      lineCount: entries.length,
    };

    return { content, metadata };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process @mentions in user input and return file context.
 */
export async function processFileMentions(
  input: string,
  cwd: string,
  options: FileMentionOptions = {}
): Promise<FileMentionResult> {
  const {
    maxFiles = 10,
    excludePatterns = [],
  } = options;

  const mentions = parseMentions(input);
  const result: FileMentionResult = {
    mentions: [],
    totalFiles: 0,
    totalSize: 0,
    errors: [],
    contextString: '',
  };

  // Limit number of mentions
  const limitedMentions = mentions.slice(0, maxFiles);

  for (const mention of limitedMentions) {
    const filePath = resolveMention(mention, cwd);

    // Check exclude patterns
    const shouldExclude = excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        // Glob pattern
        const regex = new RegExp(
          '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
        );
        return regex.test(path.basename(filePath));
      }
      return filePath.includes(pattern);
    });

    if (shouldExclude) {
      continue;
    }

    // Check if path exists
    let exists = false;
    let isDirectory = false;

    try {
      const stats = await fs.promises.stat(filePath);
      exists = true;
      isDirectory = stats.isDirectory();
    } catch {
      // Path doesn't exist
    }

    // Read content
    let content: string | undefined;
    let metadata: FileMetadata | undefined;
    let error: string | undefined;

    if (exists) {
      if (isDirectory) {
        const dirResult = await readDirectory(filePath, options);
        content = dirResult.content;
        metadata = dirResult.metadata;
        error = dirResult.error;
      } else {
        const fileResult = await readFile(filePath, options);
        content = fileResult.content;
        metadata = fileResult.metadata;
        error = fileResult.error;
      }
    } else {
      error = `File not found: ${filePath}`;
    }

    // Build mention
    const fileMention: FileMention = {
      mention,
      filePath,
      exists,
      isDirectory,
      content,
      metadata,
      error,
    };

    result.mentions.push(fileMention);

    if (exists && !error) {
      result.totalFiles++;
      if (metadata) {
        result.totalSize += metadata.size;
      }
    }

    if (error) {
      result.errors.push(error);
    }
  }

  // Build context string
  result.contextString = buildContextString(result.mentions);

  logger.debug('[FileMention] Processed mentions', {
    input: input.substring(0, 100),
    mentionCount: limitedMentions.length,
    totalFiles: result.totalFiles,
    totalSize: result.totalSize,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Build context string from mentions.
 */
function buildContextString(mentions: FileMention[]): string {
  const parts: string[] = [];

  for (const mention of mentions) {
    if (!mention.exists) {
      parts.push(`[@${mention.mention}] Error: ${mention.error}`);
      continue;
    }

    if (mention.isDirectory) {
      parts.push(`[@${mention.mention}] Directory contents:\n${mention.content}`);
    } else if (mention.content) {
      const header = mention.metadata?.lineCount
        ? `[@${mention.mention}] (${mention.metadata.lineCount} lines)`
        : `[@${mention.mention}]`;
      parts.push(`${header}:\n${mention.content}`);
    }
  }

  return parts.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if input contains @mentions.
 */
export function hasMentions(input: string): boolean {
  return /@([^\s@]+)/.test(input);
}

/**
 * Get mention count from input.
 */
export function getMentionCount(input: string): number {
  return parseMentions(input).length;
}

/**
 * Replace @mentions with formatted references.
 */
export function replaceMentions(
  input: string,
  mentions: FileMention[]
): string {
  let result = input;

  for (const mention of mentions) {
    const regex = new RegExp(`@${mention.mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
    const replacement = mention.exists
      ? `[File: ${mention.filePath}]`
      : `[Missing: ${mention.filePath}]`;
    result = result.replace(regex, replacement);
  }

  return result;
}

export default processFileMentions;