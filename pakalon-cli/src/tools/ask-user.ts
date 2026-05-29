/**
 * ask_user tool — lets the agent ask clarifying questions mid-execution.
 * Matches Copilot CLI's ask_user tool.
 *
 * Blocks execution until the TUI user responds.
 */
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AskUserQuestion {
  id: string;
  question: string;
  choices?: string[];
  /** Whether user can type a free-form answer */
  freeForm: boolean;
}

export interface AskUserResponse {
  questionId: string;
  answer: string;
}

type QuestionListener = (question: AskUserQuestion) => void;

// ---------------------------------------------------------------------------
// Ask User Gate
// ---------------------------------------------------------------------------

class AskUserGate {
  private pending: Map<string, { question: AskUserQuestion; resolve: (response: AskUserResponse) => void }> = new Map();
  private listeners: Set<QuestionListener> = new Set();

  /**
   * Ask the user a question. Blocks until the user responds.
   */
  async ask(question: string, choices?: string[]): Promise<string> {
    const id = crypto.randomUUID();

    const askQuestion: AskUserQuestion = {
      id,
      question,
      choices,
      freeForm: !choices || choices.length === 0,
    };

    return new Promise<string>((resolve) => {
      this.pending.set(id, {
        question: askQuestion,
        resolve: (response) => {
          resolve(response.answer);
        },
      });

      // Notify listeners (TUI components)
      for (const listener of this.listeners) {
        try {
          listener(askQuestion);
        } catch {
          /* ignore */
        }
      }
    });
  }

  /**
   * Respond to a pending question (called from TUI).
   */
  respond(questionId: string, answer: string): void {
    const handler = this.pending.get(questionId);
    if (!handler) return;

    this.pending.delete(questionId);
    handler.resolve({ questionId, answer });
  }

  /**
   * Register a listener for new questions.
   */
  onQuestion(listener: QuestionListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a listener.
   */
  offQuestion(listener: QuestionListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Get the first pending question (for TUI display).
   */
  getPendingQuestion(): AskUserQuestion | null {
    const first = this.pending.entries().next();
    if (first.done) return null;
    return first.value[1].question;
  }

  /**
   * True if there are pending questions.
   */
  get hasPending(): boolean {
    return this.pending.size > 0;
  }
}

export const askUserGate = new AskUserGate();
