import { EventEmitter } from 'events';
import logger from '@/utils/logger.js';

export type CommandLifecyclePhase = 'parsing' | 'validation' | 'execution' | 'completion' | 'error';

export interface CommandLifecycleEvent {
  command: string;
  phase: CommandLifecyclePhase;
  timestamp: string;
  duration?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

class CommandLifecycleManager extends EventEmitter {
  private activeCommands: Map<string, CommandLifecycleEvent> = new Map();

  start(command: string, metadata?: Record<string, unknown>): string {
    const event: CommandLifecycleEvent = {
      command,
      phase: 'parsing',
      timestamp: new Date().toISOString(),
      metadata,
    };

    this.activeCommands.set(command, event);
    this.emit('start', event);

    logger.debug(`Command lifecycle started: ${command}`);

    return command;
  }

  transition(command: string, phase: CommandLifecyclePhase): void {
    const event = this.activeCommands.get(command);

    if (!event) {
      logger.warn(`Command lifecycle event not found: ${command}`);
      return;
    }

    const startTime = new Date(event.timestamp).getTime();
    const duration = Date.now() - startTime;

    event.phase = phase;
    event.duration = duration;

    this.emit('transition', event);

    logger.debug(`Command lifecycle transition: ${command} -> ${phase} (${duration}ms)`);
  }

  complete(command: string, metadata?: Record<string, unknown>): void {
    const event = this.activeCommands.get(command);

    if (!event) {
      logger.warn(`Command lifecycle event not found: ${command}`);
      return;
    }

    const startTime = new Date(event.timestamp).getTime();
    const duration = Date.now() - startTime;

    event.phase = 'completion';
    event.duration = duration;

    if (metadata) {
      event.metadata = { ...event.metadata, ...metadata };
    }

    this.emit('complete', event);

    logger.info(`Command lifecycle completed: ${command} (${duration}ms)`);

    this.activeCommands.delete(command);
  }

  error(command: string, error: string): void {
    const event = this.activeCommands.get(command);

    if (!event) {
      logger.warn(`Command lifecycle event not found: ${command}`);
      return;
    }

    const startTime = new Date(event.timestamp).getTime();
    const duration = Date.now() - startTime;

    event.phase = 'error';
    event.duration = duration;
    event.error = error;

    this.emit('error', event);

    logger.error(`Command lifecycle error: ${command} - ${error} (${duration}ms)`);

    this.activeCommands.delete(command);
  }

  getActiveCommand(command: string): CommandLifecycleEvent | null {
    return this.activeCommands.get(command) || null;
  }

  getAllActiveCommands(): CommandLifecycleEvent[] {
    return Array.from(this.activeCommands.values());
  }

  getActiveCount(): number {
    return this.activeCommands.size;
  }

  isActive(command: string): boolean {
    return this.activeCommands.has(command);
  }

  waitForCompletion(command: string, timeout = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.off('complete', onComplete);
        this.off('error', onError);
        reject(new Error(`Command lifecycle timeout: ${command}`));
      }, timeout);

      const onComplete = (event: CommandLifecycleEvent) => {
        if (event.command === command) {
          clearTimeout(timeoutId);
          this.off('complete', onComplete);
          this.off('error', onError);
          resolve();
        }
      };

      const onError = (event: CommandLifecycleEvent) => {
        if (event.command === command) {
          clearTimeout(timeoutId);
          this.off('complete', onComplete);
          this.off('error', onError);
          reject(new Error(event.error || 'Command lifecycle error'));
        }
      };

      this.on('complete', onComplete);
      this.on('error', onError);
    });
  }

  getStats(): {
    active: number;
    byPhase: Record<CommandLifecyclePhase, number>;
    avgDuration: number;
  } {
    const byPhase: Record<CommandLifecyclePhase, number> = {
      parsing: 0,
      validation: 0,
      execution: 0,
      completion: 0,
      error: 0,
    };

    let totalDuration = 0;
    let completedCount = 0;

    for (const event of this.activeCommands.values()) {
      byPhase[event.phase]++;
    }

    return {
      active: this.activeCommands.size,
      byPhase,
      avgDuration: completedCount > 0 ? totalDuration / completedCount : 0,
    };
  }
}

export const commandLifecycle = new CommandLifecycleManager();

export function notifyCommandLifecycle(
  command: string,
  phase: CommandLifecyclePhase,
  metadata?: Record<string, unknown>
): void {
  commandLifecycle.transition(command, phase);
}

export function onCommandComplete(
  command: string,
  metadata?: Record<string, unknown>
): void {
  commandLifecycle.complete(command, metadata);
}

export function onCommandError(command: string, error: string): void {
  commandLifecycle.error(command, error);
}

export function trackCommand(command: string, metadata?: Record<string, unknown>): string {
  return commandLifecycle.start(command, metadata);
}

export { CommandLifecycleManager };