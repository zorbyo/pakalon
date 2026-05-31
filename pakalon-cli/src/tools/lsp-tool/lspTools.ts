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
export const LSP_RENAME = 'lsp_rename';
export const LSP_TYPE_DEFINITION = 'lsp_type_definition';
export const LSP_CODE_ACTIONS = 'lsp_code_actions';
export const LSP_STATUS = 'lsp_status';
export const LSP_CAPABILITIES = 'lsp_capabilities';
export const LSP_RELOAD = 'lsp_reload';
export const MAX_LSP_FILE_SIZE_BYTES = 10_000_000;

// Language server configurations - expanded to support more languages
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
  java: {
    command: 'jdtls',
    args: ['-data', '${workspaceFolder}/.jdtls'],
    filetypes: ['.java'],
  },
  csharp: {
    command: 'omnisharp',
    args: ['--languageserver', '--hostPID', '${pid}'],
    filetypes: ['.cs'],
  },
  cpp: {
    command: 'clangd',
    args: ['--header-insertion=never'],
    filetypes: ['.cpp', '.c', '.cc', '.h', '.hpp'],
  },
  ruby: {
    command: 'solargraph',
    args: ['stdio'],
    filetypes: ['.rb'],
  },
  php: {
    command: 'intelephense',
    args: ['--stdio'],
    filetypes: ['.php'],
  },
  swift: {
    command: 'sourcekit-lsp',
    args: [],
    filetypes: ['.swift'],
  },
  kotlin: {
    command: 'kotlin-language-server',
    args: [],
    filetypes: ['.kt', '.kts'],
  },
  scala: {
    command: 'metals',
    args: ['stdin'],
    filetypes: ['.scala'],
  },
  elixir: {
    command: 'elixir-ls',
    args: [],
    filetypes: ['.ex', '.exs'],
  },
  erlang: {
    command: 'erlang_ls',
    args: [],
    filetypes: ['.erl', '.hrl'],
  },
  dart: {
    command: 'dart',
    args: ['language-server'],
    filetypes: ['.dart'],
  },
  haskell: {
    command: 'haskell-language-server-wrapper',
    args: ['--lsp'],
    filetypes: ['.hs', '.lhs'],
  },
  lua: {
    command: 'lua-language-server',
    args: [],
    filetypes: ['.lua'],
  },
  yaml: {
    command: 'yaml-language-server',
    args: ['--stdio'],
    filetypes: ['.yaml', '.yml'],
  },
  xml: {
    command: 'lemminx',
    args: [],
    filetypes: ['.xml'],
  },
  css: {
    command: 'css-languageserver',
    args: ['--stdio'],
    filetypes: ['.css', '.scss', '.less'],
  },
  html: {
    command: 'html-languageserver',
    args: ['--stdio'],
    filetypes: ['.html', '.htm'],
  },
  json: {
    command: 'json-languageserver',
    args: ['--stdio'],
    filetypes: ['.json'],
  },
  markdown: {
    command: 'marksman',
    args: [],
    filetypes: ['.md', '.markdown'],
  },
  terraform: {
    command: 'terraform-ls',
    args: ['serve'],
    filetypes: ['.tf', '.tfvars'],
  },
  dockerfile: {
    command: 'docker-langserver',
    args: ['--stdio'],
    filetypes: ['Dockerfile', '.dockerfile'],
  },
  bash: {
    command: 'bash-language-server',
    args: ['start'],
    filetypes: ['.sh', '.bash'],
  },
  powershell: {
    command: 'pwsh',
    args: ['-NoLogo', '-NoProfile', '-Command', "Import-Module PowerShellEditorServices; Start-EditorServices ..."],
    filetypes: ['.ps1', '.psm1', '.psd1'],
  },
  verilog: {
    command: 'verible',
    args: ['--lspServer', 'stdin'],
    filetypes: ['.v', '.sv', '.svh'],
  },
  vhdl: {
    command: 'vhdl_ls',
    args: [],
    filetypes: ['.vhd', '.vhdl'],
  },
  solidity: {
    command: 'solc',
    args: ['--language-server'],
    filetypes: ['.sol'],
  },
  zig: {
    command: 'zls',
    args: [],
    filetypes: ['.zig'],
  },
  nim: {
    command: 'nimlsp',
    args: [],
    filetypes: ['.nim', '.nims'],
  },
  r: {
    command: 'languageserver',
    args: [],
    filetypes: ['.R', '.r'],
  },
  julia: {
    command: 'julia',
    args: ['--project', '-e', 'using LanguageServer; runserver()'],
    filetypes: ['.jl'],
  },
  clojure: {
    command: 'clojure-lsp',
    args: [],
    filetypes: ['.clj', '.cljs', '.cljc', '.edn'],
  },
  fsharp: {
    command: 'fsautocomplete',
    args: ['--mode', 'lsp'],
    filetypes: ['.fs', '.fsx', '.fsi', '.fsscript'],
  },
  groovy: {
    command: 'groovy-language-server',
    args: [],
    filetypes: ['.groovy'],
  },
  objective_c: {
    command: 'clangd',
    args: ['--header-insertion=never'],
    filetypes: ['.m', '.mm'],
  },
  fortran: {
    command: 'fortls',
    args: [],
    filetypes: ['.f', '.for', '.f90', '.f95', '.f03', '.f08'],
  },
  pascal: {
    command: 'pascal-language-server',
    args: [],
    filetypes: ['.pas', '.pp', '.inc'],
  },
  cmake: {
    command: 'cmake-language-server',
    args: [],
    filetypes: ['CMakeLists.txt', '.cmake'],
  },
  makefile: {
    command: 'makefile-language-server',
    args: [],
    filetypes: ['Makefile', '.make'],
  },
  sql: {
    command: 'sql-language-server',
    args: ['up', '--method', 'stdio'],
    filetypes: ['.sql'],
  },
  graphql: {
    command: 'graphql-lsp',
    args: ['server', '-m', 'stdio'],
    filetypes: ['.graphql', '.gql'],
  },
  proto: {
    command: 'buf',
    args: ['lsp'],
    filetypes: ['.proto'],
  },
  vim: {
    command: 'vimls',
    args: [],
    filetypes: ['.vim', '.vimrc'],
  },
  nix: {
    command: 'rnix-lsp',
    args: [],
    filetypes: ['.nix'],
  },
  dart_flutter: {
    command: 'dart',
    args: ['language-server'],
    filetypes: ['.dart'],
  },
  vue: {
    command: 'vue-language-server',
    args: ['--stdio'],
    filetypes: ['.vue'],
  },
  svelte: {
    command: 'svelteserver',
    args: ['--stdio'],
    filetypes: ['.svelte'],
  },
};

