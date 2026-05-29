import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { EventEmitter } from 'events';

export class InProcessTransport implements Transport {
  private handler: ((message: unknown) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private connected = false;
  private messageQueue: unknown[] = [];

  readonly ready: Promise<void>;

  constructor() {
    this.ready = Promise.resolve();
  }

  async start(): Promise<void> {
    this.connected = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.handler) {
        this.handler(message);
      }
    }
  }

  async send(message: unknown): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }

    if (this.handler) {
      this.handler(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  async close(): Promise<void> {
    this.connected = false;
    this.messageQueue = [];

    if (this.closeHandler) {
      this.closeHandler();
    }
  }

  onmessage = (handler: (message: unknown) => void): void => {
    this.handler = handler;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        handler(message);
      }
    }
  };

  onerror = (handler: (error: Error) => void): void => {
    this.errorHandler = handler;
  };

  onclose = (handler: () => void): void => {
    this.closeHandler = handler;
  };

  get isConnected(): boolean {
    return this.connected;
  }

  sendNotification(method: string, params?: unknown): void {
    this.send({
      jsonrpc: '2.0',
      method,
      params: params || {},
    });
  }

  sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = `inproc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Request ${method} (${id}) timed out`));
      }, 30000);

      this.send({
        jsonrpc: '2.0',
        id,
        method,
        params: params || {},
      });

      const originalHandler = this.handler;
      this.handler = (message: unknown) => {
        const msg = message as { id?: string; result?: T; error?: { code: number; message: string } };

        if (msg.id === id) {
          clearTimeout(timeout);
          this.handler = originalHandler;

          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result as T);
          }
        } else {
          originalHandler?.(message);
        }
      };
    });
  }
}

export class SdkControlTransport implements Transport {
  private handler: ((message: unknown) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private connected = false;
  private sdk: unknown;
  private messageQueue: unknown[] = [];

  readonly ready: Promise<void>;

  constructor(sdk: unknown) {
    this.sdk = sdk;
    this.ready = Promise.resolve();
  }

  async start(): Promise<void> {
    this.connected = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.handler) {
        this.handler(message);
      }
    }
  }

  async send(message: unknown): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }

    if (this.handler) {
      this.handler(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  async close(): Promise<void> {
    this.connected = false;
    this.messageQueue = [];

    if (this.closeHandler) {
      this.closeHandler();
    }
  }

  onmessage = (handler: (message: unknown) => void): void => {
    this.handler = handler;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        handler(message);
      }
    }
  };

  onerror = (handler: (error: Error) => void): void => {
    this.errorHandler = handler;
  };

  onclose = (handler: () => void): void => {
    this.closeHandler = handler;
  };

  get isConnected(): boolean {
    return this.connected;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (typeof this.sdk !== 'object' || this.sdk === null) {
      throw new Error('SDK not available');
    }

    const sdkWithTools = this.sdk as { tools?: { call?: (name: string, args: Record<string, unknown>) => Promise<unknown> } };

    if (sdkWithTools.tools?.call) {
      return sdkWithTools.tools.call(name, args);
    }

    throw new Error(`Tool ${name} not found in SDK`);
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    if (typeof this.sdk !== 'object' || this.sdk === null) {
      return [];
    }

    const sdkWithTools = this.sdk as { tools?: { list?: () => Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> } };

    if (sdkWithTools.tools?.list) {
      return sdkWithTools.tools.list();
    }

    return [];
  }
}

export class StdioTransport implements Transport {
  private handler: ((message: unknown) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private connected = false;
  private process: import('child_process').ChildProcess | null = null;

  readonly ready: Promise<void>;

  constructor(process: import('child_process').ChildProcess) {
    this.process = process;
    this.ready = Promise.resolve();

    process.stdout?.on('data', (data: Buffer) => {
      try {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          const message = JSON.parse(line);
          if (this.handler) {
            this.handler(message);
          }
        }
      } catch {
      }
    });

    process.stderr?.on('data', (data: Buffer) => {
      if (this.errorHandler) {
        this.errorHandler(new Error(data.toString()));
      }
    });

    process.on('exit', () => {
      this.connected = false;
      if (this.closeHandler) {
        this.closeHandler();
      }
    });
  }

  async start(): Promise<void> {
    this.connected = true;
  }

  async send(message: unknown): Promise<void> {
    if (!this.connected || !this.process?.stdin) {
      throw new Error('Transport not connected');
    }

    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  async close(): Promise<void> {
    this.connected = false;

    if (this.process && !this.process.killed) {
      this.process.kill();
    }

    if (this.closeHandler) {
      this.closeHandler();
    }
  }

  onmessage = (handler: (message: unknown) => void): void => {
    this.handler = handler;
  };

  onerror = (handler: (error: Error) => void): void => {
    this.errorHandler = handler;
  };

  onclose = (handler: () => void): void => {
    this.closeHandler = handler;
  };

  get isConnected(): boolean {
    return this.connected;
  }
}