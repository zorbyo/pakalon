/**
 * UI Elicitation — structured form dialogs for user input.
 *
 * Matches Copilot CLI's session.rpc.ui.elicitation() pattern.
 * Extensions and tools can present structured forms with JSON Schema fields.
 *
 * Usage:
 * - Extensions call ui.elicitation via JSON-RPC
 * - TUI presents form dialog with fields
 * - User fills form and clicks action button
 * - Result returned to extension/tool
 */
import { EventEmitter } from "events";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ElicitationField {
  /** Field name (key in result.values) */
  name: string;
  /** Display label */
  label: string;
  /** Field type */
  type: "text" | "number" | "boolean" | "select" | "multiselect";
  /** Whether field is required */
  required?: boolean;
  /** Options for select/multiselect */
  options?: Array<{ value: string; label: string }>;
  /** Default value */
  default?: unknown;
  /** Help text */
  description?: string;
  /** Placeholder text for text inputs */
  placeholder?: string;
  /** Minimum/maximum for number inputs */
  min?: number;
  max?: number;
}

export interface ElicitationAction {
  /** Action identifier */
  id: string;
  /** Display label */
  label: string;
  /** Whether this is the primary/confirm action */
  primary?: boolean;
}

export interface ElicitationRequest {
  /** Unique request ID */
  id: string;
  /** Dialog title */
  title: string;
  /** Description/instructions */
  description?: string;
  /** Form fields */
  fields: ElicitationField[];
  /** Action buttons */
  actions: ElicitationAction[];
}

export interface ElicitationResult {
  /** Request ID */
  requestId: string;
  /** Which action was clicked */
  actionId: string;
  /** Field values */
  values: Record<string, unknown>;
  /** Timestamp */
  timestamp: string;
}

type ElicitationListener = (request: ElicitationRequest) => void;

// ---------------------------------------------------------------------------
// Elicitation Manager
// ---------------------------------------------------------------------------

export class ElicitationManager extends EventEmitter {
  private pending = new Map<string, {
    request: ElicitationRequest;
    resolve: (result: ElicitationResult) => void;
  }>();
  private elicitListeners: Set<ElicitationListener> = new Set();

  /**
   * Present an elicitation dialog to the user.
   * Returns a promise that resolves when the user responds.
   */
  async elicit(
    title: string,
    fields: ElicitationField[],
    options: {
      description?: string;
      actions?: ElicitationAction[];
    } = {}
  ): Promise<ElicitationResult> {
    const id = crypto.randomUUID();

    const actions = options.actions ?? [
      { id: "cancel", label: "Cancel" },
      { id: "submit", label: "Submit", primary: true },
    ];

    const request: ElicitationRequest = {
      id,
      title,
      description: options.description,
      fields,
      actions,
    };

    return new Promise<ElicitationResult>((resolve) => {
      this.pending.set(id, { request, resolve });

      // Notify listeners (TUI components)
      for (const listener of this.elicitListeners) {
        try {
          listener(request);
        } catch {
          /* ignore */
        }
      }

      this.emit("elicitation", request);
    });
  }

  /**
   * Respond to a pending elicitation (called from TUI).
   */
  respond(requestId: string, actionId: string, values: Record<string, unknown>): void {
    const handler = this.pending.get(requestId);
    if (!handler) {
      logger.warn("[elicitation] No pending request", { requestId });
      return;
    }

    this.pending.delete(requestId);

    const result: ElicitationResult = {
      requestId,
      actionId,
      values,
      timestamp: new Date().toISOString(),
    };

    handler.resolve(result);
    this.emit("elicitation-response", result);
  }

  /**
   * Cancel a pending elicitation.
   */
  cancel(requestId: string): void {
    this.respond(requestId, "cancel", {});
  }

  /**
   * Register a listener for new elicitation requests.
   */
  onElicitation(listener: ElicitationListener): () => void {
    this.elicitListeners.add(listener);
    return () => this.elicitListeners.delete(listener);
  }

  /**
   * Get the first pending request (for TUI display).
   */
  getPendingRequest(): ElicitationRequest | null {
    const first = this.pending.entries().next();
    if (first.done) return null;
    return first.value![1].request;
  }

  /**
   * Check if there are pending requests.
   */
  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Get count of pending requests.
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}

// ---------------------------------------------------------------------------
// Convenience Methods
// ---------------------------------------------------------------------------

/**
 * Quick confirmation dialog.
 */
export async function confirm(
  manager: ElicitationManager,
  title: string,
  message: string
): Promise<boolean> {
  const result = await manager.elicit(title, [], {
    description: message,
    actions: [
      { id: "cancel", label: "Cancel" },
      { id: "confirm", label: "Confirm", primary: true },
    ],
  });
  return result.actionId === "confirm";
}

/**
 * Quick text input dialog.
 */
export async function prompt(
  manager: ElicitationManager,
  title: string,
  fieldLabel: string,
  options: { description?: string; placeholder?: string; required?: boolean } = {}
): Promise<string | null> {
  const result = await manager.elicit(
    title,
    [
      {
        name: "value",
        label: fieldLabel,
        type: "text",
        placeholder: options.placeholder,
        required: options.required,
        description: options.description,
      },
    ],
    {
      description: options.description,
    }
  );

  if (result.actionId === "cancel") return null;
  return String(result.values.value ?? "");
}

/**
 * Quick select dialog.
 */
export async function select(
  manager: ElicitationManager,
  title: string,
  fieldLabel: string,
  options: Array<{ value: string; label: string }>,
  description?: string
): Promise<string | null> {
  const result = await manager.elicit(
    title,
    [
      {
        name: "value",
        label: fieldLabel,
        type: "select",
        options,
        required: true,
      },
    ],
    { description }
  );

  if (result.actionId === "cancel") return null;
  return String(result.values.value ?? "");
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalManager: ElicitationManager | null = null;

export function getElicitationManager(): ElicitationManager {
  if (!globalManager) {
    globalManager = new ElicitationManager();
  }
  return globalManager;
}
