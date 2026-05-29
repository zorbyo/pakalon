import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'

export interface Mem0Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  name?: string
  metadata?: Record<string, unknown>
}

export interface Mem0Config {
  dbPath?: string
  namespace?: string
  enableFts?: boolean
}

export interface Mem0SearchOptions {
  userId?: string
  sessionId?: string
  limit?: number
  offset?: number
}

export interface Mem0GetAllOptions extends Mem0SearchOptions {}

export interface Mem0Memory {
  id: string
  content: string
  userId: string
  sessionId?: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Mem0SearchResult extends Mem0Memory {
  score: number
}

export interface Mem0HistoryEntry extends Mem0Memory {
  version: number
  operation: 'add' | 'update' | 'delete'
  changedAt: string
}

export interface Mem0AddOptions {
  userId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
}

export interface Mem0UpdateData {
  content?: string
  userId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
}

export interface Mem0Client {
  add(messages: Mem0Message[], options?: Mem0AddOptions): Promise<Mem0Memory>
  search(query: string, options?: Mem0SearchOptions): Promise<Mem0SearchResult[]>
  get(memoryId: string): Promise<Mem0Memory | null>
  update(memoryId: string, data: Mem0UpdateData): Promise<Mem0Memory | null>
  delete(memoryId: string): Promise<boolean>
  history(memoryId: string): Promise<Mem0HistoryEntry[]>
  getAll(options?: Mem0GetAllOptions): Promise<Mem0Memory[]>
}

type SqliteDatabase = InstanceType<typeof Database>

const DEFAULT_DB_PATH = path.join(
  process.env.PAKALON_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'pakalon'),
  'memory',
  'mem0.sqlite',
)

const PHASE_MEMORY_USER = '__phase__'

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function jsonParseRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  return {}
}

function normalizeContent(messages: Mem0Message[]): string {
  return messages
    .map((message) => {
      const prefix = `${message.role}${message.name ? `:${message.name}` : ''}`
      return `${prefix} ${message.content}`.trim()
    })
    .join('\n')
    .trim()
}

