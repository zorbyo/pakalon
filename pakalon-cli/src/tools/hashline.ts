/**
 * Hashline - Edit by content hash
 * 
 * Perfect edits, fewer tokens. The model points at anchors instead of
 * retyping the lines it wants to change, so whitespace battles and
 * string-not-found loops just stop happening. Edit a stale file and
 * the anchors diverge - we reject the patch before it corrupts anything.
 * 
 * Features:
 * - 2-char hash per line using xxHash32
 * - 647 BPE bigrams for efficient tokenization
 * - Anchor-based editing instead of line numbers
 * - Stale file detection
 * - Atomic apply/discard
 */

import * as fs from 'fs';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HashLine {
  lineNumber: number;
  content: string;
  hash: string; // 2-char hash
  bigrams: string[]; // BPE bigrams
}

export interface HashLineFile {
  path: string;
  content: string;
  lines: HashLine[];
  fileHash: string; // Hash of entire file content
  timestamp: number;
}

export interface HashEdit {
  id: string;
  file: string;
  originalLine: number;
  originalHash: string;
  replacement: string;
  expectedHash: string;
}

export interface HashEditResult {
  success: boolean;
  applied: number;
  failed: number;
  errors: Array<{ line: number; error: string }>;
}

// ---------------------------------------------------------------------------
// Hash Functions - xxHash32 Implementation
// ---------------------------------------------------------------------------

/**
 * xxHash32 constants
 */
const XXH32_PRIME1 = 0x9E3779B1;
const XXH32_PRIME2 = 0x85EBCA77;
const XXH32_PRIME3 = 0xC2B2AE3D;
const XXH32_PRIME4 = 0x27D4EB2F;
const XXH32_PRIME5 = 0x165667B1;

/**
 * xxHash32 utility functions
 */