// File extension to language mapping - expanded
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'cpp',
  '.cc': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.dart': 'dart',
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.lua': 'lua',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.json': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  '.sh': 'bash',
  '.bash': 'bash',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.v': 'verilog',
  '.sv': 'verilog',
  '.svh': 'verilog',
  '.vhd': 'vhdl',
  '.vhdl': 'vhdl',
  '.sol': 'solidity',
  '.zig': 'zig',
  '.nim': 'nim',
  '.nims': 'nim',
  '.R': 'r',
  '.r': 'r',
  '.jl': 'julia',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.edn': 'clojure',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.fsi': 'fsharp',
  '.fsscript': 'fsharp',
  '.groovy': 'groovy',
  '.m': 'objective_c',
  '.mm': 'objective_c',
  '.f': 'fortran',
  '.for': 'fortran',
  '.f90': 'fortran',
  '.f95': 'fortran',
  '.f03': 'fortran',
  '.f08': 'fortran',
  '.pas': 'pascal',
  '.pp': 'pascal',
  '.inc': 'pascal',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'proto',
  '.vim': 'vim',
  '.nix': 'nix',
  '.vue': 'vue',
  '.svelte': 'svelte',
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
   * textDocument/rename
   * Rename a symbol across all files
   */
  async rename(
    language: string,
    filePath: string,
    line: number,
    character: number,
    newName: string
  ): Promise<{
    success: boolean;
    changes?: Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: { line: number; character: number } } } }>;
    error?: string;
  }> {
    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return { success: false, error: 'Language server not initialized' };
    }

    const resolvedFilePath = this.checkLocalFileSecurity(filePath);

    const params = {
      textDocument: { uri: localPathToFileUri(resolvedFilePath) },
      position: { line: line - 1, character: character - 1 },
      newName,
    };

    try {
      const result = await this.sendRequest(client, 'textDocument/rename', params);
      if (!result) {
        return { success: false, error: 'No rename changes returned' };
      }
      // WorkspaceEdit contains changes map
      const workspaceEdit = result as { changes?: Record<string, Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }>> } };
      if (!workspaceEdit.changes) {
        return { success: false, error: 'No changes in workspace edit' };
      }
      const changes: Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> = [];
      for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
        for (const edit of edits) {
          changes.push({ uri, range: edit.range });
        }
      }
      return { success: true, changes };
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return { success: false, error: String(error) };
    }
  }

  /**
   * textDocument/typeDefinition
   * Go to the type definition of a symbol
   */
  async typeDefinition(
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
      const result = await this.sendRequest(client, 'textDocument/typeDefinition', params);
      if (!result) return [];
      const locations = Array.isArray(result) ? result : [result];
      return this.filterLocationResults(locations as Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>);
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * textDocument/codeAction
   * Get code actions (quick fixes, refactorings) for a range
   */
  async codeActions(
    language: string,
    filePath: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
    only?: string[]
  ): Promise<Array<{
    title: string;
    kind?: string;
    diagnostics?: Array<{ severity: number; message: string }>;
    edit?: unknown;
    command?: unknown;
  }>> {
    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return [];
    }

    const resolvedFilePath = this.checkLocalFileSecurity(filePath);

    const params = {
      textDocument: { uri: localPathToFileUri(resolvedFilePath) },
      range: {
        start: { line: startLine - 1, character: startCharacter },
        end: { line: endLine - 1, character: endCharacter },
      },
      context: {
        diagnostics: [],
        only: only || ['quickfix', 'refactor'],
      },
    };

    try {
      const result = await this.sendRequest(client, 'textDocument/codeAction', params);
      if (!result || !Array.isArray(result)) return [];
      return result as Array<{
        title: string;
        kind?: string;
        diagnostics?: Array<{ severity: number; message: string }>;
        edit?: unknown;
        command?: unknown;
      }>;
    } catch (error) {
      if (error instanceof LspSecurityError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Get status of all language servers
   */
  getStatus(): Array<{
    language: string;
    command: string;
    status: 'running' | 'idle' | 'missing';
    pid?: number;
  }> {
    const statuses: Array<{
      language: string;
      command: string;
      status: 'running' | 'idle' | 'missing';
      pid?: number;
    }> = [];

    for (const [language, config] of Object.entries(LSP_SERVERS)) {
      const client = this.clients.get(language);
      if (client && client.initialized) {
        statuses.push({
          language,
          command: config.command,
          status: 'running',
          pid: client.process.pid,
        });
      } else if (client) {
        statuses.push({
          language,
          command: config.command,
          status: 'idle',
        });
      } else {
        statuses.push({
          language,
          command: config.command,
          status: 'missing',
        });
      }
    }

    return statuses;
  }

  /**
   * Get capabilities of a language server
   */
  async getCapabilities(
    language: string
  ): Promise<Record<string, unknown> | null> {
    const client = this.getClient(language);
    if (!client || !client.initialized) {
      return null;
    }

    // Send initialize request and capture the capabilities
    const params = {
      processId: process.pid,
      rootUri: `file://${process.cwd()}`,
      capabilities: {},
    };

    try {
      const result = await this.sendRequest(client, 'initialize', params);
      if (!result || typeof result !== 'object') return null;
      const initResult = result as { capabilities?: Record<string, unknown> };
      return initResult.capabilities || null;
    } catch {
      return null;
    }
  }

  /**
   * Reload/restart a language server
   */
  async reload(
    language?: string
  ): Promise<{ reloaded: string[]; errors: string[] }> {
    const reloaded: string[] = [];
    const errors: string[] = [];

    const languages = language ? [language] : Object.keys(LSP_SERVERS);

    for (const lang of languages) {
      const config = LSP_SERVERS[lang];
      if (!config) {
        errors.push(`Unknown language: ${lang}`);
        continue;
      }

      // Kill existing client if any
      const existingClient = this.clients.get(lang);
      if (existingClient) {
        try {
          existingClient.process.kill();
        } catch {
          // Ignore kill errors
        }
        this.clients.delete(lang);
      }

      // Create new client
      try {
        const newClient = this.getClient(lang);
        if (newClient) {
          reloaded.push(lang);
        } else {
          errors.push(`Failed to start server for ${lang}`);
        }
      } catch (error) {
        errors.push(`Failed to reload ${lang}: ${String(error)}`);
      }
    }

    return { reloaded, errors };
  }

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

// ========== RENAME TOOL ==========

const renameInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path containing the symbol to rename'),
    line: z.number().int().positive().describe('Line number (1-based)'),
    character: z.number().int().nonnegative().describe('Character position (0-based)'),
    new_name: z.string().describe('New name for the symbol'),
  }),
);

