/**
 * Discovery - Inherit configs from other tools
 * 
 * Every other agent ships an importer and expects you to convert. This
 * module reads the eight formats already on disk in their native shape:
 * - Cursor MDC (.cursorrules)
 * - Cline .clinerules
 * - Codex AGENTS.md
 * - Copilot applyTo
 * - Aider .aider.conf
 * - Windsurf .windsurfrules
 * - Roo Code .roo/rules
 * - Enfer .enfer/rules
 * 
 * No migration script, no YAML-to-TOML port, no "supported subset" footnotes.
 * The config your team wrote last quarter still works tonight.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolFormat = 
  | 'cursor'      // .cursorrules
  | 'cline'       // .clinerules
  | 'codex'       // AGENTS.md
  | 'copilot'     // .github/copilot-instructions.md
  | 'aider'       // .aider.conf
  | 'windsurf'    // .windsurfrules
  | 'roo'         // .roo/rules
  | 'enfer'       // .enfer/rules

export interface ImportedConfig {
  format: ToolFormat;
  source: string;
  content: string;
  rules: string[];
  metadata?: Record<string, unknown>;
}

export interface DiscoveryResult {
  configs: ImportedConfig[];
  sources: ToolFormat[];
  totalRules: number;
}

// ---------------------------------------------------------------------------
// Format Parsers
// ---------------------------------------------------------------------------

/**
 * Parse Cursor .cursorrules format
 */
function parseCursorRules(content: string, filePath: string): ImportedConfig {
  const rules: string[] = [];
  
  // Split by double newlines for rule blocks
  const blocks = content.split(/\n\s*\n/);
  
  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed.length > 0) {
      rules.push(trimmed);
    }
  }
  
  return {
    format: 'cursor',
    source: filePath,
    content,
    rules,
    metadata: {
      ruleCount: rules.length,
      totalLength: content.length,
    },
  };
}

/**
 * Parse Cline .clinerules format
 */
function parseClineRules(content: string, filePath: string): ImportedConfig {
  const rules: string[] = [];
  
  // Cline uses line-based rules, skip empty lines and comments
  const lines = content.split('\n');
  let currentRule = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      if (currentRule) {
        rules.push(currentRule.trim());
        currentRule = '';
      }
      continue;
    }
    
    // Accumulate rule content
    currentRule += (currentRule ? '\n' : '') + line;
  }
  
  if (currentRule) {
    rules.push(currentRule.trim());
  }
  
  return {
    format: 'cline',
    source: filePath,
    content,
    rules,
  };
}

/**
 * Parse Codex AGENTS.md format
 */
function parseAgentsMd(content: string, filePath: string): ImportedConfig {
  const rules: string[] = [];
  
  // AGENTS.md uses markdown headers as rule separators
  const sections = content.split(/^## /m);
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length > 0) {
      rules.push(trimmed);
    }
  }
  
  return {
    format: 'codex',
    source: filePath,
    content,
    rules,
    metadata: {
      sectionCount: rules.length,
    },
  };
}

/**
 * Parse Copilot instructions format
 */
function parseCopilotInstructions(content: string, filePath: string): ImportedConfig {
  const rules: string[] = [];
  
  // Copilot uses markdown with specific sections
  const sections = content.split(/^## /m);
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length > 0) {
      rules.push(trimmed);
    }
  }
  
  // Also extract inline rules from blockquotes
  const blockquotes = content.match(/^> .+$/gm) || [];
  for (const quote of blockquotes) {
    const rule = quote.replace(/^> /, '').trim();
    if (rule.length > 0) {
      rules.push(rule);
    }
  }
  
  return {
    format: 'copilot',
    source: filePath,
    content,
    rules,
  };
}

/**
 * Parse Aider .aider.conf format
 */
function parseAiderConf(content: string, filePath: string): ImportedConfig {
  const rules: string[] = [];
  const metadata: Record<string, unknown> = {};
  
  // Aider conf is key-value pairs
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      
      // Store as metadata
      metadata[key] = value;
      
      // Convert to rule
      rules.push(`${key}: ${value}`);
    }
  }
  
  return {
    format: 'aider',
    source: filePath,
    content,
    rules,
    metadata,
  };
}

