/**
 * MCP (Model Context Protocol) Integration
 * Connects to external MCP servers for enhanced capabilities
 * 
 * Features:
 * - Firecrawl MCP for web research and scraping
 * - Penpot MCP for design file management
 * - Generic MCP client for future integrations
 */

import { z } from 'zod';
import logger from '@/utils/logger.js';

// MCP Tool Schema
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  execute: (args: any) => Promise<any>;
}

// MCP Server Configuration
export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// MCP Client for generic server communication
export class MCPClient {
  private config: MCPServerConfig;
  private connected: boolean = false;
  private sdkClient: any = null;
  private transport: any = null;
  
  constructor(config: MCPServerConfig) {
    this.config = config;
  }
  
  async connect(): Promise<void> {
    logger.info(`[MCP] Connecting to ${this.config.name}...`);
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
    ]);
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: this.config.env ? { ...process.env, ...this.config.env } as Record<string, string> : undefined,
      stderr: 'pipe',
    });
    this.sdkClient = new Client({ name: `pakalon-${this.config.name}`, version: '1.0.0' });
    await this.sdkClient.connect(this.transport);
    this.connected = true;
    logger.info(`[MCP] Connected to ${this.config.name}`);
  }
  
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    logger.info(`[MCP] Disconnecting from ${this.config.name}...`);
    await this.transport?.close?.();
    this.sdkClient = null;
    this.transport = null;
    this.connected = false;
  }
  
  async callTool(toolName: string, args: any): Promise<any> {
    if (!this.connected) {
      throw new Error(`Not connected to ${this.config.name}`);
    }
    logger.debug(`[MCP] Calling ${toolName} on ${this.config.name}`);

    const result = await this.sdkClient.callTool({
      name: toolName,
      arguments: args,
    });

    if ('structuredContent' in result && result.structuredContent) {
      return result.structuredContent;
    }

    const textParts = Array.isArray(result.content)
      ? result.content.filter((part: any) => part?.type === 'text').map((part: any) => part.text)
      : [];
    if (textParts.length > 0) {
      const text = textParts.join('\n');
      try {
        return JSON.parse(text);
      } catch {
        return { success: !result.isError, text };
      }
    }

    return result;
  }
  
  async listTools(): Promise<MCPTool[]> {
    if (!this.connected) {
      throw new Error(`Not connected to ${this.config.name}`);
    }
    const result = await this.sdkClient.listTools();
    return (result.tools ?? []).map((tool: any) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: z.object({}).passthrough(),
      execute: (args: any) => this.callTool(tool.name, args),
    }));
  }
}

// ---------------------------------------------------------------------------
// Firecrawl MCP Integration
// ---------------------------------------------------------------------------

export class FirecrawlMCP {
  private client: MCPClient;
  private readonly apiBaseUrl: string;
  