const renameOutput = lazySchema(() =>
  z.object({
    success: z.boolean(),
    changes: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        character: z.number(),
      })
    ).optional(),
    message: z.string().optional(),
  }),
);

export const lspRenameTool = buildTool({
  name: 'lsp_rename',
  searchHint: 'rename symbol, rename function, rename variable, LSP rename',
  maxResultSizeChars: 50_000,
  async description() {
    return 'Rename a symbol across all files using LSP';
  },
  get inputSchema() {
    return renameInput();
  },
  get outputSchema() {
    return renameOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP rename');
  },
  async execute(input) {
    const language = getLanguageForFile(input.file_path);
    if (!language) {
      return { success: false, message: 'Unsupported file type for LSP' };
    }

    try {
      const result = await lspClientManager.rename(
        language,
        input.file_path,
        input.line,
        input.character,
        input.new_name
      );

      if (!result.success) {
        return { success: false, message: result.error || 'Rename failed' };
      }

      return {
        success: true,
        changes: result.changes?.map((c) => ({
          file: c.uri.replace('file://', ''),
          line: c.range.start.line + 1,
          character: c.range.start.character + 1,
        })),
        message: `Renamed to '${input.new_name}' in ${result.changes?.length || 0} locations`,
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { success: false, message: securityMessage(error) };
      }
      throw error;
    }
  },
});

