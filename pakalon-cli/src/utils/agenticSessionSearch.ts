/**
 * Agentic Session Search
 *
 * Search across agentic sessions including subagent transcripts,
 * metadata, and task-level information. Supports filtering by agent
 * type, phase, status, and full-text search across session content.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

import type { SessionMetadata, SessionMode, PersistedWorktreeSession } from '../session/types.js';
import type { AgentId } from '../types-imported/ids.js';
import { getProjectsDir } from './transcriptSearch.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface AgenticSessionInfo {
  sessionId: string;
  title?: string;
  customTitle?: string;
  aiTitle?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  model?: string;
  mode?: SessionMode;
  tag?: string;
  agentName?: string;
  agentColor?: string;
  agentSetting?: string;
  workingDirectory?: string;
  turnCount?: number;
  tokenCount?: number;
  firstPrompt?: string;
  lastPrompt?: string;
  messageCount?: number;
  isSubagent?: boolean;
  parentSessionId?: string;
  agentType?: string;
  worktreeSession?: PersistedWorktreeSession | null;
  transcriptPath: string;
  metadataPath?: string;
  fileSize?: number;
}

export interface SubagentInfo {
  agentId: AgentId;
  sessionId: string;
  agentType: string;
  description?: string;
  worktreePath?: string;
  transcriptPath: string;
  metadataPath: string;
  parentSessionId: string;
}

export interface AgenticSearchResult {
  session: AgenticSessionInfo;
  subagents: SubagentInfo[];
  relevanceScore: number;
  matchFields: string[];
}

export interface AgenticSearchOptions {
  /** Maximum results (default: 30) */
  limit?: number;
  /** Filter by agent type */
  agentType?: string;
  /** Filter by session mode */
  mode?: SessionMode;
  /** Filter by tag */
  tag?: string;
  /** Filter by working directory */
  workingDirectory?: string;
  /** Include subagent sessions */
  includeSubagents?: boolean;
  /** Only sessions with custom titles */
  hasCustomTitle?: boolean;
  /** Filter by date range */
  after?: Date;
  before?: Date;
  /** Case-sensitive text search */
  caseSensitive?: boolean;
  /** Abort signal */
  signal?: AbortSignal;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_SESSION_DIR = '.pakalon/sessions';
const DEFAULT_LIMIT = 30;
const SUBAGENTS_DIR = 'subagents';

// ──────────────────────────────────────────────────────────────────────────────
// Path Resolution
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get the session directory for the current project
 */
export function getCwdSessionDir(): string {
  return path.join(process.cwd(), DEFAULT_SESSION_DIR);
}

/**
 * Get project session directory
 */
export function getProjectSessionDir(projectDir: string): string {
  const sanitized = projectDir.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(getProjectsDir(), sanitized);
}

/**
 * Get subagent transcript path
 */
export function getSubagentTranscriptPath(
  parentSessionId: string,
  agentId: AgentId,
  projectDir?: string,
): string {
  const baseDir = projectDir
    ? getProjectSessionDir(projectDir)
    : getCwdSessionDir();
  return path.join(baseDir, parentSessionId, SUBAGENTS_DIR, `agent-${agentId}.jsonl`);
}

/**
 * Get subagent metadata path
 */
export function getSubagentMetadataPath(
  parentSessionId: string,
  agentId: AgentId,
  projectDir?: string,
): string {
  return getSubagentTranscriptPath(parentSessionId, agentId, projectDir).replace(/\.jsonl$/, '.meta.json');
}

// ──────────────────────────────────────────────────────────────────────────────
// Session Discovery
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Discover all session directories and files
 */
