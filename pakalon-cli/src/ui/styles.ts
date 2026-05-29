/**
 * Output Styles - Custom Output Formatting
 * 
 * Provides customizable output formatting with different styles
 * for different output types (code, markdown, tables, errors, etc.)
 */

import chalk from "chalk";
import { z } from "zod";

export type OutputStyle = "plain" | "fancy" | "minimal" | "json" | "xml" | "markdown";

export interface StyleConfig {
  style: OutputStyle;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    success: string;
    warning: string;
    error: string;
    muted: string;
  };
  formatting: {
    showTimestamps: boolean;
    showIcons: boolean;
    compactMode: boolean;
    syntaxHighlighting: boolean;
  };
}

const DEFAULT_STYLE_CONFIG: StyleConfig = {
  style: "fancy",
  colors: {
    primary: "#4F46E5",
    secondary: "#64748B",
    accent: "#22D3EE",
    success: "#22C55E",
    warning: "#F59E0B",
    error: "#EF4444",
    muted: "#94A3B8",
  },
  formatting: {
    showTimestamps: false,
    showIcons: true,
    compactMode: false,
    syntaxHighlighting: true,
  },
};

class OutputStyler {
  private config: StyleConfig;

  constructor(config?: Partial<StyleConfig>) {
    this.config = { ...DEFAULT_STYLE_CONFIG, ...config };
  }

  setStyle(style: OutputStyle): void {
    this.config.style = style;
  }

  getStyle(): OutputStyle {
    return this.config.style;
  }

  setConfig(updates: Partial<StyleConfig>): void {
    this.config = {
      ...this.config,
      colors: { ...this.config.colors, ...updates.colors },
      formatting: { ...this.config.formatting, ...updates.formatting },
      style: updates.style || this.config.style,
    };
  }

  getConfig(): StyleConfig {
    return this.config;
  }

  private applyColor(text: string, colorKey: keyof StyleConfig["colors"]): string {
    const color = this.config.colors[colorKey];
    if (this.config.style === "plain" || !color) return text;

    try {
      return chalk.hex(color)(text);
    } catch {
      return text;
    }
  }

  success(message: string): string {
    return this.applyColor(`[OK] ${message}`, "success");
  }

  error(message: string): string {
    return this.applyColor(`[X] ${message}`, "error");
  }

  warning(message: string): string {
    return this.applyColor(`[!] ${message}`, "warning");
  }

  info(message: string): string {
    return this.applyColor(`[i] ${message}`, "accent");
  }

  header(text: string): string {
    if (this.config.style === "plain") return text;
    if (this.config.style === "minimal") return text;
    return this.applyColor(text, "primary");
  }

  muted(text: string): string {
    return this.applyColor(text, "muted");
  }

  code(text: string, language?: string): string {
    if (this.config.style === "plain" || this.config.style === "minimal") {
      return `\`\`\`${language || ""}\n${text}\n\`\`\``;
    }

    if (this.config.style === "json") {
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return text;
      }
    }

    // Fancy mode with backticks
    const prefix = language ? `\`\`\`${language}` : "```";
    return `${prefix}\n${text}\n\`\`\``;
  }

  table(headers: string[], rows: string[][]): string {
    if (this.config.style === "plain") {
      const colWidths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => (r[i] || "").length))
      );
      const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ");
      const separator = colWidths.map((w) => "-".repeat(w)).join("-+-");
      const bodyRows = rows.map((row) =>
        row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ")
      );
      return [headerRow, separator, ...bodyRows].join("\n");
    }

    if (this.config.style === "json") {
      const data = rows.map((row) =>
        headers.reduce((obj, h, i) => ({ ...obj, [h]: row[i] }), {})
      );
      return JSON.stringify(data, null, 2);
    }

    // Fancy mode
    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] || "").length))
    );
    const headerRow = headers.map((h, i) => this.header(h.padEnd(colWidths[i]))).join(" │ ");
    const separator = colWidths.map((w) => "─".repeat(w)).join("─┼─");
    const bodyRows = rows.map((row) =>
      row.map((cell, i) => this.muted(cell.padEnd(colWidths[i]))).join(" │ ")
    );
    return ["┌" + headerRow.replace(/│/g, "┬").replace(/[─]/g, "─") + "┐", "│" + headerRow + "│", "├" + separator + "┤", ...bodyRows.map((r) => "│" + r + "│"), "└" + separator.replace(/[─]/g, "─") + "┘"].join("\n");
  }

  list(items: string[], numbered = false): string {
    if (this.config.formatting.compactMode) {
      return items.map((item, i) => numbered ? `${i + 1}. ${item}` : `• ${item}`).join(" ");
    }

    return items.map((item, i) => {
      const bullet = numbered ? `${i + 1}.` : "•";
      return `${this.muted(bullet)} ${item}`;
    }).join("\n");
  }

  timestamp(): string {
    if (!this.config.formatting.showTimestamps) return "";
    return this.muted(`[${new Date().toISOString()}]`);
  }

  progressBar(current: number, total: number, width = 30): string {
    const percentage = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * width);
    const empty = width - filled;

    const bar = "█".repeat(filled) + "░".repeat(empty);
    return `${this.muted("[")}${this.applyColor(bar, "primary")}${this.muted("]")} ${percentage}%`;
  }

  section(title: string, content: string): string {
    if (this.config.style === "minimal" || this.config.style === "plain") {
      return `${title}\n${content}`;
    }

    const divider = "─".repeat(Math.min(title.length, 60));
    return `${this.header(title)}\n${this.muted(divider)}\n${content}`;
  }

  errorBlock(message: string, details?: string): string {
    const block = [
      this.error("Error:"),
      this.applyColor(message, "error"),
    ];

    if (details) {
      block.push(this.muted(details));
    }

    return block.join("\n");
  }

  successBlock(message: string, details?: string): string {
    const block = [
      this.success("Success:"),
      this.applyColor(message, "success"),
    ];

    if (details) {
      block.push(this.muted(details));
    }

    return block.join("\n");
  }

  toolResult(toolName: string, result: string): string {
    if (this.config.style === "json") {
      try {
        const parsed = JSON.parse(result);
        return JSON.stringify({ tool: toolName, result: parsed }, null, 2);
      } catch {
        return JSON.stringify({ tool: toolName, result }, null, 2);
      }
    }

    if (this.config.style === "minimal") {
      return `${this.muted(`[${toolName}]`)} ${result}`;
    }

    return `${this.header(toolName)}\n${this.muted(result)}`;
  }

  format(text: string, type: "success" | "error" | "warning" | "info" | "muted"): string {
    switch (type) {
      case "success": return this.success(text);
      case "error": return this.error(text);
      case "warning": return this.warning(text);
      case "info": return this.info(text);
      case "muted": return this.muted(text);
    }
  }
}

let styler: OutputStyler | null = null;

export function getOutputStyler(config?: Partial<StyleConfig>): OutputStyler {
  if (!styler) {
    styler = new OutputStyler(config);
  }
  return styler;
}

export function setOutputStyle(style: OutputStyle): void {
  getOutputStyler().setStyle(style);
}

export function getOutputStyleConfig(): StyleConfig {
  return getOutputStyler().getConfig();
}

export function updateOutputStyleConfig(updates: Partial<StyleConfig>): void {
  getOutputStyler().setConfig(updates);
}

export default OutputStyler;