// ========== TYPE DEFINITION TOOL ==========

const typeDefinitionInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path to search in'),
    line: z.number().int().positive().describe('Line number (1-based)'),
    character: z.number().int().nonnegative().describe('Character position (0-based)'),
  }),
);

const typeDefinitionOutput = lazySchema(() =>
  z.object({
    found: z.boolean(),
    locations: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        character: z.number(),
      })
    ).optional(),
    message: z.string().optional(),
  }),
);

export const typeDefinitionTool = buildTool({
  name: 'lsp_type_definition',
  searchHint: 'type definition, go to type, type of symbol, LSP type definition',
  maxResultSizeChars: 50_000,
  async description() {
    return 'Navigate to the type definition of a symbol using LSP';
  },
  get inputSchema() {
    return typeDefinitionInput();
  },
  get outputSchema() {
    return typeDefinitionOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP type definition');
  },
  async execute(input) {
    const language = getLanguageForFile(input.file_path);
    if (!language) {
      return { found: false, message: 'Unsupported file type for LSP' };
    }

    try {
      const results = await lspClientManager.typeDefinition(
        language,
        input.file_path,
        input.line,
        input.character
      );

      if (results.length === 0) {
        return { found: false, message: 'No type definition found' };
      }

      return {
        found: true,
        locations: results.map((loc) => ({
          file: loc.uri.replace('file://', ''),
          line: loc.range.start.line + 1,
          character: loc.range.start.character + 1,
        })),
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { found: false, message: securityMessage(error) };
      }
      throw error;
    }
  },
});

// ========== CODE ACTIONS TOOL ==========

const codeActionsInput = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('File path to get code actions for'),
    start_line: z.number().int().positive().describe('Start line number (1-based)'),
    start_character: z.number().int().nonnegative().describe('Start character position (0-based)'),
    end_line: z.number().int().positive().describe('End line number (1-based)'),
    end_character: z.number().int().nonnegative().describe('End character position (0-based)'),
    only: z.array(z.string()).optional().describe('Filter by action kinds (e.g., ["quickfix", "refactor"])'),
  }),
);

const codeActionsOutput = lazySchema(() =>
  z.object({
    count: z.number(),
    actions: z.array(
      z.object({
        title: z.string(),
        kind: z.string().optional(),
        diagnostics: z.array(
          z.object({
            severity: z.string(),
            message: z.string(),
          })
        ).optional(),
      })
    ),
  }),
);

