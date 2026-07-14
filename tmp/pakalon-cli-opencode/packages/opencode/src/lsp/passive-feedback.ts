/**
 * LSP Passive Feedback
 *
 * Provides passive feedback from LSP servers to improve AI responses.
 * This includes diagnostics, code completion suggestions, and hover information.
 */

import { Log } from "../../util/log"
import type { Diagnostic, DiagnosticFile } from "./diagnostic-registry"
import { getLspManager } from "./manager"

/**
 * Feedback types
 */
export type FeedbackType =
  | "diagnostic"
  | "completion"
  | "hover"
  | "signature"
  | "definition"
  | "references"

/**
 * Passive feedback entry
 */
export interface PassiveFeedback {
  type: FeedbackType
  serverName: string
  uri: string
  timestamp: number
  data: unknown
}

/**
 * Feedback collector options
 */
export interface FeedbackCollectorOptions {
  maxEntries?: number
  maxAge?: number // milliseconds
}

/**
 * Passive Feedback Collector
 *
 * Collects and aggregates passive feedback from LSP servers.
 */
export class PassiveFeedbackCollector {
  private entries: PassiveFeedback[] = []
  private options: Required<FeedbackCollectorOptions>

  constructor(options: FeedbackCollectorOptions = {}) {
    this.options = {
      maxEntries: 100,
      maxAge: 5 * 60 * 1000, // 5 minutes
      ...options,
    }
  }

  /**
   * Add feedback entry
   */
  addFeedback(feedback: Omit<PassiveFeedback, "timestamp">): void {
    const entry: PassiveFeedback = {
      ...feedback,
      timestamp: Date.now(),
    }

    this.entries.push(entry)
    this.cleanup()
  }

  /**
   * Get all feedback
   */
  getAllFeedback(): PassiveFeedback[] {
    this.cleanup()
    return [...this.entries]
  }

  /**
   * Get feedback by type
   */
  getFeedbackByType(type: FeedbackType): PassiveFeedback[] {
    this.cleanup()
    return this.entries.filter((e) => e.type === type)
  }

  /**
   * Get feedback for a file
   */
  getFeedbackForFile(uri: string): PassiveFeedback[] {
    this.cleanup()
    return this.entries.filter((e) => e.uri === uri)
  }

  /**
   * Get recent diagnostics
   */
  getRecentDiagnostics(): PassiveFeedback[] {
    return this.getFeedbackByType("diagnostic")
  }

  /**
   * Clear all feedback
   */
  clear(): void {
    this.entries = []
  }

  /**
   * Clear feedback for a file
   */
  clearForFile(uri: string): void {
    this.entries = this.entries.filter((e) => e.uri !== uri)
  }

  /**
   * Cleanup old entries
   */
  private cleanup(): void {
    const now = Date.now()
    const cutoff = now - this.options.maxAge

    // Remove old entries
    this.entries = this.entries.filter((e) => e.timestamp > cutoff)

    // Limit total entries
    if (this.entries.length > this.options.maxEntries) {
      this.entries = this.entries.slice(-this.options.maxEntries)
    }
  }
}

// Singleton collector
let collectorInstance: PassiveFeedbackCollector | null = null

/**
 * Get the passive feedback collector
 */
export function getPassiveFeedbackCollector(): PassiveFeedbackCollector {
  if (!collectorInstance) {
    collectorInstance = new PassiveFeedbackCollector()
  }
  return collectorInstance
}

/**
 * Collect passive feedback from LSP servers
 *
 * This function aggregates feedback from various LSP sources
 * to provide context for AI responses.
 */
export async function collectPassiveFeedback(): Promise<string | null> {
  const collector = getPassiveFeedbackCollector()
  const manager = getLspManager()

  // Get diagnostics from LSP manager
  const diagnostics = manager.getDiagnostics()

  for (const { serverName, files } of diagnostics) {
    for (const file of files) {
      collector.addFeedback({
        type: "diagnostic",
        serverName,
        uri: file.uri,
        data: file.diagnostics,
      })
    }
  }

  // Format feedback for AI context
  const feedback = collector.getRecentDiagnostics()

  if (feedback.length === 0) {
    return null
  }

  // Build feedback summary
  const lines: string[] = ["LSP Diagnostics:"]

  for (const entry of feedback) {
    const diagnostics = entry.data as Diagnostic[]
    if (diagnostics.length === 0) continue

    lines.push(`\nFile: ${entry.uri}`)
    for (const diag of diagnostics) {
      const severity = diag.severity || "Info"
      const location = diag.range
        ? `line ${diag.range.start.line + 1}`
        : "unknown location"
      lines.push(`  [${severity}] ${location}: ${diag.message}`)
    }
  }

  return lines.join("\n")
}

/**
 * Check if there's relevant feedback for a file
 */
export function hasFeedbackForFile(uri: string): boolean {
  const collector = getPassiveFeedbackCollector()
  return collector.getFeedbackForFile(uri).length > 0
}

/**
 * Clear feedback when a file is edited
 */
export function clearFeedbackForFile(uri: string): void {
  const collector = getPassiveFeedbackCollector()
  collector.clearForFile(uri)
}

export default {
  PassiveFeedbackCollector,
  getPassiveFeedbackCollector,
  collectPassiveFeedback,
  hasFeedbackForFile,
  clearFeedbackForFile,
}
