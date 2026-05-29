/**
 * LSP Server Manager
 *
 * Manages LSP server connections and operations for a workspace.
 * Wraps the existing LSP implementation from index.ts.
 */

import { debugLog } from "@/utils/logger.js";

interface DefinitionResult {
  file: string;
  line: number;
  column: number;
  symbolName?: string;
}

interface ReferencesResult {
  file: string;
  line: number;
  column: number;
  symbolName: string;
  context?: string;
}

type LSPClientConnection = unknown;

interface LspRange {
  start: { line: number; character: number };
  end?: { line: number; character: number };
}

interface LspCallHierarchyItem {
  name: string;
  kind: number;
  detail?: string;
  uri: string;
  range: LspRange;
  selectionRange: LspRange;
  data?: unknown;
}

interface LspIncomingCall {
  from: LspCallHierarchyItem;
  fromRanges?: LspRange[];
}

interface LspOutgoingCall {
  to: LspCallHierarchyItem;
  fromRanges?: LspRange[];
}

function fileUriToPath(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") return null;
    const decoded = decodeURIComponent(parsed.pathname);
    return decoded.replace(/^\/([A-Za-z]:)/, "$1");
  } catch {
    const pathMatch = uri.match(/file:\/\/\/?(.+)/);
    return pathMatch?.[1] ? decodeURIComponent(pathMatch[1]).replace(/^\/([A-Za-z]:)/, "$1") : null;
  }
}

export class LSPServerManager {
  private clients = new Map<string, LSPClientConnection>();
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  private async getClient(filePath?: string): Promise<LSPClientConnection | null> {
    const { getOrCreateLSPClient } = await import("./index.js");
    return getOrCreateLSPClient(this.workspaceRoot, filePath);
  }

  async gotoDefinition(filePath: string, line: number, character: number): Promise<DefinitionResult | null> {
    const { gotoDefinition } = await import("./index.js");
    return gotoDefinition(filePath, line, character, this.workspaceRoot);
  }

  async findReferences(filePath: string, line: number, character: number): Promise<ReferencesResult[]> {
    const { findReferences } = await import("./index.js");
    return findReferences(filePath, line, character, this.workspaceRoot);
  }

  async hover(filePath: string, line: number, character: number): Promise<{ contents: string; range?: { startLine: number; startCol: number; endLine: number; endCol: number } } | null> {
    const { getHover } = await import("./index.js");
    return getHover(filePath, line, character, this.workspaceRoot);
  }

  async documentSymbol(filePath: string): Promise<Array<{ name: string; kind: number; location: { file: string; line: number; column: number } }>> {
    const { getDocumentSymbols } = await import("./index.js");
    return getDocumentSymbols(filePath, this.workspaceRoot);
  }

  async workspaceSymbol(query: string): Promise<Array<{ name: string; location: { file: string; line: number } }>> {
    const { searchWorkspaceSymbols } = await import("./index.js");
    return searchWorkspaceSymbols(query, this.workspaceRoot);
  }

  async workspaceDiagnostics(maxFiles?: number): Promise<Array<{ file: string; diagnostics: unknown[] }>> {
    const { getWorkspaceDiagnostics } = await import("./index.js");
    return getWorkspaceDiagnostics(this.workspaceRoot, maxFiles);
  }

  async codeActions(
    filePath: string,
    range: { start: { line: number; character: number }; end: { line: number; character: number } },
    only?: string[],
  ): Promise<unknown[]> {
    const { getCodeActions } = await import("./index.js");
    return getCodeActions(filePath, range, this.workspaceRoot, only);
  }

  async semanticTokens(filePath: string): Promise<unknown | null> {
    const { getSemanticTokens } = await import("./index.js");
    return getSemanticTokens(filePath, this.workspaceRoot);
  }

  async goToImplementation(filePath: string, line: number, character: number): Promise<DefinitionResult | null> {
    const lang = this.detectLanguage(filePath);
    if (!lang) return null;

    const client = await this.getClient(filePath);
    if (!client) return null;

    try {
      const params = {
        textDocument: { uri: `file://${filePath}` },
        position: { line, character },
      };

      const result = await (client as { sendRequest: (method: string, params: unknown) => Promise<unknown> }).sendRequest("textDocument/implementation", params);

      if (!result || (Array.isArray(result) && result.length === 0)) return null;

      const location = Array.isArray(result) ? result[0] : result;
      if (!location || !location.uri) return null;

      const uri = location.uri as string;
      const pathMatch = uri.match(/file:\/\/(.+)/);
      if (!pathMatch || !pathMatch[1]) return null;

      return {
        file: pathMatch[1],
        line: (location.range?.start?.line as number) || 0,
        column: (location.range?.start?.character as number) || 0,
      };
    } catch (err) {
      debugLog(`[LSPServerManager] goToImplementation error: ${err}`);
      return null;
    }
  }

