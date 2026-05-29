import * as fs from 'fs/promises';
import * as path from 'path';

export type ExecutionLogSubAgentStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ExecutionLogFileAction = 'created' | 'modified' | 'deleted';

export interface ExecutionLogSession {
  userPrompt: string;
  startTime: number;
  projectDir: string;
  projectName: string;
}

interface BaseEntry {
  timestamp: number;
}

export interface ExecutionLogPhaseEntry extends BaseEntry {
  kind: 'phase';
  phaseName: string;
  description: string;
}

export interface ExecutionLogSubAgentEntry extends BaseEntry {
  kind: 'sub-agent';
  name: string;
  status: ExecutionLogSubAgentStatus;
  durationMs?: number;
  filesCreated: string[];
  filesModified: string[];
  error?: string;
}

export interface ExecutionLogToolCallEntry extends BaseEntry {
  kind: 'tool-call';
  toolName: string;
  params: Record<string, unknown>;
  durationMs?: number;
}

export interface ExecutionLogFileChangeEntry extends BaseEntry {
  kind: 'file-change';
  filePath: string;
  action: ExecutionLogFileAction;
  diffSummary?: string;
}

export interface ExecutionLogResultEntry extends BaseEntry {
  kind: 'result';
  success: boolean;
  message: string;
  durationMs: number;
}

export interface ExecutionLogLspEntry extends BaseEntry {
  kind: 'lsp';
  filePath: string;
  diagnosticsFound: number;
  diagnosticsFixed: number;
  details: string[];
}

export interface ExecutionLogDependencyEntry extends BaseEntry {
  kind: 'dependency';
  name: string;
  version?: string;
  action: string;
  status: 'installed' | 'skipped' | 'failed';
  message?: string;
}

export interface ExecutionLogWarningEntry extends BaseEntry {
  kind: 'warning';
  message: string;
}

export interface ExecutionLogErrorEntry extends BaseEntry {
  kind: 'error';
  message: string;
}

export type ExecutionLogEntry =
  | ExecutionLogPhaseEntry
  | ExecutionLogSubAgentEntry
  | ExecutionLogToolCallEntry
  | ExecutionLogFileChangeEntry
  | ExecutionLogResultEntry
  | ExecutionLogLspEntry
  | ExecutionLogDependencyEntry
  | ExecutionLogWarningEntry
  | ExecutionLogErrorEntry;

export interface ParsedExecutionLog {
  header: {
    projectName?: string;
    date?: string;
    duration?: string;
  };
  sections: Record<string, string[]>;
  raw: string;
}

interface SubAgentSnapshot {
  firstSeen: number;
  lastSeen: number;
  status: ExecutionLogSubAgentStatus;
  durationMs?: number;
  filesCreated: Set<string>;
  filesModified: Set<string>;
  error?: string;
}

function toIsoTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m ${seconds}s`;
  }

  return `${hours}h ${remainingMinutes}m ${seconds}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ExecutionLogger {
  private readonly projectDir: string;
  private session: ExecutionLogSession | null = null;
  private readonly entries: ExecutionLogEntry[] = [];
  private readonly subAgentSnapshots = new Map<string, SubAgentSnapshot>();

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  public startSession(userPrompt: string, startTime: number): void {
    this.session = {
      userPrompt,
      startTime,
      projectDir: this.projectDir,
      projectName: path.basename(this.projectDir),
    };

    this.entries.push({
      kind: 'phase',
      phaseName: 'session-start',
      description: userPrompt,
      timestamp: startTime,
    });
  }

  public logPhase(phaseName: string, description: string): void {
    this.entries.push({
      kind: 'phase',
      phaseName,
      description,
      timestamp: Date.now(),
    });
  }

  public logSubAgent(
    name: string,
    status: ExecutionLogSubAgentStatus,
    details?: {
      filesCreated?: string[];
      filesModified?: string[];
      error?: string;
    },
  ): void {
    const timestamp = Date.now();
    const existing = this.subAgentSnapshots.get(name);

    if (!existing) {
      this.subAgentSnapshots.set(name, {
        firstSeen: timestamp,
        lastSeen: timestamp,
        status,
        durationMs: undefined,
        filesCreated: new Set(details?.filesCreated ?? []),
        filesModified: new Set(details?.filesModified ?? []),
        error: details?.error,
      });
    } else {
      existing.lastSeen = timestamp;
      existing.status = status;
      for (const file of details?.filesCreated ?? []) {
        existing.filesCreated.add(file);
      }
      for (const file of details?.filesModified ?? []) {
        existing.filesModified.add(file);
      }
      if (details?.error) {
        existing.error = details.error;
      }
      if (status === 'completed' || status === 'failed') {
        existing.durationMs = timestamp - existing.firstSeen;
      }
    }

    this.entries.push({
      kind: 'sub-agent',
      name,
      status,
      timestamp,
      durationMs: existing?.durationMs,
      filesCreated: [...(existing?.filesCreated ?? [])],
      filesModified: [...(existing?.filesModified ?? [])],
      error: details?.error ?? existing?.error,
    });
  }

  public logToolCall(toolName: string, params: Record<string, unknown>): void {
    this.entries.push({
      kind: 'tool-call',
      toolName,
      params,
      timestamp: Date.now(),
    });
  }

  public logFileChange(filePath: string, action: ExecutionLogFileAction, diffSummary?: string): void {
    this.entries.push({
      kind: 'file-change',
      filePath,
      action,
      diffSummary,
      timestamp: Date.now(),
    });
  }

  public logResult(success: boolean, message: string, duration: number): void {
    this.entries.push({
      kind: 'result',
      success,
      message,
      durationMs: duration,
      timestamp: Date.now(),
    });
  }

  public logLspValidation(filePath: string, diagnosticsFound: number, diagnosticsFixed: number, details: string[] = []): void {
    this.entries.push({
      kind: 'lsp',
      filePath,
      diagnosticsFound,
      diagnosticsFixed,
      details,
      timestamp: Date.now(),
    });
  }

  public logDependency(name: string, action: string, status: 'installed' | 'skipped' | 'failed', message?: string, version?: string): void {
    this.entries.push({
      kind: 'dependency',
      name,
      action,
      status,
      message,
      version,
      timestamp: Date.now(),
    });
  }

  public logWarning(message: string): void {
    this.entries.push({
      kind: 'warning',
      message,
      timestamp: Date.now(),
    });
  }

  public logError(message: string): void {
    this.entries.push({
      kind: 'error',
      message,
      timestamp: Date.now(),
    });
  }

  public getEntries(): ExecutionLogEntry[] {
    return [...this.entries];
  }

  public async write(outputPath: string): Promise<void> {
    await generateExecutionLog(this.getEntries(), outputPath);
  }
}

function buildHeader(session: ExecutionLogSession | null, entries: ExecutionLogEntry[]): string {
  const startTime = session?.startTime ?? entries[0]?.timestamp ?? Date.now();
  const endTime = entries.reduce((max, entry) => Math.max(max, entry.timestamp), startTime);
  const durationMs = Math.max(0, endTime - startTime);

  return `# Phase 3 Execution Log

**Project**: ${session?.projectName ?? 'unknown'}
**Date**: ${toIsoTime(startTime)}
**Duration**: ${formatDuration(durationMs)}
`;
}

function getSessionPrompt(session: ExecutionLogSession | null, entries: ExecutionLogEntry[]): string {
  if (session?.userPrompt) {
    return session.userPrompt;
  }

  const sessionEntry = entries.find((entry): entry is ExecutionLogPhaseEntry => entry.kind === 'phase' && entry.phaseName === 'session-start');
  return sessionEntry?.description ?? 'No prompt captured.';
}

function buildInitialPromptSection(session: ExecutionLogSession | null, entries: ExecutionLogEntry[]): string {
  return `## 1. Initial Prompt

${escapeMarkdown(getSessionPrompt(session, entries))}
`;
}

function buildPhaseDocumentsSection(entries: ExecutionLogEntry[]): string {
  const loaded = entries.filter((entry): entry is ExecutionLogPhaseEntry => entry.kind === 'phase' && entry.phaseName.startsWith('doc:'));

  if (loaded.length === 0) {
    return `## 2. Phase Documents Loaded

- No document load events recorded.
`;
  }

  return `## 2. Phase Documents Loaded

${loaded.map((entry) => `- ${entry.phaseName.slice(4)} — ${escapeMarkdown(entry.description)} (${toIsoTime(entry.timestamp)})`).join('\n')}
`;
}

