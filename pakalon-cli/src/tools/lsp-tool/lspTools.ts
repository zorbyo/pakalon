/**
 * LSP (Language Server Protocol) Integration Tools
 *
 * Provides IDE-like features:
 * - Goto Definition
 * - Hover Information
 * - Find References
 * - Workspace Symbols
 * - Diagnostics
 * - Completion
 */

import { spawn, spawnSync } from 'child_process';
import { statSync } from 'fs';
import { join, extname, relative, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { z } from 'zod/v4';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
import type { PermissionResult, ToolUseContext } from '../tool-types.js';

// LSP tool constants
export const LSP_TOOL_NAME = 'LSP';
export const LSP_GOTO_DEFINITION = 'lsp_goto_definition';
export const LSP_HOVER = 'lsp_hover';
export const LSP_FIND_REFS = 'lsp_find_references';
export const LSP_WORKSPACE_SYMBOLS = 'lsp_workspace_symbols';
export const LSP_DIAGNOSTICS = 'lsp_diagnostics';
export const LSP_COMPLETION = 'lsp_completion';
// Missing operations - add implementation
export const LSP_DOCUMENT_SYMBOLS = 'lsp_document_symbols';
export const LSP_FIND_IMPLEMENTATIONS = 'lsp_find_implementations';
export const LSP_CALL_HIERARCHY = 'lsp_call_hierarchy';
export const MAX_LSP_FILE_SIZE_BYTES = 10_000_000;

// Language server configurations
const LSP_SERVERS: Record<string, { command: string; args: string[]; filetypes: string[] }> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    filetypes: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    filetypes: ['.py'],
  },
  go: {
    command: 'gopls',
    args: ['serve'],
    filetypes: ['.go'],
  },
  rust: {
    command: 'rust-analyzer',
    args: ['--stdio'],
    filetypes: ['.rs'],
  },
};

// File extension to language mapping
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

interface LSPClient {
  process: ReturnType<typeof spawn>;
  initialized: boolean;
  requestId: number;
  pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
}

class LspSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LspSecurityError';
  }
}

function toLocalPath(filePath: string): string {
  if (filePath.startsWith('file://')) {
    try {
      return fileURLToPath(filePath);
    } catch {
      return filePath;
    }
  }
  return filePath;
}

function normalizeForGitCheck(filePath: string, cwd: string): string {
  const localPath = toLocalPath(filePath);
  const absolutePath = resolve(cwd, localPath);
  const relativePath = relative(resolve(cwd), absolutePath);
  return relativePath && !relativePath.startsWith('..') ? relativePath : absolutePath;
}

export function isUncPath(filePath: string): boolean {
  return /^([\\/]{2})/.test(filePath.trim());
}

async function getGitIgnoredPaths(filePaths: string[], cwd: string): Promise<Set<string>> {
  const ignored = new Set<string>();
  const uniquePaths = [...new Set(filePaths.map((filePath) => normalizeForGitCheck(filePath, cwd)))];

  if (uniquePaths.length === 0) {
    return ignored;
  }

  const batchSize = 100;
  for (let i = 0; i < uniquePaths.length; i += batchSize) {
    const batch = uniquePaths.slice(i, i + batchSize);
    const result = spawnSync('git', ['check-ignore', '--no-index', '--exclude-standard', ...batch], {
      cwd,
      encoding: 'utf-8',
    });

    if (result.error) {
      continue;
    }

    const output = String(result.stdout ?? '').trim();
    if (!output) {
      continue;
    }

    for (const line of output.split(/\r?\n/)) {
      const ignoredPath = line.trim();
      if (ignoredPath) {
        ignored.add(ignoredPath);
      }
    }
  }

  return ignored;
}

export async function isGitIgnored(filePath: string, cwd: string): Promise<boolean> {
  const ignored = await getGitIgnoredPaths([filePath], cwd);
  return ignored.has(normalizeForGitCheck(filePath, cwd));
}

async function filterGitignoredLocationResults<T>(
  results: T[],
  cwd: string,
  getFilePath: (result: T) => string | undefined,
): Promise<T[]> {
  if (results.length === 0) {
    return results;
  }

  const paths = results.map(getFilePath).filter((filePath): filePath is string => Boolean(filePath));
  const ignored = await getGitIgnoredPaths(paths, cwd);

  return results.filter((result) => {
    const filePath = getFilePath(result);
    if (!filePath) {
      return true;
    }
    return !ignored.has(normalizeForGitCheck(filePath, cwd));
  });
}

