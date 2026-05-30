/**
 * Session Environment
 *
 * Captures and manages environment variables for a session,
 * enabling consistent environment across tool calls.
 */

/**
 * Environment snapshot.
 */
export interface SessionEnvSnapshot {
  vars: Record<string, string>;
  timestamp: number;
  sessionId: string;
}

/**
 * Manages session-scoped environment variables.
 */
export class SessionEnvironment {
  private vars = new Map<string, string>();
  private capturedVars: string[] = [];
  private sessionId: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? `session_${Date.now()}`;
  }

  /**
   * Set an environment variable.
   */
  set(key: string, value: string): void {
    this.vars.set(key, value);
  }

  /**
   * Get an environment variable.
   */
  get(key: string): string | null {
    return this.vars.get(key) ?? null;
  }

  /**
   * Get all environment variables.
   */
  getAll(): Record<string, string> {
    return Object.fromEntries(this.vars);
  }

  /**
   * Capture environment variables from process.env.
   */
  setFromProcess(keys?: string[]): void {
    const keysToCapture = keys ?? [
      'HOME', 'USER', 'SHELL', 'PATH', 'LANG', 'LC_ALL',
      'NODE_ENV', 'CI', 'TERM', 'EDITOR',
    ];

    for (const key of keysToCapture) {
      const value = process.env[key];
      if (value !== undefined) {
        this.vars.set(key, value);
        this.capturedVars.push(key);
      }
    }
  }

  /**
   * Get list of captured variable names.
   */
  getCapturedVars(): string[] {
    return [...this.capturedVars];
  }

  /**
   * Create a snapshot of the current environment.
   */
  snapshot(): SessionEnvSnapshot {
    return {
      vars: this.getAll(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
    };
  }

  /**
   * Restore environment from a snapshot.
   */
  restore(snapshot: SessionEnvSnapshot): void {
    this.vars.clear();
    for (const [key, value] of Object.entries(snapshot.vars)) {
      this.vars.set(key, value);
    }
    this.sessionId = snapshot.sessionId;
  }

  /**
   * Get session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Clear all variables.
   */
  clear(): void {
    this.vars.clear();
    this.capturedVars = [];
  }
}

// Singleton instance
let _instance: SessionEnvironment | null = null;

/**
 * Get the global session environment.
 */
export function getSessionEnvironment(): SessionEnvironment {
  if (!_instance) {
    _instance = new SessionEnvironment();
  }
  return _instance;
}
