import { EventEmitter } from 'events';
import logger from '@/utils/logger.js';

export interface CleanupItem {
  id: string;
  description?: string;
  handler: () => Promise<void> | void;
  priority: number;
  timeout?: number;
  tags: string[];
}

class CleanupRegistry extends EventEmitter {
  private items: Map<string, CleanupItem> = new Map();
  private executing = false;

  register(
    id: string,
    handler: () => Promise<void> | void,
    options: {
      description?: string;
      priority?: number;
      timeout?: number;
      tags?: string[];
    } = {}
  ): void {
    const { description, priority = 0, timeout, tags = [] } = options;

    if (this.items.has(id)) {
      logger.warn(`Cleanup item ${id} already registered`);
      return;
    }

    const item: CleanupItem = {
      id,
      description: description || id,
      handler,
      priority,
      timeout,
      tags,
    };

    this.items.set(id, item);
    logger.debug(`Registered cleanup item: ${id} (priority ${priority})`);
  }

  unregister(id: string): boolean {
    return this.items.delete(id);
  }

  async cleanup(options?: { tags?: string[]; timeout?: number }): Promise<void> {
    if (this.executing) {
      logger.warn('Cleanup already in progress');
      return;
    }

    this.executing = true;
    const { tags, timeout = 30000 } = options || {};

    const items = Array.from(this.items.values())
      .filter((item) => !tags || tags.length === 0 || item.tags.some((t) => tags.includes(t)))
      .sort((a, b) => b.priority - a.priority);

    logger.info(`Running cleanup for ${items.length} items`);

    for (const item of items) {
      try {
        logger.debug(`Executing cleanup: ${item.id}`);

        const itemTimeout = item.timeout || timeout;
        const promise = Promise.resolve(item.handler());

        if (itemTimeout > 0) {
          await Promise.race([
            promise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Cleanup ${item.id} timed out`)), itemTimeout)
            ),
          ]);
        } else {
          await promise;
        }

        this.items.delete(item.id);
        logger.debug(`Cleanup completed: ${item.id}`);
      } catch (err) {
        logger.error(`Cleanup failed for ${item.id}:`, err);
        this.emit('cleanupError', { id: item.id, error: err });
      }
    }

    this.executing = false;
    this.emit('cleanupComplete');
  }

  getItems(): CleanupItem[] {
    return Array.from(this.items.values());
  }

  getItem(id: string): CleanupItem | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }
}

export const cleanupRegistry = new CleanupRegistry();

export function registerCleanup(
  id: string,
  handler: () => Promise<void> | void,
  options?: {
    description?: string;
    priority?: number;
    timeout?: number;
    tags?: string[];
  }
): void {
  cleanupRegistry.register(id, handler, options);
}

export function unregisterCleanup(id: string): boolean {
  return cleanupRegistry.unregister(id);
}

export async function runCleanup(options?: { tags?: string[]; timeout?: number }): Promise<void> {
  await cleanupRegistry.cleanup(options);
}

export function getCleanupItems(options?: { tags?: string[] }): CleanupItem[] {
  const all = cleanupRegistry.getItems();
  if (!options?.tags || options.tags.length === 0) {
    return all;
  }
  return all.filter((item) => item.tags.some((t) => options.tags!.includes(t)));
}