/**
 * Parse Windsurf .windsurfrules format
 */
function parseWindsurfRules(content: string, filePath: string): ImportedConfig {
  const rules: string[] = [];
  
  // Windsurf uses YAML-like format with sections
  const lines = content.split('\n');
  let currentSection = '';
  let currentContent = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Section headers (no indentation)
    if (trimmed && !trimmed.startsWith(' ') && !trimmed.startsWith('-') && trimmed.endsWith(':')) {
      if (currentSection && currentContent) {
        rules.push(`${currentSection}\n${currentContent.trim()}`);
      }
      currentSection = trimmed.slice(0, -1);
      currentContent = '';
    } else if (trimmed) {
      currentContent += (currentContent ? '\n' : '') + line;
    }
  }
  
  // Add last section
  if (currentSection && currentContent) {
    rules.push(`${currentSection}\n${currentContent.trim()}`);
  }
  
  return {
    format: 'windsurf',
    source: filePath,
    content,
    rules,
  };
}

/**
 * Parse Roo Code .roo/rules format
 */
function parseRooRules(content: string, filePath: string): ImportedConfig {
  const rules: string[] = [];
  
  // Roo uses markdown with specific rule format
  const sections = content.split(/^---$/m);
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length > 0) {
      rules.push(trimmed);
    }
  }
  
  return {
    format: 'roo',
    source: filePath,
    content,
    rules,
  };
}

/**
 * Parse Enfer .enfer/rules format
 */
function parseEnferRules(content: string, filePath: string): ImportedConfig {
  const rules: string[] = [];
  
  // Enfer uses JSON-like format
  try {
    const data = JSON.parse(content);
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === 'string') {
          rules.push(item);
        } else if (typeof item === 'object' && item !== null) {
          rules.push(JSON.stringify(item, null, 2));
        }
      }
    } else if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
          rules.push(`${key}: ${value}`);
        } else if (Array.isArray(value)) {
          rules.push(`${key}:\n${value.map(v => `  - ${v}`).join('\n')}`);
        }
      }
    }
  } catch {
    // If not JSON, treat as line-based
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        rules.push(trimmed);
      }
    }
  }
  
  return {
    format: 'enfer',
    source: filePath,
    content,
    rules,
  };
}

// ---------------------------------------------------------------------------
// Format Detection
// ---------------------------------------------------------------------------

/**
 * Detect the format of a config file based on path and content
 */
function detectFormat(filePath: string, content: string): ToolFormat | null {
  const basename = path.basename(filePath).toLowerCase();
  const dirname = path.basename(path.dirname(filePath)).toLowerCase();
  
  // Exact filename matches
  if (basename === '.cursorrules') return 'cursor';
  if (basename === '.clinerules') return 'cline';
  if (basename === 'agents.md') return 'codex';
  if (basename === '.aider.conf') return 'aider';
  if (basename === '.windsurfrules') return 'windsurf';
  
  // Directory-based matches
  if (dirname === '.roo' && basename === 'rules') return 'roo';
  if (dirname === '.enfer' && basename === 'rules') return 'enfer';
  
  // Copilot: .github/copilot-instructions.md
  if (filePath.includes('.github') && basename === 'copilot-instructions.md') return 'copilot';
  
  // Content-based detection as fallback
  if (content.includes('cursor') && content.includes('rules')) return 'cursor';
  if (content.includes('cline') && content.includes('rules')) return 'cline';
  
  return null;
}

// ---------------------------------------------------------------------------
// Main Discovery Function
// ---------------------------------------------------------------------------

/**
 * Discover and parse all tool configs in a directory
 */