function buildSubAgentSection(entries: ExecutionLogEntry[]): string {
  const snapshots = new Map<string, SubAgentSnapshot>();

  for (const entry of entries) {
    if (entry.kind !== 'sub-agent') {
      continue;
    }

    const snapshot = snapshots.get(entry.name);
    if (!snapshot) {
      snapshots.set(entry.name, {
        firstSeen: entry.timestamp,
        lastSeen: entry.timestamp,
        status: entry.status,
        durationMs: entry.durationMs,
        filesCreated: new Set(entry.filesCreated),
        filesModified: new Set(entry.filesModified),
        error: entry.error,
      });
      continue;
    }

    snapshot.lastSeen = entry.timestamp;
    snapshot.status = entry.status;
    snapshot.durationMs = entry.durationMs ?? snapshot.durationMs;
    entry.filesCreated.forEach((file) => snapshot.filesCreated.add(file));
    entry.filesModified.forEach((file) => snapshot.filesModified.add(file));
    if (entry.error) {
      snapshot.error = entry.error;
    }
  }

  if (snapshots.size === 0) {
    return `## 3. Sub-Agent Execution Timeline

- No sub-agent events recorded.
`;
  }

  const lines = Array.from(snapshots.entries()).map(([name, snapshot]) => {
    const duration = snapshot.durationMs ?? Math.max(0, snapshot.lastSeen - snapshot.firstSeen);
    const filesCreated = snapshot.filesCreated.size > 0 ? [...snapshot.filesCreated].join(', ') : '—';
    const filesModified = snapshot.filesModified.size > 0 ? [...snapshot.filesModified].join(', ') : '—';
    const error = snapshot.error ? `\n  - Error: ${escapeMarkdown(snapshot.error)}` : '';
    return `- **${name}** — ${snapshot.status} (${formatDuration(duration)})\n  - Files created: ${escapeMarkdown(filesCreated)}\n  - Files modified: ${escapeMarkdown(filesModified)}${error}`;
  });

  return `## 3. Sub-Agent Execution Timeline

${lines.join('\n')}
`;
}

function buildToolCallSection(entries: ExecutionLogEntry[]): string {
  const calls = entries.filter((entry): entry is ExecutionLogToolCallEntry => entry.kind === 'tool-call');

  if (calls.length === 0) {
    return `## 4. Tool Call Log

- No tool calls recorded.
`;
  }

  return `## 4. Tool Call Log

${calls.map((entry) => `- ${toIsoTime(entry.timestamp)} — ${entry.toolName}: \`${escapeMarkdown(JSON.stringify(entry.params, null, 2))}\``).join('\n')}
`;
}

function buildFileChangeSection(entries: ExecutionLogEntry[]): string {
  const changes = entries.filter((entry): entry is ExecutionLogFileChangeEntry => entry.kind === 'file-change');

  if (changes.length === 0) {
    return `## 5. File Changes Summary

- No file changes recorded.
`;
  }

  return `## 5. File Changes Summary

${changes.map((entry) => `- ${toIsoTime(entry.timestamp)} — ${entry.action}: ${escapeMarkdown(entry.filePath)}${entry.diffSummary ? ` (${escapeMarkdown(entry.diffSummary)})` : ''}`).join('\n')}
`;
}

function buildLspSection(entries: ExecutionLogEntry[]): string {
  const validations = entries.filter((entry): entry is ExecutionLogLspEntry => entry.kind === 'lsp');

  if (validations.length === 0) {
    return `## 6. LSP Validation Results

- No LSP validations recorded.
`;
  }

  return `## 6. LSP Validation Results

${validations.map((entry) => `- ${toIsoTime(entry.timestamp)} — ${escapeMarkdown(entry.filePath)}: ${entry.diagnosticsFound} found, ${entry.diagnosticsFixed} fixed${entry.details.length > 0 ? `\n  - ${entry.details.map(escapeMarkdown).join('\n  - ')}` : ''}`).join('\n')}
`;
}

function buildDependencySection(entries: ExecutionLogEntry[]): string {
  const dependencies = entries.filter((entry): entry is ExecutionLogDependencyEntry => entry.kind === 'dependency' && entry.status === 'installed');

  if (dependencies.length === 0) {
    return `## 7. Dependencies Installed

- No dependencies installed.
`;
  }

  return `## 7. Dependencies Installed

