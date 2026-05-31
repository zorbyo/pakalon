/**
 * Hindsight - Memory the agent curates
 * 
 * The agent remembers your codebase between sessions. It writes facts mid-run
 * with retain, pulls them back with recall, and compresses each session into a
 * mental model that loads on the first turn of the next one.
 * 
 * Features:
 * - retain: Store facts/memories for future sessions
 * - recall: Retrieve relevant memories based on context
 * - reflect: Compress session into mental model
 * - Project-scoped by default
 * - Supports global, per-project, and tagged scoping
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryScope = 'global' | 'project' | 'tagged';

export interface Memory {
  id: string;
  content: string;
  scope: MemoryScope;
  tags: string[];
  projectPath?: string;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessedAt?: string;
  importance: number; // 0-1, higher = more important
}

export interface MentalModel {
  id: string;
  sessionSummary: string;
  keyFindings: string[];
  projectInsights: string[];
  createdAt: string;
  sessionDuration: number;
  messageCount: number;
}

export interface RecallOptions {
  query?: string;
  tags?: string[];
  scope?: MemoryScope;
  projectPath?: string;
  limit?: number;
  minImportance?: number;
}

export interface RetainOptions {
  content: string;
  scope?: MemoryScope;
  tags?: string[];
  projectPath?: string;
  importance?: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function getMemoryDir(): string {
  const base = process.env.PAKALON_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'pakalon');
  const dir = path.join(base, 'memory');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getGlobalMemoryPath(): string {
  return path.join(getMemoryDir(), 'global.json');
}

function getProjectMemoryPath(projectPath: string): string {
  // Create a safe filename from project path
  const safeName = projectPath.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return path.join(getMemoryDir(), `project_${safeName}.json`);
}

function getMentalModelsPath(): string {
  return path.join(getMemoryDir(), 'mental_models.json');
}

function loadMemories(filePath: string): Memory[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveMemories(filePath: string, memories: Memory[]): void {
  fs.writeFileSync(filePath, JSON.stringify(memories, null, 2), 'utf-8');
}

function loadMentalModels(): MentalModel[] {
  try {
    const filePath = getMentalModelsPath();
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveMentalModels(models: MentalModel[]): void {
  const filePath = getMentalModelsPath();
  fs.writeFileSync(filePath, JSON.stringify(models, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Retain - Store memories
// ---------------------------------------------------------------------------

export function retain(options: RetainOptions): Memory {
  const memory: Memory = {
    id: randomUUID(),
    content: options.content,
    scope: options.scope ?? 'project',
    tags: options.tags ?? [],
    projectPath: options.projectPath ?? process.cwd(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accessCount: 0,
    importance: options.importance ?? 0.5,
  };

  // Load existing memories
  let memories: Memory[];
  if (memory.scope === 'global') {
    memories = loadMemories(getGlobalMemoryPath());
  } else {
    memories = loadMemories(getProjectMemoryPath(memory.projectPath!));
  }

  // Add new memory
  memories.push(memory);

  // Save
  if (memory.scope === 'global') {
    saveMemories(getGlobalMemoryPath(), memories);
  } else {
    saveMemories(getProjectMemoryPath(memory.projectPath!), memories);
  }

  return memory;
}

// ---------------------------------------------------------------------------
// Recall - Retrieve memories
// ---------------------------------------------------------------------------

export function recall(options: RecallOptions = {}): Memory[] {
  const {
    query,
    tags,
    scope,
    projectPath,
    limit = 10,
    minImportance = 0,
  } = options;

  let memories: Memory[] = [];

  // Load memories based on scope
  if (scope === 'global' || !scope) {
    memories.push(...loadMemories(getGlobalMemoryPath()));
  }
  
  if (scope === 'project' || !scope) {
    const targetPath = projectPath ?? process.cwd();
    memories.push(...loadMemories(getProjectMemoryPath(targetPath)));
  }

  // Filter by importance
  if (minImportance > 0) {
    memories = memories.filter(m => m.importance >= minImportance);
  }

  // Filter by tags
  if (tags && tags.length > 0) {
    memories = memories.filter(m => 
      tags.some(tag => m.tags.includes(tag))
    );
  }

  // Simple text matching for query
  if (query) {
    const queryLower = query.toLowerCase();
    memories = memories
      .map(m => ({
        memory: m,
        score: calculateRelevanceScore(m, queryLower),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.memory);
  } else {
    // Sort by importance and recency
    memories.sort((a, b) => {
      const importanceDiff = b.importance - a.importance;
      if (importanceDiff !== 0) return importanceDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  // Apply limit
  memories = memories.slice(0, limit);

  // Update access counts
  for (const memory of memories) {
    memory.accessCount++;
    memory.lastAccessedAt = new Date().toISOString();
  }

  // Save updated access counts (async, don't block return)
  setTimeout(() => {
    for (const memory of memories) {
      let allMemories: Memory[];
      if (memory.scope === 'global') {
        allMemories = loadMemories(getGlobalMemoryPath());
      } else {
        allMemories = loadMemories(getProjectMemoryPath(memory.projectPath!));
      }
      
      const idx = allMemories.findIndex(m => m.id === memory.id);
      if (idx !== -1) {
        allMemories[idx] = memory;
      }
      
      if (memory.scope === 'global') {
        saveMemories(getGlobalMemoryPath(), allMemories);
      } else {
        saveMemories(getProjectMemoryPath(memory.projectPath!), allMemories);
      }
    }
  }, 0);

  return memories;
}

function calculateRelevanceScore(memory: Memory, queryLower: string): number {
  const contentLower = memory.content.toLowerCase();
  let score = 0;

  // Exact match in content
  if (contentLower.includes(queryLower)) {
    score += 10;
  }

  // Word matching
  const queryWords = queryLower.split(/\s+/);
  for (const word of queryWords) {
    if (word.length < 3) continue; // Skip short words
    if (contentLower.includes(word)) {
      score += 2;
    }
    // Check tags
    for (const tag of memory.tags) {
      if (tag.toLowerCase().includes(word)) {
        score += 3;
      }
    }
  }

  // Boost by importance
  score *= (1 + memory.importance);

  // Boost by access count (popular memories are more relevant)
  score *= (1 + Math.min(memory.accessCount * 0.1, 2));

  return score;
}

// ---------------------------------------------------------------------------
// Reflect - Compress session into mental model
// ---------------------------------------------------------------------------

export function reflect(sessionSummary: string, keyFindings: string[], projectInsights: string[], sessionDuration: number, messageCount: number): MentalModel {
  const model: MentalModel = {
    id: randomUUID(),
    sessionSummary,
    keyFindings,
    projectInsights,
    createdAt: new Date().toISOString(),
    sessionDuration,
    messageCount,
  };

  const models = loadMentalModels();
  models.push(model);

  // Keep only the last 50 mental models
  if (models.length > 50) {
    models.splice(0, models.length - 50);
  }

  saveMentalModels(models);

  // Also store key findings as memories
  for (const finding of keyFindings) {
    retain({
      content: finding,
      scope: 'project',
      tags: ['reflection', 'key-finding'],
      importance: 0.7,
    });
  }

  for (const insight of projectInsights) {
    retain({
      content: insight,
      scope: 'project',
      tags: ['reflection', 'project-insight'],
      importance: 0.6,
    });
  }

  return model;
}

// ---------------------------------------------------------------------------
// Get latest mental model for project
// ---------------------------------------------------------------------------

export function getLatestMentalModel(projectPath?: string): MentalModel | null {
  const models = loadMentalModels();
  const targetPath = projectPath ?? process.cwd();
  
  // Filter by project path if specified
  const projectModels = models.filter(m => 
    m.projectInsights.some(insight => 
      insight.toLowerCase().includes(targetPath.toLowerCase())
    )
  );

  if (projectModels.length === 0) {
    // Return the most recent model overall
    return models.length > 0 ? models[models.length - 1]! : null;
  }

  return projectModels[projectModels.length - 1]!;
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const retainToolDefinition = {
  name: 'retain',
  description: 'Store a fact or memory for future sessions. Use this to remember important information about the codebase, user preferences, or project context.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'The fact or memory to store' },
      scope: { 
        type: 'string', 
        enum: ['global', 'project', 'tagged'],
        description: 'Memory scope (default: project)',
        default: 'project'
      },
      tags: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Tags for categorizing the memory'
      },
      importance: { 
        type: 'number', 
        minimum: 0, 
        maximum: 1,
        description: 'Importance score 0-1 (default: 0.5)',
        default: 0.5
      },
    },
    required: ['content'],
  },
  isReadOnly: false,
  isConcurrencySafe: true,

  async execute(input: { content: string; scope?: string; tags?: string[]; importance?: number }) {
    const memory = retain({
      content: input.content,
      scope: input.scope as MemoryScope,
      tags: input.tags,
      importance: input.importance,
    });
    
    return {
      success: true,
      memoryId: memory.id,
      message: `Memory stored with ID: ${memory.id}`,
    };
  },
};

export const recallToolDefinition = {
  name: 'recall',
  description: 'Retrieve relevant memories based on a query or filters. Use this to find previously stored information about the codebase or project.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query to find relevant memories' },
      tags: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Filter by tags'
      },
      scope: { 
        type: 'string', 
        enum: ['global', 'project'],
        description: 'Filter by scope'
      },
      limit: { 
        type: 'number', 
        minimum: 1, 
        maximum: 50,
        description: 'Maximum number of memories to return (default: 10)',
        default: 10
      },
      minImportance: { 
        type: 'number', 
        minimum: 0, 
        maximum: 1,
        description: 'Minimum importance score (default: 0)',
        default: 0
      },
    },
  },
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input: { query?: string; tags?: string[]; scope?: string; limit?: number; minImportance?: number }) {
    const memories = recall({
      query: input.query,
      tags: input.tags,
      scope: input.scope as MemoryScope,
      limit: input.limit,
      minImportance: input.minImportance,
    });
    
    return {
      count: memories.length,
      memories: memories.map(m => ({
        id: m.id,
        content: m.content,
        scope: m.scope,
        tags: m.tags,
        importance: m.importance,
        createdAt: m.createdAt,
        accessCount: m.accessCount,
      })),
    };
  },
};

export const reflectToolDefinition = {
  name: 'reflect',
  description: 'Compress the current session into a mental model for future reference. Use this at the end of a session to summarize key findings and insights.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sessionSummary: { type: 'string', description: 'Brief summary of the session' },
      keyFindings: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Key findings from the session'
      },
      projectInsights: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Insights about the project'
      },
      sessionDuration: { 
        type: 'number', 
        description: 'Session duration in milliseconds'
      },
      messageCount: { 
        type: 'number', 
        description: 'Number of messages in the session'
      },
    },
    required: ['sessionSummary'],
  },
  isReadOnly: false,
  isConcurrencySafe: true,

  async execute(input: { 
    sessionSummary: string; 
    keyFindings?: string[]; 
    projectInsights?: string[];
    sessionDuration?: number;
    messageCount?: number;
  }) {
    const model = reflect(
      input.sessionSummary,
      input.keyFindings ?? [],
      input.projectInsights ?? [],
      input.sessionDuration ?? 0,
      input.messageCount ?? 0
    );
    
    return {
      success: true,
      modelId: model.id,
      message: `Mental model created with ID: ${model.id}`,
      summary: model.sessionSummary,
      findingsCount: model.keyFindings.length,
      insightsCount: model.projectInsights.length,
    };
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  retain,
  recall,
  reflect,
  getLatestMentalModel,
  retainToolDefinition,
  recallToolDefinition,
  reflectToolDefinition,
};
