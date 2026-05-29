/**
 * Diagnostics Logging (No PII)
 *
 * Privacy-safe logging system that strips personally identifiable information.
 * Similar to Claude's diagLogs.ts system.
 *
 * Features:
 * - Automatic PII detection and stripping
 * - Structured logging with timestamps
 * - Log levels (debug, info, warn, error)
 * - File and console output
 * - Performance metrics tracking
 * - Diagnostic event tracking
 */

import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export interface DiagnosticEvent {
  /** Event name */
  event: string;
  /** Timestamp */
  timestamp: number;
  /** Level */
  level: DiagnosticLevel;
  /** Data (PII-stripped) */
  data?: Record<string, unknown>;
  /** Duration in ms (for timing events) */
  duration_ms?: number;
  /** Session ID */
  session_id?: string;
}

export interface DiagnosticsConfig {
  /** Enable diagnostics */
  enabled: boolean;
  /** Log level */
  level: DiagnosticLevel;
  /** Output to file */
  fileOutput?: boolean;
  /** Output file path */
  filePath?: string;
  /** Enable PII stripping */
  stripPII: boolean;
  /** Max log file size in bytes */
  maxFileSize?: number;
}

// ---------------------------------------------------------------------------
// PII Patterns
// ---------------------------------------------------------------------------

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  // Phone numbers (US format)
  { pattern: /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: "[PHONE]" },
  // SSN
  { pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, replacement: "[SSN]" },
  // Credit card numbers
  { pattern: /\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g, replacement: "[CARD]" },
  // IP addresses (IPv4)
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: "[IP]" },
  // API keys (common patterns)
  { pattern: /\b(sk|pk|ak|key|token|secret|password|api_key|apikey)[-_]?[a-zA-Z0-9]{20,}\b/gi, replacement: "[KEY]" },
  // JWT tokens
  { pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, replacement: "[JWT]" },
  // UUIDs (sometimes contain info)
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replacement: "[UUID]" },
  // File paths with usernames
  { pattern: /\/home\/[a-zA-Z0-9_-]+/g, replacement: "/home/[USER]" },
  { pattern: /C:\\Users\\[a-zA-Z0-9_-]+/gi, replacement: "C:\\Users\\[USER]" },
  { pattern: /\/Users\/[a-zA-Z0-9_-]+/g, replacement: "/Users/[USER]" },
];

// ---------------------------------------------------------------------------
// Diagnostics Manager
// ---------------------------------------------------------------------------

class DiagnosticsManager {
  private config: DiagnosticsConfig;
  private logBuffer: DiagnosticEvent[] = [];
  private writeStream: fs.WriteStream | null = null;
  private initialized = false;

  constructor(config?: Partial<DiagnosticsConfig>) {
    this.config = {
      enabled: true,
      level: "info",
      fileOutput: false,
      stripPII: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      ...config,
    };
  }

