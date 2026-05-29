/**
 * Programmatic Agent Messaging — session.send() / session.sendAndWait().
 *
 * Matches Copilot CLI's programmatic messaging for extensions:
 * - send() — fire-and-forget message to agent
 * - sendAndWait() — request-response pattern (blocks until agent responds)
 *
 * Used by extensions and automation scripts to interact with the agent.
 */
import { EventEmitter } from "events";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendMessage {
  /** Message content */
  prompt: string;
  /** Optional context to inject */
  context?: string;
  /** Optional system prompt override */
  systemPrompt?: string;
  /** Optional timeout for sendAndWait (ms) */
  timeout?: number;
}

export interface AgentResponse {
  /** Response ID */
  id: string;
  /** Response content */
  content: string;
  /** Whether the response is complete */
  complete: boolean;
  /** Tool calls made during response */
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  /** Duration in ms */
  durationMs?: number;
}

type MessageHandler = (message: SendMessage) => Promise<AgentResponse>;
type StreamHandler = (chunk: string, done: boolean) => void;

// ---------------------------------------------------------------------------
// Agent Messenger
// ---------------------------------------------------------------------------

export class AgentMessenger extends EventEmitter {
  private messageHandler: MessageHandler | null = null;
  private pendingRequests = new Map<string, {
    message: SendMessage;
    resolve: (response: AgentResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    streamHandler?: StreamHandler;
  }>();

  /**
   * Register the handler that processes messages.
   * This should be called by the main agent loop.
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Send a message to the agent (fire-and-forget).
   * The agent will process it asynchronously.
   */
  send(message: SendMessage): void {
    if (!this.messageHandler) {
      logger.warn("[agent-messenger] No message handler registered");
      return;
    }

    // Fire and forget
    this.messageHandler(message).catch((err) => {
      logger.error("[agent-messenger] send() error", { error: String(err) });
    });
  }

  /**
   * Send a message and wait for the agent's response.
   * Returns the complete agent response.
   */
  async sendAndWait(
    message: SendMessage,
    options: { timeout?: number; onStream?: StreamHandler } = {}
  ): Promise<AgentResponse> {
    if (!this.messageHandler) {
      throw new Error("No message handler registered");
    }

    const id = crypto.randomUUID();
    const timeout = options.timeout ?? message.timeout ?? 60000;

    return new Promise<AgentResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Agent response timeout (${timeout}ms)`));
      }, timeout);

      this.pendingRequests.set(id, {
        message,
        resolve: (response) => {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(error);
        },
        timer,
        streamHandler: options.onStream,
      });

      // Process the message
      this.messageHandler!(message)
        .then((response) => {
          const pending = this.pendingRequests.get(id);
          if (pending) {
            pending.resolve(response);
          }
        })
        .catch((err) => {
          const pending = this.pendingRequests.get(id);
          if (pending) {
            pending.reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
    });
  }

  /**
   * Send a message with streaming response.
   * Calls onChunk for each chunk and returns the final response.
   */
  async sendWithStream(
    message: SendMessage,
    onChunk: StreamHandler,
    options: { timeout?: number } = {}
  ): Promise<AgentResponse> {
    return this.sendAndWait(message, {
      timeout: options.timeout,
      onStream: onChunk,
    });
  }

  /**
   * Get count of pending requests.
   */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Cancel all pending requests.
   */
  cancelAll(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Cancelled"));
    }
    this.pendingRequests.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalMessenger: AgentMessenger | null = null;

/**
 * Get the global agent messenger instance.
 */
export function getAgentMessenger(): AgentMessenger {
  if (!globalMessenger) {
    globalMessenger = new AgentMessenger();
  }
  return globalMessenger;
}

/**
 * Reset the global messenger (for testing).
 */
export function resetAgentMessenger(): void {
  if (globalMessenger) {
    globalMessenger.cancelAll();
    globalMessenger = null;
  }
}
