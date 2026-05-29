/**
 * LSP Symbol Context -- builds structured semantic context from LSP results
 * for AI prompt injection.
 *
 * Takes raw LSP symbols, references, diagnostics and builds a compact,
 * structured context object that can be injected into AI conversation
 * messages to give the AI rich code awareness without extra tool calls.
 */

import { detectLanguage, formatDiagnosticLine } from "./formatters.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolContext {
  projectDir: string;
  language: string;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  diagnostics: DiagnosticInfo[];
  scopeHierarchy: ScopeNode[];
}

export interface SymbolInfo {
  name: string;
  kind: string;
  file: string;
  line: number;
  container: string;
  visibility: "public" | "private" | "protected" | "internal";
  documentation: string;
}

export interface ImportInfo {
  source: string;
  imported: string;
  local: string;
  file: string;
  line: number;
}

export interface DiagnosticInfo {
  severity: string;
  message: string;
  file: string;
  line: number;
  code: string | null;
}

export interface ScopeNode {
  name: string;
  kind: string;
  line: number;
  children: ScopeNode[];
}

// ---------------------------------------------------------------------------
// Core builders
// ---------------------------------------------------------------------------

export function buildSymbolContext(
  projectDir: string,
  symbols: Array<{
    name: string;
    kind?: string;
    filePath?: string;
    line?: number;
    containerName?: string;
    visibility?: string;
    documentation?: string;
  }>,
): SymbolContext {
  const lang = symbols.length > 0 && symbols[0]?.filePath
    ? detectLanguage(symbols[0].filePath)
    : "Unknown";

  const symbolInfos: SymbolInfo[] = symbols.map((s) => ({
    name: s.name,
    kind: s.kind ?? "Unknown",
    file: s.filePath ?? "<unknown>",
    line: (s.line ?? 0) + 1,
    container: s.containerName ?? "(global)",
    visibility: mapVisibility(s.visibility),
    documentation: s.documentation ?? "",
  }));

  return {
    projectDir,
    language: lang,
    symbols: symbolInfos,
    imports: [],
    diagnostics: [],
    scopeHierarchy: buildScopeHierarchy(symbolInfos),
  };
}

function mapVisibility(v?: string): SymbolInfo["visibility"] {
  switch (v?.toLowerCase()) {
    case "public":
    case "export":
      return "public";
    case "private":
      return "private";
    case "protected":
      return "protected";
    default:
      return "internal";
  }
}

// ---------------------------------------------------------------------------
// Scope hierarchy
// ---------------------------------------------------------------------------

export function buildScopeHierarchy(symbols: SymbolInfo[]): ScopeNode[] {
  const moduleLevel: ScopeNode[] = [];
  const containerMap = new Map<string, ScopeNode>();

  for (const sym of symbols) {
    const node: ScopeNode = {
      name: sym.name,
      kind: sym.kind,
      line: sym.line,
      children: [],
    };

    if (sym.container === "(global)") {
      moduleLevel.push(node);
    } else {
      const existing = containerMap.get(sym.container);
      if (existing) {
        existing.children.push(node);
      } else {
        const parent: ScopeNode = {
          name: sym.container,
          kind: "Container",
          line: sym.line,
          children: [node],
        };
        containerMap.set(sym.container, parent);
        moduleLevel.push(parent);
      }
    }
  }

  return moduleLevel;
}

// ---------------------------------------------------------------------------
// Import context
// ---------------------------------------------------------------------------

export function buildImportContext(
  definitions: Array<{
    source: string;
    imported: string;
    local: string;
    filePath?: string;
    line?: number;
  }>,
): ImportInfo[] {
  return definitions.map((d) => ({
    source: d.source,
    imported: d.imported,
    local: d.local,
    file: d.filePath ?? "<unknown>",
    line: (d.line ?? 0) + 1,
  }));
}

// ---------------------------------------------------------------------------
// Relevant symbol extraction
// ---------------------------------------------------------------------------

