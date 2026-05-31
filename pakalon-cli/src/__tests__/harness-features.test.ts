/**
 * Comprehensive Test File for Agentic Harness Features
 * 
 * Tests all the new features implemented from harness.md:
 * - JSONL Storage
 * - Session Repository
 * - Tree Navigation
 * - Typed Errors
 * - Turn Snapshots
 * - Pending Write Queue
 * - Provider Hooks
 * - Durable Harness Recovery
 * - Compaction Enhanced
 * - Advanced Features
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Import modules to test
import {
  // Errors
  ok,
  err,
  getOrThrow,
  toError,
  SessionError,
  CompactionError,
  AgentHarnessError,
  normalizeHarnessError,
} from '../session/errors.js';

import {
  JsonlSessionStorage,
  PendingWriteQueue,
  type SessionTreeEntry,
  type AgentMessage,
} from '../session/jsonl-storage.js';

import { SessionRepo } from '../session/session-repo.js';

import {
  TurnSnapshotManager,
  compareSnapshots,
  type TurnSnapshot,
} from '../session/turn-snapshot.js';

import {
  PendingWriteQueue as WriteQueue,
  WriteQueueFlushHandler,
  type PendingWriteType,
} from '../session/pending-write-queue.js';

import {
  ProviderHooksManager,
  type StreamOptions,
} from '../session/provider-hooks.js';

import {
  DurableHarness,
  createDurableHarness,
} from '../session/durable-harness.js';

import {
  DEFAULT_THINKING_BUDGETS,
  getThinkingBudget,
  formatPromptTemplateInvocation,
  formatSkillInvocation,
  ResourceManager,
} from '../session/advanced-features.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-test-'));
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Typed Errors', () => {
  it('should create Result types correctly', () => {
    const success = ok<string, Error>('hello');
    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.value).toBe('hello');
    }

    const failure = err<string, Error>(new Error('fail'));
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.message).toBe('fail');
    }
  });

  it('should throw on getOrThrow with error', () => {
    const result = err<string, Error>(new Error('fail'));
    expect(() => getOrThrow(result)).toThrow('fail');
  });

  it('should return value on getOrThrow with success', () => {
    const result = ok<string, Error>('hello');
    expect(getOrThrow(result)).toBe('hello');
  });

  it('should normalize harness errors', () => {
    const sessionError = new SessionError('not_found', 'not found');
    const harnessError = normalizeHarnessError(sessionError, 'unknown');
    expect(harnessError.code).toBe('session');
    expect(harnessError.message).toBe('not found');
  });
});

describe('JSONL Storage', () => {
  it('should create and open session storage', async () => {
    const filePath = path.join(testDir, 'test.jsonl');
    const storage = await JsonlSessionStorage.create(filePath, {
      cwd: '/test',
      sessionId: 'test-123',
    });

    const metadata = storage.getMetadata();
    expect(metadata.id).toBe('test-123');
    expect(metadata.cwd).toBe('/test');

    // Open existing storage
    const opened = await JsonlSessionStorage.open(filePath);
    expect(opened.getMetadata().id).toBe('test-123');
  });

  it('should append entries to storage', async () => {
    const filePath = path.join(testDir, 'test.jsonl');
    const storage = await JsonlSessionStorage.create(filePath, {
      cwd: '/test',
      sessionId: 'test-123',
    });

    const entryId = await storage.createEntryId();
    await storage.appendEntry({
      type: 'message',
      id: entryId,
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: 'Hello',
        timestamp: new Date().toISOString(),
      },
    });

    const entries = await storage.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].type).toBe('message');
  });

  it('should track leaf entries', async () => {
    const filePath = path.join(testDir, 'test.jsonl');
    const storage = await JsonlSessionStorage.create(filePath, {
      cwd: '/test',
      sessionId: 'test-123',
    });

    const entryId = await storage.createEntryId();
    await storage.appendEntry({
      type: 'message',
      id: entryId,
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: 'Hello',
        timestamp: new Date().toISOString(),
      },
    });

    const leafId = await storage.getLeafId();
    expect(leafId).toBe(entryId);
  });
});

describe('Session Repository', () => {
  it('should create and list sessions', async () => {
    const repo = new SessionRepo(path.join(testDir, 'sessions'));

    const storage = await repo.create({
      cwd: '/test',
      sessionId: 'test-123',
    });

    const sessions = await repo.list({ cwd: '/test' });
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('test-123');
  });

  it('should delete sessions', async () => {
    const repo = new SessionRepo(path.join(testDir, 'sessions'));

    const storage = await repo.create({
      cwd: '/test',
      sessionId: 'test-123',
    });

    const metadata = storage.getMetadata();
    await repo.delete(metadata);

    const sessions = await repo.list({ cwd: '/test' });
    expect(sessions.length).toBe(0);
  });
});

describe('Turn Snapshot Manager', () => {
  it('should create and retrieve snapshots', () => {
    const manager = new TurnSnapshotManager();

    const snapshot = manager.createSnapshot({
      messages: [],
      systemPrompt: 'You are helpful',
      model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai', maxTokens: 4096, supportsStreaming: true, supportsThinking: false },
      thinkingLevel: 'off',
      tools: [],
      activeToolNames: [],
      streamOptions: {},
      sessionId: 'test-123',
      resources: {},
      turnNumber: 1,
    });

    expect(snapshot.id).toBeDefined();
    expect(snapshot.turnNumber).toBe(1);

    const current = manager.getCurrentSnapshot();
    expect(current?.id).toBe(snapshot.id);
  });

  it('should compare snapshots', () => {
    const manager = new TurnSnapshotManager();

    const snapshot1 = manager.createSnapshot({
      messages: [],
      systemPrompt: 'You are helpful',
      model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai', maxTokens: 4096, supportsStreaming: true, supportsThinking: false },
      thinkingLevel: 'off',
      tools: [],
      activeToolNames: [],
      streamOptions: {},
      sessionId: 'test-123',
      resources: {},
      turnNumber: 1,
    });

    const snapshot2 = manager.createSnapshot({
      messages: [],
      systemPrompt: 'You are helpful',
      model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai', maxTokens: 4096, supportsStreaming: true, supportsThinking: false },
      thinkingLevel: 'medium',
      tools: [],
      activeToolNames: [],
      streamOptions: {},
      sessionId: 'test-123',
      resources: {},
      turnNumber: 2,
    });

    const diff = compareSnapshots(snapshot1, snapshot2);
    expect(diff.thinkingLevelChanged).toBe(true);
    expect(diff.modelChanged).toBe(false);
  });
});

describe('Pending Write Queue', () => {
  it('should push and shift writes', () => {
    const queue = new WriteQueue();

    queue.push({ type: 'message', data: { content: 'Hello' } });
    queue.push({ type: 'model_change', data: { provider: 'openai' } });

    expect(queue.length).toBe(2);

    const first = queue.shift();
    expect(first?.type).toBe('message');

    expect(queue.length).toBe(1);
  });

  it('should get writes by type', () => {
    const queue = new WriteQueue();

    queue.push({ type: 'message', data: { content: 'Hello' } });
    queue.push({ type: 'model_change', data: { provider: 'openai' } });
    queue.push({ type: 'message', data: { content: 'World' } });

    const messages = queue.getByType('message');
    expect(messages.length).toBe(2);
  });

  it('should get statistics', () => {
    const queue = new WriteQueue();

    queue.push({ type: 'message', data: { content: 'Hello' } });
    queue.push({ type: 'model_change', data: { provider: 'openai' } });

    const stats = queue.getStats();
    expect(stats.queueSize).toBe(2);
    expect(stats.totalWrites).toBe(2);
  });
});

describe('Provider Hooks Manager', () => {
  it('should register and emit hooks', async () => {
    const manager = new ProviderHooksManager();

    let hookCalled = false;
    manager.on('before_provider_request', async () => {
      hookCalled = true;
      return { streamOptions: { temperature: 0.5 } };
    });

    const result = await manager.emit('before_provider_request', {
      model: { id: 'gpt-4', provider: 'openai', name: 'GPT-4' },
      sessionId: 'test-123',
      streamOptions: {},
    });

    expect(hookCalled).toBe(true);
    expect(result?.streamOptions?.temperature).toBe(0.5);
  });

  it('should apply stream options patches', () => {
    const manager = new ProviderHooksManager();

    const base: StreamOptions = { temperature: 0.7, maxTokens: 1000 };
    const patch = { temperature: 0.5, headers: { 'X-Custom': 'value' } };

    const result = manager.applyStreamOptionsPatch(base, patch);
    expect(result.temperature).toBe(0.5);
    expect(result.headers?.['X-Custom']).toBe('value');
  });
});

describe('Durable Harness', () => {
  it('should create durable harness', () => {
    const harness = createDurableHarness({ enabled: true });
    const stats = harness.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.recoveryAttempts).toBe(0);
  });
});

describe('Advanced Features', () => {
  it('should get thinking budgets', () => {
    expect(getThinkingBudget('minimal')).toBe(128);
    expect(getThinkingBudget('low')).toBe(512);
    expect(getThinkingBudget('medium')).toBe(1024);
    expect(getThinkingBudget('high')).toBe(2048);
    expect(getThinkingBudget('xhigh')).toBe(4096);
  });

  it('should format prompt templates', () => {
    const template = {
      name: 'greet',
      content: 'Hello $1, how are you?',
    };

    const result = formatPromptTemplateInvocation(template, ['World']);
    expect(result).toBe('Hello World, how are you?');
  });

  it('should format skills', () => {
    const skill = {
      name: 'test-skill',
      description: 'A test skill',
      content: 'Test content',
      filePath: '/test/skill.md',
    };

    const result = formatSkillInvocation(skill, 'Additional info');
    expect(result).toContain('<skill name="test-skill">');
    expect(result).toContain('Additional info');
  });

  it('should manage resources', () => {
    const manager = new ResourceManager();

    manager.register('test', { value: 42 }, {
      source: 'file',
      loadedAt: new Date(),
    });

    expect(manager.get('test')).toEqual({ value: 42 });
    expect(manager.has('test')).toBe(true);

    const provenance = manager.getProvenance('test');
    expect(provenance?.source).toBe('file');
  });
});

describe('Session Facade', () => {
  it('should be importable', async () => {
    const { SessionFacade } = await import('../session/session-facade.js');
    expect(SessionFacade).toBeDefined();
  });
});

describe('Compaction Enhanced', () => {
  it('should be importable', async () => {
    const { prepareCompaction, DEFAULT_COMPACTION_SETTINGS } = await import('../session/compaction-enhanced.js');
    expect(prepareCompaction).toBeDefined();
    expect(DEFAULT_COMPACTION_SETTINGS).toBeDefined();
  });
});