function assertLocalFileAllowed(filePath: string): string {
  if (isUncPath(filePath)) {
    throw new LspSecurityError(`Blocked UNC path: ${filePath}`);
  }

  const resolvedPath = resolve(filePath);
  try {
    const stats = statSync(resolvedPath);
    if (stats.size > MAX_LSP_FILE_SIZE_BYTES) {
      throw new LspSecurityError(
        `Blocked file larger than ${MAX_LSP_FILE_SIZE_BYTES} bytes: ${resolvedPath} (${stats.size} bytes)`,
      );
    }
  } catch (error) {
    if (isLspSecurityError(error)) {
      throw error;
    }
    throw new LspSecurityError(`Blocked inaccessible file: ${resolvedPath}`);
  }

  return resolvedPath;
}

function localPathToFileUri(filePath: string): string {
  return pathToFileURL(resolve(filePath)).href;
}

class LSPClientManager {
  private clients: Map<string, LSPClient> = new Map();
  private tempDir: string;

  constructor() {
    this.tempDir = join(process.cwd(), '.pakalon', 'lsp-tmp');
  }

  private ensureTempDir() {
    try {
      const { mkdirSync } = require('fs');
      mkdirSync(this.tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }

  private checkLocalFileSecurity(filePath: string): string {
    return assertLocalFileAllowed(filePath);
  }

  private async filterLocationResults<T extends { uri: string }>(results: T[]): Promise<T[]> {
    return filterGitignoredLocationResults(results, process.cwd(), (result) => toLocalPath(result.uri));
  }

  private async filterWorkspaceSymbolResults<T extends { location: { uri: string } }>(results: T[]): Promise<T[]> {
    return filterGitignoredLocationResults(results, process.cwd(), (result) => toLocalPath(result.location.uri));
  }

  getClient(language: string): LSPClient | null {
    if (this.clients.has(language)) {
      return this.clients.get(language)!;
    }

    const config = LSP_SERVERS[language];
    if (!config) {
      return null;
    }

    // Check if language server is available
    const { which } = require('which');
    if (!which(config.command)) {
      return null;
    }

    this.ensureTempDir();

    const process = spawn(config.command, config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TMPDIR: this.tempDir },
    });

    const client: LSPClient = {
      process,
      initialized: false,
      requestId: 0,
      pendingRequests: new Map(),
    };

    // Handle responses
    process.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim() || line.startsWith('Content-Length:')) continue;
        try {
          const response = JSON.parse(line);
          if (response.id !== undefined && client.pendingRequests.has(response.id)) {
            const pending = client.pendingRequests.get(response.id)!;
            client.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch {
          // Ignore parse errors for non-JSON output
        }
      }
    });

    // Initialize the client
    this.initializeClient(client, language);

    this.clients.set(language, client);
    return client;
  }

  private initializeClient(client: LSPClient, language: string) {
    // Send initialize request
    const initParams = {
      processId: process.pid,
      rootUri: `file://${process.cwd()}`,
      capabilities: {
        textDocument: {
          hover: { dynamicRegistration: true },
          definition: { dynamicRegistration: true },
          references: { dynamicRegistration: true },
          completion: { dynamicRegistration: true },
        },
        workspace: {
          symbols: { dynamicRegistration: true },
        },
      },
    };

    this.sendRequest(client, 'initialize', initParams)
      .then(() => {
        client.initialized = true;
        this.sendNotification(client, 'initialized', {});
      })
      .catch(() => {
        // Failed to initialize - client won't work
      });
  }

  private sendRequest(client: LSPClient, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++client.requestId;
      client.pendingRequests.set(id, { resolve, reject });

      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const content = JSON.stringify(message);
      const header = `Content-Length: ${content.length}\r\n\r\n`;

      client.process.stdin.write(header + content);
    });
  }

  private sendNotification(client: LSPClient, method: string, params: unknown) {
    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const content = JSON.stringify(message);
    const header = `Content-Length: ${content.length}\r\n\r\n`;

    client.process.stdin.write(header + content);
  }

  async gotoDefinition(
    language: string,
    filePath: string,
    line: number,
    character: number
  ): Promise<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } | null> {
    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return null;
    }

    const resolvedFilePath = this.checkLocalFileSecurity(filePath);

    const params = {
      textDocument: { uri: localPathToFileUri(resolvedFilePath) },
      position: { line: line - 1, character: character - 1 },
    };

    try {
      const result = await this.sendRequest(client, 'textDocument/definition', params);
      if (!result) return null;
      const filtered = await this.filterLocationResults((Array.isArray(result) ? result : [result]) as Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>);
      return filtered[0] || null;
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return null;
    }
  }

  async hover(
    language: string,
    filePath: string,
    line: number,
    character: number
  ): Promise<{ contents: string; range?: { start: { line: number; character: number }; end: { line: number; character: number } } } | null> {
    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return null;
    }

    const resolvedFilePath = this.checkLocalFileSecurity(filePath);

    const params = {
      textDocument: { uri: localPathToFileUri(resolvedFilePath) },
      position: { line: line - 1, character: character - 1 },
    };

    try {
      const result = await this.sendRequest(client, 'textDocument/hover', params);
      if (!result) return null;
      const hoverResult = result as { contents?: unknown };
      if (!hoverResult.contents) return null;

      // Extract text content from hover result
      if (typeof hoverResult.contents === 'string') {
        return { contents: hoverResult.contents };
      }
      if (hoverResult.contents && typeof hoverResult.contents === 'object' && 'value' in hoverResult.contents) {
        return { contents: String(hoverResult.contents.value) };
      }
      return { contents: JSON.stringify(hoverResult.contents) };
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return null;
    }
  }

  async findReferences(
    language: string,
    filePath: string,
    line: number,
    character: number
  ): Promise<Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } }; name?: string }>> {
    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return [];
    }

    const resolvedFilePath = this.checkLocalFileSecurity(filePath);

    const params = {
      textDocument: { uri: localPathToFileUri(resolvedFilePath) },
      position: { line: line - 1, character: character - 1 },
      context: { includeDeclaration: true },
    };

    try {
      const result = await this.sendRequest(client, 'textDocument/references', params);
      const filtered = await this.filterLocationResults((result as Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } }; name?: string }>) || []);
      return filtered;
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return [];
    }
  }

  async workspaceSymbols(query: string): Promise<Array<{ name: string; kind: number; location: { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } }>> {
    const symbols: Array<{
      name: string;
      kind: number;
      location: { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } };
    }> = [];

    for (const language of Object.keys(LSP_SERVERS)) {
      const client = this.getClient(language);
      if (!client || !client.initialized) continue;

      const params = { query, workspaceFolders: [{ uri: `file://${process.cwd()}`, name: 'root' }] };

      try {
        const result = await this.sendRequest(client, 'workspace/symbol', params);
        if (Array.isArray(result)) {
          symbols.push(...result);
        }
      } catch {
        // Ignore errors for individual languages
      }
    }

    return this.filterWorkspaceSymbolResults(symbols);
  }

  async diagnostics(filePath?: string): Promise<Array<{ uri: string; diagnostics: Array<{ severity: number; message: string; range: { start: { line: number; character: number }; end: { line: number; character: number } }; source?: string }> }>> {
    const results: Array<{
      uri: string;
      diagnostics: Array<{
        severity: number;
        message: string;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        source?: string;
      }>;
    }> = [];

    for (const language of Object.keys(LSP_SERVERS)) {
      const client = this.getClient(language);
      if (!client || !client.initialized) continue;

      if (filePath) {
        // Get diagnostics for specific file
        const resolvedFilePath = this.checkLocalFileSecurity(filePath);
        const params = { textDocument: { uri: localPathToFileUri(resolvedFilePath) } };
        try {
          const result = await this.sendRequest(client, 'textDocument/diagnostic', params);
          if (result) {
            results.push({ uri: localPathToFileUri(resolvedFilePath), diagnostics: result as Array<{ severity: number; message: string; range: { start: { line: number; character: number }; end: { line: number; character: number } }; source?: string }> });
          }
        } catch (error) {
          if (error instanceof LspSecurityError) {
            throw error;
          }
          // Ignore
        }
      } else {
        // Get all open documents' diagnostics
        for (const [lang, config] of Object.entries(LSP_SERVERS)) {
          const exts = config.filetypes;
          // Check common source files
          const glob = require('tinyglobby').glob;
          for (const ext of exts) {
            const pattern = `**/*${ext}`;
            const files = glob(pattern, { cwd: process.cwd() }).slice(0, 50); // Limit to avoid too many files
            const ignored = await getGitIgnoredPaths(files, process.cwd());
            for (const file of files) {
              const fullPath = join(process.cwd(), file);
              if (ignored.has(normalizeForGitCheck(fullPath, process.cwd()))) {
                continue;
              }
              try {
                this.checkLocalFileSecurity(fullPath);
              } catch (error) {
                continue;
              }
              const params = { textDocument: { uri: localPathToFileUri(fullPath) } };
              try {
                const result = await this.sendRequest(client, 'textDocument/diagnostic', params);
                if (result) {
                  results.push({
                    uri: localPathToFileUri(fullPath),
                    diagnostics: result as Array<{
                      severity: number;
                      message: string;
                      range: { start: { line: number; character: number }; end: { line: number; character: number } };
                      source?: string;
                    }>,
                  });
                }
              } catch {
                // Ignore
              }
            }
          }
        }
      }
    }

    return results;
  }

  async completion(
    language: string,
    filePath: string,
    line: number,
    character: number,
    triggerCharacter?: string
  ): Promise<Array<{ label: string; kind?: number; detail?: string; documentation?: string }>> {
    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return [];
    }

    const resolvedFilePath = this.checkLocalFileSecurity(filePath);

    const params = {
      textDocument: { uri: localPathToFileUri(resolvedFilePath) },
      position: { line: line - 1, character: character - 1 },
      context: triggerCharacter
        ? { triggerKind: 2, triggerCharacter }
        : { triggerKind: 1 },
    };

    try {
      const result = await this.sendRequest(client, 'textDocument/completion', params);
      if (!result) return [];
      // Handle both CompletionList and CompletionItem[] responses
      if (Array.isArray(result)) {
        return result.map((item: { label: string; kind?: number; detail?: string; documentation?: string }) => ({
          label: item.label,
          kind: item.kind,
          detail: item.detail,
          documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
        }));
      }
      if (result && typeof result === 'object' && 'items' in result) {
        return ((result as { items: Array<{ label: string; kind?: number; detail?: string; documentation?: string }> }).items || []).map((item) => ({
          label: item.label,
          kind: item.kind,
          detail: item.detail,
          documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
        }));
      }
      return [];
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return [];
    }
  }

  // ========== MISSING LSP OPERATIONS ==========

  /**
   * textDocument/documentSymbol
   * List all symbols defined in a document
   */
  async documentSymbols(
    filePath: string
  ): Promise<Array<{
    name: string;
    kind: number;
    detail?: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
    children?: Array<unknown>;
  }>> {
    // Find which language server handles this file
    const ext = extname(filePath).toLowerCase();
    let language: string | null = null;

    for (const [lang, config] of Object.entries(LSP_SERVERS)) {
      if (config.filetypes.includes(ext as never)) {
        language = lang;
        break;
      }
    }

    if (!language) {
      return [];
    }

    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return [];
    }

    const resolvedFilePath = this.checkLocalFileSecurity(filePath);

    const params = {
      textDocument: { uri: localPathToFileUri(resolvedFilePath) },
    };

    try {
      const result = await this.sendRequest(client, 'textDocument/documentSymbol', params);
      if (!result) return [];
      // DocumentSymbol response can be flat array or hierarchical
      if (Array.isArray(result)) {
        return result as Array<{
          name: string;
          kind: number;
          detail?: string;
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
          children?: Array<unknown>;
        }>;
      }
      return [];
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * textDocument/implementation
   * Find all implementations of a symbol (interface/implementation)
   */
  async findImplementations(
    language: string,
    filePath: string,
    line: number,
    character: number
  ): Promise<Array<{
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  }>> {
    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return [];
    }

    const resolvedFilePath = this.checkLocalFileSecurity(filePath);

    const params = {
      textDocument: { uri: localPathToFileUri(resolvedFilePath) },
      position: { line: line - 1, character: character - 1 },
    };

    try {
      const result = await this.sendRequest(client, 'textDocument/implementation', params);
      if (!result) return [];
      if (Array.isArray(result)) {
        return this.filterLocationResults(result as Array<{
          uri: string;
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
        }>);
      }
      return [];
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * textDocument/callHierarchy
   * Find call hierarchy (callees and callers)
   */
  async callHierarchy(
    language: string,
    filePath: string,
    line: number,
    character: number,
    direction: 'incoming' | 'outgoing' = 'outgoing'
  ): Promise<Array<{
    name: string;
    kind: number;
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    detail?: string;
  }>> {
    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return [];
    }

    const resolvedFilePath = this.checkLocalFileSecurity(filePath);

    try {
      // First, prepare the call hierarchy by requesting incoming/outgoing calls
      const params = {
        textDocument: { uri: localPathToFileUri(resolvedFilePath) },
        position: { line: line - 1, character: character - 1 },
      };

      // Call hierarchy requires a prepare call first, then expansions
      const prepareResult = await this.sendRequest(client, 'textDocument/prepareCallHierarchy', params);
      if (!prepareResult) return [];

      const prepareItems = Array.isArray(prepareResult) ? prepareResult : [prepareResult];

      const results: Array<{
        name: string;
        kind: number;
        uri: string;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        detail?: string;
      }> = [];

      for (const item of prepareItems) {
        const callParams = {
          item: {
            symbolName: (item as { name: string }).name,
            kind: (item as { kind: number }).kind,
            uri: (item as { uri: string }).uri,
            range: (item as { range: { start: { line: number; character: number }; end: { line: number; character: number } } }).range,
            selectionRange: (item as { selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } } }).selectionRange,
          },
        };

        const method = direction === 'incoming'
          ? 'callHierarchy/incomingCalls'
          : 'callHierarchy/outgoingCalls';

        const result = await this.sendRequest(client, method, callParams);
        if (result && Array.isArray(result)) {
          for (const calls of result) {
            if (Array.isArray(calls)) {
              for (const call of calls) {
                const fromOrTo = direction === 'incoming'
                  ? (call as { from?: { name: string; kind: number; detail?: string; uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } }).from
                  : (call as { to?: { name: string; kind: number; detail?: string; uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } }).to;

                if (fromOrTo) {
                  results.push({
                    name: fromOrTo.name,
                    kind: fromOrTo.kind,
                    uri: fromOrTo.uri,
                    range: fromOrTo.range,
                    detail: fromOrTo.detail,
                  });
                }
              }
            }
          }
        }
      }

      return await this.filterLocationResults(results);
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return [];
    }
  }
}

