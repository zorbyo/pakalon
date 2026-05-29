/**
 * Session Management
 * Handles session listing, creation, resumption, and management
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import logger from '@/utils/logger.js';
import type { SessionInfo, SessionListOptions, SessionCreateOptions } from './coreTypes.js';

const SESSION_DIR = '.pakalon-sessions';

interface PersistedSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  description?: string;
  tags?: string[];
  isMain: boolean;
  messagesPath: string;
}

async function getSessionDir(): Promise<string> {
  const cwd = process.cwd();
  const dir = path.join(cwd, SESSION_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function getSessionsDir(): Promise<string> {
  const cwd = process.cwd();
  const dir = path.join(cwd, SESSION_DIR, 'data');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function createSession(options: SessionCreateOptions = {}): Promise<SessionInfo> {
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  const sessionDir = await getSessionsDir();
  const messagesPath = path.join(sessionDir, `${sessionId}.json`);

  const session: PersistedSession = {
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    model: options.model || 'anthropic/claude-3-5-sonnet',
    messageCount: 0,
    description: options.description,
    tags: options.tags || [],
    isMain: true,
    messagesPath,
  };

  await fs.writeFile(messagesPath, JSON.stringify([], null, 2), 'utf-8');

  const indexPath = path.join(await getSessionDir(), 'index.json');
  const sessions = await listSessionsRaw();
  sessions.push(session);
  await fs.writeFile(indexPath, JSON.stringify(sessions, null, 2), 'utf-8');

  logger.info(`[Session] Created session ${sessionId}`);

  return toSessionInfo(session);
}

export async function getSession(sessionId: string): Promise<SessionInfo | null> {
  const sessions = await listSessionsRaw();
  const session = sessions.find(s => s.id === sessionId);
  return session ? toSessionInfo(session) : null;
}

export async function listSessions(options: SessionListOptions = {}): Promise<SessionInfo[]> {
  let sessions = await listSessionsRaw();

  if (options.mainOnly) {
    sessions = sessions.filter(s => s.isMain);
  }

  if (options.tags?.length) {
    sessions = sessions.filter(s =>
      options.tags!.some(tag => s.tags?.includes(tag)),
    );
  }

  const offset = options.offset || 0;
  const limit = options.limit || 50;

  sessions = sessions
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(offset, offset + limit);

  return sessions.map(toSessionInfo);
}

async function listSessionsRaw(): Promise<PersistedSession[]> {
  try {
    const indexPath = path.join(await getSessionDir(), 'index.json');
    const content = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const indexPath = path.join(await getSessionDir(), 'index.json');
  const sessions = await listSessionsRaw();
  const session = sessions.find(s => s.id === sessionId);

  if (session) {
    try {
      await fs.unlink(session.messagesPath);
    } catch {}

    const filtered = sessions.filter(s => s.id !== sessionId);
    await fs.writeFile(indexPath, JSON.stringify(filtered, null, 2), 'utf-8');
    logger.info(`[Session] Deleted session ${sessionId}`);
  }
}

export async function renameSession(sessionId: string, description: string): Promise<void> {
  const indexPath = path.join(await getSessionDir(), 'index.json');
  const sessions = await listSessionsRaw();
  const session = sessions.find(s => s.id === sessionId);

  if (session) {
    session.description = description;
    session.updatedAt = new Date().toISOString();
    await fs.writeFile(indexPath, JSON.stringify(sessions, null, 2), 'utf-8');
    logger.info(`[Session] Renamed session ${sessionId} to "${description}"`);
  }
}

export async function tagSession(sessionId: string, tags: string[]): Promise<void> {
  const indexPath = path.join(await getSessionDir(), 'index.json');
  const sessions = await listSessionsRaw();
  const session = sessions.find(s => s.id === sessionId);

  if (session) {
    session.tags = [...new Set([...(session.tags || []), ...tags])];
    session.updatedAt = new Date().toISOString();
    await fs.writeFile(indexPath, JSON.stringify(sessions, null, 2), 'utf-8');
    logger.info(`[Session] Tagged session ${sessionId} with [${tags.join(', ')}]`);
  }
}

export async function forkSession(sessionId: string): Promise<SessionInfo | null> {
  const sessions = await listSessionsRaw();
  const original = sessions.find(s => s.id === sessionId);

  if (!original) return null;

  const newSession = await createSession({
    model: original.model,
    description: `Fork of ${original.description || sessionId}`,
    tags: original.tags,
  });

  try {
    const messages = await fs.readFile(original.messagesPath, 'utf-8');
    const newMessagesPath = path.join(
      await getSessionsDir(),
      `${newSession.id}.json`,
    );
    await fs.writeFile(newMessagesPath, messages, 'utf-8');

    const indexPath = path.join(await getSessionDir(), 'index.json');
    const newSessions = await listSessionsRaw();
    const sessionEntry = newSessions.find(s => s.id === newSession.id);
    if (sessionEntry) {
      sessionEntry.messageCount = original.messageCount;
      await fs.writeFile(indexPath, JSON.stringify(newSessions, null, 2), 'utf-8');
    }
  } catch (err) {
    logger.error(`[Session] Error forking session: ${err}`);
  }

  return newSession;
}

function toSessionInfo(session: PersistedSession): SessionInfo {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    model: session.model,
    messageCount: session.messageCount,
    description: session.description,
    tags: session.tags,
    isMain: session.isMain,
  };
}

export type { SessionInfo, SessionListOptions, SessionCreateOptions };