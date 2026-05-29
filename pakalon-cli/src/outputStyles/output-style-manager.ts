/**
 * Output Style Selection - Customizable AI Output Formatting
 * 
 * Allows users to select different output styles for code formatting
 * and presentation.
 */

import fs from "fs/promises";
import path from "path";

export type OutputStyle =
  | "default"
  | "compact"
  | "detailed"
  | "minimal"
  | "terse"
  | "verbose";

export interface OutputStyleConfig {
  style: OutputStyle;
  includeLineNumbers: boolean;
  syntaxHighlighting: boolean;
  maxCodeBlockLines: number;
  wrapCode: boolean;
  showFileHeaders: boolean;
  showTokensUsed: boolean;
}

const STYLE_CONFIGS: Record<OutputStyle, Partial<OutputStyleConfig>> = {
  default: {
    includeLineNumbers: true,
    syntaxHighlighting: true,
    maxCodeBlockLines: 100,
    wrapCode: false,
    showFileHeaders: true,
    showTokensUsed: true,
  },
  compact: {
    includeLineNumbers: false,
    syntaxHighlighting: false,
    maxCodeBlockLines: 30,
    wrapCode: true,
    showFileHeaders: false,
    showTokensUsed: false,
  },
  detailed: {
    includeLineNumbers: true,
    syntaxHighlighting: true,
    maxCodeBlockLines: 500,
    wrapCode: false,
    showFileHeaders: true,
    showTokensUsed: true,
  },
  minimal: {
    includeLineNumbers: false,
    syntaxHighlighting: false,
    maxCodeBlockLines: 20,
    wrapCode: true,
    showFileHeaders: false,
    showTokensUsed: false,
  },
  terse: {
    includeLineNumbers: false,
    syntaxHighlighting: true,
    maxCodeBlockLines: 50,
    wrapCode: true,
    showFileHeaders: false,
    showTokensUsed: false,
  },
  verbose: {
    includeLineNumbers: true,
    syntaxHighlighting: true,
    maxCodeBlockLines: 1000,
    wrapCode: false,
    showFileHeaders: true,
    showTokensUsed: true,
  },
};

const STYLE_FILE = ".pakalon/output-style.json";

class OutputStyleManager {
  private currentStyle: OutputStyle = "default";
  private customConfig: Partial<OutputStyleConfig> = {};
  private styleFilePath: string;

  constructor(projectDir: string) {
    this.styleFilePath = path.join(projectDir, STYLE_FILE);
  }

  async initialize(): Promise<void> {
    try {
      const data = await fs.readFile(this.styleFilePath, "utf-8");
      const parsed = JSON.parse(data) as Partial<OutputStyleConfig> & { style?: OutputStyle };
      
      if (parsed.style && STYLE_CONFIGS[parsed.style]) {
        this.currentStyle = parsed.style;
        this.customConfig = { ...parsed };
      }
    } catch {
      this.currentStyle = "default";
      this.customConfig = {};
    }
  }

  async setStyle(style: OutputStyle): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!STYLE_CONFIGS[style]) {
      return { success: false, error: `Unknown style: ${style}` };
    }

    this.currentStyle = style;
    this.customConfig = {};
    await this.persist();

    return { success: true };
  }

  async customize(config: Partial<OutputStyleConfig>): Promise<{
    success: boolean;
    error?: string;
  }> {
    this.currentStyle = "default";
    this.customConfig = { ...this.customConfig, ...config };
    await this.persist();

    return { success: true };
  }

  async reset(): Promise<{
    success: boolean;
  }> {
    this.currentStyle = "default";
    this.customConfig = {};
    await this.persist();

    return { success: true };
  }

  getConfig(): OutputStyleConfig {
    const base = STYLE_CONFIGS[this.currentStyle] || STYLE_CONFIGS.default;
    return {
      style: this.currentStyle,
      ...base,
      ...this.customConfig,
    } as OutputStyleConfig;
  }

  getAvailableStyles(): Array<{ id: OutputStyle; label: string; description: string }> {
    return [
      {
        id: "default",
        label: "Default",
        description: "Balanced output with line numbers and syntax highlighting",
      },
      {
        id: "compact",
        label: "Compact",
        description: "Minimal output, no headers or extra info",
      },
      {
        id: "detailed",
        label: "Detailed",
        description: "Full output with extended code blocks",
      },
      {
        id: "minimal",
        label: "Minimal",
        description: "Ultra-compact, essential info only",
      },
      {
        id: "terse",
        label: "Terse",
        description: "Short and concise output",
      },
      {
        id: "verbose",
        label: "Verbose",
        description: "Maximum detail for debugging",
      },
    ];
  }

  formatCodeForDisplay(code: string, language: string): string {
    const config = this.getConfig();
    const lines = code.split("\n");

    if (config.maxCodeBlockLines && lines.length > config.maxCodeBlockLines) {
      const keptLines = lines.slice(0, config.maxCodeBlockLines);
      const removedCount = lines.length - config.maxCodeBlockLines;
      code = keptLines.join("\n") + `\n\n... ${removedCount} more lines (style: ${this.currentStyle})`;
    }

    if (config.showLineNumbers) {
      const numberedLines = code.split("\n").map((line, i) => 
        `${String(i + 1).padStart(3, " ")} | ${line}`
      );
      code = numberedLines.join("\n");
    }

    return code;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.styleFilePath), { recursive: true });
    await fs.writeFile(
      this.styleFilePath,
      JSON.stringify(
        { style: this.currentStyle, ...this.customConfig },
        null,
        2
      )
    );
  }
}

let globalStyleManager: OutputStyleManager | null = null;

export async function initializeOutputStyleManager(projectDir: string): Promise<OutputStyleManager> {
  globalStyleManager = new OutputStyleManager(projectDir);
  await globalStyleManager.initialize();
  return globalStyleManager;
}

export function getOutputStyleManager(): OutputStyleManager | null {
  return globalStyleManager;
}

export function getCurrentStyleConfig(): OutputStyleConfig | null {
  return globalStyleManager?.getConfig() || null;
}

export async function setOutputStyle(style: OutputStyle): Promise<boolean> {
  if (!globalStyleManager) return false;
  const result = await globalStyleManager.setStyle(style);
  return result.success;
}

export function getAvailableStyles(): Array<{ id: OutputStyle; label: string; description: string }> {
  return globalStyleManager?.getAvailableStyles() || [];
}