// Singleton instance
const lspClientManager = new LSPClientManager();

// Helper to get language from file path
function getLanguageForFile(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] || null;
}

// Helper to convert LSP severity to human-readable
function severityToString(severity: number): string {
  switch (severity) {
    case 1: return 'Error';
    case 2: return 'Warning';
    case 3: return 'Info';
    case 4: return 'Hint';
    default: return 'Unknown';
  }
}

function isLspSecurityError(error: unknown): error is LspSecurityError {
  return error instanceof LspSecurityError;
}

function securityMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'LSP security check failed';
}

async function fileAccessPermissionCheck(
  input: { file_path?: string; query?: string },
  context: ToolUseContext,
  action: string,
): Promise<PermissionResult> {
  if (context.mode === 'bypassPermissions' || context.mode === 'auto') {
    return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
  }

  if (context.mode === 'plan') {
    return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
  }

  const target = input.file_path ?? input.query ?? 'workspace';
  return {
    behavior: 'ask',
    message: `${action}: ${target}`,
    updatedInput: input as Record<string, unknown>,
  };
}

function isLspSecurityError(error: unknown): error is LspSecurityError {
  return error instanceof LspSecurityError;
}

function securityMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'LSP security check failed';
}

async function fileAccessPermissionCheck(
  input: { file_path?: string; query?: string },
  context: import('../../tools/tool-types.js').ToolUseContext,
  action: string,
): Promise<import('../../tools/tool-types.js').PermissionResult> {
  if (context.mode === 'bypassPermissions' || context.mode === 'auto') {
    return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
  }

  if (context.mode === 'plan') {
    return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
  }

  const target = input.file_path ?? input.query ?? 'workspace';
  return {
    behavior: 'ask',
    message: `${action}: ${target}`,
    updatedInput: input as Record<string, unknown>,
  };
}