  /**
   * Initialize diagnostics system
   */
  initialize(): void {
    if (this.initialized) return;

    if (this.config.fileOutput && this.config.filePath) {
      try {
        const dir = path.dirname(this.config.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.writeStream = fs.createWriteStream(this.config.filePath, { flags: "a" });
      } catch (error) {
        logger.warn(`[Diagnostics] Failed to open log file: ${error}`);
      }
    }

    this.initialized = true;
  }

  /**
   * Strip PII from text
   */
  stripPII(text: string): string {
    if (!this.config.stripPII) return text;

    let stripped = text;
    for (const { pattern, replacement } of PII_PATTERNS) {
      stripped = stripped.replace(pattern, replacement);
    }
    return stripped;
  }

  /**
   * Strip PII from object values
   */
  stripPIIFromObject(obj: Record<string, unknown>): Record<string, unknown> {
    if (!this.config.stripPII) return obj;

    const stripped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        stripped[key] = this.stripPII(value);
      } else if (typeof value === "object" && value !== null) {
        stripped[key] = this.stripPIIFromObject(value as Record<string, unknown>);
      } else {
        stripped[key] = value;
      }
    }
    return stripped;
  }

  /**
   * Log a diagnostic event
   */
  log(
    level: DiagnosticLevel,
    event: string,
    data?: Record<string, unknown>,
    duration_ms?: number
  ): void {
    if (!this.config.enabled) return;

    // Check log level
    const levels: DiagnosticLevel[] = ["debug", "info", "warn", "error"];
    if (levels.indexOf(level) < levels.indexOf(this.config.level)) {
      return;
    }

    // Strip PII
    const sanitizedData = data ? this.stripPIIFromObject(data) : undefined;

    const diagnosticEvent: DiagnosticEvent = {
      event,
      timestamp: Date.now(),
      level,
      data: sanitizedData,
      duration_ms,
    };

    // Add to buffer
    this.logBuffer.push(diagnosticEvent);

    // Write to file if enabled
    if (this.writeStream) {
      this.writeStream.write(JSON.stringify(diagnosticEvent) + "\n");
    }

    // Log to console via logger
    const message = `[Diagnostics] ${event}${duration_ms ? ` (${duration_ms}ms)` : ""}`;
    switch (level) {
      case "debug":
        logger.debug(message);
        break;
      case "info":
        logger.info(message);
        break;
      case "warn":
        logger.warn(message);
        break;
      case "error":
        logger.error(message);
        break;
    }
  }

  /**
   * Log info event
   */
  info(event: string, data?: Record<string, unknown>): void {
    this.log("info", event, data);
  }

  /**
   * Log debug event
   */
  debug(event: string, data?: Record<string, unknown>): void {
    this.log("debug", event, data);
  }

  /**
   * Log warning event
   */
  warn(event: string, data?: Record<string, unknown>): void {
    this.log("warn", event, data);
  }

  /**
   * Log error event
   */
  error(event: string, data?: Record<string, unknown>): void {
    this.log("error", event, data);
  }

  /**
   * Log timing event
   */
  timing(event: string, duration_ms: number, data?: Record<string, unknown>): void {
    this.log("info", event, { ...data, duration_ms }, duration_ms);
  }

  /**
   * Log diagnostic event (no PII)
   * Convenience method that matches Claude's logForDiagnosticsNoPII signature
   */
  logForDiagnosticsNoPII(
    level: DiagnosticLevel,
    event: string,
    data?: Record<string, unknown>
  ): void {
    this.log(level, event, data);
  }

  /**
   * Get recent events
   */
  getRecentEvents(count: number = 100): DiagnosticEvent[] {
    return this.logBuffer.slice(-count);
  }

  /**
   * Get events by level
   */
  getEventsByLevel(level: DiagnosticLevel): DiagnosticEvent[] {
    return this.logBuffer.filter((e) => e.level === level);
  }

  /**
   * Get events by name
   */
  getEventsByName(event: string): DiagnosticEvent[] {
    return this.logBuffer.filter((e) => e.event === event);
  }

  /**
   * Flush log buffer to file
   */
  flush(): void {
    if (this.writeStream) {
      for (const event of this.logBuffer) {
        this.writeStream.write(JSON.stringify(event) + "\n");
      }
    }
    this.logBuffer = [];
  }

  /**
   * Close diagnostics
   */
  close(): void {
    this.flush();
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
    this.initialized = false;
  }

  /**
   * Reset diagnostics
   */
  reset(): void {
    this.logBuffer = [];
    logger.debug("[Diagnostics] Reset");
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let manager: DiagnosticsManager | null = null;

export function getDiagnosticsManager(): DiagnosticsManager {
  if (!manager) {
    manager = new DiagnosticsManager();
  }
  return manager;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize diagnostics system
 */
export function initDiagnostics(config?: Partial<DiagnosticsConfig>): void {
  manager = new DiagnosticsManager(config);
  manager.initialize();
}

/**
 * Log diagnostic event (no PII)
 */
export function logForDiagnosticsNoPII(
  level: DiagnosticLevel,
  event: string,
  data?: Record<string, unknown>
): void {
  getDiagnosticsManager().logForDiagnosticsNoPII(level, event, data);
}

/**
 * Log info event
 */
export function logDiagnosticInfo(event: string, data?: Record<string, unknown>): void {
  getDiagnosticsManager().info(event, data);
}

/**
 * Log timing event
 */
export function logDiagnosticTiming(
  event: string,
  duration_ms: number,
  data?: Record<string, unknown>
): void {
  getDiagnosticsManager().timing(event, duration_ms, data);
}

/**
 * Strip PII from text
 */
export function stripPII(text: string): string {
  return getDiagnosticsManager().stripPII(text);
}

/**
 * Get recent diagnostic events
 */
export function getRecentDiagnostics(count?: number): DiagnosticEvent[] {
  return getDiagnosticsManager().getRecentEvents(count);
}

/**
 * Close diagnostics
 */
export function closeDiagnostics(): void {
  getDiagnosticsManager().close();
}
