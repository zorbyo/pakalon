/**
 * LSP Diagnostic Registry
 *
 * Stores LSP diagnostics received asynchronously from LSP servers.
 * Follows a pattern for consistent async attachment delivery.
 */

import { Log } from "../../util/log"

/**
 * Diagnostic severity levels
 */
export type DiagnosticSeverity = "Error" | "Warning" | "Info" | "Hint"

/**
 * Position in a document
 */
export interface Position {
  line: number
  character: number
}

/**
 * Range in a document
 */
export interface Range {
  start: Position
  end: Position
}

/**
 * Single diagnostic entry
 */
export interface Diagnostic {
  message: string
  severity?: DiagnosticSeverity
  range?: Range
  source?: string
  code?: string | number
}

/**
 * Diagnostics for a single file
 */
export interface DiagnosticFile {
  uri: string
  diagnostics: Diagnostic[]
}

/**
 * Pending LSP diagnostic notification
 */
export interface PendingLSPDiagnostic {
  serverName: string
  files: DiagnosticFile[]
  timestamp: number
  attachmentSent: boolean
}

// Volume limiting constants
const MAX_DIAGNOSTICS_PER_FILE = 10
const MAX_TOTAL_DIAGNOSTICS = 30
const MAX_DELIVERED_FILES = 500

// Global registry state
const pendingDiagnostics = new Map<string, PendingLSPDiagnostic>()
const deliveredDiagnostics = new Map<string, Set<string>>()

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Maps severity string to numeric value for sorting.
 */
function severityToNumber(severity: DiagnosticSeverity | undefined): number {
  switch (severity) {
    case "Error":
      return 1
    case "Warning":
      return 2
    case "Info":
      return 3
    case "Hint":
      return 4
    default:
      return 4
  }
}

/**
 * Creates a unique key for a diagnostic based on its content.
 */
function createDiagnosticKey(diag: Diagnostic): string {
  return JSON.stringify({
    message: diag.message,
    severity: diag.severity,
    range: diag.range,
    source: diag.source || null,
    code: diag.code || null,
  })
}

/**
 * Deduplicates diagnostics by file URI and diagnostic content.
 */
function deduplicateDiagnosticFiles(
  allFiles: DiagnosticFile[]
): DiagnosticFile[] {
  const fileMap = new Map<string, Set<string>>()
  const dedupedFiles: DiagnosticFile[] = []

  for (const file of allFiles) {
    if (!fileMap.has(file.uri)) {
      fileMap.set(file.uri, new Set())
      dedupedFiles.push({ uri: file.uri, diagnostics: [] })
    }

    const seenDiagnostics = fileMap.get(file.uri)!
    const dedupedFile = dedupedFiles.find((f) => f.uri === file.uri)!
    const previouslyDelivered = deliveredDiagnostics.get(file.uri) || new Set()

    for (const diag of file.diagnostics) {
      try {
        const key = createDiagnosticKey(diag)

        if (seenDiagnostics.has(key) || previouslyDelivered.has(key)) {
          continue
        }

        seenDiagnostics.add(key)
        dedupedFile.diagnostics.push(diag)
      } catch (error) {
        // Include the diagnostic anyway
        dedupedFile.diagnostics.push(diag)
      }
    }
  }

  return dedupedFiles.filter((f) => f.diagnostics.length > 0)
}

/**
 * Register LSP diagnostics received from a server.
 */
export function registerPendingLSPDiagnostic(params: {
  serverName: string
  files: DiagnosticFile[]
}): void {
  const diagnosticId = generateId()

  Log.debug(
    `LSP Diagnostics: Registering ${params.files.length} file(s) from ${params.serverName}`
  )

  pendingDiagnostics.set(diagnosticId, {
    serverName: params.serverName,
    files: params.files,
    timestamp: Date.now(),
    attachmentSent: false,
  })
}

/**
 * Get all pending LSP diagnostics that haven't been delivered yet.
 */
export function checkForLSPDiagnostics(): Array<{
  serverName: string
  files: DiagnosticFile[]
}> {
  const allFiles: DiagnosticFile[] = []
  const serverNames = new Set<string>()
  const diagnosticsToMark: PendingLSPDiagnostic[] = []

  for (const diagnostic of pendingDiagnostics.values()) {
    if (!diagnostic.attachmentSent) {
      allFiles.push(...diagnostic.files)
      serverNames.add(diagnostic.serverName)
      diagnosticsToMark.push(diagnostic)
    }
  }

  if (allFiles.length === 0) {
    return []
  }

  let dedupedFiles = deduplicateDiagnosticFiles(allFiles)

  // Mark as sent and delete
  for (const diagnostic of diagnosticsToMark) {
    diagnostic.attachmentSent = true
  }
  for (const [id, diagnostic] of pendingDiagnostics) {
    if (diagnostic.attachmentSent) {
      pendingDiagnostics.delete(id)
    }
  }

  // Apply volume limiting
  let totalDiagnostics = 0
  for (const file of dedupedFiles) {
    // Sort by severity
    file.diagnostics.sort(
      (a, b) => severityToNumber(a.severity) - severityToNumber(b.severity)
    )

    // Cap per file
    if (file.diagnostics.length > MAX_DIAGNOSTICS_PER_FILE) {
      file.diagnostics = file.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    }

    // Cap total
    const remainingCapacity = MAX_TOTAL_DIAGNOSTICS - totalDiagnostics
    if (file.diagnostics.length > remainingCapacity) {
      file.diagnostics = file.diagnostics.slice(0, remainingCapacity)
    }

    totalDiagnostics += file.diagnostics.length
  }

  dedupedFiles = dedupedFiles.filter((f) => f.diagnostics.length > 0)

  // Track delivered diagnostics
  for (const file of dedupedFiles) {
    if (!deliveredDiagnostics.has(file.uri)) {
      deliveredDiagnostics.set(file.uri, new Set())
    }
    const delivered = deliveredDiagnostics.get(file.uri)!
    for (const diag of file.diagnostics) {
      try {
        delivered.add(createDiagnosticKey(diag))
      } catch {
        // Continue
      }
    }

    // Limit cache size
    if (deliveredDiagnostics.size > MAX_DELIVERED_FILES) {
      const firstKey = deliveredDiagnostics.keys().next().value
      if (firstKey) deliveredDiagnostics.delete(firstKey)
    }
  }

  const finalCount = dedupedFiles.reduce(
    (sum, f) => sum + f.diagnostics.length,
    0
  )

  if (finalCount === 0) {
    return []
  }

  return [
    {
      serverName: Array.from(serverNames).join(", "),
      files: dedupedFiles,
    },
  ]
}

/**
 * Clear all pending diagnostics.
 */
export function clearAllLSPDiagnostics(): void {
  pendingDiagnostics.clear()
}

/**
 * Reset all diagnostic state including cross-turn tracking.
 */
export function resetAllLSPDiagnosticState(): void {
  pendingDiagnostics.clear()
  deliveredDiagnostics.clear()
}

/**
 * Clear delivered diagnostics for a specific file.
 */
export function clearDeliveredDiagnosticsForFile(fileUri: string): void {
  deliveredDiagnostics.delete(fileUri)
}

/**
 * Get count of pending diagnostics
 */
export function getPendingLSPDiagnosticCount(): number {
  return pendingDiagnostics.size
}

export default {
  registerPendingLSPDiagnostic,
  checkForLSPDiagnostics,
  clearAllLSPDiagnostics,
  resetAllLSPDiagnosticState,
  clearDeliveredDiagnosticsForFile,
  getPendingLSPDiagnosticCount,
}