// =====================
// Tool Definitions
// =====================

const gotoDefinitionInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path to search in'),
    line: z.number().int().positive().describe('Line number (1-based)'),
    character: z.number().int().nonnegative().describe('Character position (0-based)'),
  }),
);

const gotoDefinitionOutput = lazySchema(() =>
  z.object({
    found: z.boolean(),
    file: z.string().optional(),
    line: z.number().optional(),
    character: z.number().optional(),
    message: z.string().optional(),
  }),
);

export const gotoDefinitionTool = buildTool({
  name: LSP_GOTO_DEFINITION,
  searchHint: 'goto definition, go to symbol definition, LSP definition lookup',
  maxResultSizeChars: 50_000,
  async description() {
    return 'Navigate to the definition of a symbol at the cursor position using LSP';
  },
  get inputSchema() {
    return gotoDefinitionInput();
  },
  get outputSchema() {
    return gotoDefinitionOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP goto definition');
  },
  async execute(input, extras) {
    const language = getLanguageForFile(input.file_path);
    if (!language) {
      return { found: false, message: 'Unsupported file type for LSP' };
    }

    try {
      const result = await lspClientManager.gotoDefinition(language, input.file_path, input.line, input.character);

      if (!result) {
        return { found: false, message: 'No definition found' };
      }

      const uri = result.uri.replace('file://', '');
      const startLine = result.range.start.line + 1;
      const startChar = result.range.start.character + 1;

      return {
        found: true,
        file: uri,
        line: startLine,
        character: startChar,
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { found: false, message: securityMessage(error) };
      }
      throw error;
    }
  },
});

