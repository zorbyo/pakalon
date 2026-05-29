/**
 * JSON-RPC 2.0 over stdio — bidirectional communication between CLI and extensions.
 *
 * Extensions run as child processes. Communication uses JSON-RPC over stdio:
 * - CLI sends requests/notifications to extension via extension's stdin
 * - Extension sends requests/notifications to CLI via extension's stdout
 *
 * Each message is a single JSON line (newline-delimited).
 */
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
} from "./types.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// JSON-RPC Error Codes
// ---------------------------------------------------------------------------

export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom
  TOOL_EXECUTION_ERROR: -32000,
  HOOK_DENY: -32001,
  TIMEOUT: -32002,
} as const;

// ---------------------------------------------------------------------------
// RPC Channel
// ---------------------------------------------------------------------------

export interface RpcChannelOptions {
  /** Child process to communicate with */
  process: ChildProcess;
  /** Channel name for logging */
  name: string;
  /** Request timeout in ms (default 30000) */
  timeout?: number;
}

type RequestHandler = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type NotificationHandler = (method: string, params?: Record<string, unknown>) => void;

export class JsonRpcChannel extends EventEmitter {
  private process: ChildProcess;
  private name: string;
  private timeout: number;
  private pendingRequests = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private requestIdCounter = 0;
  private requestHandler: RequestHandler | null = null;
  private notificationHandler: NotificationHandler | null = null;
  private buffer = "";

  constructor(options: RpcChannelOptions) {
    super();
    this.process = options.process;
    this.name = options.name;
    this.timeout = options.timeout ?? 30000;

    this.setupListeners();
  }

  private setupListeners(): void {
    // Handle stdout data (extension → CLI)
    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr (extension logs)
    this.process.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        logger.debug(`[extension:${this.name}] stderr: ${msg}`);
      }
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      logger.info(`[extension:${this.name}] Process exited`, { code, signal });
      this.rejectAllPending(new Error(`Extension ${this.name} exited (code=${code}, signal=${signal})`));
      this.emit("exit", { code, signal });
    });

    // Handle process error
    this.process.on("error", (err) => {
      logger.error(`[extension:${this.name}] Process error`, { error: err.message });
      this.rejectAllPending(err);
      this.emit("error", err);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        this.handleMessage(message);
      } catch (err) {
        logger.warn(`[extension:${this.name}] Failed to parse JSON-RPC message`, {
          line: trimmed.slice(0, 200),
          error: String(err),
        });
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    // Check if it's a response (has "result" or "error" and "id")
    if ("id" in message && ("result" in message || "error" in message)) {
      this.handleResponse(message as unknown as JsonRpcResponse);
      return;
    }

    // Check if it's a request (has "method" and "id")
    if ("method" in message && "id" in message) {
      this.handleRequest(message as unknown as JsonRpcRequest);
      return;
    }

    // Check if it's a notification (has "method" but no "id")
    if ("method" in message && !("id" in message)) {
      this.handleNotification(message as unknown as JsonRpcNotification);
      return;
    }

    logger.warn(`[extension:${this.name}] Unknown message format`, { message });
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id!);
    if (!pending) {
      logger.debug(`[extension:${this.name}] Received response for unknown request`, { id: response.id });
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id!);

    if (response.error) {
      pending.reject(new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    if (!this.requestHandler) {
      this.sendError(request.id, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, `No handler for method: ${request.method}`);
      return;
    }

    try {
      const result = await this.requestHandler(request.method, request.params);
      this.sendResponse(request.id, result);
    } catch (err) {
      this.sendError(request.id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, String(err));
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (this.notificationHandler) {
      try {
        this.notificationHandler(notification.method, notification.params);
      } catch (err) {
        logger.error(`[extension:${this.name}] Notification handler error`, { error: String(err) });
      }
    }
    this.emit("notification", notification);
  }

  // ---------------------------------------------------------------------------
  // Send Methods
  // ---------------------------------------------------------------------------

  private sendRaw(message: object): void {
    if (!this.process.stdin || this.process.stdin.destroyed) {
      logger.warn(`[extension:${this.name}] Cannot send — stdin closed`);
      return;
    }
    const json = JSON.stringify(message) + "\n";
    this.process.stdin.write(json);
  }

  /**
   * Send a request to the extension and wait for response.
   */
  async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestIdCounter;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`JSON-RPC request timeout: ${method} (${this.timeout}ms)`));
      }, this.timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.sendRaw(request);
    });
  }

  /**
   * Send a notification to the extension (fire-and-forget).
   */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.sendRaw(notification);
  }

  /**
   * Send a response to a request from the extension.
   */
  private sendResponse(id: string | number, result: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      result,
    };
    this.sendRaw(response);
  }

  /**
   * Send an error response to a request from the extension.
   */
  private sendError(id: string | number, code: number, message: string, data?: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      error: { code, message, data },
    };
    this.sendRaw(response);
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Set the handler for incoming requests from extensions.
   */
  setRequestHandler(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  /**
   * Set the handler for incoming notifications from extensions.
   */
  setNotificationHandler(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingEntries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private pendingEntries(): Array<[string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }]> {
    return Array.from(this.pendingRequests.entries());
  }

  /**
   * Close the channel and kill the extension process.
   */
  close(): void {
    this.rejectAllPending(new Error("Extension channel closed"));

    if (this.process.stdin && !this.process.stdin.destroyed) {
      // Send shutdown notification
      this.sendNotification("shutdown");
      this.process.stdin.end();
    }

    // Give the extension 2 seconds to clean up, then force kill
    setTimeout(() => {
      if (this.process.exitCode === null) {
        this.process.kill("SIGTERM");
        setTimeout(() => {
          if (this.process.exitCode === null) {
            this.process.kill("SIGKILL");
          }
        }, 2000);
      }
    }, 2000);
  }

  /**
   * Get the number of pending requests.
   */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }
}
