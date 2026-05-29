/**
 * Prompt Injection Protection — Detect and prevent prompt injection attacks.
 *
 * Provides comprehensive protection against:
 * - Direct prompt injection attempts
 * - Indirect injection via file content
 * - System prompt extraction attempts
 * - Role confusion attacks
 * - Instruction override attempts
 *
 * Port from security best practices.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type InjectionSeverity = "low" | "medium" | "high" | "critical";

export type InjectionType =
  | "direct-injection"
  | "indirect-injection"
  | "system-prompt-extraction"
  | "role-confusion"
  | "instruction-override"
  | "context-manipulation"
  | "data-exfiltration";

export interface InjectionPattern {
  /** Pattern name */
  name: string;
  /** Pattern type */
  type: InjectionType;
  /** Severity level */
  severity: InjectionSeverity;
  /** Regex pattern to match */
  pattern: RegExp;
  /** Description of the pattern */
  description: string;
  /** Whether this pattern is enabled */
  enabled: boolean;
}

export interface InjectionDetection {
  /** Whether injection was detected */
  detected: boolean;
  /** Patterns that matched */
  matches: Array<{
    pattern: InjectionPattern;
    match: string;
    index: number;
  }>;
  /** Overall severity */
  overallSeverity: InjectionSeverity;
  /** Recommended action */
  recommendedAction: "allow" | "sanitize" | "block" | "warn";
  /** Sanitized input if applicable */
  sanitizedInput?: string;
}

export interface InjectionProtectionConfig {
  /** Whether injection protection is enabled */
  enabled: boolean;
  /** Whether to sanitize detected injections */
  sanitize: boolean;
  /** Whether to block detected injections */
  block: boolean;
  /** Whether to log detection attempts */
  logAttempts: boolean;
  /** Custom patterns to add */
  customPatterns?: InjectionPattern[];
  /** Patterns to disable */
  disabledPatterns?: string[];
}