// -----

const hoverInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path'),
    line: z.number().int().positive().describe('Line number (1-based)'),
    character: z.number().int().nonnegative().describe('Character position (0-based)'),
  }),
);

const hoverOutput = lazySchema(() =>
  z.object({
    found: z.boolean(),
    content: z.string().optional(),
    message: z.string().optional(),
  }),
);

export const hoverTool = buildTool({
  name: LSP_HOVER,
  searchHint: 'hover, type info, documentation on hover, LSP hover',
  maxResultSizeChars: 50_000,
  async description() {
    return 'Get hover information (type documentation) for a symbol using LSP';
  },
  get inputSchema() {
    return hoverInput();
  },
  get outputSchema() {
    return hoverOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP hover');
  },
  async execute(input) {
    const language = getLanguageForFile(input.file_path);
    if (!language) {
      return { found: false, message: 'Unsupported file type for LSP' };
    }

    try {
      const result = await lspClientManager.hover(language, input.file_path, input.line, input.character);

      if (!result) {
        return { found: false, message: 'No hover information available' };
      }

      return { found: true, content: result.contents };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { found: false, message: securityMessage(error) };
      }
      throw error;
    }
  },
});

// -----

const findRefsInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path'),
    line: z.number().int().positive().describe('Line number (1-based)'),
    character: z.number().int().nonnegative().describe('Character position (0-based)'),
  }),
);

