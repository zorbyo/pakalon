/**
 * Image Analyzer Tool
 * 
 * Comprehensive image analysis using vision models via OpenRouter.
 * Supports drag-and-drop, clipboard paste, and file path analysis.
 * 
 * Features:
 * - Multiple vision model support (GPT-4V, Claude 3, Gemini)
 * - Base64 and file path input
 * - Detailed analysis (objects, text, colors, composition)
 * - Custom questions about images
 * - Batch analysis support
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ImageAnalysisResult {
  success: boolean;
  description?: string;
  objects?: string[];
  text?: string[];
  colors?: string[];
  composition?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface ImageAnalyzerOptions {
  model?: string;
  question?: string;
  maxTokens?: number;
  temperature?: number;
}

// ============================================================================
// Supported Vision Models
// ============================================================================

const VISION_MODELS: Record<string, string> = {
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4-vision': 'openai/gpt-4-vision-preview',
  'claude-3-opus': 'anthropic/claude-3-opus-20240229',
  'claude-3-sonnet': 'anthropic/claude-3-sonnet-20240229',
  'claude-3-haiku': 'anthropic/claude-3-haiku-20240307',
  'gemini-pro': 'google/gemini-pro-vision',
  'gemini-flash': 'google/gemini-2.0-flash-001',
};

const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

// ============================================================================
// Supported Image Formats
// ============================================================================

const SUPPORTED_FORMATS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

// ============================================================================
// Image Analyzer Class
// ============================================================================

export class ImageAnalyzer {
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel?: string) {
    this.apiKey = apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
    this.defaultModel = defaultModel ?? DEFAULT_MODEL;
  }

  /**
   * Analyze an image from file path
   */
  async analyzeFromFile(
    filePath: string,
    options?: ImageAnalyzerOptions
  ): Promise<ImageAnalysisResult> {
    try {
      // Validate file exists
      await fs.access(filePath);
      
      // Read file and convert to base64
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString('base64');
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = SUPPORTED_FORMATS[ext];
      
      if (!mimeType) {
        return {
          success: false,
          error: `Unsupported image format: ${ext}. Supported: ${Object.keys(SUPPORTED_FORMATS).join(', ')}`,
        };
      }

      return await this.analyzeFromBase64(base64, mimeType, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[image-analyzer] Failed to analyze file', { filePath, error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Analyze an image from base64 string
   */
  async analyzeFromBase64(
    base64Image: string,
    mimeType: string = 'image/png',
    options?: ImageAnalyzerOptions
  ): Promise<ImageAnalysisResult> {
    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'OPENROUTER_API_KEY not configured. Set it in environment or pass via constructor.',
        };
      }

      const model = options?.model ?? this.defaultModel;
      const question = options?.question ?? this.getDefaultQuestion();
      const maxTokens = options?.maxTokens ?? 1000;
      const temperature = options?.temperature ?? 0.7;

      // Build the request
      const requestBody = {
        model: VISION_MODELS[model] ?? model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: question },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: maxTokens,
        temperature,
      };

      // Call OpenRouter API
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://pakalon.com',
          'X-Title': 'Pakalon CLI',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content ?? '';

      if (!content) {
        return {
          success: false,
          error: 'No analysis content returned from model',
        };
      }

      // Parse the response
      return this.parseAnalysisResponse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[image-analyzer] Analysis failed', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Analyze multiple images in batch
   */
  async analyzeBatch(
    images: Array<{ path?: string; base64?: string; mimeType?: string }>,
    options?: ImageAnalyzerOptions
  ): Promise<ImageAnalysisResult[]> {
    const results: ImageAnalysisResult[] = [];

    for (const image of images) {
      let result: ImageAnalysisResult;
      
      if (image.path) {
        result = await this.analyzeFromFile(image.path, options);
      } else if (image.base64) {
        result = await this.analyzeFromBase64(image.base64, image.mimeType, options);
      } else {
        result = { success: false, error: 'No image path or base64 provided' };
      }
      
      results.push(result);
    }

    return results;
  }

  /**
   * Get default analysis question
   */
  private getDefaultQuestion(): string {
    return `Analyze this image in detail. Provide:
1. A comprehensive description of what you see
2. List of main objects/elements
3. Any visible text (OCR)
4. Dominant colors
5. Composition and layout description
6. Any notable features or patterns

Format your response as a structured analysis.`;
  }

  /**
   * Parse the model's response into structured data
   */
  private parseAnalysisResponse(content: string): ImageAnalysisResult {
    // Extract objects
    const objects = this.extractSection(content, /(?:objects?|elements?|items?)[\s:]*([\s\S]*?)(?=\n\n|\n(?=\d\.|$))/i);
    
    // Extract text
    const text = this.extractSection(content, /(?:text|ocr|labels?)[\s:]*([\s\S]*?)(?=\n\n|\n(?=\d\.|$))/i);
    
    // Extract colors
    const colors = this.extractSection(content, /(?:colors?|dominant)[\s:]*([\s\S]*?)(?=\n\n|\n(?=\d\.|$))/i);

    return {
      success: true,
      description: content,
      objects: objects ? this.parseList(objects) : [],
      text: text ? this.parseList(text) : [],
      colors: colors ? this.parseList(colors) : [],
    };
  }

  /**
   * Extract a section from the response
   */
  private extractSection(content: string, pattern: RegExp): string | null {
    const match = content.match(pattern);
    return match?.[1]?.trim() ?? null;
  }

  /**
   * Parse a comma/newline separated list
   */
  private parseList(text: string): string[] {
    return text
      .split(/[,;\n]/)
      .map(item => item.replace(/^[-•*]\s*/, '').trim())
      .filter(item => item.length > 0 && item.length < 100);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let analyzerInstance: ImageAnalyzer | null = null;

export function getImageAnalyzer(): ImageAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new ImageAnalyzer();
  }
  return analyzerInstance;
}