  async prepareCallHierarchy(filePath: string, line: number, character: number): Promise<LspCallHierarchyItem[] | null> {
    const client = await this.getClient(filePath);
    if (!client) return null;

    try {
      const params = {
        textDocument: { uri: `file://${filePath}` },
        position: { line, character },
      };

      const result = await (client as { sendRequest: (method: string, params: unknown) => Promise<unknown> }).sendRequest("textDocument/prepareCallHierarchy", params);

      return Array.isArray(result)
        ? result as LspCallHierarchyItem[]
        : result
          ? [result as LspCallHierarchyItem]
          : null;
    } catch (err) {
      debugLog(`[LSPServerManager] prepareCallHierarchy not supported: ${err}`);
      return null;
    }
  }

  async incomingCalls(filePath: string, line: number, character: number): Promise<ReferencesResult[]> {
    const client = await this.getClient(filePath);
    if (!client) return [];

    try {
      const prepareResult = await this.prepareCallHierarchy(filePath, line, character);
      if (!prepareResult || prepareResult.length === 0) return [];

      const calls: ReferencesResult[] = [];
      const clientProxy = client as { sendRequest: (method: string, params: unknown) => Promise<unknown> };

      for (const item of prepareResult) {
        const params = {
          item,
        };

        const result = await clientProxy.sendRequest("callHierarchy/incomingCalls", params);

        if (result && Array.isArray(result)) {
          for (const call of result as LspIncomingCall[]) {
            const from = call.from;
            const file = from?.uri ? fileUriToPath(from.uri) : null;
            if (!from || !file) continue;
            const range = call.fromRanges?.[0] ?? from.selectionRange ?? from.range;
            calls.push({
              file,
              line: range.start.line,
              column: range.start.character,
              symbolName: from.name || item.name,
            });
          }
        }
      }

      return calls;
    } catch (err) {
      debugLog(`[LSPServerManager] incomingCalls not supported: ${err}`);
      return [];
    }
  }

  async outgoingCalls(filePath: string, line: number, character: number): Promise<ReferencesResult[]> {
    const client = await this.getClient(filePath);
    if (!client) return [];

    try {
      const prepareResult = await this.prepareCallHierarchy(filePath, line, character);
      if (!prepareResult || prepareResult.length === 0) return [];

      const calls: ReferencesResult[] = [];
      const clientProxy = client as { sendRequest: (method: string, params: unknown) => Promise<unknown> };

      for (const item of prepareResult) {
        const params = {
          item,
        };

        const result = await clientProxy.sendRequest("callHierarchy/outgoingCalls", params);

        if (result && Array.isArray(result)) {
          for (const call of result as LspOutgoingCall[]) {
            const to = call.to;
            const file = to?.uri ? fileUriToPath(to.uri) : null;
            if (!to || !file) continue;
            const range = to.selectionRange ?? to.range;
            calls.push({
              file,
              line: range.start.line,
              column: range.start.character,
              symbolName: to.name || item.name,
            });
          }
        }
      }

      return calls;
    } catch (err) {
      debugLog(`[LSPServerManager] outgoingCalls not supported: ${err}`);
      return [];
    }
  }

  private detectLanguage(filePath: string): string | null {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      py: "python",
      ts: "typescript",
      tsx: "tsx",
      js: "javascript",
      jsx: "jsx",
      go: "go",
      rs: "rust",
      java: "java",
      cs: "csharp",
      cpp: "cpp",
      c: "c",
      php: "php",
      kt: "kotlin",
      rb: "ruby",
      html: "html",
      css: "css",
      json: "json",
      yaml: "yaml",
      yml: "yaml",
      xml: "xml",
      kotlin: "kotlin",
      ruby: "ruby",
      csharp: "csharp",
    };
    return ext ? langMap[ext] || null : null;
  }

  async formatDocument(filePath: string): Promise<any[] | null> {
    const { formatDocument } = await import("./index.js");
    return formatDocument(filePath, this.workspaceRoot);
  }

  async typeHierarchy(filePath: string, line: number, character: number): Promise<any[] | null> {
    const { getTypeHierarchy } = await import("./index.js");
    return getTypeHierarchy(filePath, line, character, this.workspaceRoot);
  }

  async inlayHint(filePath: string, line: number, character: number): Promise<any[] | null> {
    const { getInlayHints } = await import("./index.js");
    return getInlayHints(filePath, line, character, this.workspaceRoot);
  }

  async signatureHelp(filePath: string, line: number, character: number): Promise<any | null> {
    const { getSignatureHelp } = await import("./index.js");
    return getSignatureHelp(filePath, line, character, this.workspaceRoot);
  }

  async cleanup(): Promise<void> {
    const { cleanupLSPClients } = await import("./index.js");
    await cleanupLSPClients();
    this.clients.clear();
  }
}

const serverManagers = new Map<string, LSPServerManager>();

export function getLSPServerManager(workspaceRoot?: string): LSPServerManager {
  const root = workspaceRoot || process.cwd();

  if (!serverManagers.has(root)) {
    serverManagers.set(root, new LSPServerManager(root));
  }

  return serverManagers.get(root)!;
}

export function clearAllServerManagers(): void {
  serverManagers.clear();
}