export function extractRelevantSymbols(
  symbols: SymbolInfo[],
  query: string,
): SymbolInfo[] {
  if (!query.trim()) return symbols;

  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  return symbols.filter((sym) => {
    const haystack = `${sym.name} ${sym.kind} ${sym.container} ${sym.file}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

// ---------------------------------------------------------------------------
// AI context formatting
// ---------------------------------------------------------------------------

export function formatSymbolContextForAI(context: SymbolContext): string {
  const parts: string[] = [
    `Project: ${context.projectDir}`,
    `Language: ${context.language}`,
    "",
  ];

  if (context.symbols.length > 0) {
    parts.push("=== Symbols ===");
    for (const sym of context.symbols) {
      const vis = sym.visibility !== "internal" ? ` (${sym.visibility})` : "";
      const container = sym.container !== "(global)" ? ` in ${sym.container}` : "";
      parts.push(`  ${sym.kind} **${sym.name}**${vis}${container} -- ${sym.file}:${sym.line}`);
    }
    parts.push("");
  }

  if (context.imports.length > 0) {
    parts.push("=== Imports ===");
    for (const imp of context.imports) {
      parts.push(`  ${imp.local} <- ${imp.imported} from ${imp.source} (${imp.file}:${imp.line})`);
    }
    parts.push("");
  }

  if (context.diagnostics.length > 0) {
    parts.push("=== Diagnostics ===");
    for (const d of context.diagnostics) {
      parts.push(`  [${d.severity.toUpperCase()}] ${d.file}:${d.line} -- ${d.message}`);
    }
    parts.push("");
  }

  if (context.scopeHierarchy.length > 0) {
    parts.push("=== Scope Hierarchy ===");
    parts.push(formatScopeForAI(context.scopeHierarchy));
  }

  return parts.join("\n");
}

export function formatScopeForAI(nodes: ScopeNode[], indent: number = 0): string {
  const prefix = "  ".repeat(indent);
  const lines: string[] = [];

  for (const node of nodes) {
    lines.push(`${prefix}${node.kind} ${node.name}:${node.line}`);
    if (node.children.length > 0) {
      lines.push(formatScopeForAI(node.children, indent + 1));
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Diagnostic context helpers
// ---------------------------------------------------------------------------

export function buildDiagnosticContext(
  diagnostics: Array<{
    message: string;
    severity?: number;
    filePath?: string;
    line?: number;
    code?: string | number;
  }>,
): DiagnosticInfo[] {
  const severityMap: Record<number, string> = {
    1: "Error",
    2: "Warning",
    3: "Information",
    4: "Hint",
  };

  return diagnostics.map((d) => ({
    severity: severityMap[d.severity ?? 3] ?? "Information",
    message: d.message,
    file: d.filePath ?? "<unknown>",
    line: (d.line ?? 0) + 1,
    code: d.code != null ? String(d.code) : null,
  }));
}

export function formatDiagnosticContextForAI(diagnostics: DiagnosticInfo[]): string {
  if (!diagnostics.length) return "(no issues)";
  const lines = [`Issues (${diagnostics.length}):`];
 ﻿for (const d of diagnostics) {
    lines.push(` [${d.severity.toUpperCase()}] ${d.file}:${d.line} -- ${d.message}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Combined context builder
// ---------------------------------------------------------------------------

export function buildFullCodeContext(
  projectDir: string,
  symbols: SymbolInfo[],
  imports: ImportInfo[],
  diagnostics: DiagnosticInfo[],
): string {
  const context = buildSymbolContext(
    projectDir,
    symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      filePath: s.file,
      line: s.line - 1,
      containerName: s.container,
      visibility: s.visibility,
      documentation: s.documentation,
    })),
  );
  context.imports = imports;
  context.diagnostics = diagnostics;
  return formatSymbolContextForAI(context);
}

export default {
  buildSymbolContext,
  buildScopeHierarchy,
  buildImportContext,
  extractRelevantSymbols,
  formatSymbolContextForAI,
  formatScopeForAI,
  buildDiagnosticContext,
  formatDiagnosticContextForAI: formatDiagnosticContextForAI,
  buildFullCodeContext,
};