export async function discoverSessions(options?: {
  projectDir?: string;
  includeSubagents?: boolean;
}): Promise<{
  mainSessions: string[];
  subagentSessions: Map<string, SubagentInfo[]>;
}> {
  const mainSessions: string[] = [];
  const subagentSessions = new Map<string, SubagentInfo[]>();

  const dirsToScan: string[] = [];

  const cwdDir = getCwdSessionDir();
  if (fsSync.existsSync(cwdDir)) {
    dirsToScan.push(cwdDir);
  }

  if (options?.projectDir) {
    const projDir = getProjectSessionDir(options.projectDir);
    if (fsSync.existsSync(projDir)) {
      dirsToScan.push(projDir);
    }
  }

  const projectsDir = getProjectsDir();
  if (fsSync.existsSync(projectsDir) && !options?.projectDir) {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirsToScan.push(path.join(projectsDir, entry.name));
      }
    }
  }

  for (const dir of dirsToScan) {
    try {
      const files = await fs.readdir(dir);

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const fullPath = path.join(dir, file);
        const stat = fsSync.statSync(fullPath);
        if (!stat.isFile()) continue;

        const sessionId = file.replace('.jsonl', '');
        mainSessions.push(fullPath);

        if (options?.includeSubagents) {
          const subagentDir = path.join(dir, sessionId, SUBAGENTS_DIR);
          if (fsSync.existsSync(subagentDir)) {
            const subFiles = await fs.readdir(subagentDir);
            const subs: SubagentInfo[] = [];

            for (const subFile of subFiles) {
              if (!subFile.endsWith('.jsonl')) continue;

              const agentId = subFile.replace('agent-', '').replace('.jsonl', '') as AgentId;
              const subPath = path.join(subagentDir, subFile);
              const metaPath = subPath.replace(/\.jsonl$/, '.meta.json');

              let agentType = 'unknown';
              let description: string | undefined;
              let worktreePath: string | undefined;

              if (fsSync.existsSync(metaPath)) {
                try {
                  const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
                  agentType = meta.agentType ?? 'unknown';
                  description = meta.description;
                  worktreePath = meta.worktreePath;
                } catch {
                  // ignore
                }
              }

              subs.push({
                agentId,
                sessionId: `${sessionId}-${agentId}`,
                agentType,
                description,
                worktreePath,
                transcriptPath: subPath,
                metadataPath: metaPath,
                parentSessionId: sessionId,
              });
            }

            if (subs.length > 0) {
              subagentSessions.set(sessionId, subs);
            }
          }
        }
      }
    } catch {
      // skip inaccessible directories
    }
  }

  return { mainSessions, subagentSessions };
}

// ──────────────────────────────────────────────────────────────────────────────
// Metadata Parsing
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parse session metadata from transcript header entries
 */
export async function parseSessionMetadata(
  transcriptPath: string,
  options?: { maxEntries?: number },
): Promise<Partial<SessionMetadata> & {
  customTitle?: string;
  aiTitle?: string;
  lastPrompt?: string;
  tag?: string;
  agentName?: string;
  agentColor?: string;
  agentSetting?: string;
  mode?: SessionMode;
  messageCount?: number;
}> {
  const metadata: Partial<SessionMetadata> & {
    customTitle?: string;
    aiTitle?: string;
    lastPrompt?: string;
    tag?: string;
    agentName?: string;
    agentColor?: string;
    agentSetting?: string;
    mode?: SessionMode;
    messageCount?: number;
  } = {};

  if (!fsSync.existsSync(transcriptPath)) return metadata;

  const maxEntries = options?.maxEntries ?? 200;
  const content = await fs.readFile(transcriptPath, 'utf-8');
  const lines = content.split('\n');

  let messageCount = 0;
  let entriesParsed = 0;

  for (const line of lines) {
    if (entriesParsed >= maxEntries) break;

    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const entry = JSON.parse(trimmed);
      entriesParsed++;

      switch (entry.type) {
        case 'custom-title':
          metadata.customTitle = entry.customTitle;
          if (entry.customTitle) metadata.title = entry.customTitle;
          break;
        case 'ai-title':
          metadata.aiTitle = entry.aiTitle;
          if (!metadata.title && entry.aiTitle) metadata.title = entry.aiTitle;
          break;
        case 'last-prompt':
          metadata.lastPrompt = entry.lastPrompt;
          if (!metadata.firstPrompt) metadata.firstPrompt = entry.lastPrompt;
          break;
        case 'tag':
          metadata.tag = entry.tag;
          break;
        case 'agent-name':
          metadata.agentName = entry.agentName;
          break;
        case 'agent-color':
          metadata.agentColor = entry.agentColor;
          break;
        case 'agent-setting':
          metadata.agentSetting = entry.agentSetting;
          break;
        case 'mode':
          metadata.mode = entry.mode;
          break;
        case 'user':
        case 'assistant':
        case 'system':
        case 'tool':
        case 'attachment':
          messageCount++;
          if (!metadata.firstPrompt && entry.type === 'user' && entry.content) {
            const content = typeof entry.content === 'string'
              ? entry.content
              : Array.isArray(entry.content)
                ? entry.content.map((p: unknown) => typeof p === 'object' && p !== null && 'text' in p ? (p as Record<string, unknown>).text : '').join('')
                : '';
            metadata.firstPrompt = content.slice(0, 200);
          }
          break;
      }
    } catch {
      // skip malformed lines
    }
  }

  metadata.messageCount = messageCount;

  try {
    const stat = fsSync.statSync(transcriptPath);
    metadata.updatedAt = stat.mtime.toISOString();
  } catch {
    // ignore
  }

  return metadata;
}

