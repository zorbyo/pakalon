/**
 * Hindsight Memory Client
 * 
 * Client for interacting with Hindsight memory server.
 * Supports retain, recall, and reflect operations.
 * 
 * Based on OMP's hindsight implementation.
 */

import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface HindsightConfig {
  apiUrl: string;
  apiToken?: string;
  bankId: string;
  dynamicBankId?: string;
  agentName: string;
  autoRecall: boolean;
  autoRetain: boolean;
  retainMode: 'append' | 'replace';
  recallBudget: number;
  recallMaxTokens: number;
  debug: boolean;
}

export interface HindsightMemory {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
  bankId: string;
  agentName?: string;
}

export interface RecallResult {
  memories: HindsightMemory[];
  totalTokens: number;
  truncated: boolean;
}

export interface ReflectResult {
  answer: string;
  sources: HindsightMemory[];
  confidence: number;
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: HindsightConfig = {
  apiUrl: process.env.HINDSIGHT_API_URL || 'http://localhost:8888',
  apiToken: process.env.HINDSIGHT_API_TOKEN,
  bankId: process.env.HINDSIGHT_BANK_ID || 'default',
  dynamicBankId: process.env.HINDSIGHT_DYNAMIC_BANK_ID,
  agentName: process.env.HINDSIGHT_AGENT_NAME || 'pakalon',
  autoRecall: process.env.HINDSIGHT_AUTO_RECALL !== 'false',
  autoRetain: process.env.HINDSIGHT_AUTO_RETAIN !== 'false',
  retainMode: (process.env.HINDSIGHT_RETAIN_MODE as 'append' | 'replace') || 'append',
  recallBudget: parseInt(process.env.HINDSIGHT_RECALL_BUDGET || '1000', 10),
  recallMaxTokens: parseInt(process.env.HINDSIGHT_RECALL_MAX_TOKENS || '4000', 10),
  debug: process.env.HINDSIGHT_DEBUG === 'true',
};

// ============================================================================
// Hindsight Client
// ============================================================================

export class HindsightClient {
  private config: HindsightConfig;
  private baseUrl: string;

  constructor(config?: Partial<HindsightConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.baseUrl = this.config.apiUrl.replace(/\/$/, '');
  }

  /**
   * Retain a memory in the Hindsight bank
   */
  async retain(
    content: string,
    options?: {
      metadata?: Record<string, unknown>;
      bankId?: string;
    }
  ): Promise<HindsightMemory> {
    const bankId = options?.bankId || this.config.bankId;
    
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/banks/${bankId}/memories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiToken ? { 'Authorization': `Bearer ${this.config.apiToken}` } : {}),
        },
        body: JSON.stringify({
          content,
          agent_name: this.config.agentName,
          metadata: options?.metadata,
          mode: this.config.retainMode,
        }),
      });

      if (!response.ok) {
        throw new Error(`Hindsight retain failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (this.config.debug) {
        logger.debug('[Hindsight] Retained memory', { bankId, contentLength: content.length });
      }

      return {
        id: result.id || `mem-${Date.now()}`,
        content,
        metadata: options?.metadata,
        timestamp: Date.now(),
        bankId,
        agentName: this.config.agentName,
      };
    } catch (error) {
      logger.error('[Hindsight] Retain failed', { error: String(error) });
      throw error;
    }
  }

  /**
   * Recall memories from the Hindsight bank
   */
  async recall(
    query: string,
    options?: {
      budget?: number;
      maxTokens?: number;
      bankId?: string;
    }
  ): Promise<RecallResult> {
    const bankId = options?.bankId || this.config.bankId;
    const budget = options?.budget || this.config.recallBudget;
    const maxTokens = options?.maxTokens || this.config.recallMaxTokens;

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/banks/${bankId}/recall`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiToken ? { 'Authorization': `Bearer ${this.config.apiToken}` } : {}),
        },
        body: JSON.stringify({
          query,
          agent_name: this.config.agentName,
          budget,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`Hindsight recall failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      const memories: HindsightMemory[] = (result.memories || []).map((m: any) => ({
        id: m.id,
        content: m.content,
        metadata: m.metadata,
        timestamp: m.timestamp || Date.now(),
        bankId,
        agentName: m.agent_name,
      }));

      const totalTokens = memories.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);

      if (this.config.debug) {
        logger.debug('[Hindsight] Recalled memories', { 
          bankId, 
          count: memories.length, 
          totalTokens 
        });
      }

      return {
        memories,
        totalTokens,
        truncated: totalTokens > maxTokens,
      };
    } catch (error) {
      logger.error('[Hindsight] Recall failed', { error: String(error) });
      return { memories: [], totalTokens: 0, truncated: false };
    }
  }

  /**
   * Reflect on a question using memories as context
   */
  async reflect(
    question: string,
    options?: {
      bankId?: string;
      maxSources?: number;
    }
  ): Promise<ReflectResult> {
    const bankId = options?.bankId || this.config.bankId;
    const maxSources = options?.maxSources || 5;

    try {
      // First recall relevant memories
      const recallResult = await this.recall(question, { bankId });
      
      // Then use the memories to answer the question
      const response = await fetch(`${this.baseUrl}/api/v1/banks/${bankId}/reflect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiToken ? { 'Authorization': `Bearer ${this.config.apiToken}` } : {}),
        },
        body: JSON.stringify({
          question,
          context_memories: recallResult.memories.slice(0, maxSources).map(m => m.content),
          agent_name: this.config.agentName,
        }),
      });

      if (!response.ok) {
        throw new Error(`Hindsight reflect failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (this.config.debug) {
        logger.debug('[Hindsight] Reflected on question', { 
          bankId, 
          questionLength: question.length,
          sourcesCount: recallResult.memories.length 
        });
      }

      return {
        answer: result.answer || 'No answer available',
        sources: recallResult.memories.slice(0, maxSources),
        confidence: result.confidence || 0.5,
      };
    } catch (error) {
      logger.error('[Hindsight] Reflect failed', { error: String(error) });
      return {
        answer: 'Failed to reflect on question',
        sources: [],
        confidence: 0,
      };
    }
  }

  /**
   * Get memory bank status
   */
  async getBankStatus(bankId?: string): Promise<{
    totalMemories: number;
    lastUpdated: number | null;
  }> {
    const targetBankId = bankId || this.config.bankId;

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/banks/${targetBankId}/status`, {
        headers: {
          ...(this.config.apiToken ? { 'Authorization': `Bearer ${this.config.apiToken}` } : {}),
        },
      });

      if (!response.ok) {
        return { totalMemories: 0, lastUpdated: null };
      }

      const result = await response.json();
      return {
        totalMemories: result.total_memories || 0,
        lastUpdated: result.last_updated || null,
      };
    } catch (error) {
      logger.error('[Hindsight] Get bank status failed', { error: String(error) });
      return { totalMemories: 0, lastUpdated: null };
    }
  }

  /**
   * Check if Hindsight server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get configuration
   */
  getConfig(): HindsightConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let clientInstance: HindsightClient | null = null;

export function getHindsightClient(config?: Partial<HindsightConfig>): HindsightClient {
  if (!clientInstance) {
    clientInstance = new HindsightClient(config);
  }
  return clientInstance;
}

export function resetHindsightClient(): void {
  clientInstance = null;
}
