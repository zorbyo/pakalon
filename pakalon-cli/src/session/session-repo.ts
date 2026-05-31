/**
 * Session Repository
 * 
 * Repository pattern for session management, inspired by pi's JsonlSessionRepo.
 * Provides high-level API for session CRUD operations with:
 * - Session creation with metadata
 * - Session listing and filtering
 * - Session forking for branching
 * - Session deletion
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';
import { SessionError } from './errors.js';
import { JsonlSessionStorage, type JsonlSessionMetadata, type SessionTreeEntry } from './jsonl-storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionCreateOptions {
  id?: string;
  cwd: string;
  parentSessionPath?: string;
}

export interface SessionListOptions {
  cwd?: string;
  limit?: number;
  offset?: number;
}

export interface SessionForkOptions {
  entryId?: string;
  position?: "before" | "at";
  id?: string;
  cwd: string;
  parentSessionPath?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function createSessionId(): string {
  return randomUUID();
}

function createTimestamp(): string {
  return new Date().toISOString();
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Repository
// ─────────────────────────────────────────────────────────────────────────────

export class SessionRepo {
  private readonly sessionsRoot: string;

  constructor(sessionsRoot?: string) {
    this.sessionsRoot = sessionsRoot || path.join(
      process.env.PAKALON_CONFIG_DIR || path.join(os.homedir(), '.pakalon'),
      'jsonl-sessions'
    );
  }

  private async getSessionDir(cwd: string): Promise<string> {
    return path.join(this.sessionsRoot, encodeCwd(cwd));
  }

  private async createSessionFilePath(cwd: string, sessionId: string, timestamp: string): Promise<string> {
    const sessionDir = await this.getSessionDir(cwd);
    return path.join(sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
  }

  /**
   * Create a new session
   */
  async create(options: SessionCreateOptions): Promise<JsonlSessionStorage> {
    const id = options.id ?? createSessionId();
    const createdAt = createTimestamp();
    const sessionDir = await this.getSessionDir(options.cwd);
    await ensureDir(sessionDir);
    const filePath = await this.createSessionFilePath(options.cwd, id, createdAt);
    return JsonlSessionStorage.create(filePath, {
      cwd: options.cwd,
      sessionId: id,
      parentSessionPath: options.parentSessionPath,
    });
  }

  /**
   * Open an existing session
   */
  async open(metadata: JsonlSessionMetadata): Promise<JsonlSessionStorage> {
    if (!fsSync.existsSync(metadata.path)) {
      throw new SessionError("not_found", `Session not found: ${metadata.path}`);
    }
    return JsonlSessionStorage.open(metadata.path);
  }

  /**
   * List sessions
   */
  async list(options: SessionListOptions = {}): Promise<JsonlSessionMetadata[]> {
    const dirs = options.cwd ? [await this.getSessionDir(options.cwd)] : await this.listSessionDirs();
    const sessions: JsonlSessionMetadata[] = [];
    
    for (const dir of dirs) {
      if (!fsSync.existsSync(dir)) {
        continue;
      }
      
      try {
        const files = await fs.readdir(dir);
        const jsonlFiles = files.filter((file) => file.endsWith('.jsonl'));
        
        for (const file of jsonlFiles) {
          try {
            const filePath = path.join(dir, file);
            const metadata = await loadJsonlSessionMetadata(filePath);
            sessions.push(metadata);
          } catch (error) {
            const cause = error instanceof Error ? error : new Error(String(error));
            if (cause instanceof SessionError && cause.code === "invalid_session") {
              continue;
            }
            throw cause;
          }
        }
      } catch (error) {
        logger.error(`Failed to list sessions in ${dir}:`, error);
        continue;
      }
    }
    
    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    const offset = options.offset || 0;
    const limit = options.limit || 50;
    
    return sessions.slice(offset, offset + limit);
  }

  /**
   * Delete a session
   */
  async delete(metadata: JsonlSessionMetadata): Promise<void> {
    try {
      await fs.unlink(metadata.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new SessionError("storage", `Failed to delete session ${metadata.path}`, toError(error));
      }
    }
  }

  /**
   * Fork a session
   */
  async fork(
    sourceMetadata: JsonlSessionMetadata,
    options: SessionForkOptions,
  ): Promise<JsonlSessionStorage> {
    const source = await this.open(sourceMetadata);
    const forkedEntries = await getEntriesToFork(source, options);
    
    const id = options.id ?? createSessionId();
    const createdAt = createTimestamp();
    const sessionDir = await this.getSessionDir(options.cwd);
    await ensureDir(sessionDir);
    
    const storage = await JsonlSessionStorage.create(
      await this.createSessionFilePath(options.cwd, id, createdAt),
      {
        cwd: options.cwd,
        sessionId: id,
        parentSessionPath: options.parentSessionPath ?? sourceMetadata.path,
      },
    );
    
    for (const entry of forkedEntries) {
      await storage.appendEntry(entry);
    }
    
    return storage;
  }

  private async listSessionDirs(): Promise<string[]> {
    if (!fsSync.existsSync(this.sessionsRoot)) {
      return [];
    }
    
    try {
      const entries = await fs.readdir(this.sessionsRoot);
      return entries
        .filter((entry) => {
          try {
            return fsSync.statSync(path.join(this.sessionsRoot, entry)).isDirectory();
          } catch {
            return false;
          }
        })
        .map((entry) => path.join(this.sessionsRoot, entry));
    } catch (error) {
      logger.error('Failed to list session directories:', error);
      return [];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fork Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getEntriesToFork(
  source: JsonlSessionStorage,
  options: SessionForkOptions,
): Promise<SessionTreeEntry[]> {
  const entries = await source.getEntries();
  
  if (!options.entryId) {
    return [...entries];
  }
  
  const targetIndex = entries.findIndex((e) => e.id === options.entryId);
  if (targetIndex === -1) {
    throw new SessionError("invalid_fork_target", `Entry ${options.entryId} not found`);
  }
  
  if (options.position === "before") {
    return entries.slice(0, targetIndex);
  }
  
  return entries.slice(0, targetIndex + 1);
}

async function loadJsonlSessionMetadata(filePath: string): Promise<JsonlSessionMetadata> {
  const content = await fs.readFile(filePath, "utf-8");
  const firstLine = content.split("\n")[0];
  
  if (!firstLine?.trim()) {
    throw new SessionError("invalid_session", `Invalid JSONL session file ${filePath}: missing session header`);
  }
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch (error) {
    throw new SessionError("invalid_session", `Invalid JSONL session file ${filePath}: first line is not valid JSON`);
  }
  
  if (!isRecord(parsed) || parsed.type !== "session" || parsed.version !== 1) {
    throw new SessionError("invalid_session", `Invalid JSONL session file ${filePath}: invalid header`);
  }
  
  return {
    id: parsed.id as string,
    createdAt: parsed.timestamp as string,
    cwd: parsed.cwd as string,
    path: filePath,
    parentSessionPath: parsed.parentSession as string | undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}