const findRefsOutput = lazySchema(() =>
  z.object({
    count: z.number(),
    references: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        character: z.number(),
        name: z.string().optional(),
      }),
    ),
  }),
);

export const findRefsTool = buildTool({
  name: LSP_FIND_REFS,
  searchHint: 'find references, find usages, where is symbol used, LSP references',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Find all references to a symbol using LSP';
  },
  get inputSchema() {
    return findRefsInput();
  },
  get outputSchema() {
    return findRefsOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP find references');
  },
  async execute(input) {
    const language = getLanguageForFile(input.file_path);
    if (!language) {
      return { count: 0, references: [], message: 'Unsupported file type' };
    }

    try {
      const results = await lspClientManager.findReferences(language, input.file_path, input.line, input.character);

      return {
        count: results.length,
        references: results.map((ref) => ({
          file: ref.uri.replace('file://', ''),
          line: ref.range.start.line + 1,
          character: ref.range.start.character + 1,
          name: ref.name,
        })),
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { count: 0, references: [] };
      }
      throw error;
    }
  },
});

// -----

const workspaceSymbolsInput = lazySchema(() =>
  z.strictObject({
    query: z.string().describe('Symbol name to search for'),
    kind: z
      .enum(['all', 'file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key', 'null', 'enummember', 'struct', 'event', 'operator', 'typeparameter'])
      .optional()
      .default('all')
      .describe('Filter by symbol kind'),
  }),
);

const workspaceSymbolsOutput = lazySchema(() =>
  z.object({
    count: z.number(),
    symbols: z.array(
      z.object({
        name: z.string(),
        kind: z.string(),
        file: z.string(),
        line: z.number(),
        character: z.number(),
      }),
    ),
  }),
);

// Kind numbers mapping
const KIND_MAP: Record<number, string> = {
  1: 'file',
  2: 'module',
  3: 'namespace',
  4: 'package',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'constructor',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'string',
  16: 'number',
  17: 'boolean',
  18: 'array',
  19: 'object',
  20: 'key',
  21: 'null',
  22: 'enummember',
  23: 'struct',
  24: 'event',
  25: 'operator',
  26: 'typeparameter',
};

export const workspaceSymbolsTool = buildTool({
  name: LSP_WORKSPACE_SYMBOLS,
  searchHint: 'workspace symbols, search symbols, find functions classes, LSP symbols',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Search for symbols (functions, classes, variables) across the workspace using LSP';
  },
  get inputSchema() {
    return workspaceSymbolsInput();
  },
  get outputSchema() {
    return workspaceSymbolsOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck({ query: input.query }, context, 'Use LSP workspace symbols');
  },
  async execute(input) {
    try {
      const results = await lspClientManager.workspaceSymbols(input.query);

      return {
        count: results.length,
        symbols: results.map((sym) => ({
          name: sym.name,
          kind: KIND_MAP[sym.kind] || 'unknown',
          file: sym.location.uri.replace('file://', ''),
          line: sym.location.range.start.line + 1,
          character: sym.location.range.start.character + 1,
        })),
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { count: 0, symbols: [] };
      }
      throw error;
    }
  },
});