export const codeActionsTool = buildTool({
  name: 'lsp_code_actions',
  searchHint: 'code actions, quick fixes, refactoring, LSP code actions',
  maxResultSizeChars: 50_000,
  async description() {
    return 'Get code actions (quick fixes, refactorings) for a code range using LSP';
  },
  get inputSchema() {
    return codeActionsInput();
  },
  get outputSchema() {
    return codeActionsOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck(input, context, 'Use LSP code actions');
  },
  async execute(input) {
    const language = getLanguageForFile(input.file_path);
    if (!language) {
      return { count: 0, actions: [], message: 'Unsupported file type for LSP' };
    }

    try {
      const results = await lspClientManager.codeActions(
        language,
        input.file_path,
        input.start_line,
        input.start_character,
        input.end_line,
        input.end_character,
        input.only
      );

      return {
        count: results.length,
        actions: results.map((action) => ({
          title: action.title,
          kind: action.kind,
          diagnostics: action.diagnostics?.map((d) => ({
            severity: severityToString(d.severity),
            message: d.message,
          })),
        })),
      };
    } catch (error) {
      if (isLspSecurityError(error)) {
        return { count: 0, actions: [] };
      }
      throw error;
    }
  },
});

// ========== LSP STATUS TOOL ==========

const statusOutput = lazySchema(() =>
  z.object({
    servers: z.array(
      z.object({
        language: z.string(),
        command: z.string(),
        status: z.enum(['running', 'idle', 'missing']),
        pid: z.number().optional(),
      })
    ),
  }),
);

export const lspStatusTool = buildTool({
  name: 'lsp_status',
  searchHint: 'LSP status, language server status, check LSP servers',
  maxResultSizeChars: 10_000,
  async description() {
    return 'Check the status of all language servers';
  },
  get inputSchema() {
    return lazySchema(() => z.strictObject({}))();
  },
  get outputSchema() {
    return statusOutput();
  },
  async checkPermissions(_input, context) {
    return fileAccessPermissionCheck({}, context, 'Check LSP status');
  },
  async execute() {
    const statuses = lspClientManager.getStatus();
    return { servers: statuses };
  },
});

// ========== LSP CAPABILITIES TOOL ==========

const capabilitiesInput = lazySchema(() =>
  z.strictObject({
    language: z.string().describe('Language to check capabilities for (e.g., "typescript", "python")'),
  }),
);

const capabilitiesOutput = lazySchema(() =>
  z.object({
    language: z.string(),
    capabilities: z.record(z.unknown()).nullable(),
    message: z.string().optional(),
  }),
);

export const lspCapabilitiesTool = buildTool({
  name: 'lsp_capabilities',
  searchHint: 'LSP capabilities, language server capabilities, what LSP supports',
  maxResultSizeChars: 50_000,
  async description() {
    return 'Check the capabilities of a language server';
  },
  get inputSchema() {
    return capabilitiesInput();
  },
  get outputSchema() {
    return capabilitiesOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck({}, context, 'Check LSP capabilities');
  },
  async execute(input) {
    const capabilities = await lspClientManager.getCapabilities(input.language);
    return {
      language: input.language,
      capabilities,
      message: capabilities ? 'Capabilities retrieved' : 'Server not available or not initialized',
    };
  },
});

// ========== LSP RELOAD TOOL ==========

const reloadInput = lazySchema(() =>
  z.strictObject({
    language: z.string().optional().describe('Language to reload (omit to reload all)'),
  }),
);

const reloadOutput = lazySchema(() =>
  z.object({
    reloaded: z.array(z.string()),
    errors: z.array(z.string()),
    message: z.string(),
  }),
);

export const lspReloadTool = buildTool({
  name: 'lsp_reload',
  searchHint: 'reload LSP, restart language server, LSP reload',
  maxResultSizeChars: 10_000,
  async description() {
    return 'Reload or restart language servers';
  },
  get inputSchema() {
    return reloadInput();
  },
  get outputSchema() {
    return reloadOutput();
  },
  async checkPermissions(input, context) {
    return fileAccessPermissionCheck({}, context, 'Reload LSP servers');
  },
  async execute(input) {
    const result = await lspClientManager.reload(input.language);
    return {
      ...result,
      message: `Reloaded ${result.reloaded.length} server(s), ${result.errors.length} error(s)`,
    };
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
  lspRenameTool,
  typeDefinitionTool,
  codeActionsTool,
  lspStatusTool,
  lspCapabilitiesTool,
  lspReloadTool,
];
