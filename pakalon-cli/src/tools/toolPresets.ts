/**
 * Tool Presets
 *
 * Named presets for different tool configurations. Allows defining
 * reusable tool configurations that can be applied to different
 * contexts or workflows.
 *
 * Strategy:
 * 1. Define named presets with tool configurations
 * 2. Apply presets to tool sets
 * 3. Support preset inheritance
 * 4. Allow runtime preset modification
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolPresetOptions {
  /** Whether to inherit from parent preset (default: true) */
  inherit?: boolean;
  /** Parent preset name */
  parent?: string;
}

export interface ToolPreset {
  /** Preset name */
  name: string;
  /** Preset description */
  description?: string;
  /** Tools to include */
  include?: string[];
  /** Tools to exclude */
  exclude?: string[];
  /** Tool-specific configurations */
  configs?: Record<string, Record<string, unknown>>;
  /** Whether preset is enabled (default: true) */
  enabled?: boolean;
  /** Parent preset for inheritance */
  parent?: string;
  /** Preset metadata */
  metadata?: Record<string, unknown>;
}

export interface ToolConfiguration {
  /** Tool name */
  name: string;
  /** Whether tool is enabled */
  enabled: boolean;
  /** Tool-specific settings */
  settings?: Record<string, unknown>;
  /** Tool permissions */
  permissions?: {
    read?: boolean;
    write?: boolean;
    execute?: boolean;
  };
}

export interface PresetApplicationResult {
  /** Applied preset name */
  presetName: string;
  /** Tools that were included */
  includedTools: string[];
  /** Tools that were excluded */
  excludedTools: string[];
  /** Tool configurations applied */
  configurations: ToolConfiguration[];
  /** Whether inheritance was used */
  usedInheritance: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preset Manager
// ─────────────────────────────────────────────────────────────────────────────

export class ToolPresetManager {
  private presets: Map<string, ToolPreset> = new Map();
  private appliedPresets: Map<string, PresetApplicationResult> = new Map();

  constructor() {
    // Register built-in presets
    this.registerBuiltInPresets();
  }

  /**
   * Register a preset.
   */
  register(preset: ToolPreset): void {
    this.presets.set(preset.name, preset);
    logger.debug('[ToolPresets] Registered preset', {
      name: preset.name,
      includeCount: preset.include?.length || 0,
      excludeCount: preset.exclude?.length || 0,
    });
  }

  /**
   * Unregister a preset.
   */
  unregister(name: string): boolean {
    return this.presets.delete(name);
  }

  /**
   * Get a preset by name.
   */
  get(name: string): ToolPreset | undefined {
    return this.presets.get(name);
  }

  /**
   * Get all presets.
   */
  getAll(): ToolPreset[] {
    return Array.from(this.presets.values());
  }

  /**
   * Apply a preset to a list of tools.
   */
  apply(
    presetName: string,
    tools: string[],
    options: ToolPresetOptions = {}
  ): PresetApplicationResult {
    const preset = this.presets.get(presetName);
    if (!preset) {
      throw new Error(`Preset "${presetName}" not found`);
    }

    const { inherit = true, parent } = options;

    // Resolve inheritance chain
    let resolvedPreset = { ...preset };
    if (inherit && preset.parent) {
      resolvedPreset = this.resolveInheritance(preset);
    } else if (parent) {
      const parentPreset = this.presets.get(parent);
      if (parentPreset) {
        resolvedPreset = this.mergePresets(parentPreset, preset);
      }
    }

    // Apply include/exclude filters
    const includedTools = tools.filter(tool => {
      if (resolvedPreset.exclude?.includes(tool)) {
        return false;
      }
      if (resolvedPreset.include?.length) {
        return resolvedPreset.include.includes(tool);
      }
      return true;
    });

    const excludedTools = tools.filter(tool =>
      resolvedPreset.exclude?.includes(tool) ||
      (resolvedPreset.include?.length && !resolvedPreset.include.includes(tool))
    );

    // Build tool configurations
    const configurations: ToolConfiguration[] = includedTools.map(tool => ({
      name: tool,
      enabled: true,
      settings: resolvedPreset.configs?.[tool] || {},
    }));

    const result: PresetApplicationResult = {
      presetName,
      includedTools,
      excludedTools,
      configurations,
      usedInheritance: !!preset.parent && inherit,
    };

    this.appliedPresets.set(presetName, result);

    logger.debug('[ToolPresets] Applied preset', {
      presetName,
      includedCount: includedTools.length,
      excludedCount: excludedTools.length,
      usedInheritance: result.usedInheritance,
    });

    return result;
  }