// -----

const diagnosticsInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().optional().describe('Specific file to check (optional, checks all if not provided)'),
    severity: z.enum(['error', 'warning', 'info', 'hint', 'all']).optional().default('all').describe('Minimum severity to include'),
  }),
);

const diagnosticsOutput = lazySchema(() =>
  z.object({
    files_checked: z.number(),
    total_issues: z.number(),
    issues: z.array(
      z.object({
        file: z.string(),
        severity: z.string(),
        message: z.string(),
        line: z.number(),
        column: z.number(),
        source: z.string().optional(),
      }),
    ),
  }),
);

export const diagnosticsTool = buildTool({
  name: LSP_DIAGNOSTICS,
  searchHint: 'diagnostics, errors, warnings, lint, type errors, LSP diagnostics',
  maxResultSizeChars: 200_000,
  async description() {
    return 'Run LSP diagnostics to find errors, warnings, and other issues in the codebase';
  },
  get inputSchema() {
    return diagnosticsInput();
  },
  get outputSchema() {
    return diagnosticsOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck({ file_path: input.file_path }, context, 'Use LSP diagnostics');
  },
  async execute(input) {
    const severityMap: Record<string, number> = {
      error: 1,
      warning: 2,
      info: 3,
      hint: 4,
    };

    const minSeverity = severityMap[input.severity || 'all'] || 0;

    try {
      const results = await lspClientManager.diagnostics(input.file_path);

      const allIssues: Array<{
        file: string;
        severity: string;
        message: string;
        line: number;
        column: number;
        source?: string;
      }> = [];

      for (const fileResult of results) {
        for (const diag of fileResult.diagnostics) {
          if (diag.severity > minSeverity && minSeverity > 0) continue;
          allIssues.push({
            file: fileResult.uri.replace('file://', ''),
            severity: severityToString(diag.severity),
            message: diag.message,
            line: diag.range.start.line + 1,
            column: diag.range.start.character + 1,
            source: diag.source,
          });
        }
      }

      return {
        files_checked: results.length,
        total_issues: allIssues.length,
        issues: allIssues,
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { files_checked: 0, total_issues: 0, issues: [] };
      }
      throw error;
    }
  },
});

// -----

const completionInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path for completion'),
    line: z.number().int().positive().describe('Line number (1-based)'),
    character: z.number().int().nonnegative().describe('Character position (0-based)'),
    trigger_character: z.string().optional().describe('Character that triggered completion (e.g., ".", "(")'),
  }),
);

const completionOutput = lazySchema(() =>
  z.object({
    count: z.number(),
    completions: z.array(
      z.object({
        label: z.string(),
        kind: z.string().optional(),
        detail: z.string().optional(),
        documentation: z.string().optional(),
      }),
    ),
  }),
);

// Kind numbers for completion items
const COMPLETION_KIND_MAP: Record<number, string> = {
  1: 'text',
  2: 'method',
  3: 'function',
  4: 'constructor',
  5: 'field',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'module',
  10: 'property',
  11: 'unit',
  12: 'value',
  13: 'enum',
  14: 'keyword',
  15: 'snippet',
  16: 'color',
  17: 'file',
  18: 'reference',
  19: 'folder',
  20: 'enummember',
  21: 'constant',
  22: 'struct',
  23: 'event',
  24: 'operator',
  25: 'typeparameter',
};

export const completionTool = buildTool({
  name: LSP_COMPLETION,
  searchHint: 'completion, autocomplete, suggestions, LSP completion',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Get code completion suggestions at the cursor position using LSP';
  },
  get inputSchema() {
    return completionInput();
  },
  get outputSchema() {
    return completionOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP completion');
  },
  async execute(input) {
    const language = getLanguageForFile(input.file_path);
    if (!language) {
      return { count: 0, completions: [], message: 'Unsupported file type' };
    }

    try {
      const results = await lspClientManager.completion(
        language,
        input.file_path,
        input.line,
        input.character,
        input.trigger_character
      );

      return {
        count: results.length,
        completions: results.map((item) => ({
          label: item.label,
          kind: item.kind ? COMPLETION_KIND_MAP[item.kind] || 'text' : undefined,
          detail: item.detail,
          documentation: item.documentation,
        })),
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { count: 0, completions: [] };
      }
      throw error;
    }
  },
});

// ========== MISSING LSP OPERATIONS TOOLS ==========

const documentSymbolsInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path to list symbols from'),
  }),
);

