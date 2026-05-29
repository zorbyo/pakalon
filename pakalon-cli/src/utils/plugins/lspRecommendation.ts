import { spawnSync } from 'child_process';
import { extname } from 'path';
import { getGlobalConfig, saveGlobalConfig } from '../config.js';

export interface LspPluginMatch {
  pluginId: string;
  pluginName: string;
  description: string;
  extensions: string[];
  commands: string[];
}

const LSP_PLUGIN_CATALOG: LspPluginMatch[] = [
  {
    pluginId: 'lsp-typescript',
    pluginName: 'TypeScript LSP',
    description: 'Diagnostics, completion, and code actions for TypeScript and JavaScript projects.',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'],
    commands: ['typescript-language-server', 'tsserver'],
  },
  {
    pluginId: 'lsp-python',
    pluginName: 'Python LSP',
    description: 'Diagnostics, completion, and refactors for Python files.',
    extensions: ['.py', '.pyi'],
    commands: ['pyright-langserver', 'pylsp'],
  },
  {
    pluginId: 'lsp-rust',
    pluginName: 'Rust Analyzer LSP',
    description: 'Rust diagnostics, completion, and cargo-aware navigation.',
    extensions: ['.rs'],
    commands: ['rust-analyzer'],
  },
  {
    pluginId: 'lsp-go',
    pluginName: 'Go LSP',
    description: 'Go diagnostics, completion, formatting, and workspace symbols.',
    extensions: ['.go'],
    commands: ['gopls'],
  },
  {
    pluginId: 'lsp-vue',
    pluginName: 'Vue LSP',
    description: 'Vue single-file component diagnostics and completions.',
    extensions: ['.vue'],
    commands: ['vue-language-server', 'vue-language-server.cmd'],
  },
  {
    pluginId: 'lsp-svelte',
    pluginName: 'Svelte LSP',
    description: 'Svelte component diagnostics, completion, and hover support.',
    extensions: ['.svelte'],
    commands: ['svelteserver'],
  },
  {
    pluginId: 'lsp-json-yaml',
    pluginName: 'JSON/YAML LSP',
    description: 'Schema-aware diagnostics and completion for JSON and YAML files.',
    extensions: ['.json', '.jsonc', '.yaml', '.yml'],
    commands: ['vscode-json-language-server', 'yaml-language-server'],
  },
  {
    pluginId: 'lsp-clangd',
    pluginName: 'Clangd LSP',
    description: 'C and C++ diagnostics, navigation, and refactoring support.',
    extensions: ['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx'],
    commands: ['clangd'],
  },
];

function commandExists(command: string): boolean {
  const checker = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(checker, [command], {
    encoding: 'utf-8',
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return result.status === 0;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isPluginEnabled(pluginId: string): boolean {
  const enabledPlugins = getGlobalConfig().enabledPlugins;
  if (!enabledPlugins || typeof enabledPlugins !== 'object') return false;
  return (enabledPlugins as Record<string, unknown>)[pluginId] === true;
}

export async function getMatchingLspPlugins(filePath: string): Promise<LspPluginMatch[]> {
  const extension = extname(filePath).toLowerCase();
  if (!extension) return [];

  const config = getGlobalConfig();
  if (config.lspRecommendationDisabled === true) return [];

  const neverSuggest = new Set(getStringArray(config.lspRecommendationNeverSuggest));
  return LSP_PLUGIN_CATALOG.filter((plugin) => {
    if (!plugin.extensions.includes(extension)) return false;
    if (neverSuggest.has(plugin.pluginId)) return false;
    if (isPluginEnabled(plugin.pluginId)) return false;
    return plugin.commands.some(commandExists);
  });
}

export function addToNeverSuggest(pluginId: string): void {
  saveGlobalConfig((current) => {
    const neverSuggest = new Set(getStringArray(current.lspRecommendationNeverSuggest));
    neverSuggest.add(pluginId);
    return {
      ...current,
      lspRecommendationNeverSuggest: [...neverSuggest],
    };
  });
}

export function incrementIgnoredCount(): void {
  saveGlobalConfig((current) => {
    const currentCount = typeof current.lspRecommendationIgnoredCount === 'number'
      ? current.lspRecommendationIgnoredCount
      : 0;
    return {
      ...current,
      lspRecommendationIgnoredCount: currentCount + 1,
    };
  });
}

export function getLspPluginCatalog(): LspPluginMatch[] {
  return [...LSP_PLUGIN_CATALOG];
}
