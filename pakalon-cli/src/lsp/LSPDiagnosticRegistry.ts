export interface Diagnostic {
  message: string;
  severity?: number;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  source?: string;
  code?: string | number;
}

export interface DiagnosticEntry {
  serverName: string;
  filePath: string;
  diagnostics: Diagnostic[];
  timestamp: number;
}

export interface DiagnosticSnapshot {
  filePath: string;
  serverName: string;
  diagnostics: Diagnostic[];
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify({
    message: diagnostic.message,
    severity: diagnostic.severity ?? null,
    range: diagnostic.range ?? null,
    source: diagnostic.source ?? null,
    code: diagnostic.code ?? null,
  });
}

export class LSPDiagnosticRegistry {
  private pending = new Map<string, DiagnosticEntry>();
  private delivered = new Map<string, Set<string>>();

  register(serverName: string, filePath: string, diagnostics: Diagnostic[]): void {
    const key = `${serverName}:${filePath}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const seen = new Set<string>();
    const deduped = diagnostics.filter((diagnostic) => {
      const digest = diagnosticKey(diagnostic);
      if (seen.has(digest)) return false;
      seen.add(digest);
      return true;
    });

    this.pending.set(key, {
      serverName,
      filePath,
      diagnostics: deduped,
      timestamp: Date.now(),
    });
  }

  consumePending(): DiagnosticSnapshot[] {
    const snapshots: DiagnosticSnapshot[] = [];

    for (const [entryKey, entry] of this.pending.entries()) {
      const delivered = this.delivered.get(entry.filePath) ?? new Set<string>();
      const nextDiagnostics = entry.diagnostics.filter((diagnostic) => {
        const digest = diagnosticKey(diagnostic);
        if (delivered.has(digest)) return false;
        delivered.add(digest);
        return true;
      });

      if (nextDiagnostics.length > 0) {
        this.delivered.set(entry.filePath, delivered);
        snapshots.push({
          filePath: entry.filePath,
          serverName: entry.serverName,
          diagnostics: nextDiagnostics,
        });
      }

      this.pending.delete(entryKey);
    }

    return snapshots;
  }

  snapshot(): DiagnosticSnapshot[] {
    return this.consumePending();
  }

  clearForFile(filePath: string): void {
    this.delivered.delete(filePath);
    for (const [key, entry] of this.pending.entries()) {
      if (entry.filePath === filePath) {
        this.pending.delete(key);
      }
    }
  }

  clearAll(): void {
    this.pending.clear();
    this.delivered.clear();
  }

  getPendingCount(): number {
    return this.pending.size;
  }
}

const registryByWorkspace = new Map<string, LSPDiagnosticRegistry>();

export function getLSPDiagnosticRegistry(workspaceDir: string): LSPDiagnosticRegistry {
  const key = workspaceDir || process.cwd();
  let registry = registryByWorkspace.get(key);
  if (!registry) {
    registry = new LSPDiagnosticRegistry();
    registryByWorkspace.set(key, registry);
  }
  return registry;
}

export function registerPendingLSPDiagnostic(params: {
  workspaceDir: string;
  serverName: string;
  filePath: string;
  diagnostics: Diagnostic[];
}): void {
  getLSPDiagnosticRegistry(params.workspaceDir).register(
    params.serverName,
    params.filePath,
    params.diagnostics,
  );
}

export function checkForLSPDiagnostics(workspaceDir = process.cwd()): DiagnosticSnapshot[] {
  return getLSPDiagnosticRegistry(workspaceDir).consumePending();
}

export function clearAllLSPDiagnostics(workspaceDir = process.cwd()): void {
  getLSPDiagnosticRegistry(workspaceDir).clearAll();
}

export function clearDeliveredDiagnosticsForFile(filePath: string, workspaceDir = process.cwd()): void {
  getLSPDiagnosticRegistry(workspaceDir).clearForFile(filePath);
}

export function getPendingLSPDiagnosticCount(workspaceDir = process.cwd()): number {
  return getLSPDiagnosticRegistry(workspaceDir).getPendingCount();
}

export default {
  LSPDiagnosticRegistry,
  getLSPDiagnosticRegistry,
  registerPendingLSPDiagnostic,
  checkForLSPDiagnostics,
  clearAllLSPDiagnostics,
  clearDeliveredDiagnosticsForFile,
  getPendingLSPDiagnosticCount,
};