  /**
   * Resolve inheritance chain for a preset.
   */
  private resolveInheritance(preset: ToolPreset): ToolPreset {
    if (!preset.parent) {
      return preset;
    }

    const parentPreset = this.presets.get(preset.parent);
    if (!parentPreset) {
      return preset;
    }

    // Recursively resolve parent
    const resolvedParent = parentPreset.parent
      ? this.resolveInheritance(parentPreset)
      : parentPreset;

    return this.mergePresets(resolvedParent, preset);
  }

  /**
   * Merge two presets (child overrides parent).
   */
  private mergePresets(parent: ToolPreset, child: ToolPreset): ToolPreset {
    return {
      name: child.name,
      description: child.description || parent.description,
      include: [...(parent.include || []), ...(child.include || [])],
      exclude: [...(parent.exclude || []), ...(child.exclude || [])],
      configs: {
        ...(parent.configs || {}),
        ...(child.configs || {}),
      },
      enabled: child.enabled !== undefined ? child.enabled : parent.enabled,
      metadata: {
        ...(parent.metadata || {}),
        ...(child.metadata || {}),
      },
    };
  }

  /**
   * Get result of preset application.
   */
  getApplicationResult(presetName: string): PresetApplicationResult | undefined {
    return this.appliedPresets.get(presetName);
  }

  /**
   * Clear all presets and application results.
   */
  clear(): void {
    this.presets.clear();
    this.appliedPresets.clear();
  }

  /**
   * Register built-in presets.
   */
  private registerBuiltInPresets(): void {
    // Read-only preset
    this.register({
      name: 'read-only',
      description: 'Only allow read operations',
      include: [
        'Read',
        'Glob',
        'Grep',
        'WebSearch',
        'WebFetch',
        'LSP',
        'lsp_goto_definition',
        'lsp_hover',
        'lsp_find_references',
        'lsp_workspace_symbols',
        'lsp_diagnostics',
        'lsp_completion',
      ],
      exclude: [],
    });

    // Development preset
    this.register({
      name: 'development',
      description: 'Standard development tools',
      include: [
        'Read',
        'Glob',
        'Grep',
        'WebSearch',
        'WebFetch',
        'LSP',
        'lsp_*',
        'Edit',
        'Write',
        'Bash',
      ],
      exclude: [],
      configs: {
        Bash: {
          timeout: 30000,
          shell: 'bash',
        },
      },
    });

    // Security preset
    this.register({
      name: 'security',
      description: 'Security-focused tools',
      include: [
        'Read',
        'Glob',
        'Grep',
        'WebSearch',
        'WebFetch',
        'LSP',
        'lsp_*',
      ],
      exclude: [
        'Write',
        'Edit',
        'Bash',
      ],
    });

    // Minimal preset
    this.register({
      name: 'minimal',
      description: 'Minimal tool set',
      include: [
        'Read',
        'Grep',
      ],
      exclude: [],
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a tool preset manager.
 */
export function createToolPresetManager(): ToolPresetManager {
  return new ToolPresetManager();
}

/**
 * Create a custom preset.
 */
export function createPreset(
  name: string,
  options: {
    description?: string;
    include?: string[];
    exclude?: string[];
    configs?: Record<string, Record<string, unknown>>;
    parent?: string;
  }
): ToolPreset {
  return {
    name,
    ...options,
    enabled: true,
  };
}

export default ToolPresetManager;