export function discoverToolConfigs(
  projectDir: string,
  options: {
    recursive?: boolean;
    formats?: ToolFormat[];
  } = {}
): DiscoveryResult {
  const { recursive = true, formats } = options;
  const configs: ImportedConfig[] = [];
  const sources: Set<ToolFormat> = new Set();
  
  // Define all possible config file locations
  const configPaths: Array<{ pattern: string; format?: ToolFormat }> = [
    // Cursor
    { pattern: '.cursorrules', format: 'cursor' },
    { pattern: '.cursor/rules', format: 'cursor' },
    
    // Cline
    { pattern: '.clinerules', format: 'cline' },
    { pattern: '.cline/rules', format: 'cline' },
    
    // Codex
    { pattern: 'AGENTS.md', format: 'codex' },
    
    // Copilot
    { pattern: '.github/copilot-instructions.md', format: 'copilot' },
    
    // Aider
    { pattern: '.aider.conf', format: 'aider' },
    
    // Windsurf
    { pattern: '.windsurfrules', format: 'windsurf' },
    
    // Roo Code
    { pattern: '.roo/rules', format: 'roo' },
    { pattern: '.roo/rules/*.md', format: 'roo' },
    
    // Enfer
    { pattern: '.enfer/rules', format: 'enfer' },
    { pattern: '.enfer/rules/*.json', format: 'enfer' },
  ];
  
  for (const configPath of configPaths) {
    const fullPath = path.join(projectDir, configPath.pattern);
    
    // Check if file/directory exists
    try {
      const stat = fs.statSync(fullPath);
      
      if (stat.isFile()) {
        // Read and parse file
        const content = fs.readFileSync(fullPath, 'utf-8');
        const format = configPath.format || detectFormat(fullPath, content);
        
        if (format && (!formats || formats.includes(format))) {
          const config = parseConfigFile(content, fullPath, format);
          configs.push(config);
          sources.add(format);
        }
      } else if (stat.isDirectory() && recursive) {
        // Read all files in directory
        const files = fs.readdirSync(fullPath);
        for (const file of files) {
          const filePath = path.join(fullPath, file);
          try {
            const fileStat = fs.statSync(filePath);
            if (fileStat.isFile()) {
              const content = fs.readFileSync(filePath, 'utf-8');
              const format = configPath.format || detectFormat(filePath, content);
              
              if (format && (!formats || formats.includes(format))) {
                const config = parseConfigFile(content, filePath, format);
                configs.push(config);
                sources.add(format);
              }
            }
          } catch {
            // Skip files that can't be read
          }
        }
      }
    } catch {
      // File/directory doesn't exist, skip
    }
  }
  
  const totalRules = configs.reduce((sum, config) => sum + config.rules.length, 0);
  
  return {
    configs,
    sources: Array.from(sources),
    totalRules,
  };
}

/**
 * Parse a config file based on its format
 */
function parseConfigFile(
  content: string,
  filePath: string,
  format: ToolFormat
): ImportedConfig {
  switch (format) {
    case 'cursor':
      return parseCursorRules(content, filePath);
    case 'cline':
      return parseClineRules(content, filePath);
    case 'codex':
      return parseAgentsMd(content, filePath);
    case 'copilot':
      return parseCopilotInstructions(content, filePath);
    case 'aider':
      return parseAiderConf(content, filePath);
    case 'windsurf':
      return parseWindsurfRules(content, filePath);
    case 'roo':
      return parseRooRules(content, filePath);
    case 'enfer':
      return parseEnferRules(content, filePath);
    default:
      return {
        format: 'cursor',
        source: filePath,
        content,
        rules: [content],
      };
  }
}

/**
 * Merge imported configs into a single rule set
 */
export function mergeConfigs(configs: ImportedConfig[]): string[] {
  const allRules: string[] = [];
  const seen = new Set<string>();
  
  for (const config of configs) {
    for (const rule of config.rules) {
      const normalized = rule.trim().toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        allRules.push(rule);
      }
    }
  }
  
  return allRules;
}

/**
 * Export discovery results as a config file
 */
export function exportDiscoveryResult(
  result: DiscoveryResult,
  outputPath: string
): void {
  const lines: string[] = [
    '# Auto-discovered tool configurations',
    `# Sources: ${result.sources.join(', ')}`,
    `# Total rules: ${result.totalRules}`,
    '',
  ];
  
  for (const config of result.configs) {
    lines.push(`## ${config.format} (${config.source})`);
    lines.push('');
    for (const rule of config.rules) {
      lines.push(rule);
      lines.push('');
    }
  }
  
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}

export default {
  discoverToolConfigs,
  mergeConfigs,
  exportDiscoveryResult,
  parseConfigFile,
  detectFormat,
};
