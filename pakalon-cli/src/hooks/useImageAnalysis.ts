/**
 * useImageAnalysis Hook
 * 
 * Automatically analyzes images when they are pasted or drag-dropped.
 * Integrates with the existing image paste flow.
 */

import { useCallback, useRef } from 'react';
import { getImageAnalysisSkill, type PastedImage } from '@/skills/bundled/image-analysis.js';
import { useNotifications } from '@/context/notifications.js';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface UseImageAnalysisOptions {
  /** Enable automatic analysis on paste */
  enabled?: boolean;
  /** Callback when analysis completes */
  onAnalysisComplete?: (result: { image: PastedImage; analysis: string }) => void;
  /** Show notifications during analysis */
  showNotifications?: boolean;
}

export interface UseImageAnalysisResult {
  /** Analyze a pasted image */
  analyzeImage: (image: PastedImage) => Promise<void>;
  /** Analyze multiple images */
  analyzeBatch: (images: PastedImage[]) => Promise<void>;
  /** Check if analysis is in progress */
  isAnalyzing: boolean;
}

// ============================================================================
// Hook
// ============================================================================

export function useImageAnalysis(
  options?: UseImageAnalysisOptions
): UseImageAnalysisResult {
  const {
    enabled = true,
    onAnalysisComplete,
    showNotifications = true,
  } = options ?? {};

  const { addNotification } = useNotifications();
  const isAnalyzingRef = useRef(false);
  const skillRef = useRef(getImageAnalysisSkill());

  /**
   * Analyze a single pasted image
   */
  const analyzeImage = useCallback(async (image: PastedImage) => {
    if (!enabled || isAnalyzingRef.current) {
      return;
    }

    try {
      isAnalyzingRef.current = true;

      // Show analysis started notification
      if (showNotifications) {
        addNotification({
          key: 'image-analysis',
          text: `Analyzing image${image.filename ? `: ${image.filename}` : ''}...`,
          priority: 'background',
          timeoutMs: 3000,
        });
      }

      // Perform analysis
      const result = await skillRef.current.analyzePastedImage(image);

      if (result.success && result.description) {
        const analysis = skillRef.current.formatResult(result);

        // Notify completion
        if (showNotifications) {
          addNotification({
            key: 'image-analysis',
            text: `Image analysis complete${image.filename ? `: ${image.filename}` : ''}`,
            priority: 'background',
            timeoutMs: 5000,
          });
        }

        // Call callback
        onAnalysisComplete?.({ image, analysis });

        logger.debug('[useImageAnalysis] Analysis completed', {
          filename: image.filename,
          analysisLength: analysis.length,
        });
      } else {
        logger.warn('[useImageAnalysis] Analysis failed', {
          error: result.error,
        });

        if (showNotifications) {
          addNotification({
            key: 'image-analysis',
            text: `Image analysis failed: ${result.error}`,
            priority: 'background',
            timeoutMs: 5000,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[useImageAnalysis] Unexpected error', { error: message });

      if (showNotifications) {
        addNotification({
          key: 'image-analysis',
          text: `Image analysis error: ${message}`,
          priority: 'background',
          timeoutMs: 5000,
        });
      }
    } finally {
      isAnalyzingRef.current = false;
    }
  }, [enabled, onAnalysisComplete, showNotifications, addNotification]);

  /**
   * Analyze multiple images in batch
   */
  const analyzeBatch = useCallback(async (images: PastedImage[]) => {
    if (!enabled || isAnalyzingRef.current || images.length === 0) {
      return;
    }

    try {
      isAnalyzingRef.current = true;

      // Show batch analysis notification
      if (showNotifications) {
        addNotification({
          key: 'image-analysis',
          text: `Analyzing ${images.length} image(s)...`,
          priority: 'background',
          timeoutMs: 3000,
        });
      }

      // Perform batch analysis
      const results = await skillRef.current.analyzeBatch(images);

      // Process results
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      // Notify completion
      if (showNotifications) {
        const message = failed.length > 0
          ? `Analyzed ${successful.length} image(s), ${failed.length} failed`
          : `Analyzed ${successful.length} image(s) successfully`;
        
        addNotification({
          key: 'image-analysis',
          text: message,
          priority: 'background',
          timeoutMs: 5000,
        });
      }

      logger.debug('[useImageAnalysis] Batch analysis completed', {
        total: images.length,
        successful: successful.length,
        failed: failed.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[useImageAnalysis] Batch analysis error', { error: message });

      if (showNotifications) {
        addNotification({
          key: 'image-analysis',
          text: `Batch analysis error: ${message}`,
          priority: 'background',
          timeoutMs: 5000,
        });
      }
    } finally {
      isAnalyzingRef.current = false;
    }
  }, [enabled, showNotifications, addNotification]);

  return {
    analyzeImage,
    analyzeBatch,
    isAnalyzing: isAnalyzingRef.current,
  };
}

// ============================================================================
// Convenience: Create enhanced onImagePaste handler
// ============================================================================

export function createImagePasteHandler(
  originalOnImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: { width: number; height: number },
    sourcePath?: string,
  ) => void,
  options?: UseImageAnalysisOptions
) {
  const skill = getImageAnalysisSkill();
  const { addNotification } = options ?? {};

  return async (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: { width: number; height: number },
    sourcePath?: string,
  ) => {
    // Call original handler first
    originalOnImagePaste?.(base64Image, mediaType, filename, dimensions, sourcePath);

    // Auto-analyze if enabled
    if (options?.enabled !== false) {
      const image: PastedImage = {
        base64: base64Image,
        mimeType: mediaType || 'image/png',
        filename,
        sourcePath,
      };

      try {
        const result = await skill.analyzePastedImage(image);
        
        if (result.success && result.description) {
          const analysis = skill.formatResult(result);
          
          // Store analysis for later use
          // This could be integrated with the message system
          logger.debug('[image-paste-handler] Auto-analysis completed', {
            filename,
            analysisLength: analysis.length,
          });
        }
      } catch (error) {
        logger.error('[image-paste-handler] Auto-analysis failed', {
          error: String(error),
        });
      }
    }
  };
}
