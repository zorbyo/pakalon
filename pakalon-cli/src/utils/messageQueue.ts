import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '@/utils/logger.js';

export interface QueuedCommand {
  id: string;
  command: string;
  priority: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
  result?: unknown;
  error?: string;
}

export interface MessageQueueConfig {
  maxSize: number;
  defaultPriority: number;
  autoExecute: boolean;
}

const DEFAULT_CONFIG: MessageQueueConfig = {
  maxSize: 100,
  defaultPriority: 0,
  autoExecute: false,
};

class MessageQueue extends EventEmitter {
  private queue: QueuedCommand[] = [];
  private executing = false;
  private config: MessageQueueConfig;

  constructor(config: Partial<MessageQueueConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  enqueue(
    command: string,
    options: {
      priority?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): string | null {
    if (this.queue.length >= this.config.maxSize) {
      logger.warn('Message queue is full');
      return null;
    }

    const id = uuidv4();
    const cmd: QueuedCommand = {
      id,
      command,
      priority: options.priority ?? this.config.defaultPriority,
      timestamp: new Date().toISOString(),
      metadata: options.metadata,
      status: 'pending',
    };

    this.queue.push(cmd);
    this.queue.sort((a, b) => b.priority - a.priority);

    this.emit('enqueue', cmd);

    if (this.config.autoExecute && !this.executing) {
      this.executeNext();
    }

    return id;
  }

  dequeue(id: string): QueuedCommand | null {
    const index = this.queue.findIndex((c) => c.id === id);

    if (index === -1) {
      return null;
    }

    const [command] = this.queue.splice(index, 1);
    this.emit('dequeue', command);

    return command;
  }

  cancel(id: string): boolean {
    const cmd = this.queue.find((c) => c.id === id);

    if (!cmd) {
      return false;
    }

    cmd.status = 'cancelled';
    this.emit('cancel', cmd);

    return true;
  }

  peek(): QueuedCommand | null {
    return this.queue[0] || null;
  }

  get(id: string): QueuedCommand | undefined {
    return this.queue.find((c) => c.id === id);
  }

  getAll(): QueuedCommand[] {
    return [...this.queue];
  }

  getByStatus(status: QueuedCommand['status']): QueuedCommand[] {
    return this.queue.filter((c) => c.status === status);
  }

  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    this.emit('clear', count);
  }

  size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  updatePriority(id: string, priority: number): boolean {
    const cmd = this.queue.find((c) => c.id === id);

    if (!cmd) {
      return false;
    }

    cmd.priority = priority;
    this.queue.sort((a, b) => b.priority - a.priority);

    this.emit('priorityChange', cmd);

    return true;
  }

  private async executeNext(): Promise<void> {
    if (this.executing || this.queue.length === 0) {
      return;
    }

    this.executing = true;

    const cmd = this.queue.find((c) => c.status === 'pending');

    if (!cmd) {
      this.executing = false;
      return;
    }

    cmd.status = 'executing';
    this.emit('execute', cmd);

    this.emit('execute', cmd);
  }

  complete(id: string, result: unknown): boolean {
    const cmd = this.queue.find((c) => c.id === id);

    if (!cmd) {
      return false;
    }

    cmd.status = 'completed';
    cmd.result = result;
    this.emit('complete', cmd);

    this.executing = false;
    this.executeNext();

    return true;
  }

  fail(id: string, error: string): boolean {
    const cmd = this.queue.find((c) => c.id === id);

    if (!cmd) {
      return false;
    }

    cmd.status = 'failed';
    cmd.error = error;
    this.emit('fail', cmd);

    this.executing = false;
    this.executeNext();

    return true;
  }

  getStats(): {
    total: number;
    pending: number;
    executing: number;
    completed: number;
    failed: number;
  } {
    return {
      total: this.queue.length,
      pending: this.queue.filter((c) => c.status === 'pending').length,
      executing: this.queue.filter((c) => c.status === 'executing').length,
      completed: this.queue.filter((c) => c.status === 'completed').length,
      failed: this.queue.filter((c) => c.status === 'failed').length,
    };
  }
}

export const messageQueue = new MessageQueue();

export function enqueueCommand(
  command: string,
  options?: { priority?: number; metadata?: Record<string, unknown> }
): string | null {
  return messageQueue.enqueue(command, options);
}

export function dequeueCommand(id: string): QueuedCommand | null {
  return messageQueue.dequeue(id);
}

export function cancelCommand(id: string): boolean {
  return messageQueue.cancel(id);
}

export function getCommand(id: string): QueuedCommand | undefined {
  return messageQueue.get(id);
}

export function peekCommand(): QueuedCommand | null {
  return messageQueue.peek();
}

export function getCommandQueueStats() {
  return messageQueue.getStats();
}

export function clearCommandQueue(): void {
  messageQueue.clear();
}

export { MessageQueue };