/**
 * Build AgenticSessionInfo from transcript path and metadata
 */
export async function buildSessionInfo(
  transcriptPath: string,
  subagents?: SubagentInfo[],
): Promise<AgenticSessionInfo | null> {
  if (!fsSync.existsSync(transcriptPath)) return null;

  const sessionId = path.basename(transcriptPath, '.jsonl');
  const metadata = await parseSessionMetadata(transcriptPath);

  let fileSize: number | undefined;
  try {
    fileSize = fsSync.statSync(transcriptPath).size;
  } catch {
    // ignore
  }

  return {
    sessionId,
    title: metadata.title,
    customTitle: metadata.customTitle,
    aiTitle: metadata.aiTitle,
    createdAt: metadata.createdAt ?? new Date().toISOString(),
    updatedAt: metadata.updatedAt ?? new Date().toISOString(),
    lastActivityAt: metadata.lastActivityAt ?? metadata.updatedAt ?? new Date().toISOString(),
    model: metadata.model,
    mode: metadata.mode,
    tag: metadata.tag,
    agentName: metadata.agentName,
    agentColor: metadata.agentColor,
    agentSetting: metadata.agentSetting,
    workingDirectory: metadata.workingDirectory,
    turnCount: metadata.turnCount,
    tokenCount: metadata.tokenCount,
    firstPrompt: metadata.firstPrompt,
    lastPrompt: metadata.lastPrompt,
    messageCount: metadata.messageCount,
    isSubagent: false,
    transcriptPath,
    metadataPath: transcriptPath.replace(/\.jsonl$/, '.meta.json'),
    fileSize,
    worktreeSession: undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Calculate relevance score for a session against a query
 */
function calculateRelevanceScore(
  session: AgenticSessionInfo,
  query: string,
  caseSensitive: boolean,
): { score: number; matchFields: string[] } {
  const matchFields: string[] = [];
  let score = 0;

  const searchText = (value: string | undefined): string => {
    if (!value) return '';
    return caseSensitive ? value : value.toLowerCase();
  };

  const searchQuery = caseSensitive ? query : query.toLowerCase();

  const checkField = (value: string | undefined, field: string, weight: number): void => {
    if (!value) return;
    const sv = searchText(value);
    if (sv.includes(searchQuery)) {
      matchFields.push(field);
      score += weight;
      if (sv.startsWith(searchQuery)) score += weight * 0.5;
    }
  };

  checkField(session.customTitle, 'customTitle', 30);
  checkField(session.aiTitle, 'aiTitle', 25);
  checkField(session.title, 'title', 25);
  checkField(session.firstPrompt, 'firstPrompt', 20);
  checkField(session.lastPrompt, 'lastPrompt', 15);
  checkField(session.tag, 'tag', 20);
  checkField(session.agentName, 'agentName', 15);
  checkField(session.model, 'model', 10);
  checkField(session.workingDirectory, 'workingDirectory', 5);

  return { score, matchFields };
}

/**
 * Search across all agentic sessions
 */
export async function searchAgenticSessions(
  query: string,
  options: AgenticSearchOptions = {},
): Promise<AgenticSearchResult[]> {
  const {
    limit = DEFAULT_LIMIT,
    agentType,
    mode,
    tag,
    workingDirectory,
    includeSubagents = true,
    hasCustomTitle,
    after,
    before,
    caseSensitive = false,
    signal,
  } = options;

  const { mainSessions: transcriptPaths, subagentSessions } = await discoverSessions({
    includeSubagents,
  });

  const results: AgenticSearchResult[] = [];

  for (const transcriptPath of transcriptPaths) {
    if (signal?.aborted) break;

    const sessionId = path.basename(transcriptPath, '.jsonl');
    const sessionInfo = await buildSessionInfo(transcriptPath, subagentSessions.get(sessionId));

    if (!sessionInfo) continue;

    if (agentType && sessionInfo.agentName !== agentType) continue;
    if (mode && sessionInfo.mode !== mode) continue;
    if (tag && sessionInfo.tag !== tag) continue;
    if (workingDirectory && sessionInfo.workingDirectory !== workingDirectory) continue;
    if (hasCustomTitle && !sessionInfo.customTitle) continue;

    if (after && new Date(sessionInfo.updatedAt) < after) continue;
    if (before && new Date(sessionInfo.updatedAt) > before) continue;

    const subs = subagentSessions.get(sessionId) ?? [];
    if (agentType && subs.length > 0) {
      const matchingSubs = subs.filter((s) => s.agentType === agentType);
      if (matchingSubs.length === 0 && sessionInfo.agentName !== agentType) continue;
    }

    let relevanceScore = 0;
    const matchFields: string[] = [];

    if (query.trim()) {
      const { score, matchFields: fields } = calculateRelevanceScore(sessionInfo, query, caseSensitive);
      relevanceScore = score;
      matchFields.push(...fields);

      if (relevanceScore === 0) continue;
    }

    results.push({
      session: sessionInfo,
      subagents: subs,
      relevanceScore,
      matchFields,
    });
  }

  results.sort((a, b) => {
    if (a.relevanceScore !== b.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime();
  });

  return results.slice(0, limit);
}

/**
 * Get session info by ID
 */
export async function getAgenticSession(
  sessionId: string,
  options?: { includeSubagents?: boolean; projectDir?: string },
): Promise<{ session: AgenticSessionInfo | null; subagents: SubagentInfo[] }> {
  const { mainSessions, subagentSessions } = await discoverSessions({
    projectDir: options?.projectDir,
    includeSubagents: options?.includeSubagents ?? true,
  });

  const transcriptPath = mainSessions.find((p) =>
    path.basename(p, '.jsonl') === sessionId,
  );

  if (!transcriptPath) {
    return { session: null, subagents: [] };
  }

  const sessionInfo = await buildSessionInfo(
    transcriptPath,
    subagentSessions.get(sessionId),
  );

  return {
    session: sessionInfo,
    subagents: subagentSessions.get(sessionId) ?? [],
  };
}

/**
 * List all sessions with optional filtering
 */
export async function listAgenticSessions(options?: {
  limit?: number;
  projectDir?: string;
  includeSubagents?: boolean;
  sortBy?: 'updatedAt' | 'createdAt' | 'messageCount';
}): Promise<AgenticSessionInfo[]> {
  const {
    limit = DEFAULT_LIMIT,
    projectDir,
    includeSubagents = true,
    sortBy = 'updatedAt',
  } = options ?? {};

  const { mainSessions, subagentSessions } = await discoverSessions({
    projectDir,
    includeSubagents,
  });

  const sessions: AgenticSessionInfo[] = [];

  for (const transcriptPath of mainSessions) {
    const sessionId = path.basename(transcriptPath, '.jsonl');
    const info = await buildSessionInfo(transcriptPath, subagentSessions.get(sessionId));
    if (info) sessions.push(info);
  }

  sessions.sort((a, b) => {
    switch (sortBy) {
      case 'createdAt':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'messageCount':
        return (b.messageCount ?? 0) - (a.messageCount ?? 0);
      default:
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  });

  return sessions.slice(0, limit);
}

/**
 * Search subagent sessions
 */
export async function searchSubagentSessions(
  query: string,
  options?: {
    agentType?: string;
    parentSessionId?: string;
    limit?: number;
    caseSensitive?: boolean;
  },
): Promise<SubagentInfo[]> {
  const {
    agentType,
    parentSessionId,
    limit = DEFAULT_LIMIT,
    caseSensitive = false,
  } = options ?? {};

  const { subagentSessions } = await discoverSessions({ includeSubagents: true });

  const results: SubagentInfo[] = [];
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  for (const [parentId, subs] of subagentSessions) {
    if (parentSessionId && parentId !== parentSessionId) continue;

    for (const sub of subs) {
      if (agentType && sub.agentType !== agentType) continue;

      if (query.trim()) {
        const searchable = [
          sub.agentType,
          sub.description,
          sub.worktreePath,
          sub.agentId,
        ].filter(Boolean).join(' ');

        const compare = caseSensitive ? searchable : searchable.toLowerCase();
        if (!compare.includes(searchQuery)) continue;
      }

      results.push(sub);
    }
  }

  return results.slice(0, limit);
}
