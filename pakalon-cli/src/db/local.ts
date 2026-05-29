import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { loadModeConfig } from "@/config/mode.js";
import type { LocalModel } from "@/ai/local/types.js";

const require = createRequire(import.meta.url);

interface Database {
  run: (sql: string) => unknown;
}

interface DatabaseConstructor {
  new (path: string, options?: { create?: boolean }): Database;
}

interface LocalStatement<Row> {
  run: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => Row[];
  get: (...params: unknown[]) => Row | null;
}

interface LocalDatabase extends Database {
  query: <Row = Record<string, unknown>>(sql: string) => LocalStatement<Row>;
}

export interface LocalSessionSummary {
  id: string;
  title: string | null;
  mode: string;
  model_id: string | null;
  project_dir: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
  messages_count?: number;
  prompt_text?: string | null;
}

export interface LocalSessionMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  model: string | null;
  created_at: string;
}

let localDb: Database | null = null;

function createSqliteDatabase(dbPath: string): Database {
  const sqlite = require("bun:sqlite") as { Database: DatabaseConstructor };
  return new sqlite.Database(dbPath, { create: true });
}

function query<Row = Record<string, unknown>>(db: Database, sql: string): LocalStatement<Row> {
  return (db as LocalDatabase).query<Row>(sql);
}

function getDbPath(): string {
  return loadModeConfig().storage.path;
}

export function getLocalDb(): Database {
  if (localDb) return localDb;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  localDb = createSqliteDatabase(dbPath);
  localDb.run("PRAGMA journal_mode = WAL;");
  localDb.run("PRAGMA foreign_keys = ON;");
  initLocalDatabase(localDb);
  return localDb;
}

export function initLocalDatabase(db?: Database): void {
  const target = db ?? getLocalDb();

  target.run(`
    CREATE TABLE IF NOT EXISTS selfhosted_sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      mode TEXT NOT NULL DEFAULT 'chat',
      model_id TEXT,
      project_dir TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  target.run(`
    CREATE TABLE IF NOT EXISTS selfhosted_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES selfhosted_sessions(id) ON DELETE CASCADE
    )
  `);

  target.run(`
    CREATE TABLE IF NOT EXISTS selfhosted_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  target.run(`
    CREATE TABLE IF NOT EXISTS selfhosted_models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_url TEXT NOT NULL,
      context_window INTEGER NOT NULL DEFAULT 0,
      parameters TEXT,
      quantization TEXT,
      size INTEGER,
      family TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function saveLocalModelRegistry(models: LocalModel[]): void {
  const db = getLocalDb();
  const stmt = query(db, `
    INSERT INTO selfhosted_models (
      id, name, provider, base_url, context_window, parameters, quantization, size, family, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      provider = excluded.provider,
      base_url = excluded.base_url,
      context_window = excluded.context_window,
      parameters = excluded.parameters,
      quantization = excluded.quantization,
      size = excluded.size,
      family = excluded.family,
      updated_at = datetime('now')
  `);

  for (const model of models) {
    stmt.run(
      model.id,
      model.name,
      model.provider,
      model.baseUrl,
      model.contextWindow,
      model.parameters ?? null,
      model.quantization ?? null,
      model.size ?? null,
      model.family ?? null,
    );
  }
}

export function loadLocalModelRegistry(): LocalModel[] {
  const rows = query<{
      id: string;
      name: string;
      provider: LocalModel["provider"];
      base_url: string;
      context_window: number;
      parameters: string | null;
      quantization: string | null;
      size: number | null;
      family: string | null;
    }>(getLocalDb(), "SELECT * FROM selfhosted_models ORDER BY provider, name")
    .all();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.base_url,
    contextWindow: row.context_window,
    parameters: row.parameters ?? undefined,
    quantization: row.quantization ?? undefined,
    size: row.size ?? undefined,
    family: row.family ?? undefined,
  }));
}

export function saveLocalSetting(key: string, value: unknown): void {
  query(getLocalDb(), `
      INSERT INTO selfhosted_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `)
    .run(key, JSON.stringify(value));
}

export function loadLocalSetting<T>(key: string): T | null {
  const row = query<{ value: string }>(getLocalDb(), "SELECT value FROM selfhosted_settings WHERE key = ?")
    .get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function createLocalSession(title?: string, mode = "chat", cwd = process.cwd(), modelId?: string | null): LocalSessionSummary {
  const id = randomUUID();
  const effectiveTitle = title ?? `Local session ${new Date().toLocaleString()}`;
  query(getLocalDb(), `
      INSERT INTO selfhosted_sessions (id, title, mode, model_id, project_dir)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(id, effectiveTitle, mode, modelId ?? null, cwd);

  const session = query<LocalSessionSummary>(getLocalDb(), "SELECT * FROM selfhosted_sessions WHERE id = ?")
    .get(id);
  if (!session) throw new Error("Failed to create local session");
  return session;
}

export function listLocalSessions(limit = 10, cwd?: string | null): LocalSessionSummary[] {
  const rows = query<LocalSessionSummary>(getLocalDb(), `
      SELECT
        s.*,
        (SELECT COUNT(*) FROM selfhosted_messages m WHERE m.session_id = s.id) AS message_count,
        (SELECT content FROM selfhosted_messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.created_at ASC LIMIT 1) AS prompt_text
      FROM selfhosted_sessions s
      ORDER BY s.updated_at DESC
    `)
    .all();

  const filtered = cwd ? rows.filter((row) => row.project_dir === cwd) : rows;
  return filtered.slice(0, limit).map((row) => ({
    ...row,
    messages_count: row.message_count ?? 0,
  }));
}

export function appendLocalSessionMessage(
  sessionId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  model?: string | null,
): LocalSessionMessage {
  const id = randomUUID();
  const db = getLocalDb();
  query(db, `
    INSERT INTO selfhosted_messages (id, session_id, role, content, model)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, sessionId, role, content, model ?? null);

  query(db, "UPDATE selfhosted_sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);

  const message = query<LocalSessionMessage>(db, "SELECT * FROM selfhosted_messages WHERE id = ?")
    .get(id);
  if (!message) throw new Error("Failed to append local message");
  return message;
}

export function loadLocalSessionMessages(sessionId: string): LocalSessionMessage[] {
  return query<LocalSessionMessage>(
      getLocalDb(),
      "SELECT * FROM selfhosted_messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId);
}

export function resolveLatestLocalSessionId(cwd?: string | null): string | null {
  return listLocalSessions(1, cwd)[0]?.id ?? null;
}

export function forkLocalSession(sourceSessionId: string, cwd = process.cwd(), modelId?: string | null): string {
  const newSession = createLocalSession(`Fork of ${sourceSessionId.slice(0, 8)}`, "chat", cwd, modelId);
  const messages = loadLocalSessionMessages(sourceSessionId);
  for (const message of messages) {
    appendLocalSessionMessage(
      newSession.id,
      message.role as "user" | "assistant" | "system" | "tool",
      message.content,
      message.model ?? modelId,
    );
  }
  return newSession.id;
}
