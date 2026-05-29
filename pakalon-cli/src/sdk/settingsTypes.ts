/**
 * SDK Settings Types
 * Settings configuration types for the SDK
 */

/**
 * Model configuration
 */
export interface ModelConfig {
  provider?: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  thinkingBudget?: number;
}

/**
 * Appearance settings
 */
export interface AppearanceSettings {
  theme?: 'light' | 'dark' | 'system';
  color?: string;
  fontSize?: number;
  fontFamily?: string;
}

/**
 * Editor settings
 */
export interface EditorSettings {
  tabSize?: number;
  insertSpaces?: boolean;
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  lineNumbers?: 'on' | 'off' | 'relative';
  minimap?: boolean;
}

/**
 * Terminal settings
 */
export interface TerminalSettings {
  shell?: string;
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  scrollback?: number;
}

/**
 * Permission settings
 */
export interface PermissionSettings {
  allowBash?: boolean;
  allowEdit?: boolean;
  allowReject?: boolean;
  allowApprove?: boolean;
  trustedDirectories?: string[];
}

/**
 * MCP settings
 */
export interface McpSettings {
  servers?: Record<string, McpServerConfig>;
  enabled?: boolean;
}

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
}

/**
 * Analytics settings
 */
export interface AnalyticsSettings {
  enabled?: boolean;
  errorReporting?: boolean;
  usageStatistics?: boolean;
}

/**
 * Notification settings
 */
export interface NotificationSettings {
  enabled?: boolean;
  sound?: boolean;
  desktop?: boolean;
  mentionOnly?: boolean;
}

/**
 * Main Settings interface - combines all settings categories
 */
export interface Settings {
  version?: string;
  model?: ModelConfig;
  appearance?: AppearanceSettings;
  editor?: EditorSettings;
  terminal?: TerminalSettings;
  permissions?: PermissionSettings;
  mcp?: McpSettings;
  analytics?: AnalyticsSettings;
  notifications?: NotificationSettings;
  expansions?: Record<string, unknown>;
}

/**
 * Settings change event
 */
export interface SettingsChangeEvent {
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Settings validation result
 */
export interface SettingsValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Settings source (where settings were loaded from)
 */
export type SettingsSource = 'default' | 'global' | 'project' | 'env' | 'cli';