${dependencies.map((entry) => `- ${toIsoTime(entry.timestamp)} — ${escapeMarkdown(entry.name)} (${escapeMarkdown(entry.action)})${entry.version ? ` v${escapeMarkdown(entry.version)}` : ''}`).join('\n')}
`;
}

function buildWarningsSection(entries: ExecutionLogEntry[]): string {
  const warnings = entries.filter((entry): entry is ExecutionLogWarningEntry | ExecutionLogErrorEntry => entry.kind === 'warning' || entry.kind === 'error');

  if (warnings.length === 0) {
    return `## 8. Errors & Warnings

- None recorded.
`;
  }

  return `## 8. Errors & Warnings

${warnings.map((entry) => `- ${toIsoTime(entry.timestamp)} — ${entry.kind.toUpperCase()}: ${escapeMarkdown(entry.message)}`).join('\n')}
`;
}

function buildSummarySection(entries: ExecutionLogEntry[], session: ExecutionLogSession | null): string {
  const subAgentLatest = new Map<string, ExecutionLogSubAgentEntry>();
  const fileChanges = entries.filter((entry): entry is ExecutionLogFileChangeEntry => entry.kind === 'file-change');
  const toolCalls = entries.filter((entry): entry is ExecutionLogToolCallEntry => entry.kind === 'tool-call');

  for (const entry of entries) {
    if (entry.kind === 'sub-agent') {
      subAgentLatest.set(entry.name, entry);
    }
  }

  const succeeded = [...subAgentLatest.values()].filter((entry) => entry.status === 'completed').length;
  const failed = [...subAgentLatest.values()].filter((entry) => entry.status === 'failed').length;
  const startedAt = session?.startTime ?? entries[0]?.timestamp ?? Date.now();
  const finishedAt = entries.reduce((max, entry) => Math.max(max, entry.timestamp), startedAt);

  return `## 9. Summary Statistics

- Total duration: ${formatDuration(Math.max(0, finishedAt - startedAt))}
- Files changed: ${new Set(fileChanges.map((entry) => entry.filePath)).size}
- Agents succeeded: ${succeeded}
- Agents failed: ${failed}
- Tool calls made: ${toolCalls.length}
`;
}

function buildMarkdown(entries: ExecutionLogEntry[], session: ExecutionLogSession | null): string {
  return [
    buildHeader(session, entries),
    buildInitialPromptSection(session, entries),
    buildPhaseDocumentsSection(entries),
    buildSubAgentSection(entries),
    buildToolCallSection(entries),
    buildFileChangeSection(entries),
    buildLspSection(entries),
    buildDependencySection(entries),
    buildWarningsSection(entries),
    buildSummarySection(entries, session),
  ].join('\n');
}

export async function generateExecutionLog(logEntries: ExecutionLogEntry[], outputPath: string): Promise<void> {
  const sessionEntry = logEntries.find((entry): entry is ExecutionLogPhaseEntry => entry.kind === 'phase' && entry.phaseName === 'session-start');
  const projectRoot = path.dirname(path.dirname(path.dirname(outputPath)));
  const session: ExecutionLogSession | null = sessionEntry
    ? {
        userPrompt: '',
        startTime: sessionEntry.timestamp,
        projectDir: projectRoot,
        projectName: path.basename(projectRoot),
      }
    : null;

  const markdown = buildMarkdown(logEntries, session);
  await fs.writeFile(outputPath, markdown, 'utf-8');
}

export async function loadExecutionLog(outputPath: string): Promise<ParsedExecutionLog> {
  const raw = await fs.readFile(outputPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const header: ParsedExecutionLog['header'] = {};
  const sections: Record<string, string[]> = {};

  let currentSection = 'header';
  sections[currentSection] = [];

  for (const line of lines) {
    if (line.startsWith('**Project**:')) {
      header.projectName = line.replace('**Project**:', '').trim();
    } else if (line.startsWith('**Date**:')) {
      header.date = line.replace('**Date**:', '').trim();
    } else if (line.startsWith('**Duration**:')) {
      header.duration = line.replace('**Duration**:', '').trim();
    } else if (line.startsWith('## ')) {
      currentSection = line.replace(/^##\s+/, '').trim();
      sections[currentSection] = [];
    } else {
      sections[currentSection].push(line);
    }
  }

  return { header, sections, raw };
}

export function isExecutionLogEntry(value: unknown): value is ExecutionLogEntry {
  return isRecord(value) && typeof value.kind === 'string' && typeof value.timestamp === 'number';
}