  constructor() {
    this.client = new MCPClient({
      name: 'firecrawl',
      command: 'npx',
      args: ['-y', '@firecrawl/mcp-server'],
      env: {
        FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || '',
      },
    });
    this.apiBaseUrl = (process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev/v1').replace(/\/$/, '');
  }
  
  async connect(): Promise<void> {
    await this.client.connect();
  }
  
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
  
  /**
   * Scrape a single URL
   */
  async scrapeUrl(url: string): Promise<{
    success: boolean;
    markdown?: string;
    html?: string;
    metadata?: any;
    error?: string;
  }> {
    try {
      logger.info(`[Firecrawl] Scraping URL: ${url}`);
      
      if (!process.env.FIRECRAWL_API_KEY) {
        logger.warn('[Firecrawl] API key not set, using fallback fetch');
        const response = await fetch(url);
        const html = await response.text();
        
        return {
          success: true,
          html,
          markdown: `# Content from ${url}\n\n${html.substring(0, 1000)}...`,
          metadata: {
            url,
            statusCode: response.status,
            contentType: response.headers.get('content-type'),
          },
        };
      }

      const result = await this.requestFirecrawl('/scrape', {
        url,
        formats: ['markdown', 'html'],
      });
      const data = result.data ?? result;

      return {
        success: Boolean(result.success ?? true),
        markdown: data.markdown,
        html: data.html,
        metadata: data.metadata,
      };
      
    } catch (error) {
      logger.error(`[Firecrawl] Scrape failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Crawl a website (multiple pages)
   */
  async crawlWebsite(url: string, maxPages: number = 10): Promise<{
    success: boolean;
    pages?: Array<{
      url: string;
      markdown: string;
      metadata: any;
    }>;
    error?: string;
  }> {
    try {
      logger.info(`[Firecrawl] Crawling website: ${url} (max ${maxPages} pages)`);

      if (!process.env.FIRECRAWL_API_KEY) {
        const scraped = await this.scrapeUrl(url);
        return scraped.success && scraped.markdown
          ? { success: true, pages: [{ url, markdown: scraped.markdown, metadata: scraped.metadata ?? {} }] }
          : { success: false, error: scraped.error ?? 'Firecrawl API key not configured' };
      }

      const result = await this.requestFirecrawl('/crawl', {
        url,
        limit: maxPages,
        scrapeOptions: {
          formats: ['markdown'],
        },
      });
      const pages = result.data ?? result.pages ?? [];
      
      return {
        success: Boolean(result.success ?? true),
        pages,
      };
      
    } catch (error) {
      logger.error(`[Firecrawl] Crawl failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Search the web
   */
  async search(query: string, maxResults: number = 5): Promise<{
    success: boolean;
    results?: Array<{
      title: string;
      url: string;
      snippet: string;
    }>;
    error?: string;
  }> {
    try {
      logger.info(`[Firecrawl] Searching: "${query}" (max ${maxResults} results)`);

      if (!process.env.FIRECRAWL_API_KEY) {
        return {
          success: false,
          error: 'FIRECRAWL_API_KEY is required for dynamic web search',
        };
      }

      const result = await this.requestFirecrawl('/search', {
        query,
        limit: maxResults,
      });
      const rawResults = result.data ?? result.results ?? [];
      
      return {
        success: Boolean(result.success ?? true),
        results: rawResults.map((item: any) => ({
          title: String(item.title ?? item.name ?? item.url ?? ''),
          url: String(item.url ?? item.link ?? ''),
          snippet: String(item.description ?? item.snippet ?? item.markdown?.slice(0, 240) ?? ''),
        })).filter((item: { url: string }) => item.url),
      };
      
    } catch (error) {
      logger.error(`[Firecrawl] Search failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async requestFirecrawl(endpoint: string, body: Record<string, unknown>): Promise<any> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY is required');
    }

    const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });

    const text = await response.text();
    let payload: any = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { success: false, error: text };
      }
    }

    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || payload.message || `Firecrawl API error: ${response.status}`);
    }

    return payload;
  }
}

// ---------------------------------------------------------------------------
// Penpot MCP Integration
// ---------------------------------------------------------------------------

export class PenpotMCP {
  private client: MCPClient;
  
  constructor() {
    this.client = new MCPClient({
      name: 'penpot',
      command: 'node',
      args: ['./src/integrations/penpot-mcp-server.js'],
      env: {
        PENPOT_TOKEN: process.env.PENPOT_TOKEN || '',
      },
    });
  }
  
  async connect(): Promise<void> {
    await this.client.connect();
  }
  
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
  
  /**
   * List all Penpot projects
   */
  async listProjects(): Promise<{
    success: boolean;
    projects?: Array<{
      id: string;
      name: string;
      createdAt: string;
    }>;
    error?: string;
  }> {
    try {
      logger.info('[Penpot] Listing projects...');
      
      const result = await this.client.callTool('list_projects', {});
      
      return {
        success: true,
        projects: result.projects,
      };
      
    } catch (error) {
      logger.error(`[Penpot] List projects failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Get Penpot file contents
   */
  async getFile(fileId: string): Promise<{
    success: boolean;
    file?: any;
    error?: string;
  }> {
    try {
      logger.info(`[Penpot] Getting file: ${fileId}`);
      
      const result = await this.client.callTool('get_file', {
        file_id: fileId,
      });
      
      return {
        success: true,
        file: result.file,
      };
      
    } catch (error) {
      logger.error(`[Penpot] Get file failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Create a new Penpot file
   */
  async createFile(projectId: string, fileName: string): Promise<{
    success: boolean;
    fileId?: string;
    error?: string;
  }> {
    try {
      logger.info(`[Penpot] Creating file: ${fileName} in project ${projectId}`);
      
      const result = await this.client.callTool('create_file', {
        project_id: projectId,
        name: fileName,
      });
      
      return {
        success: true,
        fileId: result.file_id,
      };
      
    } catch (error) {
      logger.error(`[Penpot] Create file failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Export Penpot file as SVG/PNG
   */
  async exportFile(fileId: string, format: 'svg' | 'png'): Promise<{
    success: boolean;
    data?: Buffer;
    error?: string;
  }> {
    try {
      logger.info(`[Penpot] Exporting file ${fileId} as ${format}`);
      
      const result = await this.client.callTool('export_file', {
        file_id: fileId,
        format,
      });
      
      return {
        success: true,
        data: Buffer.from(result.data, 'base64'),
      };
      
    } catch (error) {
      logger.error(`[Penpot] Export file failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// MCP Manager - Centralized MCP client management
// ---------------------------------------------------------------------------

export class MCPManager {
  private firecrawl: FirecrawlMCP;
  private penpot: PenpotMCP;
  private connected: boolean = false;
  
  constructor() {
    this.firecrawl = new FirecrawlMCP();
    this.penpot = new PenpotMCP();
  }
  
  async connectAll(): Promise<void> {
    logger.info('[MCP] Connecting to all MCP servers...');
    
    try {
      await this.firecrawl.connect();
      await this.penpot.connect();
      this.connected = true;
      
      logger.info('[MCP] All MCP servers connected');
    } catch (error) {
      logger.warn(`[MCP] Failed to connect some servers: ${error}`);
    }
  }
  
  async disconnectAll(): Promise<void> {
    if (!this.connected) return;
    
    logger.info('[MCP] Disconnecting from all MCP servers...');
    
    await this.firecrawl.disconnect();
    await this.penpot.disconnect();
    
    this.connected = false;
    logger.info('[MCP] All MCP servers disconnected');
  }
  
  getFirecrawl(): FirecrawlMCP {
    return this.firecrawl;
  }
  
  getPenpot(): PenpotMCP {
    return this.penpot;
  }
}

// Singleton instance
let mcpManager: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!mcpManager) {
    mcpManager = new MCPManager();
  }
  return mcpManager;
}

export async function initializeMCP(): Promise<void> {
  const manager = getMCPManager();
  await manager.connectAll();
}

export async function shutdownMCP(): Promise<void> {
  if (mcpManager) {
    await mcpManager.disconnectAll();
    mcpManager = null;
  }
}
