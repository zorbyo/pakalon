/**
 * Penpot Integration
 * Create and manage Penpot design files
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { watch } from 'chokidar';
import logger from '@/utils/logger.js';

export interface PenpotConfig {
  token?: string;
  baseUrl?: string;
}

export interface PenpotProject {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
}

export interface PenpotFile {
  id: string;
  name: string;
  projectId: string;
  pages: PenpotPage[];
}

export interface PenpotPage {
  id: string;
  name: string;
  frames: PenpotFrame[];
}

export interface PenpotFrame {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: PenpotShape[];
}

export interface PenpotShape {
  id: string;
  type: 'rect' | 'circle' | 'text' | 'image' | 'group';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills?: string[];
  strokes?: string[];
  text?: string;
  children?: PenpotShape[];
}

export class PenpotClient {
  private token: string;
  private baseUrl: string;
  
  constructor(config: PenpotConfig = {}) {
    this.token = config.token || process.env.PENPOT_TOKEN || '';
    this.baseUrl = config.baseUrl || 'https://design.penpot.app/api';
    
    if (!this.token) {
      logger.warn('[Penpot] No access token provided. Set PENPOT_TOKEN environment variable.');
    }
  }
  
  /**
   * List all projects
   */
  async listProjects(): Promise<{
    success: boolean;
    projects?: PenpotProject[];
    error?: string;
  }> {
    try {
      if (!this.token) {
        return {
          success: false,
          error: 'Penpot token not configured',
        };
      }
      
      logger.info('[Penpot] Listing projects...');
      
      const response = await fetch(`${this.baseUrl}/rpc/command/get-projects`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      
      if (!response.ok) {
        throw new Error(`Penpot API error: ${response.status} ${response.statusText}`);
      }
      
      const projects = await response.json();
      
      logger.info(`[Penpot] Found ${projects.length} projects`);
      
      return {
        success: true,
        projects,
      };
      
    } catch (error) {
      logger.error(`[Penpot] Failed to list projects: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Create a new project
   */
  async createProject(name: string): Promise<{
    success: boolean;
    projectId?: string;
    error?: string;
  }> {
    try {
      if (!this.token) {
        return {
          success: false,
          error: 'Penpot token not configured',
        };
      }
      
      logger.info(`[Penpot] Creating project: ${name}`);
      
      const response = await fetch(`${this.baseUrl}/rpc/command/create-project`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
      
      if (!response.ok) {
        throw new Error(`Penpot API error: ${response.status} ${response.statusText}`);
      }
      
      const project = await response.json();
      
      logger.info(`[Penpot] Project created: ${project.id}`);
      
      return {
        success: true,
        projectId: project.id,
      };
      
    } catch (error) {
      logger.error(`[Penpot] Failed to create project: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Create a new file in a project
   */
  async createFile(projectId: string, name: string): Promise<{
    success: boolean;
    fileId?: string;
    error?: string;
  }> {
    try {
      if (!this.token) {
        return {
          success: false,
          error: 'Penpot token not configured',
        };
      }
      
      logger.info(`[Penpot] Creating file: ${name} in project ${projectId}`);
      
      const response = await fetch(`${this.baseUrl}/rpc/command/create-file`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          'project-id': projectId,
          name,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Penpot API error: ${response.status} ${response.statusText}`);
      }
      
      const file = await response.json();
      
      logger.info(`[Penpot] File created: ${file.id}`);
      
      return {
        success: true,
        fileId: file.id,
      };
      
    } catch (error) {
      logger.error(`[Penpot] Failed to create file: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Get file contents
   */
  async getFile(fileId: string): Promise<{
    success: boolean;
    file?: PenpotFile;
    error?: string;
  }> {
    try {
      if (!this.token) {
        return {
          success: false,
          error: 'Penpot token not configured',
        };
      }
      
      logger.info(`[Penpot] Getting file: ${fileId}`);
      
      const response = await fetch(`${this.baseUrl}/rpc/query/get-file`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: fileId }),
      });
      
      if (!response.ok) {
        throw new Error(`Penpot API error: ${response.status} ${response.statusText}`);
      }
      
      const file = await response.json();
      
      logger.info(`[Penpot] File retrieved: ${file.name}`);
      
      return {
        success: true,
        file,
      };
      
    } catch (error) {
      logger.error(`[Penpot] Failed to get file: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Export file as SVG
   */
  async exportSVG(fileId: string, outputPath: string): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> {
    try {
      logger.info(`[Penpot] Exporting file ${fileId} as SVG`);
      
      // This is a placeholder - actual Penpot export API may differ
      const fileResult = await this.getFile(fileId);
      
      if (!fileResult.success || !fileResult.file) {
        return {
          success: false,
          error: fileResult.error,
        };
      }
      
      // Generate basic SVG structure
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <!-- Penpot file: ${fileResult.file.name} -->
  <text x="50" y="50">Exported from Penpot</text>
</svg>`;
      
      await fs.writeFile(outputPath, svg, 'utf-8');
      
      logger.info(`[Penpot] SVG exported to: ${outputPath}`);
      
      return {
        success: true,
        path: outputPath,
      };
      
    } catch (error) {
      logger.error(`[Penpot] Failed to export SVG: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Penpot File Watcher
 * Watches .penpot files for changes and syncs
 */
export class PenpotFileWatcher {
  private watcher: any;
  private client: PenpotClient;
  private callbacks: Map<string, (file: string) => void>;
  
  constructor(client: PenpotClient) {
    this.client = client;
    this.callbacks = new Map();
  }
  
  /**
   * Start watching a directory for .penpot files
   */
  watch(directory: string, callback: (file: string) => void): void {
    logger.info(`[Penpot] Watching directory: ${directory}`);
    
    this.watcher = watch(path.join(directory, '**', '*.penpot'), {
      persistent: true,
      ignoreInitial: true,
    });
    
    this.watcher.on('change', (filePath: string) => {
      logger.info(`[Penpot] File changed: ${filePath}`);
      callback(filePath);
    });
    
    this.watcher.on('add', (filePath: string) => {
      logger.info(`[Penpot] File added: ${filePath}`);
      callback(filePath);
    });
  }
  
  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      logger.info('[Penpot] Stopped watching files');
    }
  }
}

/**
 * Create Penpot client instance
 */
export function createPenpotClient(config?: PenpotConfig): PenpotClient {
  return new PenpotClient(config);
}

/**
 * Create Penpot file watcher
 */
export function createPenpotWatcher(client: PenpotClient): PenpotFileWatcher {
  return new PenpotFileWatcher(client);
}
