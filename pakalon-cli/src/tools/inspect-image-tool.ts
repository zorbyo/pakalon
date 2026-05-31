/**
 * Inspect Image Tool
 * 
 * Analyzes images using vision models.
 * Based on OMP's inspect-image tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

interface ImageAnalysis {
  description: string;
  objects: string[];
  text?: string[];
  colors?: string[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Image Inspector
// ============================================================================

class ImageInspector {
  private apiKey: string | undefined;
  private defaultModel: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    this.defaultModel = 'gpt-4-vision-preview';
  }

  /**
   * Analyze an image
   */
  async analyze(
    imagePath: string,
    question: string,
    model?: string
  ): Promise<ImageAnalysis> {
    const useModel = model || this.defaultModel;

    try {
      // Read image as base64
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = this.getMimeType(imagePath);

      if (useModel.includes('gpt-4') || useModel.includes('openai')) {
        return await this.analyzeWithOpenAI(base64Image, mimeType, question);
      } else if (useModel.includes('claude') || useModel.includes('anthropic')) {
        return await this.analyzeWithAnthropic(base64Image, mimeType, question);
      } else {
        throw new Error(`Unsupported model: ${useModel}`);
      }
    } catch (error) {
      logger.error('[inspect-image] Analysis failed', { error: String(error) });
      throw error;
    }
  }

  /**
   * Analyze with OpenAI
   */
  private async analyzeWithOpenAI(
    base64Image: string,
    mimeType: string,
    question: string
  ): Promise<ImageAnalysis> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: question },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}` },
              },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';

    return {
      description: content,
      objects: this.extractObjects(content),
      text: this.extractText(content),
    };
  }

  /**
   * Analyze with Anthropic
   */
  private async analyzeWithAnthropic(
    base64Image: string,
    mimeType: string,
    question: string
  ): Promise<ImageAnalysis> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: base64Image,
                },
              },
              { type: 'text', text: question },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const result = await response.json();
    const content = result.content?.[0]?.text || '';

    return {
      description: content,
      objects: this.extractObjects(content),
      text: this.extractText(content),
    };
  }

  /**
   * Get MIME type from file path
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
    };
    return mimeTypes[ext] || 'image/png';
  }

  /**
   * Extract objects from description
   */
  private extractObjects(description: string): string[] {
    const objects: string[] = [];
    const patterns = [
      /(?:contains?|shows?|displays?)\s+(?:a|an|the)\s+([^.]+)/gi,
      /(?:there (?:is|are))\s+(?:a|an|the)\s+([^.]+)/gi,
    ];

    for (const pattern of patterns) {
      const matches = description.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          objects.push(match[1].trim());
        }
      }
    }

    return [...new Set(objects)];
  }

  /**
   * Extract text from description
   */
  private extractText(description: string): string[] {
    const texts: string[] = [];
    const pattern = /(?:text|label|sign|writing).*?["']([^"']+)["']/gi;
    
    const matches = description.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        texts.push(match[1]);
      }
    }

    return texts;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let inspectorInstance: ImageInspector | null = null;

function getImageInspector(): ImageInspector {
  if (!inspectorInstance) {
    inspectorInstance = new ImageInspector();
  }
  return inspectorInstance;
}

// ============================================================================
// Inspect Image Tool
// ============================================================================

const inspectImageInputSchema = z.object({
  path: z.string().describe('Path to the image file'),
  question: z.string().describe('Question about the image'),
  model: z.string().optional().describe('Vision model to use'),
});

export const inspectImageTool = buildTool({
  name: 'inspect_image',
  description: 'Analyze an image using vision models. Ask questions about image content.',
  inputSchema: inspectImageInputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  requiresUserInteraction: false,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { path: imagePath, question, model } = args;
    
    try {
      const inspector = getImageInspector();
      const analysis = await inspector.analyze(imagePath, question, model);
      
      let output = `Analysis of ${imagePath}:\n\n${analysis.description}`;
      
      if (analysis.objects.length > 0) {
        output += `\n\nObjects detected: ${analysis.objects.join(', ')}`;
      }
      
      if (analysis.text && analysis.text.length > 0) {
        output += `\n\nText found: ${analysis.text.join(', ')}`;
      }
      
      return { data: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[inspect-image] Tool failed', { error: message });
      return { data: `Image analysis failed: ${message}` };
    }
  },
  
  userFacingName: () => 'Inspect Image',
  
  renderToolUseMessage: (input) => {
    const imagePath = typeof input.path === 'string' ? input.path : '';
    const question = typeof input.question === 'string' ? input.question : '';
    return `Inspecting ${path.basename(imagePath)}: ${question.slice(0, 50)}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