export interface InjectionStats {
  /** Total inputs checked */
  totalChecked: number;
  /** Total injections detected */
  totalDetected: number;
  /** Detections by type */
  byType: Map<InjectionType, number>;
  /** Detections by severity */
  bySeverity: Map<InjectionSeverity, number>;
  /** Recent detections (last 24h) */
  recentDetections: Array<{
    timestamp: Date;
    type: InjectionType;
    severity: InjectionSeverity;
    inputPreview: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Patterns
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PATTERNS: InjectionPattern[] = [
  // Direct injection patterns
  {
    name: "ignore-instructions",
    type: "direct-injection",
    severity: "high",
    pattern: /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|earlier|all)\s+(?:instructions|prompts|rules|guidelines)/i,
    description: "Attempts to ignore previous instructions",
    enabled: true,
  },
  {
    name: "new-instructions",
    type: "direct-injection",
    severity: "high",
    pattern: /(?:you\s+are\s+now|from\s+now\s+on|new\s+instructions|updated\s+instructions|override|emergency)\s*[:.]/i,
    description: "Attempts to override system instructions",
    enabled: true,
  },
  {
    name: "system-prompt-extraction",
    type: "system-prompt-extraction",
    severity: "critical",
    pattern: /(?:show|reveal|display|print|echo|repeat|output)\s+(?:your|the)\s+(?:system|initial|original|base)\s+(?:prompt|instructions|message)/i,
    description: "Attempts to extract system prompt",
    enabled: true,
  },
  {
    name: "role-confusion",
    type: "role-confusion",
    severity: "medium",
    pattern: /(?:you\s+are\s+(?:now\s+)?(?:a|an|the)\s+)?(?:different|new|another|alternate)\s+(?:assistant|AI|bot|agent|model)/i,
    description: "Attempts to confuse the agent's role",
    enabled: true,
  },
  {
    name: "instruction-override",
    type: "instruction-override",
    severity: "high",
    pattern: /(?:precedence|priority|override|supersede)\s+(?:over|above|than|the)\s+(?:system|initial|original)\s+(?:prompt|instructions)/i,
    description: "Attempts to override system instructions",
    enabled: true,
  },
  {
    name: "context-manipulation",
    type: "context-manipulation",
    severity: "medium",
    pattern: /(?:pretend|imagine|assume|suppose)\s+(?:you\s+)?(?:have|are|were|had)\s+(?:no|zero|empty|null)\s+(?:previous|prior|existing)\s+(?:context|instructions|memory)/i,
    description: "Attempts to manipulate context",
    enabled: true,
  },
  {
    name: "data-exfiltration",
    type: "data-exfiltration",
    severity: "critical",
    pattern: /(?:send|transmit|exfiltrate|upload|post)\s+(?:all|every|any|the)\s+(?:data|information|content|files|secrets|keys|tokens|passwords)\s+(?:to|at|via)\s+(?:https?:\/\/|ftp:\/\/)/i,
    description: "Attempts to exfiltrate data",
    enabled: true,
  },
  {
    name: "delimiter-injection",
    type: "direct-injection",
    severity: "medium",
    pattern: /(?:im_start|im_end|\[INST\]|\[\/INST\]|<<SYS>>|<\/s>)/i,
    description: "Attempts to inject message delimiters",
    enabled: true,
  },
  {
    name: "encoding-bypass",
    type: "direct-injection",
    severity: "low",
    pattern: /(?:base64|rot13|hex|url)\s*(?:encode|decode)\s*(?:\(|:)/i,
    description: "Attempts to use encoding to bypass detection",
    enabled: true,
  },
  {
    name: "nested-instruction",
    type: "indirect-injection",
    severity: "medium",
    pattern: /\[(?:INST|SYS|SYSTEM|USER|ASSISTANT)\].*\[\/(?:INST|SYS|SYSTEM|USER|ASSISTANT)\]/is,
    description: "Nested instruction tags",
    enabled: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Injection Protection
// ─────────────────────────────────────────────────────────────────────────────

export class InjectionProtection {
  private config: InjectionProtectionConfig;
  private patterns: InjectionPattern[];
  private stats: InjectionStats;
  private recentDetections: Array<{
    timestamp: Date;
    type: InjectionType;
    severity: InjectionSeverity;
    inputPreview: string;
  }> = [];

  constructor(config?: Partial<InjectionProtectionConfig>) {
    this.config = {
      enabled: true,
      sanitize: true,
      block: false,
      logAttempts: true,
      ...config,
    };

    // Initialize patterns
    this.patterns = [...DEFAULT_PATTERNS];
    if (config?.customPatterns) {
      this.patterns.push(...config.customPatterns);
    }
    if (config?.disabledPatterns) {
      for (const name of config.disabledPatterns) {
        const pattern = this.patterns.find((p) => p.name === name);
        if (pattern) {
          pattern.enabled = false;
        }
      }
    }

    // Initialize stats
    this.stats = {
      totalChecked: 0,
      totalDetected: 0,
      byType: new Map(),
      bySeverity: new Map(),
      recentDetections: [],
    };
  }

  /**
   * Check input for prompt injection attempts.
   */
  check(input: string): InjectionDetection {
    if (!this.config.enabled) {
      return {
        detected: false,
        matches: [],
        overallSeverity: "low",
        recommendedAction: "allow",
      };
    }

    this.stats.totalChecked++;
    const matches: InjectionDetection["matches"] = [];
    let highestSeverity: InjectionSeverity = "low";

    for (const pattern of this.patterns) {
      if (!pattern.enabled) continue;

      const match = pattern.pattern.exec(input);
      if (match) {
        matches.push({
          pattern,
          match: match[0],
          index: match.index,
        });

        // Update highest severity
        if (this.getSeverityLevel(pattern.severity) > this.getSeverityLevel(highestSeverity)) {
          highestSeverity = pattern.severity;
        }

        // Update stats
        this.stats.totalDetected++;
        const typeCount = this.stats.byType.get(pattern.type) ?? 0;
        this.stats.byType.set(pattern.type, typeCount + 1);
        const severityCount = this.stats.bySeverity.get(pattern.severity) ?? 0;
        this.stats.bySeverity.set(pattern.severity, severityCount + 1);

        // Add to recent detections
        this.recentDetections.push({
          timestamp: new Date(),
          type: pattern.type,
          severity: pattern.severity,
          inputPreview: input.slice(0, 100),
        });

        // Trim recent detections
        if (this.recentDetections.length > 100) {
          this.recentDetections = this.recentDetections.slice(-100);
        }
      }
    }

    // Determine recommended action
    let recommendedAction: InjectionDetection["recommendedAction"] = "allow";
    if (matches.length > 0) {
      if (highestSeverity === "critical" || (this.config.block && highestSeverity === "high")) {
        recommendedAction = "block";
      } else if (this.config.sanitize && (highestSeverity === "high" || highestSeverity === "medium")) {
        recommendedAction = "sanitize";
      } else {
        recommendedAction = "warn";
      }
    }

    // Log if configured
    if (this.config.logAttempts && matches.length > 0) {
      logger.warn("[InjectionProtection] Potential injection detected", {
        inputPreview: input.slice(0, 100),
        matches: matches.map((m) => m.pattern.name),
        severity: highestSeverity,
        action: recommendedAction,
      });
    }

    // Sanitize if needed
    let sanitizedInput: string | undefined;
    if (recommendedAction === "sanitize" || recommendedAction === "block") {
      sanitizedInput = this.sanitizeInput(input, matches);
    }

    return {
      detected: matches.length > 0,
      matches,
      overallSeverity: highestSeverity,
      recommendedAction,
      sanitizedInput,
    };
  }

  /**
   * Sanitize input by removing detected injection patterns.
   */
  sanitizeInput(input: string, matches: InjectionDetection["matches"]): string {
    let sanitized = input;

    // Sort matches by index in reverse order to maintain positions
    const sortedMatches = [...matches].sort((a, b) => b.index - a.index);

    for (const match of sortedMatches) {
      const before = sanitized.slice(0, match.index);
      const after = sanitized.slice(match.index + match.match.length);
      sanitized = `${before}[SANITIZED]${after}`;
    }

    return sanitized;
  }

  /**
   * Add a custom pattern.
   */
  addPattern(pattern: InjectionPattern): void {
    this.patterns.push(pattern);
    logger.debug("[InjectionProtection] Added pattern", { name: pattern.name });
  }

  /**
   * Remove a pattern by name.
   */
  removePattern(name: string): boolean {
    const index = this.patterns.findIndex((p) => p.name === name);
    if (index !== -1) {
      this.patterns.splice(index, 1);
      logger.debug("[InjectionProtection] Removed pattern", { name });
      return true;
    }
    return false;
  }

  /**
   * Enable/disable a pattern.
   */
  togglePattern(name: string, enabled: boolean): boolean {
    const pattern = this.patterns.find((p) => p.name === name);
    if (pattern) {
      pattern.enabled = enabled;
      logger.debug("[InjectionProtection] Toggled pattern", { name, enabled });
      return true;
    }
    return false;
  }

  /**
   * Get all patterns.
   */
  getPatterns(): InjectionPattern[] {
    return [...this.patterns];
  }

  /**
   * Get stats.
   */
  getStats(): InjectionStats {
    return {
      ...this.stats,
      recentDetections: [...this.recentDetections],
    };
  }

  /**
   * Update config.
   */
  updateConfig(config: Partial<InjectionProtectionConfig>): void {
    this.config = { ...this.config, ...config };
    logger.debug("[InjectionProtection] Config updated", config);
  }

  private getSeverityLevel(severity: InjectionSeverity): number {
    switch (severity) {
      case "critical":
        return 4;
      case "high":
        return 3;
      case "medium":
        return 2;
      case "low":
        return 1;
      default:
        return 0;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let instance: InjectionProtection | null = null;

/**
 * Get the singleton injection protection instance.
 */
export function getInjectionProtection(config?: Partial<InjectionProtectionConfig>): InjectionProtection {
  if (!instance) {
    instance = new InjectionProtection(config);
  }
  return instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetInjectionProtection(): void {
  instance = null;
}

/**
 * Initialize injection protection with default config.
 */
export function initializeInjectionProtection(): InjectionProtection {
  return getInjectionProtection({
    enabled: true,
    sanitize: true,
    block: false,
    logAttempts: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quick check for prompt injection (convenience function).
 */
export function checkForInjection(input: string): InjectionDetection {
  return getInjectionProtection().check(input);
}

/**
 * Sanitize input if injection detected (convenience function).
 */
export function sanitizeIfInjection(input: string): string {
  const detection = checkForInjection(input);
  if (detection.detected && detection.sanitizedInput) {
    return detection.sanitizedInput;
  }
  return input;
}

/**
 * Check if input is safe (convenience function).
 */
export function isInputSafe(input: string): boolean {
  const detection = checkForInjection(input);
  return !detection.detected || detection.recommendedAction === "warn";
}