const documentSymbolsOutput = lazySchema(() =>
  z.object({
    count: z.number(),
    symbols: z.array(
      z.object({
        name: z.string(),
        kind: z.number(),
        detail: z.string().optional(),
        line: z.number(),
        character: z.number(),
      })
    ),
    message: z.string().optional(),
  }),
);

export const documentSymbolsTool = buildTool({
  name: LSP_DOCUMENT_SYMBOLS,
  searchHint: 'document symbols, list symbols in file, document outline, LSP document symbols',
  maxResultSizeChars: 100_000,
  async description() {
    return 'List all symbols (functions, classes, variables, etc.) defined in a document using LSP documentSymbol';
  },
  get inputSchema() {
    return documentSymbolsInput();
  },
  get outputSchema() {
    return documentSymbolsOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP document symbols');
  },
  async execute(input) {
    try {
      const results = await lspClientManager.documentSymbols(input.file_path);

      return {
        count: results.length,
        symbols: results.map((item) => ({
          name: item.name,
          kind: item.kind,
          detail: item.detail,
          line: item.selectionRange.start.line + 1,
          character: item.selectionRange.start.character + 1,
        })),
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { count: 0, symbols: [] };
      }
      throw error;
    }
  },
});

const findImplementationsInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path to search in'),
    line: z.number().int().positive().describe('Line number (1-based)'),
    character: z.number().int().nonnegative().describe('Character position (0-based)'),
  }),
);

const findImplementationsOutput = lazySchema(() =>
  z.object({
    count: z.number(),
    implementations: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        character: z.number(),
      })
    ),
    message: z.string().optional(),
  }),
);

export const findImplementationsTool = buildTool({
  name: LSP_FIND_IMPLEMENTATIONS,
  searchHint: 'find implementations, go to implementation, LSP implementation lookup, interface implementations',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Find all implementations of a symbol (e.g., interface implementations) using LSP textDocument/implementation';
  },
  get inputSchema() {
    return findImplementationsInput();
  },
  get outputSchema() {
    return findImplementationsOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP find implementations');
  },
  async execute(input) {
    const language = getLanguageForFile(input.file_path);
    if (!language) {
      return { count: 0, implementations: [], message: 'Unsupported file type' };
    }

    try {
      const results = await lspClientManager.findImplementations(
        language,
        input.file_path,
        input.line,
        input.character
      );

      return {
        count: results.length,
        implementations: results.map((item) => ({
          file: item.uri.replace('file://', ''),
          line: item.range.start.line + 1,
          character: item.range.start.character + 1,
        })),
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { count: 0, implementations: [] };
      }
      throw error;
    }
  },
});

const callHierarchyInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path to search in'),
    line: z.number().int().positive().describe('Line number (1-based)'),
    character: z.number().int().nonnegative().describe('Character position (0-based)'),
    direction: z.enum(['incoming', 'outgoing']).optional().default('outgoing').describe('Call direction: incoming (callers) or outgoing (callees)'),
  }),
);

const callHierarchyOutput = lazySchema(() =>
  z.object({
    count: z.number(),
    calls: z.array(
      z.object({
        name: z.string(),
        kind: z.number(),
        file: z.string(),
        line: z.number(),
        character: z.number(),
        detail: z.string().optional(),
      })
    ),
    message: z.string().optional(),
  }),
);

export const callHierarchyTool = buildTool({
  name: LSP_CALL_HIERARCHY,
  searchHint: 'call hierarchy, callers, callees, function calls, LSP call hierarchy',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Find call hierarchy (incoming calls/callers or outgoing calls/callees) for a symbol using LSP callHierarchy';
  },
  get inputSchema() {
    return callHierarchyInput();
  },
  get outputSchema() {
    return callHierarchyOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP call hierarchy');
  },
  async execute(input) {
    const language = getLanguageForFile(input.file_path);
    if (!language) {
      return { count: 0, calls: [], message: 'Unsupported file type' };
    }

    try {
      const results = await lspClientManager.callHierarchy(
        language,
        input.file_path,
        input.line,
        input.character,
        input.direction || 'outgoing'
      );

      return {
        count: results.length,
        calls: results.map((item) => ({
          name: item.name,
          kind: item.kind,
          file: item.uri.replace('file://', ''),
          line: item.range.start.line + 1,
          character: item.range.start.character + 1,
          detail: item.detail,
        })),
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { count: 0, calls: [] };
      }
      throw error;
    }
  },
});

// Export all LSP tools
export const lspTools = [
  gotoDefinitionTool,
  hoverTool,
  findRefsTool,
  workspaceSymbolsTool,
  diagnosticsTool,
  completionTool,
  documentSymbolsTool,
  findImplementationsTool,
  callHierarchyTool,
];
