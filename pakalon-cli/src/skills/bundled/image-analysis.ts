/**
 * Image Analysis Skill
 * 
 * Automatically analyzes images when they are pasted or drag-dropped.
 * Provides detailed analysis of image content, objects, text, and colors.
 * 
 * This skill can be triggered:
 * - Automatically when images are pasted
 * - Manually via /skill:image-analysis command
 * - Via the analyze_image tool
 */

import { getImageAnalyzer, type ImageAnalysisResult } from '@/tools/image-analyzer.js';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ImageAnalysisSkillOptions {
  /** Automatically analyze images when pasted */
  autoAnalyze?: boolean;
  /** Default model to use for analysis */
  defaultModel?: string;
  /** Custom questions to ask about images */
  customQuestions?: string[];
  /** Maximum images to analyze in batch */
  maxBatchSize?: number;
}

export interface PastedImage {
  base64: string;
  mimeType: string;
  filename?: string;
  sourcePath?: string;
}

// ============================================================================
// Image Analysis Skill
// ============================================================================

export class ImageAnalysisSkill {
  private options: Required<ImageAnalysisSkillOptions>;
  private analyzer;

  constructor(options?: ImageAnalysisSkillOptions) {
    this.options = {
      autoAnalyze: options?.autoAnalyze ?? true,
      defaultModel: options?.defaultModel ?? 'google/gemini-2.0-flash-001',
      customQuestions: options?.customQuestions ?? [],
      maxBatchSize: options?.maxBatchSize ?? 5,
    };
    this.analyzer = getImageAnalyzer();
  }

  /**
   * Analyze a pasted image
   */
  async analyzePastedImage(image: PastedImage): Promise<ImageAnalysisResult> {
    try {
      const question = this.buildQuestion();
      
      const result = await this.analyzer.analyzeFromBase64(
        image.base64,
        image.mimeType,
        {
          question,
          model: this.options.defaultModel,
        }
      );

      logger.debug('[image-analysis-skill] Analyzed pasted image', {
        success: result.success,
        filename: image.filename,
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[image-analysis-skill] Failed to analyze pasted image', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Analyze an image file
   */
  async analyzeImageFile(filePath: string): Promise<ImageAnalysisResult> {
    try {
      const question = this.buildQuestion();
      
      const result = await this.analyzer.analyzeFromFile(filePath, {
        question,
        model: this.options.defaultModel,
      });

      logger.debug('[image-analysis-skill] Analyzed image file', {
        success: result.success,
        filePath,
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[image-analysis-skill] Failed to analyze image file', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Analyze multiple images in batch
   */
  async analyzeBatch(images: PastedImage[]): Promise<ImageAnalysisResult[]> {
    const limitedImages = images.slice(0, this.options.maxBatchSize);
    
    return Promise.all(
      limitedImages.map(image => this.analyzePastedImage(image))
    );
  }

  /**
   * Build the analysis question
   */
  private buildQuestion(): string {
    const baseQuestion = `Analyze this image in detail. Provide:
1. A comprehensive description of what you see
2. List of main objects/elements
3. Any visible text (OCR)
4. Dominant colors
5. Composition and layout description
6. Any notable features or patterns`;

    if (this.options.customQuestions.length > 0) {
      return `${baseQuestion}\n\nAdditional questions:\n${this.options.customQuestions.map(q => `- ${q}`).join('\n')}`;
    }

    return baseQuestion;
  }

  /**
   * Format analysis result for display
   */
  formatResult(result: ImageAnalysisResult): string {
    if (!result.success) {
      return `Analysis failed: ${result.error}`;
    }

    let output = '';

    if (result.description) {
      output += result.description;
    }

    if (result.objects && result.objects.length > 0) {
      output += `\n\n**Objects:** ${result.objects.join(', ')}`;
    }

    if (result.text && result.text.length > 0) {
      output += `\n\n**Text found:** ${result.text.join(', ')}`;
    }

    if (result.colors && result.colors.length > 0) {
      output += `\n\n**Colors:** ${result.colors.join(', ')}`;
    }

    return output;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let skillInstance: ImageAnalysisSkill | null = null;

export function getImageAnalysisSkill(): ImageAnalysisSkill {
  if (!skillInstance) {
    skillInstance = new ImageAnalysisSkill();
  }
  return skillInstance;
}

// ============================================================================
// Skill Command
// ============================================================================

export const imageAnalysisSkillCommand = {
  name: 'image-analysis',
  description: 'Analyze images using vision AI. Automatically analyzes pasted/dragged images.',
  aliases: ['analyze-image', 'vision'],
  category: 'analysis',
  
  async execute(args?: string): Promise<string> {
    const skill = getImageAnalysisSkill();
    
    if (args) {
      // Analyze specific image file
      const result = await skill.analyzeImageFile(args);
      return skill.formatResult(result);
    }

    return `Image Analysis Skill Active

This skill automatically analyzes images when you paste or drag them into the terminal.

**Features:**
- Automatic analysis on paste/drag-drop
- Support for PNG, JPG, GIF, WebP, BMP formats
- Detailed analysis: objects, text, colors, composition
- Multiple vision models supported

**Usage:**
- Paste an image (Ctrl+V) → Auto-analyzed
- Drag an image file → Auto-analyzed
- Use the \`analyze_image\` tool for manual analysis

**Supported Models:**
- GPT-4o (openai/gpt-4o)
- Claude 3 Opus/Sonnet/Haiku
- Gemini Pro Vision
- Gemini 2.0 Flash

**Commands:**
- \`/skill:image-analysis\` - Show this help
- \`/skill:image-analysis <path>\` - Analyze specific image file`;
  },
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Register the image analysis skill with the skill system.
 * Called during bundled skill initialization.
 */
export function registerImageAnalysisSkill(): void {
  // The skill is registered via the command system
  // This function is called to ensure the module is loaded
  logger.debug('[image-analysis-skill] Registered');
}