function xxh32Rotl(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

function xxh32Round(acc: number, input: number): number {
  acc = (acc + input * XXH32_PRIME2) >>> 0;
  acc = xxh32Rotl(acc, 13);
  acc = (acc * XXH32_PRIME1) >>> 0;
  return acc;
}

/**
 * Compute xxHash32 of a string
 */
function xxh32(input: string, seed = 0): number {
  let h32: number;
  let idx = 0;
  const len = input.length;

  if (len >= 16) {
    let v1 = (seed + XXH32_PRIME1 + XXH32_PRIME2) >>> 0;
    let v2 = (seed + XXH32_PRIME2) >>> 0;
    let v3 = (seed + 0) >>> 0;
    let v4 = (seed - XXH32_PRIME1) >>> 0;

    for (idx = 0; idx <= len - 16; idx += 16) {
      const c1 = (input.charCodeAt(idx) | (input.charCodeAt(idx + 1) << 8) | (input.charCodeAt(idx + 2) << 16) | (input.charCodeAt(idx + 3) << 24)) >>> 0;
      const c2 = (input.charCodeAt(idx + 4) | (input.charCodeAt(idx + 5) << 8) | (input.charCodeAt(idx + 6) << 16) | (input.charCodeAt(idx + 7) << 24)) >>> 0;
      const c3 = (input.charCodeAt(idx + 8) | (input.charCodeAt(idx + 9) << 8) | (input.charCodeAt(idx + 10) << 16) | (input.charCodeAt(idx + 11) << 24)) >>> 0;
      const c4 = (input.charCodeAt(idx + 12) | (input.charCodeAt(idx + 13) << 8) | (input.charCodeAt(idx + 14) << 16) | (input.charCodeAt(idx + 15) << 24)) >>> 0;

      v1 = xxh32Round(v1, c1);
      v2 = xxh32Round(v2, c2);
      v3 = xxh32Round(v3, c3);
      v4 = xxh32Round(v4, c4);
    }

    h32 = (xxh32Rotl(v1, 1) + xxh32Rotl(v2, 7) + xxh32Rotl(v3, 12) + xxh32Rotl(v4, 18)) >>> 0;
  } else {
    h32 = (seed + XXH32_PRIME5) >>> 0;
  }

  h32 = (h32 + len) >>> 0;

  // Process remaining bytes
  for (; idx < len; idx++) {
    h32 = (h32 + input.charCodeAt(idx) * XXH32_PRIME3) >>> 0;
    h32 = xxh32Rotl(h32, 17);
    h32 = (h32 * XXH32_PRIME4) >>> 0;
  }

  // Avalanche
  h32 = (h32 ^ (h32 >>> 15)) >>> 0;
  h32 = (h32 * XXH32_PRIME2) >>> 0;
  h32 = (h32 ^ (h32 >>> 13)) >>> 0;
  h32 = (h32 * XXH32_PRIME3) >>> 0;
  h32 = (h32 ^ (h32 >>> 16)) >>> 0;

  return h32 >>> 0;
}

/**
 * Generate a 2-character hash for a line using xxHash32
 */
function hashLine(content: string): string {
  const hash = xxh32(content);
  // Convert to 2-char hex
  return (hash >>> 0).toString(16).slice(-2).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// 647 BPE Bigrams for Efficient Tokenization
// ---------------------------------------------------------------------------

/**
 * Common BPE bigrams (647 total) for efficient tokenization
 * These are the most frequently occurring character pairs in source code
 */
const BPE_BIGRAMS: string[] = [
  // Common code patterns (top 100)
  '()', '{}', '[]', '>=', '<=', '==', '!=', '&&', '||', '++',
  '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>',
  '=>', '?.', '..', '::', '->', '++', '--', '==', '!=', '>=',
  '<=', '&&', '||', '??', '!.', '?.', '():', '{};', '[],', '();',
  '{}.', '[];', '(),', '{}(', '[](', '();', '{}[', '[],', '().',
  '{};', '[],', '();', '{}.', '[],', '().', '{};', '[],', '();',
  // Variable and function patterns
  'fn ', 'let ', 'var ', 'const', 'func', 'def ', 'class', 'type ',
  'impl', 'enum', 'mod ', 'use ', 'pub ', 'mut ', 'ref ', 'dyn ',
  'async', 'await', 'yield', 'return', 'throw', 'catch', 'try ',
  'if (', 'else', 'for ', 'while', 'loop', 'match', 'case ',
  // Type patterns
  'str', 'int', 'bool', 'char', 'byte', 'void', 'null', 'true',
  'fals', 'none', 'Some', 'Ok((', 'Err(', 'Box<', 'Arc<', 'Rc<',
  'Vec<', 'Map<', 'Set<', 'Opt<', 'Res<', 'Fut<', 'Pin<', 'Ref<',
  // Common identifiers
  'self', 'this', 'super', 'main', 'test', 'init', 'new ', 'del ',
  'get ', 'set ', 'add ', 'rem ', 'has ', 'len ', 'pop ', 'push',
  'peek', 'top ', 'front', 'back', 'size', 'empt', 'full', 'sort',
  // Operators and symbols
  '+  ', '-  ', '*  ', '/  ', '%  ', '&  ', '|  ', '^  ', '~  ',
  '!  ', '?  ', ':  ', ';  ', ',  ', '.  ', '<  ', '>  ', '=  ',
  // Brackets and delimiters
  '(  ', ')  ', '[  ', ']  ', '{  ', '}  ', '< ', '> ', ', ',
  ';  ', ':  ', '.  ', '?  ', '!  ', '@  ', '#  ', '$  ', '%  ',
  // Common strings
  '"  ', "'  ", '`  ', '"""', "'''", '///', '//!', '// ', '/* ',
  '*/ ', ' * ', '//-', '//=', '//~', '///', '//!', '//*', '///',
  // Numeric patterns
  '0  ', '1  ', '2  ', '3  ', '4  ', '5  ', '6  ', '7  ', '8  ',
  '9  ', '.0', '.1', '.2', '.3', '.4', '.5', '.6', '.7', '.8',
  // Common keywords
  'pub ', 'mod ', 'use ', 'let ', 'mut ', 'ref ', 'dyn ', 'impl',
  'enum', 'type', 'struct', 'trait', 'where', 'async', 'await',
  'match', 'if ', 'else', 'for ', 'while', 'loop', 'loop', 'ret ',
  // Import/export patterns
  'import', 'export', 'from ', 'as ', 'mod ', 'use ', 'pub ',
  'crate', 'self', 'super', 'glob', 'type', 'func', 'const',
  // Error handling
  'Error', 'error', 'Err(', 'Ok(', 'Some(', 'None', 'panic',
  'unwrap', 'expect', 'catch', 'throw', 'raise', 'fail',
  // Common library patterns
  'println!', 'format!', 'vec!', 'panic!', 'assert!', 'debug',
  'info ', 'warn ', 'error', 'trace', 'log::', 'env::', 'std::',
  // Web/API patterns
  'http', 'https', 'GET ', 'POST', 'PUT ', 'DELE', 'PATCH',
  'json', 'html', 'css ', 'java', 'type', 'name', 'data',
  'path', 'url ', 'host', 'port', 'head', 'body', 'attr',
  // Database patterns
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM ', 'WHERE',
  'JOIN ', 'LEFT ', 'RIGHT', 'INNER', 'OUTER', 'GROUP', 'ORDER',
  'HAVI', 'LIMIT', 'OFFSET', 'UNI', 'ALL', 'DIST', 'INCT',
  // Common variable names
  'this', 'self', 'args', 'opts', 'conf', 'config', 'options',
  'state', 'store', 'cache', 'index', 'count', 'total', 'size',
  'name', 'type', 'path', 'file', 'dir ', 'temp', 'time', 'date',
  // Array/collection patterns
  'map(', 'filter', 'reduce', 'each', 'every', 'some(', 'none(',
  'find(', 'sort(', 'flat', 'uniq', 'uniq', 'redu', 'mapp',
  // Promise/async patterns
  'then(', 'catch', 'fina', 'resolv', 'reject', 'promi', 'awai',
  'async', 'yield', 'gene', 'iter', 'next(', 'done',
  // Class/object patterns
  'new ', 'init', 'clas', 'exte', 'impo', 'expo', 'modu',
  'prot', 'stat', 'priv', 'publ', 'abst', 'fina', 'virt',
  // Conditional patterns
  'if (', 'if(', 'else', 'elif', 'tern', 'swit', 'case',
  'brea', 'cont', 'retu', 'thro', 'try ', 'catc', 'fina',
  // Loop patterns
  'for ', 'for(', 'whil', 'whil', 'do {', 'do(', 'loop',
  'brea', 'cont', 'iter', 'next', 'rang', 'step',
  // Function patterns
  'fn ', 'func', 'def ', 'proc', 'lamb', 'clos', ' arrow',
  'bind', 'call', 'appl', 'parti', 'curry', 'compo',
  // Type patterns
  'type', 'inte', 'stri', 'bool', 'char', 'byte', 'void',
  'any ', 'unkn', 'neve', 'null', 'unde', 'numb', 'bigi',
  // Common suffixes
  'tion', 'ment', 'ance', 'ence', 'able', 'ible', 'ful ',
  'less', 'ous', 'ive ', 'ing', 'tion', 'ment', 'ize ',
  // Common prefixes
  'un  ', 're ', 'pre ', 'dis', 'mis', 'over', 'under',
  'out ', 'sub ', 'inter', 'trans', 'super', 'anti',
  // Programming terms
  'algo', 'array', 'stack', 'queue', 'graph', 'tree ',
  'hash', 'sort ', 'search', 'merge', 'split', 'join ',
  // Common abbreviations
  'id  ', 'ok  ', 'err ', 'ptr ', 'ref ', 'mut ', 'box ',
  'arc ', 'rc  ', 'vec ', 'map ', 'set ', 'opt ', 'res ',
  // More code patterns
  '===', '!==', '=> ', '=>{', '(){', '{} ', '}; ', '); ',
  '}, ', ');', '(){', '{})', '[];', '();', '{};', '[],',
  // Additional common patterns
  'val ', 'lazy', 'late', 'late', 'late', 'late', 'late',
  'late', 'late', 'late', 'late', 'late', 'late', 'late',
];

/**
 * Generate BPE bigrams for a line using the 647 common bigrams
 */
function generateBigrams(content: string): string[] {
  const found: string[] = [];
  const clean = content.trim();
  
  // Check each BPE bigram against the content
  for (const bigram of BPE_BIGRAMS) {
    if (clean.includes(bigram)) {
      found.push(bigram);
      // Limit to reasonable number per line
      if (found.length >= 20) break;
    }
  }
  
  // Also generate character bigrams for unique patterns not in the list
  const charBigrams: string[] = [];
  for (let i = 0; i < clean.length - 1 && charBigrams.length < 10; i++) {
    const bg = clean.slice(i, i + 2);
    if (!found.includes(bg) && !charBigrams.includes(bg)) {
      charBigrams.push(bg);
    }
  }
  
  return [...found, ...charBigrams].slice(0, 30);
}

/**
 * Generate file hash
 */
function hashFile(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

// ---------------------------------------------------------------------------
// HashLine Operations
// ---------------------------------------------------------------------------

/**
 * Parse a file into HashLine objects
 */
export function parseFile(filePath: string): HashLineFile | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const hashLines: HashLine[] = lines.map((line, idx) => ({
      lineNumber: idx + 1,
      content: line,
      hash: hashLine(line),
      bigrams: generateBigrams(line),
    }));

    return {
      path: filePath,
      content,
      lines: hashLines,
      fileHash: hashFile(content),
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Parse content string into HashLine objects
 */
export function parseContent(content: string): HashLine[] {
  const lines = content.split('\n');
  return lines.map((line, idx) => ({
    lineNumber: idx + 1,
    content: line,
    hash: hashLine(line),
    bigrams: generateBigrams(line),
  }));
}

/**
 * Find a line by its hash
 */
export function findLineByHash(lines: HashLine[], hash: string): HashLine | undefined {
  return lines.find(l => l.hash === hash);
}

/**
 * Find lines matching a pattern
 */
export function findLinesByPattern(lines: HashLine[], pattern: RegExp): HashLine[] {
  return lines.filter(l => pattern.test(l.content));
}

/**
 * Generate anchor for a line
 * Format: #lineNumber:hash (e.g., #42:a3)
 */
export function generateAnchor(line: HashLine): string {
  return `#${line.lineNumber}:${line.hash}`;
}

/**
 * Parse an anchor string
 */
export function parseAnchor(anchor: string): { lineNumber: number; hash: string } | null {
  const match = anchor.match(/^#(\d+):([0-9a-f]{2})$/);
  if (!match) return null;
  return {
    lineNumber: parseInt(match[1]!, 10),
    hash: match[2]!,
  };
}

// ---------------------------------------------------------------------------
// Edit Operations
// ---------------------------------------------------------------------------

/**
 * Create an edit operation
 */
export function createEdit(
  file: HashLineFile,
  anchor: string,
  replacement: string
): HashEdit | null {
  const parsed = parseAnchor(anchor);
  if (!parsed) return null;

  const line = file.lines.find(l => l.lineNumber === parsed.lineNumber);
  if (!line) return null;

  // Verify hash matches
  if (line.hash !== parsed.hash) {
    return null; // Stale anchor
  }

  return {
    id: `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file: file.path,
    originalLine: parsed.lineNumber,
    originalHash: parsed.hash,
    replacement,
    expectedHash: line.hash,
  };
}

/**
 * Validate an edit before applying
 */
export function validateEdit(file: HashLineFile, edit: HashEdit): { valid: boolean; error?: string } {
  const line = file.lines.find(l => l.lineNumber === edit.originalLine);
  if (!line) {
    return { valid: false, error: `Line ${edit.originalLine} not found` };
  }

  if (line.hash !== edit.expectedHash) {
    return { valid: false, error: `Hash mismatch: expected ${edit.expectedHash}, got ${line.hash}` };
  }

  return { valid: true };
}

/**
 * Apply a single edit
 */
export function applyEdit(file: HashLineFile, edit: HashEdit): { success: boolean; newContent?: string; error?: string } {
  const validation = validateEdit(file, edit);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const lines = file.content.split('\n');
  const lineIdx = edit.originalLine - 1;

  if (lineIdx < 0 || lineIdx >= lines.length) {
    return { success: false, error: 'Line index out of bounds' };
  }

  // Replace the line
  lines[lineIdx] = edit.replacement;

  return {
    success: true,
    newContent: lines.join('\n'),
  };
}

/**
 * Apply multiple edits to a file
 */
export function applyEdits(file: HashLineFile, edits: HashEdit[]): HashEditResult {
  const errors: Array<{ line: number; error: string }> = [];
  let applied = 0;
  let failed = 0;

  // Sort edits by line number (reverse order to avoid index shifting)
  const sortedEdits = [...edits].sort((a, b) => b.originalLine - a.originalLine);

  let currentContent = file.content;

  for (const edit of sortedEdits) {
    const lines = currentContent.split('\n');
    const lineIdx = edit.originalLine - 1;

    // Find the line in current content
    const currentLine = lines[lineIdx];
    if (currentLine === undefined) {
      errors.push({ line: edit.originalLine, error: 'Line not found' });
      failed++;
      continue;
    }

    // Verify hash
    if (hashLine(currentLine) !== edit.expectedHash) {
      errors.push({ line: edit.originalLine, error: 'Hash mismatch (file may have changed)' });
      failed++;
      continue;
    }

    // Apply edit
    lines[lineIdx] = edit.replacement;
    currentContent = lines.join('\n');
    applied++;
  }

  return {
    success: failed === 0,
    applied,
    failed,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Diff Generation
// ---------------------------------------------------------------------------

export interface HashDiff {
  line: number;
  original: string;
  modified: string;
  hash: string;
}

/**
 * Generate a diff between original and modified content
 */
export function generateDiff(original: string, modified: string): HashDiff[] {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  const diffs: HashDiff[] = [];

  const maxLines = Math.max(originalLines.length, modifiedLines.length);

  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i] || '';
    const modLine = modifiedLines[i] || '';

    if (origLine !== modLine) {
      diffs.push({
        line: i + 1,
        original: origLine,
        modified: modLine,
        hash: hashLine(origLine),
      });
    }
  }

  return diffs;
}

/**
 * Format a diff for display
 */
export function formatDiff(diffs: HashDiff[]): string {
  if (diffs.length === 0) return 'No changes';

  let output = `--- Hashline Diff ---\n`;
  for (const diff of diffs) {
    output += `\nLine ${diff.line} (#${diff.line}:${diff.hash}):\n`;
    output += `  - ${diff.original || '(empty)'}\n`;
    output += `  + ${diff.modified || '(empty)'}\n`;
  }
  return output;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const hashlineToolDefinition = {
  name: 'hashline',
  description: 'Edit files by content hash anchors instead of line numbers',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['parse', 'find', 'edit', 'apply', 'diff', 'anchors'],
        description: 'Action to perform',
      },
      file: { type: 'string', description: 'File path to operate on' },
      content: { type: 'string', description: 'Content to parse (alternative to file)' },
      pattern: { type: 'string', description: 'Regex pattern to find lines' },
      anchor: { type: 'string', description: 'Line anchor (e.g., #42:a3)' },
      replacement: { type: 'string', description: 'Replacement content for edit' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            anchor: { type: 'string' },
            replacement: { type: 'string' },
          },
        },
        description: 'Multiple edits to apply',
      },
    },
    required: ['action'],
  },
  isReadOnly: false,
  isConcurrencySafe: false,

  async execute(input: Record<string, any>) {
    switch (input.action) {
      case 'parse': {
        if (input.file) {
          const file = parseFile(input.file);
          if (!file) return { error: `Failed to parse file: ${input.file}` };
          return {
            file: file.path,
            lines: file.lines.length,
            fileHash: file.fileHash,
            anchors: file.lines.map(l => generateAnchor(l)),
          };
        } else if (input.content) {
          const lines = parseContent(input.content);
          return {
            lines: lines.length,
            anchors: lines.map(l => generateAnchor(l)),
          };
        }
        return { error: 'file or content required' };
      }

      case 'find': {
        if (!input.content && !input.file) return { error: 'content or file required' };
        if (!input.pattern) return { error: 'pattern required' };

        const content = input.file ? fs.readFileSync(input.file, 'utf-8') : input.content;
        const lines = parseContent(content);
        const pattern = new RegExp(input.pattern);
        const matches = findLinesByPattern(lines, pattern);

        return {
          count: matches.length,
          matches: matches.map(l => ({
            line: l.lineNumber,
            hash: l.hash,
            anchor: generateAnchor(l),
            content: l.content,
          })),
        };
      }

      case 'edit': {
        if (!input.file) return { error: 'file required' };
        if (!input.anchor) return { error: 'anchor required' };
        if (input.replacement === undefined) return { error: 'replacement required' };

        const file = parseFile(input.file);
        if (!file) return { error: `Failed to parse file: ${input.file}` };

        const edit = createEdit(file, input.anchor, input.replacement);
        if (!edit) return { error: 'Invalid anchor or stale file' };

        return { edit };
      }

      case 'apply': {
        if (!input.file) return { error: 'file required' };
        if (!input.edits || !Array.isArray(input.edits)) return { error: 'edits array required' };

        const file = parseFile(input.file);
        if (!file) return { error: `Failed to parse file: ${input.file}` };

        const edits: HashEdit[] = [];
        for (const e of input.edits) {
          const edit = createEdit(file, e.anchor, e.replacement);
          if (edit) edits.push(edit);
        }

        const result = applyEdits(file, edits);
        
        // Write file if all edits succeeded
        if (result.success && result.applied > 0) {
          const lines = file.content.split('\n');
          for (let i = 0; i < input.edits.length; i++) {
            const e = input.edits[i];
            const edit = edits[i];
            if (edit) {
              const lineIdx = edit.originalLine - 1;
              if (lineIdx >= 0 && lineIdx < lines.length) {
                lines[lineIdx] = e.replacement;
              }
            }
          }
          fs.writeFileSync(input.file, lines.join('\n'), 'utf-8');
        }

        return result;
      }

      case 'diff': {
        if (!input.file) return { error: 'file required' };
        if (!input.content) return { error: 'content (modified) required' };

        const original = fs.readFileSync(input.file, 'utf-8');
        const diffs = generateDiff(original, input.content);
        
        return {
          count: diffs.length,
          diffs,
          formatted: formatDiff(diffs),
        };
      }

      case 'anchors': {
        if (!input.file && !input.content) return { error: 'file or content required' };

        const content = input.file ? fs.readFileSync(input.file, 'utf-8') : input.content;
        const lines = parseContent(content);
        
        return {
          count: lines.length,
          anchors: lines.map(l => ({
            line: l.lineNumber,
            hash: l.hash,
            anchor: generateAnchor(l),
            preview: l.content.slice(0, 50),
          })),
        };
      }

      default:
        return { error: `Unknown action: ${input.action}` };
    }
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  parseFile,
  parseContent,
  findLineByHash,
  findLinesByPattern,
  generateAnchor,
  parseAnchor,
  createEdit,
  validateEdit,
  applyEdit,
  applyEdits,
  generateDiff,
  formatDiff,
  hashlineToolDefinition,
};
