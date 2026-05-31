/**
 * JSONL Session Storage
 * 
 * Append-only JSONL-based session storage inspired by pi's implementation.
 * Provides durable, tree-based session persistence with:
 * - Append-only writes for durability
 * - Tree-based session entries with parent-child relationships
 * - Leaf tracking for session navigation
 * - Header metadata for session identification
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';
import { SessionError, type Result, ok, err, toError } from './errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionHeader {
  type: "session";
  version: 1;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionTreeEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface MessageEntry extends SessionTreeEntryBase {
  type: "message";
  message: {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  };
}

export interface ThinkingLevelChangeEntry extends SessionTreeEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionTreeEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface CompactionEntry extends SessionTreeEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  fromHook?: boolean;
}

export interface BranchSummaryEntry extends SessionTreeEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: unknown;
  fromHook?: boolean;
}

export interface CustomEntry extends SessionTreeEntryBase {
  type: "custom";
  customType: string;
  data?: unknown;
}

export interface CustomMessageEntry extends SessionTreeEntryBase {
  type: "custom_message";
  customType: string;
  content: string;
  details?: unknown;
  display: boolean;
}

export interface LabelEntry extends SessionTreeEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

export interface SessionInfoEntry extends SessionTreeEntryBase {
  type: "session_info";
  name?: string;
}

export interface LeafEntry extends SessionTreeEntryBase {
  type: "leaf";
  targetId: string | null;
}

export type SessionTreeEntry =
  | MessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
  | LeafEntry;

export interface JsonlSessionMetadata {
  id: string;
  createdAt: string;
  cwd: string;
  path: string;
  parentSessionPath?: string;
}

export interface SessionContext {
  messages: Array<{ role: string; content: string; timestamp: string }>;
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function generateEntryId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!byId.has(id)) return id;
  }
  return randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidSession(filePath: string, message: string, cause?: Error): SessionError {
  return new SessionError("invalid_session", `Invalid JSONL session file ${filePath}: ${message}`, cause);
}

function invalidEntry(filePath: string, lineNumber: number, message: string, cause?: Error): SessionError {
  return new SessionError(
    "invalid_entry",
    `Invalid JSONL session file ${filePath}: line ${lineNumber} ${message}`,
    cause,
  );
}

function parseHeaderLine(line: string, filePath: string): SessionHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidSession(filePath, "first line is not a valid session header", toError(error));
  }
  if (!isRecord(parsed)) throw invalidSession(filePath, "first line is not a valid session header");
  if (parsed.type !== "session") throw invalidSession(filePath, "first line is not a valid session header");
  if (parsed.version !== 1) throw invalidSession(filePath, "unsupported session version");
  if (typeof parsed.id !== "string" || !parsed.id) throw invalidSession(filePath, "session header is missing id");
  if (typeof parsed.timestamp !== "string" || !parsed.timestamp) {
    throw invalidSession(filePath, "session header is missing timestamp");
  }
  if (typeof parsed.cwd !== "string" || !parsed.cwd) throw invalidSession(filePath, "session header is missing cwd");
  if (parsed.parentSession !== undefined && typeof parsed.parentSession !== "string") {
    throw invalidSession(filePath, "session header parentSession must be a string");
  }
  return {
    type: "session",
    version: 1,
    id: parsed.id as string,
    timestamp: parsed.timestamp as string,
    cwd: parsed.cwd as string,
    parentSession: parsed.parentSession as string | undefined,
  };
}

function parseEntryLine(line: string, filePath: string, lineNumber: number): SessionTreeEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidEntry(filePath, lineNumber, "is not valid JSON", toError(error));
  }
  if (!isRecord(parsed)) throw invalidEntry(filePath, lineNumber, "is not a valid session entry");
  if (typeof parsed.type !== "string") throw invalidEntry(filePath, lineNumber, "is missing entry type");
  if (typeof parsed.id !== "string" || !parsed.id) throw invalidEntry(filePath, lineNumber, "is missing entry id");
  if (parsed.parentId !== null && typeof parsed.parentId !== "string") {
    throw invalidEntry(filePath, lineNumber, "has invalid parentId");
  }
  if (typeof parsed.timestamp !== "string" || !parsed.timestamp) {
    throw invalidEntry(filePath, lineNumber, "is missing timestamp");
  }
  if (parsed.type === "leaf" && parsed.targetId !== null && typeof parsed.targetId !== "string") {
    throw invalidEntry(filePath, lineNumber, "has invalid targetId");
  }
  return parsed as unknown as SessionTreeEntry;
}

function leafIdAfterEntry(entry: SessionTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId : entry.id;
}

function headerToSessionMetadata(header: SessionHeader, filePath: string): JsonlSessionMetadata {
  return {
    id: header.id,
    createdAt: header.timestamp,
    cwd: header.cwd,
    path: filePath,
    parentSessionPath: header.parentSession,
  };
}

function updateLabelCache(labelsById: Map<string, string>, entry: SessionTreeEntry): void {
  if (entry.type !== "label") return;
  const label = entry.label?.trim();
  if (label) {
    labelsById.set(entry.targetId, label);
  } else {
    labelsById.delete(entry.targetId);
  }
}

function buildLabelsById(entries: SessionTreeEntry[]): Map<string, string> {
  const labelsById = new Map<string, string>();
  for (const entry of entries) {
    updateLabelCache(labelsById, entry);
  }
  return labelsById;
}

// ─────────────────────────────────────────────────────────────────────────────
// JsonlSessionStorage
// ─────────────────────────────────────────────────────────────────────────────

export class JsonlSessionStorage {
  private readonly filePath: string;
  private readonly metadata: JsonlSessionMetadata;
  private entries: SessionTreeEntry[];
  private byId: Map<string, SessionTreeEntry>;
  private labelsById: Map<string, string>;
  private currentLeafId: string | null;

  private constructor(
    filePath: string,
    header: SessionHeader,
    entries: SessionTreeEntry[],
    leafId: string | null,
  ) {
    this.filePath = filePath;
    this.metadata = headerToSessionMetadata(header, this.filePath);
    this.entries = entries;
    this.byId = new Map(entries.map((entry) => [entry.id, entry]));
    this.labelsById = buildLabelsById(entries);
    this.currentLeafId = leafId;
  }

  static async open(filePath: string): Promise<JsonlSessionStorage> {
    const loaded = await loadJsonlStorage(filePath);
    return new JsonlSessionStorage(filePath, loaded.header, loaded.entries, loaded.leafId);
  }

  static async create(
    filePath: string,
    options: {
      cwd: string;
      sessionId: string;
      parentSessionPath?: string;
    },
  ): Promise<JsonlSessionStorage> {
    const header: SessionHeader = {
      type: "session",
      version: 1,
      id: options.sessionId,
      timestamp: new Date().toISOString(),
      cwd: options.cwd,
      parentSession: options.parentSessionPath,
    };
    
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(header)}\n`);
    return new JsonlSessionStorage(filePath, header, [], null);
  }

  getMetadata(): JsonlSessionMetadata {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    if (this.currentLeafId !== null && !this.byId.has(this.currentLeafId)) {
      throw new SessionError("invalid_session", `Entry ${this.currentLeafId} not found`);
    }
    return this.currentLeafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    const entry: LeafEntry = {
      type: "leaf",
      id: generateEntryId(this.byId),
      parentId: this.currentLeafId,
      timestamp: new Date().toISOString(),
      targetId: leafId,
    };
    await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.currentLeafId = leafId;
  }

  async createEntryId(): Promise<string> {
    return generateEntryId(this.byId);
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    updateLabelCache(this.labelsById, entry);
    this.currentLeafId = leafIdAfterEntry(entry);
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.byId.get(id);
  }

  async findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return this.entries.filter((entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry.type === type);
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.labelsById.get(id);
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (leafId === null) return [];
    const pathEntries: SessionTreeEntry[] = [];
    let current = this.byId.get(leafId);
    if (!current) throw new SessionError("not_found", `Entry ${leafId} not found`);
    while (current) {
      pathEntries.unshift(current);
      if (!current.parentId) break;
      const parent = this.byId.get(current.parentId);
      if (!parent) throw new SessionError("invalid_session", `Entry ${current.parentId} not found`);
      current = parent;
    }
    return pathEntries;
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    return [...this.entries];
  }

  async buildContext(): Promise<SessionContext> {
    const messages: SessionContext["messages"] = [];
    let thinkingLevel = "off";
    let model: SessionContext["model"] = null;

    for (const entry of this.entries) {
      switch (entry.type) {
        case "message":
          messages.push({
            role: entry.message.role,
            content: entry.message.content,
            timestamp: entry.message.timestamp,
          });
          break;
        case "thinking_level_change":
          thinkingLevel = entry.thinkingLevel;
          break;
        case "model_change":
          model = { provider: entry.provider, modelId: entry.modelId };
          break;
      }
    }

    return { messages, thinkingLevel, model };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadJsonlStorage(
  filePath: string,
): Promise<{
  header: SessionHeader;
  entries: SessionTreeEntry[];
  leafId: string | null;
}> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length === 0) {
    throw invalidSession(filePath, "missing session header");
  }

  const header = parseHeaderLine(lines[0]!, filePath);
  const entries: SessionTreeEntry[] = [];
  let leafId: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const entry = parseEntryLine(lines[i]!, filePath, i + 1);
    entries.push(entry);
    leafId = leafIdAfterEntry(entry);
  }
  return { header, entries, leafId };
}

export async function loadJsonlSessionMetadata(filePath: string): Promise<JsonlSessionMetadata> {
  const content = await fs.readFile(filePath, "utf-8");
  const firstLine = content.split("\n")[0];
  if (firstLine?.trim()) return headerToSessionMetadata(parseHeaderLine(firstLine, filePath), filePath);
  throw invalidSession(filePath, "missing session header");
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending Write Queue
// ─────────────────────────────────────────────────────────────────────────────

export type PendingWriteType =
  | "message"
  | "model_change"
  | "thinking_level_change"
  | "custom"
  | "custom_message"
  | "label"
  | "session_info"
  | "leaf";

export interface PendingSessionWrite {
  type: PendingWriteType;
  data: Omit<SessionTreeEntry, "id" | "parentId" | "timestamp">;
}

export class PendingWriteQueue {
  private queue: PendingSessionWrite[] = [];

  push(write: PendingSessionWrite): void {
    this.queue.push(write);
  }

  shift(): PendingSessionWrite | undefined {
    return this.queue.shift();
  }

  get length(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }

  toArray(): PendingSessionWrite[] {
    return [...this.queue];
  }
}
