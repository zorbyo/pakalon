/**
 * Search Tool BM25
 * 
 * BM25 search over the hidden tool index for deferred tools.
 * Based on OMP's search-tool-bm25 tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import logger from '@/utils/logger.js';

// ============================================================================
// BM25 Implementation
// ============================================================================

interface BM25Document {
  id: string;
  name: string;
  description: string;
  searchHint?: string;
  score: number;
}

class BM25Index {
  private documents: BM25Document[] = [];
  private avgDocLength: number = 0;
  private termFreqs: Map<string, Map<string, number>> = new Map();
  private docFreqs: Map<string, number> = new Map();
  private k1: number = 1.5;
  private b: number = 0.75;

  addDocument(doc: BM25Document): void {
    this.documents.push(doc);
    this.updateStats();
  }

  private updateStats(): void {
    this.termFreqs.clear();
    this.docFreqs.clear();

    let totalLength = 0;
    const docCount = this.documents.length;

    for (const doc of this.documents) {
      const text = `${doc.name} ${doc.description} ${doc.searchHint || ''}`.toLowerCase();
      const terms = text.split(/\s+/).filter(t => t.length > 0);
      totalLength += terms.length;

      const termFreq = new Map<string, number>();
      for (const term of terms) {
        termFreq.set(term, (termFreq.get(term) || 0) + 1);
      }
      this.termFreqs.set(doc.id, termFreq);

      const uniqueTerms = new Set(terms);
      for (const term of uniqueTerms) {
        this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
      }
    }

    this.avgDocLength = docCount > 0 ? totalLength / docCount : 0;
  }

  search(query: string, maxResults: number = 10): BM25Document[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    const docCount = this.documents.length;

    const scores = new Map<string, number>();

    for (const doc of this.documents) {
      let score = 0;
      const docLen = this.termFreqs.get(doc.id)?.size || 0;

      for (const term of queryTerms) {
        const tf = this.termFreqs.get(doc.id)?.get(term) || 0;
        const df = this.docFreqs.get(term) || 0;
        const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);

        const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * docLen / this.avgDocLength));
        
        score += idf * tfNorm;
      }

      if (score > 0) {
        scores.set(doc.id, score);
      }
    }

    return this.documents
      .filter(doc => scores.has(doc.id))
      .map(doc => ({ ...doc, score: scores.get(doc.id) || 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  getDocumentCount(): number {
    return this.documents.length;
  }

  clear(): void {
    this.documents = [];
    this.termFreqs.clear();
    this.docFreqs.clear();
  }
}

// ============================================================================
// Tool Index
// ============================================================================

let toolIndex: BM25Index | null = null;
let hiddenTools: Map<string, { name: string; description: string; searchHint?: string }> = new Map();

export function registerHiddenTool(name: string, description: string, searchHint?: string): void {
  hiddenTools.set(name, { name, description, searchHint });
  toolIndex = null; // Reset index
}

export function unregisterHiddenTool(name: string): void {
  hiddenTools.delete(name);
  toolIndex = null;
}

function getToolIndex(): BM25Index {
  if (!toolIndex) {
    toolIndex = new BM25Index();
    for (const [id, tool] of hiddenTools) {
      toolIndex.addDocument({
        id,
        name: tool.name,
        description: tool.description,
        searchHint: tool.searchHint,
        score: 0,
      });
    }
  }
  return toolIndex;
}

// ============================================================================
// Search Tool BM25
// ============================================================================

const searchToolBM25InputSchema = z.object({
  query: z.string().describe('Search query to find relevant tools'),
  maxResults: z.number().optional().default(5).describe('Maximum number of tools to return'),
});

export const searchToolBM25Tool = buildTool({
  name: 'search_tool_bm25',
  description: 'Search for hidden/deferred tools using BM25 ranking. Activates top matches for use.',
  inputSchema: searchToolBM25InputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { query, maxResults } = args;
    
    try {
      const index = getToolIndex();
      
      if (index.getDocumentCount() === 0) {
        return {
          data: 'No hidden tools registered. All tools are already available.',
        };
      }
      
      const results = index.search(query, maxResults);
      
      if (results.length === 0) {
        return {
          data: `No tools found matching "${query}".`,
        };
      }
      
      // Format results
      const formattedResults = results.map((tool, index) => {
        const score = (tool.score * 100).toFixed(0);
        return `[${index + 1}] ${tool.name} (relevance: ${score}%)\n    ${tool.description}`;
      }).join('\n\n');
      
      const summary = `Found ${results.length} tools matching "${query}":\n\n${formattedResults}`;
      
      logger.debug('[search-tool-bm25] Search completed', { 
        query: query.slice(0, 50),
        resultsCount: results.length 
      });
      
      return {
        data: summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[search-tool-bm25] Search failed', { error: message });
      
      return {
        data: `Search failed: ${message}`,
      };
    }
  },
  
  userFacingName: () => 'Search Tools',
  
  renderToolUseMessage: (input) => {
    const query = typeof input.query === 'string' ? input.query : '';
    return `Searching tools: ${query}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
