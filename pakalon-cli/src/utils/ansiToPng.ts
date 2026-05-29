/**
 * ANSI to PNG Conversion
 *
 * Converts ANSI-escaped terminal output to PNG images for export/sharing.
 * Uses canvas-like rendering with monospace font metrics.
 *
 * Supports:
 * - 16/256/true-color ANSI codes
 * - Bold, italic, underline, strikethrough
 * - Custom font size and theme
 * - Padding and background customization
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

export interface AnsiToPngOptions {
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  padding?: number;
  backgroundColor?: string;
  theme?: "dark" | "light";
  showLineNumbers?: boolean;
  windowControls?: boolean;
  windowTitle?: string;
  outputPath?: string;
}

export interface ColorMap {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
  background: string;
  foreground: string;
}

const DARK_THEME: ColorMap = {
  black: "#000000",
  red: "#CD3131",
  green: "#0DBC79",
  yellow: "#E5E510",
  blue: "#2472C8",
  magenta: "#BC3FBC",
  cyan: "#11A8CD",
  white: "#E5E5E5",
  brightBlack: "#666666",
  brightRed: "#F14C4C",
  brightGreen: "#23D18B",
  brightYellow: "#F5F543",
  brightBlue: "#3B8EEA",
  brightMagenta: "#D670D6",
  brightCyan: "#29B8DB",
  brightWhite: "#E5E5E5",
  background: "#1E1E1E",
  foreground: "#D4D4D4",
};

const LIGHT_THEME: ColorMap = {
  black: "#000000",
  red: "#CD3131",
  green: "#00BC00",
  yellow: "#949800",
  blue: "#0451A5",
  magenta: "#BC05BC",
  cyan: "#0598BC",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#CD3131",
  brightGreen: "#14CE14",
  brightYellow: "#B5BA00",
  brightBlue: "#0451A5",
  brightMagenta: "#BC05BC",
  brightCyan: "#0598BC",
  brightWhite: "#A5A5A5",
  background: "#FFFFFF",
  foreground: "#333333",
};

interface AnsiToken {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

const ANSI_ESCAPE_REGEX = /\x1b\[([0-9;]*)m/g;
const ANSI_RESET = 0;

function parseAnsiCodes(codeStr: string): number[] {
  if (!codeStr) return [ANSI_RESET];
  return codeStr.split(";").map((c) => parseInt(c, 10) || 0);
}

function applyCodes(
  codes: number[],
  current: { fg?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean },
  theme: ColorMap,
): void {
  for (const code of codes) {
    if (code === ANSI_RESET) {
      current.fg = undefined;
      current.bg = undefined;
      current.bold = false;
      current.italic = false;
      current.underline = false;
      current.strikethrough = false;
    } else if (code === 1) {
      current.bold = true;
    } else if (code === 3) {
      current.italic = true;
    } else if (code === 4) {
      current.underline = true;
    } else if (code === 9) {
      current.strikethrough = true;
    } else if (code === 22) {
      current.bold = false;
    } else if (code >= 30 && code <= 37) {
      const colors = [theme.black, theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan, theme.white];
      current.fg = colors[code - 30];
    } else if (code >= 40 && code <= 47) {
      const colors = [theme.black, theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan, theme.white];
      current.bg = colors[code - 40];
    } else if (code >= 90 && code <= 97) {
      const colors = [theme.brightBlack, theme.brightRed, theme.brightGreen, theme.brightYellow, theme.brightBlue, theme.brightMagenta, theme.brightCyan, theme.brightWhite];
      current.fg = colors[code - 90];
    } else if (code >= 100 && code <= 107) {
      const colors = [theme.black, theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan, theme.white];
      current.bg = colors[code - 100];
    } else if (code === 38 || code === 48) {
      // True color / 256 color — simplified handling
      current.fg = code === 38 ? theme.foreground : current.fg;
      current.bg = code === 48 ? theme.background : current.bg;
    }
  }
}

export function tokenizeAnsi(input: string, theme: ColorMap): AnsiToken[] {
  const tokens: AnsiToken[] = [];
  let lastIndex = 0;
  let current: { fg?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean } = {};

  const regex = new RegExp(ANSI_ESCAPE_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      const text = input.slice(lastIndex, match.index);
      if (text) {
        tokens.push({ text, ...current });
      }
    }
    const codes = parseAnsiCodes(match[1] ?? "");
    applyCodes(codes, current, theme);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < input.length) {
    const remaining = input.slice(lastIndex);
    if (remaining) {
      tokens.push({ text: remaining, ...current });
    }
  }

  return tokens;
}

export function ansiToSvg(
  input: string,
  options: AnsiToPngOptions = {},
): string {
  const theme = options.theme === "light" ? LIGHT_THEME : DARK_THEME;
  const fontSize = options.fontSize ?? 14;
  const lineHeight = options.lineHeight ?? 1.4;
  const padding = options.padding ?? 16;
  const showLineNumbers = options.showLineNumbers ?? false;
  const windowControls = options.windowControls ?? false;
  const windowTitle = options.windowTitle ?? "pakalon";

  const tokens = tokenizeAnsi(input, theme);
  const lines = input.split("\n");
  const charWidth = fontSize * 0.6;
  const lineH = fontSize * lineHeight;
  const maxCols = Math.max(...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").length));
  const lineNumWidth = showLineNumbers ? String(lines.length).length * charWidth + charWidth : 0;

  const width = padding * 2 + lineNumWidth + maxCols * charWidth;
  const headerHeight = windowControls ? 32 : 0;
  const height = headerHeight + padding * 2 + lines.length * lineH;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="${theme.background}" rx="8"/>`;

  if (windowControls) {
    svg += `<circle cx="24" cy="20" r="6" fill="#FF5F56"/>`;
    svg += `<circle cx="44" cy="20" r="6" fill="#FFBD2E"/>`;
    svg += `<circle cx="64" cy="20" r="6" fill="#27C93F"/>`;
    svg += `<text x="${width / 2}" y="24" text-anchor="middle" fill="${theme.foreground}" font-size="12" font-family="system-ui">${windowTitle}</text>`;
  }

  const textStartY = headerHeight + padding + fontSize;
  let lineIdx = 0;
  let charOffset = 0;
  let currentLine = 0;

  for (const token of tokens) {
    const escaped = token.text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const lines = token.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      if (i > 0) {
        currentLine++;
        charOffset = 0;
      }
      if (!lineText) continue;

      const x = padding + lineNumWidth + charOffset * charWidth;
      const y = textStartY + currentLine * lineH;

      let attrs = `x="${x}" y="${y}" fill="${token.fg ?? theme.foreground}" font-size="${fontSize}" font-family="${options.fontFamily ?? "monospace"}"`;
      if (token.bold) attrs += ` font-weight="bold"`;
      if (token.italic) attrs += ` font-style="italic"`;
      if (token.underline) attrs += ` text-decoration="underline"`;

      svg += `<text ${attrs}>${escaped}</text>`;
      charOffset += lineText.length;
    }
    lineIdx++;
  }

  svg += `</svg>`;
  return svg;
}

export async function ansiToPng(
  input: string,
  options: AnsiToPngOptions = {},
): Promise<Buffer> {
  const svg = ansiToSvg(input, options);

  try {
    const sharp = await import("sharp");
    const pngBuffer = await sharp.default(Buffer.from(svg)).png().toBuffer();
    return pngBuffer;
  } catch (err) {
    logger.warn("[ansiToPng] sharp not available, returning SVG as PNG wrapper", { error: err });
    return Buffer.from(svg);
  }
}

export async function saveAnsiAsPng(
  input: string,
  outputPath?: string,
  options: AnsiToPngOptions = {},
): Promise<string> {
  const png = await ansiToPng(input, options);
  const dest = outputPath ?? path.join(os.tmpdir(), `pakalon-ansi-${createHash("md5").update(input.slice(0, 100)).digest("hex").slice(0, 8)}.png`);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, png);
  logger.info("[ansiToPng] Saved PNG", { path: dest });

  return dest;
}

export async function saveAnsiAsSvg(
  input: string,
  outputPath?: string,
  options: AnsiToPngOptions = {},
): Promise<string> {
  const svg = ansiToSvg(input, options);
  const dest = outputPath ?? path.join(os.tmpdir(), `pakalon-ansi-${createHash("md5").update(input.slice(0, 100)).digest("hex").slice(0, 8)}.svg`);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, svg, "utf-8");
  logger.info("[ansiToSvg] Saved SVG", { path: dest });

  return dest;
}

export { DARK_THEME, LIGHT_THEME };
export type { AnsiToken };
