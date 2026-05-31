/**
 * Color Diff Module
 * 
 * Pure TypeScript implementation for syntax highlighting and color diffing.
 * Provides terminal-based color output for code diffs and file viewing.
 * 
 * This is a simplified version that provides core functionality
 * without requiring external dependencies like highlight.js.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface SyntaxTheme {
  theme: string;
  source: string | null;
}

export type ColorMode = 'truecolor' | 'color256' | 'ansi';

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Style {
  foreground: Color;
  background: Color;
}

type Block = [Style, string];
type Marker = '+' | '-' | ' ';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const UNDIM = '\x1b[22m';

// ---------------------------------------------------------------------------
// Color Helpers
// ---------------------------------------------------------------------------

function rgb(r: number, g: number, b: number): Color {
  return { r, g, b, a: 255 };
}

function ansiIdx(index: number): Color {
  return { r: index, g: 0, b: 0, a: 0 };
}

const DEFAULT_BG: Color = { r: 0, g: 0, b: 0, a: 1 };

function detectColorMode(theme: string): ColorMode {
  if (theme.includes('ansi')) return 'ansi';
  const ct = process.env.COLORTERM ?? '';
  return ct === 'truecolor' || ct === '24bit' ? 'truecolor' : 'color256';
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function ansi256FromRgb(r: number, g: number, b: number): number {
  const q = (c: number) =>
    c < 48 ? 0 : c < 115 ? 1 : c < 155 ? 2 : c < 195 ? 3 : c < 235 ? 4 : 5;
  const qr = q(r);
  const qg = q(g);
  const qb = q(b);
  const cubeIdx = 16 + 36 * qr + 6 * qg + qb;
  const grey = Math.round((r + g + b) / 3);
  if (grey < 5) return 16;
  if (grey > 244 && qr === qg && qg === qb) return cubeIdx;
  const greyLevel = Math.max(0, Math.min(23, Math.round((grey - 8) / 10)));
  const greyIdx = 232 + greyLevel;
  const greyRgb = 8 + greyLevel * 10;
  const cr = CUBE_LEVELS[qr]!;
  const cg = CUBE_LEVELS[qg]!;
  const cb = CUBE_LEVELS[qb]!;
  const dCube = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
  const dGrey = (r - greyRgb) ** 2 + (g - greyRgb) ** 2 + (b - greyRgb) ** 2;
  return dGrey < dCube ? greyIdx : cubeIdx;
}

function colorToEscape(c: Color, fg: boolean, mode: ColorMode): string {
  if (c.a === 0) {
    const idx = c.r;
    if (idx < 8) return `\x1b[${(fg ? 30 : 40) + idx}m`;
    if (idx < 16) return `\x1b[${(fg ? 90 : 100) + (idx - 8)}m`;
    return `\x1b[${fg ? 38 : 48};5;${idx}m`;
  }
  if (c.a === 1) return fg ? '\x1b[39m' : '\x1b[49m';
  const codeType = fg ? 38 : 48;
  if (mode === 'truecolor') {
    return `\x1b[${codeType};2;${c.r};${c.g};${c.b}m`;
  }
  return `\x1b[${codeType};5;${ansi256FromRgb(c.r, c.g, c.b)}m`;
}

function asTerminalEscaped(
  blocks: readonly Block[],
  mode: ColorMode,
  skipBackground: boolean,
  dim: boolean
): string {
  let out = dim ? RESET + DIM : RESET;
  for (const [style, text] of blocks) {
    out += colorToEscape(style.foreground, true, mode);
    if (!skipBackground) {
      out += colorToEscape(style.background, false, mode);
    }
    out += text;
  }
  return out + RESET;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

interface Theme {
  addLine: Color;
  addWord: Color;
  addDecoration: Color;
  deleteLine: Color;
  deleteWord: Color;
  deleteDecoration: Color;
  foreground: Color;
  background: Color;
}

function defaultStyle(theme: Theme): Style {
  return { foreground: theme.foreground, background: theme.background };
}

function lineBackground(marker: Marker, theme: Theme): Color {
  switch (marker) {
    case '+': return theme.addLine;
    case '-': return theme.deleteLine;
    case ' ': return theme.background;
  }
}

function decorationColor(marker: Marker, theme: Theme): Color {
  switch (marker) {
    case '+': return theme.addDecoration;
    case '-': return theme.deleteDecoration;
    case ' ': return theme.foreground;
  }
}

function buildTheme(themeName: string, _mode: ColorMode): Theme {
  const isDark = themeName.includes('dark');
  const isAnsi = themeName.includes('ansi');

  if (isAnsi) {
    return {
      addLine: DEFAULT_BG,
      addWord: DEFAULT_BG,
      addDecoration: ansiIdx(10),
      deleteLine: DEFAULT_BG,
      deleteWord: DEFAULT_BG,
      deleteDecoration: ansiIdx(9),
      foreground: ansiIdx(7),
      background: DEFAULT_BG,
    };
  }

  if (isDark) {
    return {
      addLine: rgb(2, 40, 0),
      addWord: rgb(4, 71, 0),
      addDecoration: rgb(80, 200, 80),
      deleteLine: rgb(61, 1, 0),
      deleteWord: rgb(92, 2, 0),
      deleteDecoration: rgb(220, 90, 90),
      foreground: rgb(248, 248, 242),
      background: DEFAULT_BG,
    };
  }

  return {
    addLine: rgb(220, 255, 220),
    addWord: rgb(178, 255, 178),
    addDecoration: rgb(36, 138, 61),
    deleteLine: rgb(255, 220, 220),
    deleteWord: rgb(255, 199, 199),
    deleteDecoration: rgb(207, 34, 46),
    foreground: rgb(51, 51, 51),
    background: DEFAULT_BG,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function maxLineNumber(hunk: Hunk): number {
  const oldEnd = Math.max(0, hunk.oldStart + hunk.oldLines - 1);
  const newEnd = Math.max(0, hunk.newStart + hunk.newLines - 1);
  return Math.max(oldEnd, newEnd);
}

function parseMarker(s: string): Marker {
  return s === '+' || s === '-' ? s : ' ';
}

export class ColorDiff {
  private hunk: Hunk;
  private filePath: string;

  constructor(hunk: Hunk, filePath: string) {
    this.hunk = hunk;
    this.filePath = filePath;
  }

  render(themeName: string, width: number, dim: boolean): string[] | null {
    const mode = detectColorMode(themeName);
    const theme = buildTheme(themeName, mode);

    const maxDigits = String(maxLineNumber(this.hunk)).length;
    let oldLine = this.hunk.oldStart;
    let newLine = this.hunk.newStart;
    const effectiveWidth = Math.max(1, width - maxDigits - 2 - 1);

    type Entry = { lineNumber: number; marker: Marker; code: string };
    const entries: Entry[] = this.hunk.lines.map(rawLine => {
      const marker = parseMarker(rawLine.slice(0, 1));
      const code = rawLine.slice(1);
      let lineNumber: number;
      switch (marker) {
        case '+':
          lineNumber = newLine++;
          break;
        case '-':
          lineNumber = oldLine++;
          break;
        case ' ':
          lineNumber = newLine;
          oldLine++;
          newLine++;
          break;
      }
      return { lineNumber, marker, code };
    });

    const out: string[] = [];
    for (const entry of entries) {
      const { lineNumber, marker, code } = entry;
      const style = defaultStyle(theme);
      const bg = lineBackground(marker, theme);
      const fg = decorationColor(marker, theme);

      const lineStyle: Style = { foreground: fg, background: bg };
      const blocks: Block[] = [[lineStyle, code]];

      const prefix = ` ${String(lineNumber).padStart(maxDigits)} `;
      const prefixStyle: Style = { foreground: fg, background: bg };
      const fullLine: Block[] = [[prefixStyle, prefix], ...blocks];

      out.push(asTerminalEscaped(fullLine, mode, false, dim));
    }
    return out;
  }
}

export class ColorFile {
  private code: string;
  private filePath: string;

  constructor(code: string, filePath: string) {
    this.code = code;
    this.filePath = filePath;
  }

  render(themeName: string, width: number, dim: boolean): string[] | null {
    const mode = detectColorMode(themeName);
    const theme = buildTheme(themeName, mode);
    const lines = this.code.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const maxDigits = String(lines.length).length;
    const effectiveWidth = Math.max(1, width - maxDigits - 2);

    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const style = defaultStyle(theme);
      const blocks: Block[] = [[style, lines[i]!]];
      const prefix = ` ${String(i + 1).padStart(maxDigits)} `;
      const prefixStyle: Style = { foreground: theme.foreground, background: theme.background };
      const fullLine: Block[] = [[prefixStyle, prefix], ...blocks];
      out.push(asTerminalEscaped(fullLine, mode, true, dim));
    }
    return out;
  }
}

export function getSyntaxTheme(themeName: string): SyntaxTheme {
  const defaultTheme = themeName.includes('dark') ? 'Monokai Extended' : 'GitHub';
  return { theme: defaultTheme, source: null };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  ColorDiff,
  ColorFile,
  getSyntaxTheme,
  detectColorMode,
  ansi256FromRgb,
};
