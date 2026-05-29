import { EventEmitter } from 'events';
import logger from '@/utils/logger.js';

export type ShutdownPhase = 'init' | 'pre' | 'main' | 'post' | 'force' | 'complete';

export interface ShutdownOptions {
  timeout?: number;
  forceOnTimeout?: boolean;
  emitEvents?: boolean;
}

export interface ShutdownListener {
  id: string;
  phase: ShutdownPhase;
  handler: () => Promise<void> | void;
  priority: number;
  timeout?: number;
}

class ShutdownManager extends EventEmitter {
  private listeners: Map<string, ShutdownListener> = new Map();
  private isShuttingDown = false;
  private shutdownPhase: ShutdownPhase = 'init';
  private shutdownStartTime = 0;
  private defaultTimeout = 30000;

  constructor() {
    super();
    this.setupProcessHandlers();
  }

  private setupProcessHandlers(): void {
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGHUP', () => this.shutdown('SIGHUP'));
    process.on('uncaughtException', (err) => this.handleUncaughtException(err));
    process.on('unhandledRejection', (reason) => this.handleUnhandledRejection(reason));
  }

  register(
    id: string,
    handler: () => Promise<void> | void,
    phase: ShutdownPhase = 'main',
    priority = 0,
    timeout?: number
  ): void {
    const listener: ShutdownListener = { id, handler, phase, priority, timeout };

    if (this.listeners.has(id)) {
      logger.warn(`Shutdown listener ${id} already registered, replacing`);
    }

    this.listeners.set(id, listener);
    logger.debug(`Registered shutdown listener: ${id} (${phase}, priority ${priority})`);
  }

  unregister(id: string): boolean {
    const removed = this.listeners.delete(id);
    if (removed) {
      logger.debug(`Unregistered shutdown listener: ${id}`);
    }
    return removed;
  }

  async shutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    this.shutdownStartTime = Date.now();
    this.emit('shutdownStart', { signal, phase: this.shutdownPhase });

    logger.info(`Shutting down (signal: ${signal || 'none'})...`);

    try {
      await this.executePhase('pre');
      await this.executePhase('main');
      await this.executePhase('post');
      this.shutdownPhase = 'complete';
      this.emit('shutdownComplete', { duration: Date.now() - this.shutdownStartTime });
    } catch (err) {
      logger.error('Shutdown error:', err);
      this.emit('shutdownError', err);
    } finally {
      this.isShuttingDown = false;
    }
  }

  private async executePhase(phase: ShutdownPhase): Promise<void> {
    this.shutdownPhase = phase;
    this.emit('phaseStart', { phase });

    const phaseListeners = Array.from(this.listeners.values())
      .filter((l) => l.phase === phase)
      .sort((a, b) => b.priority - a.priority);

    for (const listener of phaseListeners) {
      try {
        logger.debug(`Executing shutdown handler: ${listener.id}`);

        const timeout = listener.timeout || this.defaultTimeout;
        const promise = Promise.resolve(listener.handler());

        if (timeout > 0) {
          await Promise.race([
            promise,
            this.createTimeoutPromise(listener.id, timeout),
          ]);
        } else {
          await promise;
        }

        logger.debug(`Shutdown handler completed: ${listener.id}`);
      } catch (err) {
        logger.error(`Shutdown handler failed: ${listener.id}`, err);
        this.emit('handlerError', { listener: listener.id, error: err });
      }
    }

    this.emit('phaseEnd', { phase });
  }

  private createTimeoutPromise(id: string, timeout: number): Promise<void> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Shutdown handler ${id} timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  private async handleUncaughtException(err: Error): Promise<void> {
    logger.error('Uncaught exception:', err);
    this.emit('uncaughtException', err);
    await this.shutdown('uncaughtException');
  }

  private async handleUnhandledRejection(reason: unknown): Promise<void> {
    logger.error('Unhandled rejection:', reason);
    this.emit('unhandledRejection', reason);
  }

  getShutdownStatus(): {
    isShuttingDown: boolean;
    phase: ShutdownPhase;
    duration: number;
    listenersCount: number;
  } {
    return {
      isShuttingDown: this.isShuttingDown,
      phase: this.shutdownPhase,
      duration: this.isShuttingDown ? Date.now() - this.shutdownStartTime : 0,
      listenersCount: this.listeners.size,
    };
  }

  getListeners(phase?: ShutdownPhase): ShutdownListener[] {
    const all = Array.from(this.listeners.values());
    if (phase) {
      return all.filter((l) => l.phase === phase);
    }
    return all;
  }

  forceShutdown(code = 1): void {
    logger.warn('Force shutting down...');
    this.shutdownPhase = 'force';
    process.exit(code);
  }
}

export const shutdownManager = new ShutdownManager();

export function registerShutdownHandler(
  id: string,
  handler: () => Promise<void> | void,
  phase: ShutdownPhase = 'main',
  priority = 0
): void {
  shutdownManager.register(id, handler, phase, priority);
}

export function unregisterShutdownHandler(id: string): boolean {
  return shutdownManager.unregister(id);
}

export async function gracefulShutdown(options?: ShutdownOptions): Promise<void> {
  await shutdownManager.shutdown();
}

export function forceShutdown(code = 1): void {
  shutdownManager.forceShutdown(code);
}