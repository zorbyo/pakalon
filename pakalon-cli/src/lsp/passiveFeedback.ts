import { getLSPDiagnosticRegistry, type DiagnosticSnapshot } from "./LSPDiagnosticRegistry.js";

export type PassiveFeedback = {
  filePath: string;
  serverName: string;
  diagnostics: DiagnosticSnapshot["diagnostics"];
};

export function collectPassiveFeedback(workspaceDir = process.cwd()): string | null {
  const snapshots = getLSPDiagnosticRegistry(workspaceDir).consumePending();
  if (snapshots.length === 0) return null;

  const lines: string[] = ["LSP diagnostics:"];
  for (const snapshot of snapshots) {
    lines.push(`- ${snapshot.filePath} (${snapshot.serverName})`);
    for (const diagnostic of snapshot.diagnostics) {
      const line = diagnostic.range?.start.line ?? 0;
      const character = diagnostic.range?.start.character ?? 0;
      lines.push(`  • [${diagnostic.severity ?? "Information"}] ${line + 1}:${character + 1} ${diagnostic.message}`);
    }
  }
  return lines.join("\n");
}

export function hasFeedbackForFile(filePath: string, workspaceDir = process.cwd()): boolean {
  const registry = getLSPDiagnosticRegistry(workspaceDir);
  return registry.snapshot().some((entry) => entry.filePath === filePath);
}

export function clearFeedbackForFile(filePath: string, workspaceDir = process.cwd()): void {
  getLSPDiagnosticRegistry(workspaceDir).clearForFile(filePath);
}

export default {
  collectPassiveFeedback,
  hasFeedbackForFile,
  clearFeedbackForFile,
};
