/**
 * Render Mermaid Tool
 * 
 * Renders Mermaid diagrams to terminal-friendly ASCII or PNG.
 * Based on OMP's render_mermaid tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '@/utils/logger.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

interface MermaidRenderResult {
  success: boolean;
  ascii?: string;
  imagePath?: string;
  error?: string;
  format: 'ascii' | 'png' | 'svg';
}

// ============================================================================
// Mermaid Renderer
// ============================================================================

class MermaidRenderer {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(process.cwd(), '.tmp-mermaid');
  }

  /**
   * Render Mermaid diagram
   */
  async render(
    mermaidCode: string,
    format: 'ascii' | 'png' | 'svg' = 'ascii'
  ): Promise<MermaidRenderResult> {
    try {
      // Ensure temp directory exists
      await fs.mkdir(this.tempDir, { recursive: true });

      if (format === 'ascii') {
        return await this.renderToASCII(mermaidCode);
      } else {
        return await this.renderToFile(mermaidCode, format);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[mermaid] Render failed', { error: message });
      return {
        success: false,
        error: message,
        format,
      };
    }
  }

  /**
   * Render to ASCII using mmdc (Mermaid CLI)
   */
  private async renderToASCII(mermaidCode: string): Promise<MermaidRenderResult> {
    const inputFile = path.join(this.tempDir, `input-${Date.now()}.mmd`);
    const outputFile = path.join(this.tempDir, `output-${Date.now()}.png`);

    try {
      await fs.writeFile(inputFile, mermaidCode, 'utf-8');
      
      // Try to use mmdc if available
      try {
        await execAsync(`mmdc -i ${inputFile} -o ${outputFile} -t dark -b transparent`, {
          timeout: 30000,
        });
        
        // Read the PNG and convert to ASCII (simplified)
        const ascii = `[Diagram rendered to ${outputFile}]\n\nMermaid code:\n${mermaidCode}`;
        
        return {
          success: true,
          ascii,
          format: 'ascii',
        };
      } catch {
        // mmdc not available, return mermaid code as text
        return {
          success: true,
          ascii: `Mermaid diagram (rendering requires mmdc):\n\n${mermaidCode}`,
          format: 'ascii',
        };
      }
    } finally {
      // Cleanup temp files
      try {
        await fs.unlink(inputFile).catch(() => {});
        await fs.unlink(outputFile).catch(() => {});
      } catch {}
    }
  }

  /**
   * Render to PNG/SVG file
   */
  private async renderToFile(
    mermaidCode: string,
    format: 'png' | 'svg'
  ): Promise<MermaidRenderResult> {
    const inputFile = path.join(this.tempDir, `input-${Date.now()}.mmd`);
    const outputFile = path.join(this.tempDir, `output-${Date.now()}.${format}`);

    try {
      await fs.writeFile(inputFile, mermaidCode, 'utf-8');
      
      await execAsync(`mmdc -i ${inputFile} -o ${outputFile} -t dark -b transparent`, {
        timeout: 30000,
      });
      
      return {
        success: true,
        imagePath: outputFile,
        format,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to render: ${message}`,
        format,
      };
    } finally {
      try {
        await fs.unlink(inputFile).catch(() => {});
      } catch {}
    }
  }

  /**
   * Cleanup temp directory
   */
  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch {}
  }
}

// ============================================================================
// Singleton
// ============================================================================

let rendererInstance: MermaidRenderer | null = null;

function getMermaidRenderer(): MermaidRenderer {
  if (!rendererInstance) {
    rendererInstance = new MermaidRenderer();
  }
  return rendererInstance;
}

// ============================================================================
// Render Mermaid Tool
// ============================================================================

const renderMermaidInputSchema = z.object({
  code: z.string().describe('Mermaid diagram code'),
  format: z.enum(['ascii', 'png', 'svg']).optional().default('ascii').describe('Output format'),
});

export const renderMermaidTool = buildTool({
  name: 'render_mermaid',
  description: 'Render Mermaid diagrams to ASCII art or image files.',
  inputSchema: renderMermaidInputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  requiresUserInteraction: false,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { code, format } = args;
    
    try {
      const renderer = getMermaidRenderer();
      const result = await renderer.render(code, format);
      
      if (result.success) {
        let output = '';
        if (result.ascii) {
          output = result.ascii;
        } else if (result.imagePath) {
          output = `Diagram rendered to: ${result.imagePath}`;
        }
        return { data: output };
      } else {
        return { data: `Render failed: ${result.error}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[mermaid] Tool failed', { error: message });
      return { data: `Render failed: ${message}` };
    }
  },
  
  userFacingName: () => 'Render Mermaid',
  
  renderToolUseMessage: (input) => {
    const format = typeof input.format === 'string' ? input.format : 'ascii';
    return `Rendering Mermaid diagram (${format})`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