// ============================================================================
// Tool Definition
// ============================================================================

const imageAnalysisInputSchema = z.object({
  path: z.string().optional().describe('Path to the image file'),
  image: z.string().optional().describe('Base64-encoded image data'),
  mime_type: z.string().optional().describe('MIME type of the image (default: image/png)'),
  question: z.string().optional().describe('Specific question about the image'),
  model: z.string().optional().describe('Vision model to use (e.g., gpt-4o, claude-3-opus)'),
}).refine(
  (data) => data.path || data.image,
  { message: 'Either path or image (base64) must be provided' }
);

export const imageAnalyzerTool = buildTool({
  name: 'analyze_image',
  description: 'Analyze an image using vision AI models. Supports file paths and base64 input. Ask questions about image content, objects, text, colors, and composition.',
  inputSchema: imageAnalysisInputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  requiresUserInteraction: false,

  async call(args, ctx): Promise<ToolResult<string>> {
    const { path: imagePath, image, mime_type, question, model } = args;
    
    try {
      const analyzer = getImageAnalyzer();
      
      let result: ImageAnalysisResult;
      
      if (imagePath) {
        // Analyze from file path
        result = await analyzer.analyzeFromFile(imagePath, {
          question,
          model,
        });
      } else if (image) {
        // Analyze from base64
        result = await analyzer.analyzeFromBase64(image, mime_type, {
          question,
          model,
        });
      } else {
        return { data: 'Error: Either path or image (base64) must be provided' };
      }
      
      if (!result.success) {
        return { data: `Image analysis failed: ${result.error}` };
      }
      
      // Format the output
      let output = `## Image Analysis\n\n${result.description}`;
      
      if (result.objects && result.objects.length > 0) {
        output += `\n\n### Objects Detected\n${result.objects.map(o => `- ${o}`).join('\n')}`;
      }
      
      if (result.text && result.text.length > 0) {
        output += `\n\n### Text Found (OCR)\n${result.text.map(t => `- ${t}`).join('\n')}`;
      }
      
      if (result.colors && result.colors.length > 0) {
        output += `\n\n### Dominant Colors\n${result.colors.map(c => `- ${c}`).join('\n')}`;
      }
      
      return { data: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[image-analyzer] Tool failed', { error: message });
      return { data: `Image analysis error: ${message}` };
    }
  },

  userFacingName: () => 'Analyze Image',

  renderToolUseMessage: (input) => {
    const imagePath = typeof input.path === 'string' ? input.path : undefined;
    const question = typeof input.question === 'string' ? input.question : undefined;
    
    if (imagePath) {
      const filename = path.basename(imagePath);
      return `Analyzing ${filename}${question ? `: ${question.slice(0, 50)}` : ''}`;
    }
    return `Analyzing pasted image${question ? `: ${question.slice(0, 50)}` : ''}`;
  },

  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a file is a supported image format
 */
export function isSupportedImageFormat(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext in SUPPORTED_FORMATS;
}

/**
 * Get MIME type from file path
 */
export function getImageMimeType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_FORMATS[ext];
}

/**
 * Get list of supported image formats
 */
export function getSupportedFormats(): string[] {
  return Object.keys(SUPPORTED_FORMATS);
}
