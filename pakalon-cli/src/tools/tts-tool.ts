/**
 * TTS Tool
 * 
 * Text-to-speech via xAI Grok Voice.
 * Based on OMP's tts tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

type TtsCodec = 'mp3' | 'wav';

interface TtsOptions {
  text: string;
  voiceId?: string;
  language?: string;
  outputPath: string;
  sampleRate?: number;
  bitRate?: number;
}

// ============================================================================
// TTS Engine
// ============================================================================

class TTSEngine {
  private apiKey: string | undefined;
  private defaultVoice: string;
  private defaultLanguage: string;

  constructor() {
    this.apiKey = process.env.XAI_API_KEY;
    this.defaultVoice = 'eve';
    this.defaultLanguage = 'en';
  }

  /**
   * Synthesize speech
   */
  async synthesize(options: TtsOptions): Promise<{
    success: boolean;
    outputPath?: string;
    codec?: TtsCodec;
    duration?: number;
    error?: string;
  }> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'xAI API key not configured',
      };
    }

    try {
      const voiceId = options.voiceId || this.defaultVoice;
      const language = options.language || this.defaultLanguage;
      const codec: TtsCodec = options.outputPath.endsWith('.wav') ? 'wav' : 'mp3';

      // Call xAI TTS API
      const response = await fetch('https://api.x.ai/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-voice',
          input: options.text,
          voice: voiceId,
          language,
          response_format: codec,
          speed: 1.0,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`xAI API error: ${errorText}`);
      }

      // Get audio data
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      
      // Write to file
      await fs.writeFile(options.outputPath, audioBuffer);

      logger.debug('[tts] Synthesized speech', {
        voiceId,
        language,
        codec,
        outputPath: options.outputPath,
        bytes: audioBuffer.length,
      });

      return {
        success: true,
        outputPath: options.outputPath,
        codec,
        duration: Math.ceil(audioBuffer.length / (options.bitRate || 128000) * 8),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[tts] Synthesis failed', { error: message });
      return {
        success: false,
        error: message,
      };
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let engineInstance: TTSEngine | null = null;

function getTTSEngine(): TTSEngine {
  if (!engineInstance) {
    engineInstance = new TTSEngine();
  }
  return engineInstance;
}

// ============================================================================
// TTS Tool
// ============================================================================

const ttsInputSchema = z.object({
  text: z.string().min(1).max(15000).describe('Text to synthesize'),
  voice_id: z.string().optional().default('eve').describe('Voice ID'),
  language: z.string().optional().default('en').describe('Language code'),
  output_path: z.string().describe('Output file path'),
  sample_rate: z.number().optional().describe('Sample rate'),
  bit_rate: z.number().optional().describe('Bit rate'),
});

export const ttsTool = buildTool({
  name: 'tts',
  description: 'Synthesize speech from text using xAI Grok Voice.',
  inputSchema: ttsInputSchema,
  isReadOnly: false,
  isConcurrencySafe: true,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { text, voice_id, language, output_path, sample_rate, bit_rate } = args;
    
    try {
      const engine = getTTSEngine();
      const result = await engine.synthesize({
        text,
        voiceId: voice_id,
        language,
        outputPath: output_path,
        sampleRate: sample_rate,
        bitRate: bit_rate,
      });
      
      if (result.success) {
        let output = `Speech synthesized successfully`;
        output += `\nOutput: ${result.outputPath}`;
        output += `\nVoice: ${voice_id}`;
        output += `\nLanguage: ${language}`;
        output += `\nCodec: ${result.codec}`;
        return { data: output };
      } else {
        return { data: `TTS failed: ${result.error}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[tts] Tool failed', { error: message });
      return { data: `TTS failed: ${message}` };
    }
  },
  
  userFacingName: () => 'TTS',
  
  renderToolUseMessage: (input) => {
    const text = typeof input.text === 'string' ? input.text : '';
    const preview = text.length > 50 ? text.slice(0, 50) + '...' : text;
    return `TTS: ${preview}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
