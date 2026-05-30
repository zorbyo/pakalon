/**
 * Stream Optimization for Pakalon CLI
 *
 * Provides buffered streaming for provider responses.
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamConfig {
  bufferSize?: number;
  flushIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Default Configurations
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: StreamConfig = {
  bufferSize: 10,
  flushIntervalMs: 100,
};

// ---------------------------------------------------------------------------
// Stream Optimizer
// ---------------------------------------------------------------------------

export class StreamOptimizer {
  private buffer: string[] = [];
  private config: StreamConfig;

  constructor(config: StreamConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a stream with buffering
   */
  async *processStream(
    stream: AsyncIterable<string>,
    bufferSize?: number
  ): AsyncGenerator<string, void, unknown> {
    const bufSize = bufferSize || this.config.bufferSize || 10;
    const buffer: string[] = [];

    for await (const chunk of stream) {
      buffer.push(chunk);

      if (buffer.length >= bufSize) {
        yield buffer.join("");
        buffer.length = 0;
      }
    }

    // Flush remaining
    if (buffer.length > 0) {
      yield buffer.join("");
    }
  }

  /**
   * Batch stream chunks with timeout
   */
  async *batchStream(
    stream: AsyncIterable<string>,
    maxBatchSize: number = 50,
    timeoutMs: number = 100
  ): AsyncGenerator<string, void, unknown> {
    const batch: string[] = [];
    let lastFlush = Date.now();

    for await (const chunk of stream) {
      batch.push(chunk);
      const now = Date.now();

      const shouldFlush =
        batch.length >= maxBatchSize ||
        now - lastFlush >= timeoutMs;

      if (shouldFlush && batch.length > 0) {
        yield batch.join("");
        batch.length = 0;
        lastFlush = now;
      }
    }

    if (batch.length > 0) {
      yield batch.join("");
    }
  }

  /**
   * Add chunk to buffer
   */
  addChunk(chunk: string): void {
    this.buffer.push(chunk);
  }

  /**
   * Check if buffer should be flushed
   */
  shouldFlush(): boolean {
    return this.buffer.length >= (this.config.bufferSize || 10);
  }

  /**
   * Flush buffer and return combined string
   */
  flush(): string {
    if (this.buffer.length === 0) {
      return "";
    }

    const combined = this.buffer.join("");
    this.buffer = [];
    return combined;
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.buffer = [];
  }
}

// Global instance
export const streamOptimizer = new StreamOptimizer();

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Process stream with buffering
 */
export async function* processStream(
  stream: AsyncIterable<string>,
  bufferSize?: number
): AsyncGenerator<string, void, unknown> {
  yield* streamOptimizer.processStream(stream, bufferSize);
}

/**
 * Batch stream chunks
 */
export async function* batchStream(
  stream: AsyncIterable<string>,
  maxBatchSize?: number,
  timeoutMs?: number
): AsyncGenerator<string, void, unknown> {
  yield* streamOptimizer.batchStream(stream, maxBatchSize, timeoutMs);
}
