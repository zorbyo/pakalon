/**
 * LSP Formatters — language-aware formatting for LSP operation results.
 *
 * Converts raw LSP types (Location, SymbolInformation, Hover, etc.) into
 * human-readable strings suitable for terminal display and AI context injection.
 *
 * Supports: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP, C#
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormattedLocation {
  file: string;
  line: number;
  character: number;
  label: string;
}

export interface FormattedSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  container: string;
  signature: string;
}

export interface FormattedReference {
  file: string;
  line: number;
  character: number;
  contextLine: string;
}

export interface FormattedDiagnostic {
  severity: "error" | "warning" | "information" | "hint";
  message: string;
  file: string;
  line: number;
  character: number;
  code: string | null;
}

export interface FormattedHover {
  contents: string;
  language: string;
}

export interface CallHierarchyEntry {
  name: string;
  kind: string;
  file: string;
  line: number;
  character: number;
  detail: string;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript (JSX)",
  ".js": "JavaScript",
  ".jsx": "JavaScript (JSX)",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".c": "C",
  ".cpp": "C++",
  ".h": "C/C++ Header",
  ".hpp": "C++ Header",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return LANGUAGE_MAP[ext] ?? "Unknown";
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_LABEL: Record<string, string> = {
  "1": "Error",
  "2": "Warning",
  "3": "Information",
  "4": "Hint",
};

export function formatSeverity(severity: number | string): string {
  return SEVERITY_LABEL[String(severity)] ?? "Information";
}

// ---------------------------------------------------------------------------
// Location formatting
// ---------------------------------------------------------------------------

export function formatLocation(location: {
  uri?: string;
  filePath?: string;
  line?: number;
  character?: number;
}): FormattedLocation {
  const file = location.filePath ?? location.uri ?? "<unknown>";
  const line = (location.line ?? 0) + 1; // 1-based for display
  const character = location.character ?? 0;
  return {
    file,
    line,
    character,
    label: `${file}:${line}:${character}`,
  };
}

export function formatLocationString(location: {
  uri?: string;
  filePath?: string;
  line?: number;
  character?: number;
}): string {
  const f = formatLocation(location);
  return f.label;
}

// ---------------------------------------------------------------------------
// Symbol formatting
// ---------------------------------------------------------------------------

const SYMBOL_KIND_ICON: Record<string, string> = {
  File: "[Document]",
  Module: "[Package]",
  Namespace: "[Folder]",
  Package: "[Package]",
  Class: "[LargeDiamond]",
  Method: "[Wrench]",
  Property: "[Key]",
  Field: "[INPUTSYMBOLFOR]",
  Constructor: "[BUILDINGCONSTRUCTION]",
  Enum: "[Clipboard]",
  Interface: "[LargeDiamond]",
  Function: "[!]",
  Variable: "[Pin]",
  Constant: "[Lock]",
  String: "[Memo]",
  Number: "[INPUTSYMBOLFOR]",
  Boolean: "[OK]",
  Array: "[Chart]",
  Object: "[Clipboard]",
  Key: "[OLDKEY]",
  Null: "[X]",
  EnumMember: "[Clipboard]",
  Struct: "[BUILDINGCONSTRUCTION]",
  Event: "[Loudspeaker]",
  Operator: "/",
  TypeParameter: "[INPUTSYMBOLFOR]",
};

export function getSymbolKindIcon(kind: string): string {
  return SYMBOL_KIND_ICON[kind] ?? "•";
}

export function formatSymbol(
  symbol: {
    name: string;
    kind?: string;
    filePath?: string;
    line?: number;
    containerName?: string;
    signature?: string;
  },
  language?: string,
): FormattedSymbol {
  const lang = language ?? detectLanguage(symbol.filePath ?? "");
  return {
    name: symbol.name,
    kind: symbol.kind ?? "Unknown",
    file: symbol.filePath ?? "<unknown>",
    line: (symbol.line ?? 0) + 1,
    container: symbol.containerName ?? "(global)",
    signature: symbol.signature ?? "",
  };
}

export function formatSymbolLine(symbol: FormattedSymbol): string {
  const icon = getSymbolKindIcon(symbol.kind);
  const container = symbol.container !== "(global)" ? ` in ${symbol.container}` : "";
  const sig = symbol.signature ? ` ${symbol.signature}` : "";
  return `${icon} ${symbol.kind} **${symbol.name}**${sig}${container} — ${symbol.file}:${symbol.line}`;
}

export function formatDocumentSymbols(
  symbols: Array<{
    name: string;
    kind?: string;
    filePath?: string;
    line?: number;
    containerName?: string;
    children?: Array<{ name: string; kind?: string; line?: number }>;
  }>,
  language?: string,
): string {
  if (!symbols.length) return "(no symbols)";

  const lang = language ?? (symbols[0]?.filePath ? detectLanguage(symbols[0].filePath) : "Unknown");
  const lines: string[] = [`Symbols (${lang}):`];

  for (const sym of symbols) {
    const formatted = formatSymbol(sym, lang);
    lines.push(`  ${formatSymbolLine(formatted)}`);
    if (sym.children?.length) {
      for (const child of sym.children) {
        const childIcon = getSymbolKindIcon(child.kind ?? "");
        lines.push(`    ${childIcon} ${child.kind ?? "?"} ${child.name}:${(child.line ?? 0) + 1}`);
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Reference formatting
// ---------------------------------------------------------------------------

export function formatReference(
  reference: {
    filePath?: string;
    line?: number;
    character?: number;
    contextLine?: string;
  },
): FormattedReference {
  return {
    file: reference.filePath ?? "<unknown>",
    line: (reference.line ?? 0) + 1,
    character: reference.character ?? 0,
    contextLine: reference.contextLine ?? "",
  };
}

export function formatReferenceLine(ref: FormattedReference): string {
  const ctx = ref.contextLine ? ` │ ${ref.contextLine.trim()}` : "";
  return `  ${ref.file}:${ref.line}:${ref.character}${ctx}`;
}

export function formatReferencesList(
  references: Array<{
    filePath?: string;
    line?: number;
    character?: number;
    contextLine?: string;
  }>,
): string {
  if (!references.length) return "(no references found)";
  const lines = [`References (${references.length}):`];
  for (const ref of references) {
    lines.push(formatReferenceLine(formatReference(ref)));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Hover formatting
// ---------------------------------------------------------------------------

export function formatHover(hoverResult: {
  contents?: string | Array<{ language: string; value: string }>;
  language?: string;
}): FormattedHover {
  if (!hoverResult.contents) {
    return { contents: "(no hover info)", language: "text" };
  }

  if (typeof hoverResult.contents === "string") {
    return { contents: hoverResult.contents, language: hoverResult.language ?? "text" };
  }

  if (Array.isArray(hoverResult.contents)) {
    const parts = hoverResult.contents.map((c) => c.value);
    const lang = hoverResult.contents[0]?.language ?? hoverResult.language ?? "text";
    return { contents: parts.join("\n\n"), language: lang };
  }

  return { contents: String(hoverResult.contents), language: hoverResult.language ?? "text" };
}

export function formatHoverBlock(hoverResult: {
  contents?: string | Array<{ language: string; value: string }>;
  language?: string;
}): string {
  const formatted = formatHover(hoverResult);
  const lang = formatted.language !== "text" ? formatted.language : "";
  return ["```" + lang, formatted.contents, "```"].join("\n");
}

// ---------------------------------------------------------------------------
// Diagnostic formatting
// ---------------------------------------------------------------------------

const SEVERITY_COLOR: Record<string, string> = {
  Error: "red",
  Warning: "yellow",
  Information: "blue",
  Hint: "dim",
};

export function formatDiagnostic(
  diagnostic: {
    message: string;
    severity?: number;
    filePath?: string;
    line?: number;
    character?: number;
    code?: string | number;
  },
): FormattedDiagnostic {
  const severityLabel = formatSeverity(diagnostic.severity ?? 3);
  return {
    severity: severityLabel.toLowerCase() as FormattedDiagnostic["severity"],
    message: diagnostic.message,
    file: diagnostic.filePath ?? "<unknown>",
    line: (diagnostic.line ?? 0) + 1,
    character: diagnostic.character ?? 0,
    code: diagnostic.code != null ? String(diagnostic.code) : null,
  };
}

export function formatDiagnosticLine(d: FormattedDiagnostic): string {
  const codeStr = d.code ? ` [${d.code}]` : "";
  return `[${d.severity.toUpperCase()}]${codeStr} ${d.file}:${d.line}:${d.character} — ${d.message}`;
}

export function formatDiagnosticsList(
  diagnostics: Array<{
    message: string;
    severity?: number;
    filePath?: string;
    line?: number;
    character?: number;
    code?: string | number;
  }>,
): string {
  if (!diagnostics.length) return "";
  const groups: Record<string, typeof diagnostics> = {};
  for (const d of diagnostics) {
    const key = d.filePath ?? "<unknown>";
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  }

  const lines: string[] = [];
  for (const [file, diags] of Object.entries(groups)) {
    lines.push(`${file}:`);
    for (const d of diags) {
      const formatted = formatDiagnostic(d);
      lines.push(`  ${formatDiagnosticLine(formatted)}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Call hierarchy formatting
// ---------------------------------------------------------------------------

export function formatCallHierarchyEntry(entry: {
  name: string;
  kind?: string;
  filePath?: string;
  line?: number;
  character?: number;
  detail?: string;
}): CallHierarchyEntry {
  return {
    name: entry.name,
    kind: entry.kind ?? "Unknown",
    file: entry.filePath ?? "<unknown>",
    line: (entry.line ?? 0) + 1,
    character: entry.character ?? 0,
    detail: entry.detail ?? "",
  };
}

export function formatCallHierarchyLine(entry: CallHierarchyEntry, indent: number = 0): string {
  const icon = getSymbolKindIcon(entry.kind);
  const prefix = "  ".repeat(indent);
  const detail = entry.detail ? ` — ${entry.detail}` : "";
  return `${prefix}${icon} ${entry.kind} **${entry.name}**${detail} (${entry.file}:${entry.line})`;
}

export function formatCallHierarchy(
  item: CallHierarchyEntry,
  callers?: CallHierarchyEntry[],
  callees?: CallHierarchyEntry[],
): string {
  const lines: string[] = ["Call Hierarchy:"];
  lines.push(formatCallHierarchyLine(item, 0));

  if (callers?.length) {
    lines.push("  Callers:");
    for (const caller of callers) {
      lines.push(formatCallHierarchyLine(caller, 2));
    }
  }

  if (callees?.length) {
    lines.push("  Callees:");
    for (const callee of callees) {
      lines.push(formatCallHierarchyLine(callee, 2));
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Scope formatting
// ---------------------------------------------------------------------------

export function formatScopeHierarchy(
  symbols: Array<{
    name: string;
    kind?: string;
    line?: number;
    children?: Array<{ name: string; kind?: string; line?: number }>;
  }>,
): string {
  if (!symbols.length) return "";
  const lines: string[] = ["Scope Hierarchy:"];
  for (const sym of symbols) {
    const icon = getSymbolKindIcon(sym.kind ?? "");
    lines.push(`  ${icon} ${sym.kind ?? "?"} ${sym.name}:${(sym.line ?? 0) + 1}`);
    if (sym.children?.length) {
      for (const child of sym.children) {
        const childIcon = getSymbolKindIcon(child.kind ?? "");
        lines.push(`    ${childIcon} ${child.kind ?? "?"} ${child.name}:${(child.line ?? 0) + 1}`);
      }
    }
  }
  return lines.join("\n");
}

export default {
  detectLanguage,
  formatLocation,
  formatLocationString,
  formatSymbol,
  formatSymbolLine,
  formatDocumentSymbols,
  formatReference,
  formatReferenceLine,
  formatReferencesList,
  formatHover,
  formatHoverBlock,
  formatDiagnostic,
  formatDiagnosticLine,
  formatDiagnosticsList,
  formatCallHierarchyEntry,
  formatCallHierarchyLine,
  formatCallHierarchy,
  formatScopeHierarchy,
};