function toMemory(row: Record<string, unknown>): Mem0Memory {
  return {
    id: String(row.id),
    content: String(row.content ?? ''),
    userId: String(row.user_id ?? ''),
    sessionId: typeof row.session_id === 'string' ? row.session_id : undefined,
    metadata: jsonParseRecord(typeof row.metadata_json === 'string' ? row.metadata_json : undefined),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function toHistoryEntry(row: Record<string, unknown>): Mem0HistoryEntry {
  return {
    ...toMemory(row),
    version: Number(row.version ?? 1),
    operation: row.operation === 'update' || row.operation === 'delete' ? row.operation : 'add',
    changedAt: String(row.changed_at ?? row.updated_at ?? ''),
  }
}

function buildWhere(options?: Mem0SearchOptions): { clause: string; params: Record<string, unknown> } {
  const parts: string[] = []
  const params: Record<string, unknown> = {}

  if (options?.userId) {
    parts.push('user_id = @userId')
    params.userId = options.userId
  }
  if (options?.sessionId) {
    parts.push('session_id = @sessionId')
    params.sessionId = options.sessionId
  }

  return {
    clause: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '',
    params,
  }
}

class SqliteMem0Client implements Mem0Client {
  private readonly db: SqliteDatabase
  private readonly ftsEnabled: boolean

  constructor(config?: Mem0Config) {
    const dbPath = config?.dbPath ?? DEFAULT_DB_PATH
    ensureDir(dbPath)
    this.db = new Database(dbPath)
    this.ftsEnabled = config?.enableFts ?? true
    this.initialize()
  }

  private initialize(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_history (
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        operation TEXT NOT NULL,
        content TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_history_memory_id ON memory_history(id);
    `)

    if (this.ftsEnabled) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            content,
            user_id UNINDEXED,
            session_id UNINDEXED,
            memory_id UNINDEXED,
            metadata_json UNINDEXED
          );
        `)
      } catch {
        // FTS5 unavailable; search will fall back to keyword matching.
      }
    }
  }

  private upsertHistory(memory: Mem0Memory, operation: Mem0HistoryEntry['operation']): void {
    const versionRow = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM memory_history WHERE id = ?')
      .get(memory.id) as { version?: number } | undefined
    const version = (versionRow?.version ?? 0) + 1
    this.db
      .prepare(
        `INSERT INTO memory_history (
          id, version, operation, content, user_id, session_id, metadata_json,
          created_at, updated_at, changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        memory.id,
        version,
        operation,
        memory.content,
        memory.userId,
        memory.sessionId ?? null,
        JSON.stringify(memory.metadata),
        memory.createdAt,
        memory.updatedAt,
        nowIso(),
      )
  }

  private syncFts(memory: Mem0Memory): void {
    if (!this.ftsEnabled) return
    try {
      this.db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(memory.id)
      this.db
        .prepare('INSERT INTO memories_fts (content, user_id, session_id, memory_id, metadata_json) VALUES (?, ?, ?, ?, ?)')
        .run(memory.content, memory.userId, memory.sessionId ?? null, memory.id, JSON.stringify(memory.metadata))
    } catch {
      // FTS is best-effort.
    }
  }

  async add(messages: Mem0Message[], options?: Mem0AddOptions): Promise<Mem0Memory> {
    const content = normalizeContent(messages)
    const now = nowIso()
    const memory: Mem0Memory = {
      id: randomUUID(),
      content,
      userId: options?.userId ?? 'anonymous',
      sessionId: options?.sessionId,
      metadata: options?.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    }

    this.db
      .prepare(
        `INSERT INTO memories (id, content, user_id, session_id, metadata_json, created_at, updated_at)
         VALUES (@id, @content, @userId, @sessionId, @metadata_json, @createdAt, @updatedAt)`
      )
      .run({
        id: memory.id,
        content: memory.content,
        userId: memory.userId,
        sessionId: memory.sessionId ?? null,
        metadata_json: JSON.stringify(memory.metadata),
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      })

    this.upsertHistory(memory, 'add')
    this.syncFts(memory)
    return memory
  }

  async search(query: string, options?: Mem0SearchOptions): Promise<Mem0SearchResult[]> {
    const limit = options?.limit ?? 10
    const offset = options?.offset ?? 0
    const where = buildWhere(options)

    if (query.trim().length === 0) {
      const rows = this.db
        .prepare(
          `SELECT id, content, user_id, session_id, metadata_json, created_at, updated_at
           FROM memories ${where.clause}
           ORDER BY updated_at DESC
           LIMIT @limit OFFSET @offset`
        )
        .all({ ...where.params, limit, offset }) as Record<string, unknown>[]

      return rows.map((row, index) => ({ ...toMemory(row), score: Math.max(0, rows.length - index) }))
    }

    if (this.ftsEnabled) {
      try {
        const rows = this.db
          .prepare(
            `SELECT m.id, m.content, m.user_id, m.session_id, m.metadata_json, m.created_at, m.updated_at, bm25(memories_fts) AS score
             FROM memories_fts f
             JOIN memories m ON m.id = f.memory_id
             WHERE memories_fts MATCH @query ${where.clause ? `AND ${where.clause.slice(6)}` : ''}
             ORDER BY score ASC
             LIMIT @limit OFFSET @offset`
          )
          .all({ ...where.params, query, limit, offset }) as Array<Record<string, unknown> & { score?: number }>

        return rows.map((row) => ({ ...toMemory(row), score: typeof row.score === 'number' ? row.score : 0 }))
      } catch {
        // Fallback below.
      }
    }

    const rows = this.db
      .prepare(
        `SELECT id, content, user_id, session_id, metadata_json, created_at, updated_at
         FROM memories ${where.clause}
         ORDER BY updated_at DESC`
      )
      .all(where.params) as Record<string, unknown>[]

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored = rows
      .map((row) => {
        const memory = toMemory(row)
        const haystack = `${memory.content} ${JSON.stringify(memory.metadata)}`.toLowerCase()
        let score = 0
        for (const term of terms) {
          if (haystack.includes(term)) {
            score += 1
          }
        }
        const recencyBoost = Math.max(0, 1 - (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24 * 365))
        score += recencyBoost * 0.25
        return { ...memory, score }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit)

    return scored
  }

  async get(memoryId: string): Promise<Mem0Memory | null> {
    const row = this.db
      .prepare('SELECT id, content, user_id, session_id, metadata_json, created_at, updated_at FROM memories WHERE id = ?')
      .get(memoryId) as Record<string, unknown> | undefined
    return row ? toMemory(row) : null
  }

  async update(memoryId: string, data: Mem0UpdateData): Promise<Mem0Memory | null> {
    const current = await this.get(memoryId)
    if (!current) return null

    const next: Mem0Memory = {
      ...current,
      content: data.content ?? current.content,
      userId: data.userId ?? current.userId,
      sessionId: data.sessionId ?? current.sessionId,
      metadata: data.metadata ? { ...current.metadata, ...data.metadata } : current.metadata,
      updatedAt: nowIso(),
    }

    this.db
      .prepare(
        `UPDATE memories
         SET content = @content, user_id = @userId, session_id = @sessionId, metadata_json = @metadata_json, updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: next.id,
        content: next.content,
        userId: next.userId,
        sessionId: next.sessionId ?? null,
        metadata_json: JSON.stringify(next.metadata),
        updatedAt: next.updatedAt,
      })

    this.upsertHistory(next, 'update')
    this.syncFts(next)
    return next
  }

  async delete(memoryId: string): Promise<boolean> {
    const current = await this.get(memoryId)
    if (!current) return false

    this.upsertHistory(current, 'delete')
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId)
    if (this.ftsEnabled) {
      try {
        this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(memoryId)
      } catch {
        // ignore
      }
    }
    return true
  }

  async history(memoryId: string): Promise<Mem0HistoryEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT id, version, operation, content, user_id, session_id, metadata_json, created_at, updated_at, changed_at
         FROM memory_history
         WHERE id = ?
         ORDER BY version ASC`
      )
      .all(memoryId) as Record<string, unknown>[]
    return rows.map((row) => toHistoryEntry(row))
  }

  async getAll(options?: Mem0GetAllOptions): Promise<Mem0Memory[]> {
    const where = buildWhere(options)
    const limit = options?.limit ?? 100
    const offset = options?.offset ?? 0
    const rows = this.db
      .prepare(
        `SELECT id, content, user_id, session_id, metadata_json, created_at, updated_at
         FROM memories ${where.clause}
         ORDER BY updated_at DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...where.params, limit, offset }) as Record<string, unknown>[]
    return rows.map((row) => toMemory(row))
  }
}

export function createMem0Client(config?: Mem0Config): Mem0Client {
  return new SqliteMem0Client(config)
}

export async function interPhaseStore(
  phase: string,
  data: unknown,
  client: Mem0Client,
): Promise<Mem0Memory> {
  const message: Mem0Message = {
    role: 'system',
    content: typeof data === 'string' ? data : JSON.stringify(data),
    metadata: {
      phase,
      kind: 'inter-phase',
    },
  }

  return client.add([message], {
    userId: PHASE_MEMORY_USER,
    sessionId: phase,
    metadata: { phase, kind: 'inter-phase' },
  })
}

export async function interPhaseRetrieve(phase: string, client: Mem0Client): Promise<Mem0Memory | null> {
  const matches = await client.search(phase, {
    userId: PHASE_MEMORY_USER,
    sessionId: phase,
    limit: 1,
  })
  return matches[0] ?? null
}
